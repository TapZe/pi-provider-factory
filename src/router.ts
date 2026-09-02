import type { ProviderConfig } from "@oh-my-pi/pi-coding-agent";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { Effort } from "@oh-my-pi/pi-catalog/effort";
import type { Api, Model, ModelSpec } from "@oh-my-pi/pi-catalog/types";
import { createProviderErrorMessage } from "@oh-my-pi/pi-ai/providers/error-message";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import { streamSimple, type AssistantMessage, type Context } from "@oh-my-pi/pi-ai";

import { factoryThinkingFor, familyOf, identityFor, upstreamProviderFor } from "./catalog";
import {
  ANTHROPIC_BETAS,
  ANTHROPIC_VERSION,
  FACTORY_API_BASE_OVERRIDDEN,
  FACTORY_HEADERS,
  FACTORY_OPENAI_PLATFORM_ORG,
  FACTORY_ORG_ID,
  FACTORY_DROID_SYSTEM_PROMPT,
  PROVIDER_ID,
  resolveFactoryApiBase,
} from "./constants";
import { parseFactoryCredential, type ParsedFactoryCredential } from "./credential";
import { isRecord } from "./object-fields";
import { factoryStreamMarkupHealingPattern, normalizeFactoryToolCallStream } from "./tool-call-normalization";

type FactoryTargetApi = "anthropic-messages" | "openai-responses" | "openai-completions";


function errorStream(model: Model<Api>, message: string): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const error = createProviderErrorMessage(model, new Error(message));
  stream.push({ type: "error", reason: "error", error });

  return stream;
}

type FactoryDiagnosticArgs = {
  model: Model<Api>;
  targetApi: FactoryTargetApi;
  credential: ParsedFactoryCredential;
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

function resolveTargetApi(modelId: string): FactoryTargetApi | null {
  // MiniMax is a Droid Core model, but Factory serves it through the
  // Anthropic-compatible endpoint rather than chat completions.
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

function normalizeReasoningEffort(effort: Effort | undefined): Effort | undefined {
  const effortName = effort as string | undefined;
  return !effortName || effortName === "off" || effortName === "none" ? undefined : effort;
}

// Factory's gateway requires requests to carry Droid's system prompt prefix
// ("You are Droid, an AI software engineering agent built by Factory.")
// Requests missing this prefix or with system stripped return 403 Forbidden.
export function prepareContextForFactory(context: Context): Context {
  const existingPrompts = context.systemPrompt?.filter((part) => part.length > 0) ?? [];
  const alreadyHasDroidPrefix = existingPrompts.some((prompt) =>
    prompt.includes("You are Droid, an AI software engineering agent built by Factory"),
  );

  return {
    ...context,
    systemPrompt: alreadyHasDroidPrefix ? existingPrompts : [FACTORY_DROID_SYSTEM_PROMPT, ...existingPrompts],
  };
}

function buildTargetHeaders(modelId: string, targetApi: FactoryTargetApi, orgId: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    ...FACTORY_HEADERS,
    "x-api-provider": upstreamProviderFor(modelId),
  };

  if (targetApi === "anthropic-messages") {
    headers["anthropic-version"] = ANTHROPIC_VERSION;
    headers["anthropic-beta"] = ANTHROPIC_BETAS;
  }

  if (targetApi === "openai-responses") {
    headers["OpenAI-Platform"] = FACTORY_OPENAI_PLATFORM_ORG;
  }

  if (orgId) {
    headers["X-Factory-Org-Id"] = orgId;
  }

  return headers;
}

function buildCompletionCompatibility(
  modelId: string,
  targetApi: FactoryTargetApi,
): ModelSpec<FactoryTargetApi>["compat"] {
  if (targetApi !== "openai-completions") {
    return undefined;
  }

  const isDeepseek = modelId.startsWith("deepseek-");
  return {
    extraBody: {
      reasoning_history: isDeepseek ? "interleaved" : "preserved",
    },
    streamMarkupHealingPattern: factoryStreamMarkupHealingPattern(modelId),
    stripDeepseekSpecialTokens: isDeepseek,
    requiresToolResultName: modelId.startsWith("kimi-"),
    requiresReasoningContentForToolCalls: true,
    requiresReasoningContentForAllAssistantTurns: isDeepseek,
    allowsSyntheticReasoningContentForToolCalls: !isDeepseek,
    requiresAssistantContentForToolCalls: true,
  };
}

function buildFactoryTargetModel(
  model: Model<Api>,
  targetApi: FactoryTargetApi,
  orgId: string | null,
  apiEndpoint: string,
): Model<FactoryTargetApi> {
  const thinking = factoryThinkingFor(model.id, model.reasoning, model.thinking);
  const spec: ModelSpec<FactoryTargetApi> = {
    provider: PROVIDER_ID,
    id: model.id,
    name: model.name,
    api: targetApi,
    baseUrl:
      targetApi === "anthropic-messages" ? `${apiEndpoint}/api/llm/a` : `${apiEndpoint}/api/llm/o/v1`,
    reasoning: model.reasoning,
    thinking,
    supportsTools: true,
    compat: buildCompletionCompatibility(model.id, targetApi),
    input: model.input,
    cost: model.cost,
    premiumMultiplier: model.premiumMultiplier,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    headers: buildTargetHeaders(model.id, targetApi, orgId),
  };

  const target = Object.assign(buildModel(spec), { identity: identityFor(model.id) });
  if (thinking) {
    target.thinking = thinking;
  }
  return target;
}

export const factoryStreamSimple: NonNullable<ProviderConfig["streamSimple"]> = (model, context, options) => {
  const rawApiKey = typeof options?.apiKey === "string" ? options.apiKey : undefined;
  const credential = parseFactoryCredential(rawApiKey);

  if (!credential.access) {
    return errorStream(model, "factory: no Factory credential; run `/login factory`");
  }

  const targetApi = resolveTargetApi(model.id);

  if (!targetApi) {
    return errorStream(model, `factory: model ${model.id} is not supported in v1 (Gemini/other)`);
  }

  try {
    const apiEndpoint = resolveFactoryApiBase(credential.apiEndpoint);
    const target = buildFactoryTargetModel(model, targetApi, credential.orgId ?? FACTORY_ORG_ID, apiEndpoint);

    const routedContext = prepareContextForFactory(context);
    const hasTools = (routedContext.tools?.length ?? 0) > 0;
    const resolvedToolChoice = options?.toolChoice ?? (hasTools ? "auto" : undefined);
    const resolvedReasoning = normalizeReasoningEffort(options?.reasoning);

    const inner = streamSimple(target, routedContext, {
      ...options,
      reasoning: resolvedReasoning,
      toolChoice: resolvedToolChoice,
      apiKey: credential.access,
      headers: {
        ...buildRequestHeaders(options),
        ...(options?.headers ?? {}),
      },
    });
    const normalized = normalizeFactoryToolCallStream(
      inner,
      routedContext.tools,
      targetApi === "openai-completions",
    );

    return routeWithFactoryDiagnostics(normalized, { model, targetApi, credential, apiEndpoint });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return errorStream(model, `factory: failed to route model ${model.id}: ${message}`);
  }
};
