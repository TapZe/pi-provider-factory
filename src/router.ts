import type { ProviderConfig } from "@oh-my-pi/pi-coding-agent";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import type { Api, Model, ModelSpec } from "@oh-my-pi/pi-catalog/types";
import { createProviderErrorMessage } from "@oh-my-pi/pi-ai/providers/error-message";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import { streamSimple, type AssistantMessage, type Context } from "@oh-my-pi/pi-ai";

import { familyOf, upstreamProviderFor } from "./catalog";
import {
  ANTHROPIC_BETAS,
  ANTHROPIC_VERSION,
  FACTORY_API,
  FACTORY_API_BASE_OVERRIDDEN,
  FACTORY_HEADERS,
  FACTORY_OPENAI_PLATFORM_ORG,
  FACTORY_ORG_ID,
  FACTORY_DROID_SYSTEM_PROMPT,
  PROVIDER_ID,
} from "./constants";

type FactoryTargetApi = "anthropic-messages" | "openai-responses" | "openai-completions";

type ParsedCredential = {
  access?: string;
  orgId: string | null;
  apiEndpoint: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function firstStringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = stringField(record, key);

    if (value) {
      return value;
    }
  }

  return undefined;
}

function decodeBase64Url(segment: string): string {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`;

  return atob(padded);
}

function orgIdFromAccessToken(accessToken: string): string | null {
  const [, payloadSegment] = accessToken.split(".");

  if (!payloadSegment) {
    return null;
  }

  try {
    const payload: unknown = JSON.parse(decodeBase64Url(payloadSegment));

    if (!isRecord(payload)) {
      return null;
    }

    return (
      firstStringField(payload, ["external_org_id", "org_id", "organization_id", "organizationId", "orgId"]) ?? null
    );
  } catch {
    return null;
  }
}

function parseCredential(raw: string | undefined): ParsedCredential {
  if (!raw) {
    return { orgId: null, apiEndpoint: null };
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (isRecord(parsed) && typeof parsed.access === "string" && parsed.access.length > 0) {
      const parsedOrgId = typeof parsed.orgId === "string" && parsed.orgId.length > 0 ? parsed.orgId : null;

      return {
        access: parsed.access,
        orgId: parsedOrgId ?? orgIdFromAccessToken(parsed.access),
        apiEndpoint: typeof parsed.apiEndpoint === "string" && parsed.apiEndpoint.length > 0 ? parsed.apiEndpoint : null,
      };
    }
  } catch {
    return {
      access: raw,
      orgId: orgIdFromAccessToken(raw),
      apiEndpoint: null,
    };
  }
  return {
    access: raw,
    orgId: orgIdFromAccessToken(raw),
    apiEndpoint: null,
  };
}

function errorStream(model: Model<Api>, message: string): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const error = createProviderErrorMessage(model, new Error(message));
  stream.push({ type: "error", reason: "error", error });

  return stream;
}

type FactoryDiagnosticArgs = {
  model: Model<Api>;
  targetApi: FactoryTargetApi;
  credential: ParsedCredential;
  apiEndpoint: string;
};

function looksLikeFactoryForbidden(status: number | undefined, message: string | undefined): boolean {
  if (status === 403) {
    return true;
  }

  if (!message) {
    return false;
  }

  return message.startsWith("403") && /forbidden/i.test(message);
}

function redactIdentifier(value: string | null | undefined): string {
  if (!value) {
    return "missing";
  }

  if (value.length <= 12) {
    return value;
  }

  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function statusFromUnknownError(error: unknown): number | undefined {
  if (isRecord(error) && typeof error.status === "number") {
    return error.status;
  }

  return undefined;
}

function factoryForbiddenDiagnostic(args: FactoryDiagnosticArgs & { originalMessage: string | undefined }): string {
  const orgId = args.credential.orgId ?? FACTORY_ORG_ID;
  const redactedOrgId = redactIdentifier(orgId);
  const credentialApiEndpoint = args.credential.apiEndpoint ?? "default";
  const baseOverride = FACTORY_API_BASE_OVERRIDDEN ? "yes" : "no";
  const upstream = args.originalMessage ?? "403 Forbidden";

  return (
    `factory: Factory gateway returned 403 Forbidden for ${args.model.provider}/${args.model.id} ` +
    `via ${args.targetApi} at ${args.apiEndpoint}. ` +
    "The credential resolved, but Factory refused the LLM request. " +
    "Check Factory org/model entitlement for this account, unset FACTORY_API_KEY/FACTORY_API_BASE if they are " +
    "overriding OAuth, then run `/logout factory` and `/login factory` if the org changed. " +
    `Request context: X-Factory-Org-Id=${redactedOrgId}; credentialApiEndpoint=${credentialApiEndpoint}; ` +
    `FACTORY_API_BASE override=${baseOverride}. ` +
    `Upstream response: ${upstream}`
  );
}

function enrichFactoryForbiddenError(message: AssistantMessage, args: FactoryDiagnosticArgs): AssistantMessage {
  if (!looksLikeFactoryForbidden(message.errorStatus, message.errorMessage)) {
    return message;
  }

  return {
    ...message,
    errorMessage: factoryForbiddenDiagnostic({ ...args, originalMessage: message.errorMessage }),
  };
}

function wrapThrownFactoryForbidden(error: unknown, args: FactoryDiagnosticArgs): unknown {
  if (!(error instanceof Error) || !looksLikeFactoryForbidden(statusFromUnknownError(error), error.message)) {
    return error;
  }

  return new Error(factoryForbiddenDiagnostic({ ...args, originalMessage: error.message }), { cause: error });
}

function routeWithFactoryDiagnostics(
  inner: AssistantMessageEventStream,
  args: FactoryDiagnosticArgs,
): AssistantMessageEventStream {
  const outer = new AssistantMessageEventStream();

  void (async () => {
    try {
      for await (const event of inner) {
        if (event.type === "error") {
          outer.push({ ...event, error: enrichFactoryForbiddenError(event.error, args) });
        } else {
          outer.push(event);
        }

        if (outer.done) {
          return;
        }
      }

      if (!outer.done) {
        outer.end(await inner.result());
      }
    } catch (error) {
      outer.fail(wrapThrownFactoryForbidden(error, args));
    }
  })();

  return outer;
}

function targetApiFor(modelId: string): FactoryTargetApi | null {
  // MiniMax is a Droid Core (open) model, but Factory serves it through the
  // Anthropic-compatible endpoint (observed in droid 0.153.1), not the OpenAI
  // chat-completions endpoint used by the other open models.
  if (modelId.startsWith("minimax-")) {
    return "anthropic-messages";
  }

  switch (familyOf(modelId)) {
    case "anthropic":
      return "anthropic-messages";
    case "openai-responses":
      return "openai-responses";
    case "openai-completions":
      return "openai-completions";
    case "unsupported":
      return null;
  }
}

function randomHeaderId(prefix: string): string {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function buildRequestHeaders(options: Parameters<NonNullable<ProviderConfig["streamSimple"]>>[2]): Record<string, string> {
  return {
    "x-session-id": options?.sessionId ?? randomHeaderId("session"),
    "x-assistant-message-id": randomHeaderId("assistant"),
  };
}

const DROID_TOOL_NAME_MAP: Record<string, string> = {
  // Execute (Bash / Terminal / CLI)
  bash: "Execute",
  shell: "Execute",
  runcommand: "Execute",
  executecommand: "Execute",
  exec: "Execute",
  run: "Execute",
  terminal: "Execute",
  bashtool: "Execute",
  bash_tool: "Execute",
  "bash-tool": "Execute",
  run_command: "Execute",
  "run-command": "Execute",
  execute_command: "Execute",
  "execute-command": "Execute",
  execute_terminal_command: "Execute",
  "execute-terminal-command": "Execute",
  execute_bash: "Execute",
  "execute-bash": "Execute",
  execute_cli: "Execute",
  "execute-cli": "Execute",
  command: "Execute",

  // Read (Files / Cat)
  read: "Read",
  readfile: "Read",
  fileread: "Read",
  file_read: "Read",
  "file-read": "Read",
  read_file: "Read",
  "read-file": "Read",
  read_cli: "Read",
  "read-cli": "Read",
  view_file: "Read",
  "view-file": "Read",
  open_file: "Read",
  "open-file": "Read",
  cat: "Read",

  // Create (Write / File Creation)
  write: "Create",
  writefile: "Create",
  write_file: "Create",
  "write-file": "Create",
  createfile: "Create",
  create_file: "Create",
  "create-file": "Create",
  create_cli: "Create",
  "create-cli": "Create",

  // Edit (File Editing / Multiedit)
  edit: "Edit",
  editfile: "Edit",
  edit_file: "Edit",
  "edit-file": "Edit",
  edit_cli: "Edit",
  "edit-cli": "Edit",
  multiedit: "Edit",
  multi_edit: "Edit",
  "multi-edit": "Edit",
  ast_edit: "Edit",
  "ast-edit": "Edit",

  // ApplyPatch
  apply_patch: "ApplyPatch",
  "apply-patch": "ApplyPatch",
  apply_patch_cli: "ApplyPatch",
  "apply-patch-cli": "ApplyPatch",

  // Grep (Content / Pattern Search)
  grep: "Grep",
  grep_tool: "Grep",
  "grep-tool": "Grep",
  greptool: "Grep",
  grep_tool_cli: "Grep",
  grep_search_cli: "Grep",
  "grep-search-cli": "Grep",
  grep_search: "Grep",
  "grep-search": "Grep",
  search: "Grep",
  search_tool_bm25: "Grep",
  ast_grep: "Grep",
  "ast-grep": "Grep",
  rg: "Grep",
  ripgrep: "Grep",

  // Glob (File finding / name search)
  glob: "Glob",
  glob_tool: "Glob",
  "glob-tool": "Glob",
  globtool: "Glob",
  glob_search_cli: "Glob",
  "glob-search-cli": "Glob",
  search_files: "Glob",
  "search-files": "Glob",
  searchfiles: "Glob",
  find: "Glob",
  find_files: "Glob",
  "find-files": "Glob",

  // LS (Directory Listing)
  ls: "LS",
  dir: "LS",
  list_dir: "LS",
  "list-dir": "LS",
  listfiles: "LS",
  list_files: "LS",
  "list-files": "LS",
  list_folder: "LS",
  "list-folder": "LS",
  listfolder: "LS",
  view_folder: "LS",
  "view-folder": "LS",
  viewfolder: "LS",
  ls_cli: "LS",
  "ls-cli": "LS",

  // Web & URL Fetching
  web_search: "WebSearch",
  "web-search": "WebSearch",
  websearch: "WebSearch",
  fetch: "FetchUrl",
  fetch_url: "FetchUrl",
  "fetch-url": "FetchUrl",
  fetchurl: "FetchUrl",

  // User Interaction & Todos
  ask: "AskUser",
  ask_user: "AskUser",
  "ask-user": "AskUser",
  ask_user_cli: "AskUser",
  "ask-user-cli": "AskUser",
  askuser: "AskUser",
  todo: "TodoWrite",
  todo_write: "TodoWrite",
  "todo-write": "TodoWrite",
  todowrite: "TodoWrite",

  // Tasks & Subagents
  task: "Task",
  task_cli: "Task",
  "task-cli": "Task",
  subagent: "Task",
  sub_agent: "Task",
  "sub-agent": "Task",
  task_output: "TaskOutput",
  "task-output": "TaskOutput",
  task_output_cli: "TaskOutput",
  "task-output-cli": "TaskOutput",
  task_stop: "TaskStop",
  "task-stop": "TaskStop",
  task_stop_cli: "TaskStop",
  "task-stop-cli": "TaskStop",

  // Tools & Skills & Loops
  tool_search: "ToolSearch",
  "tool-search": "ToolSearch",
  tool_search_cli: "ToolSearch",
  "tool-search-cli": "ToolSearch",
  manage_skill: "Skill",
  skill: "Skill",
  skill_cli: "Skill",
  "skill-cli": "Skill",
  schedule: "Loop",
  croncreate: "Loop",
  "cron-create-cli": "Loop",
  cronlist: "Loop",
  "cron-list-cli": "Loop",
  crondelete: "Loop",
  "cron-delete-cli": "Loop",
};

// Factory's gateway requires requests to carry Droid's system prompt prefix
// ("You are Droid, an AI software engineering agent built by Factory.")
// Requests missing this prefix or with system stripped return 403 Forbidden.
// We ensure the required Droid prefix is at the start of the system prompt array,
// and tools are aliased to Droid's fine-tuned PascalCase names on the wire.
export function prepareContextForFactory(context: Context): Context {
  const existingPrompts = context.systemPrompt?.filter((part) => part.length > 0) ?? [];
  const alreadyHasDroidPrefix = existingPrompts.some((p) =>
    p.includes("You are Droid, an AI software engineering agent built by Factory"),
  );

  const tools = context.tools?.map((tool) => {
    const droidName = DROID_TOOL_NAME_MAP[tool.name.toLowerCase()];
    if (droidName) {
      return {
        ...tool,
        name: droidName,
        customWireName: droidName,
      };
    }
    return tool;
  });

  const messages = context.messages?.map((msg) => {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const content = msg.content.map((block) => {
        if (block.type === "toolCall") {
          const droidName = DROID_TOOL_NAME_MAP[block.name.toLowerCase()];
          if (droidName) {
            return {
              ...block,
              name: droidName,
              customWireName: droidName,
            };
          }
        }
        return block;
      });
      return { ...msg, content };
    }

    if (msg.role === "toolResult") {
      const candidate = msg.toolName ?? ((msg as unknown as Record<string, unknown>).name as string | undefined);
      const droidName = candidate ? DROID_TOOL_NAME_MAP[candidate.toLowerCase()] : undefined;
      if (droidName) {
        return {
          ...msg,
          toolName: droidName,
          customWireName: droidName,
        };
      }
    }

    return msg;
  });

  return {
    ...context,
    tools,
    messages: messages ?? context.messages,
    systemPrompt: alreadyHasDroidPrefix ? existingPrompts : [FACTORY_DROID_SYSTEM_PROMPT, ...existingPrompts],
  };
}

function buildTargetModel(
  model: Model<Api>,
  targetApi: FactoryTargetApi,
  orgId: string | null,
  apiEndpoint: string,
): Model<FactoryTargetApi> {
  const isAnthropic = targetApi === "anthropic-messages";
  const baseUrl = isAnthropic ? `${apiEndpoint}/api/llm/a` : `${apiEndpoint}/api/llm/o/v1`;
  const headers: Record<string, string> = { ...FACTORY_HEADERS, "x-api-provider": upstreamProviderFor(model.id) };

  if (isAnthropic) {
    headers["anthropic-version"] = ANTHROPIC_VERSION;
    headers["anthropic-beta"] = ANTHROPIC_BETAS;
  }

  if (targetApi === "openai-responses") {
    headers["OpenAI-Platform"] = FACTORY_OPENAI_PLATFORM_ORG;
  }

  if (orgId) {
    headers["X-Factory-Org-Id"] = orgId;
  }

  const isGlm = model.id.startsWith("glm-");
  const isDeepseek = model.id.startsWith("deepseek-");
  const isKimi = model.id.startsWith("kimi-");
  const markupPattern = isGlm || isDeepseek ? "thinking" : isKimi ? "kimi" : undefined;

  const compat: ModelSpec<FactoryTargetApi>["compat"] =
    targetApi === "openai-completions"
      ? {
          extraBody: {
            reasoning_history: "preserved",
          },
          streamMarkupHealingPattern: markupPattern,
          requiresReasoningContentForToolCalls: true,
          allowsSyntheticReasoningContentForToolCalls: true,
          requiresAssistantContentForToolCalls: true,
        }
      : undefined;

  const spec: ModelSpec<FactoryTargetApi> = {
    provider: PROVIDER_ID,
    id: model.id,
    name: model.name,
    api: targetApi,
    baseUrl,
    reasoning: model.reasoning,
    compat,
    input: model.input,
    cost: model.cost,
    premiumMultiplier: model.premiumMultiplier,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    headers,
  };

  return buildModel(spec);
}

export const factoryStreamSimple: NonNullable<ProviderConfig["streamSimple"]> = (model, context, options) => {
  const rawApiKey = typeof options?.apiKey === "string" ? options.apiKey : undefined;
  const credential = parseCredential(rawApiKey);

  if (!credential.access) {
    return errorStream(model, "factory: no Factory credential; run `/login factory`");
  }

  const targetApi = targetApiFor(model.id);

  if (!targetApi) {
    return errorStream(model, `factory: model ${model.id} is not supported in v1 (Gemini/other)`);
  }

  try {
    const apiEndpoint = FACTORY_API_BASE_OVERRIDDEN ? FACTORY_API : credential.apiEndpoint ?? FACTORY_API;
    const target = buildTargetModel(model, targetApi, credential.orgId ?? FACTORY_ORG_ID, apiEndpoint);

    const routedContext = prepareContextForFactory(context);
    const hasTools = (routedContext.tools && routedContext.tools.length > 0) ?? false;
    const resolvedToolChoice = options?.toolChoice ?? (hasTools ? "auto" : undefined);

    const inner = streamSimple(target, routedContext, {
      ...options,
      toolChoice: resolvedToolChoice,
      apiKey: credential.access,
      headers: {
        ...buildRequestHeaders(options),
        ...(options?.headers ?? {}),
      },
    });

    return routeWithFactoryDiagnostics(inner, { model, targetApi, credential, apiEndpoint });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return errorStream(model, `factory: failed to route model ${model.id}: ${message}`);
  }
};
