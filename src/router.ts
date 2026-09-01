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
  read: "Read",
  read_file: "Read",
  view_file: "Read",
  edit: "Edit",
  edit_file: "Edit",
  write: "Create",
  write_file: "Create",
  bash: "Execute",
  execute_bash: "Execute",
  exec: "Execute",
  grep: "Grep",
  grep_search: "Grep",
  find: "Find",
  find_files: "Find",
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
    if (droidName && !tool.customWireName) {
      return {
        ...tool,
        customWireName: droidName,
      };
    }
    return tool;
  });

  return {
    ...context,
    tools,
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

  const spec: ModelSpec<FactoryTargetApi> = {
    provider: PROVIDER_ID,
    id: model.id,
    name: model.name,
    api: targetApi,
    baseUrl,
    reasoning: model.reasoning,
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
