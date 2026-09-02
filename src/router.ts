import type { ProviderConfig } from "@oh-my-pi/pi-coding-agent";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { Effort } from "@oh-my-pi/pi-catalog/effort";
import type { Api, Model, ModelSpec } from "@oh-my-pi/pi-catalog/types";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import { streamSimple, type Context } from "@oh-my-pi/pi-ai";

import { factoryThinkingFor, familyOf, identityFor, upstreamProviderFor } from "./catalog";
import {
  ANTHROPIC_BETAS,
  ANTHROPIC_VERSION,
  FACTORY_HEADERS,
  FACTORY_OPENAI_PLATFORM_ORG,
  FACTORY_ORG_ID,
  FACTORY_DROID_SYSTEM_PROMPT,
  PROVIDER_ID,
  resolveFactoryApiBase,
} from "./constants";
import { parseFactoryCredential, type ParsedFactoryCredential } from "./credential";
import { createFactoryErrorStream, routeWithFactoryDiagnostics } from "./router-diagnostics";
import {
  createQuotaExhaustedStream,
  isQuotaPreflightEnabled,
  preflightQuotaCheck,
} from "./quota-gate";
import {
  factoryStreamMarkupHealingPattern,
  normalizeFactoryToolCallStream,
} from "./tool-call-normalization";
type FactoryTargetApi = "anthropic-messages" | "openai-responses" | "openai-completions";


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
  useClaudeThinkingInference: boolean,
): Model<FactoryTargetApi> {
  // Claude's Anthropic wire protocol changes by model generation. Leaving the
  // target unset lets pi-catalog select adaptive, budget-effort, or budget from
  // the Claude ID instead of reusing the custom provider's generic effort mode.
  const explicitThinking = useClaudeThinkingInference
    ? undefined
    : factoryThinkingFor(model.id, model.reasoning, model.thinking);
  const spec: ModelSpec<FactoryTargetApi> = {
    provider: PROVIDER_ID,
    id: model.id,
    name: model.name,
    api: targetApi,
    baseUrl:
      targetApi === "anthropic-messages" ? `${apiEndpoint}/api/llm/a` : `${apiEndpoint}/api/llm/o/v1`,
    reasoning: model.reasoning,
    thinking: explicitThinking,
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
  if (explicitThinking) {
    target.thinking = explicitThinking;
  }
  return target;
}

function streamSimpleDirect(
  model: Model<Api>,
  context: Context,
  options: Parameters<NonNullable<ProviderConfig["streamSimple"]>>[2],
  credential: ParsedFactoryCredential,
  targetApi: FactoryTargetApi,
  apiEndpoint: string,
): AssistantMessageEventStream {
  const effectiveOrgId =
    credential.source === "raw"
      ? (credential.orgId ?? FACTORY_ORG_ID)
      : credential.orgId;

  if (credential.source === "oauth-envelope" && !effectiveOrgId) {
    return createFactoryErrorStream(
      model,
      "factory: OAuth credential is missing an organization ID; run `/logout factory` and `/login factory`",
    );
  }

  const useClaudeThinkingInference = targetApi === "anthropic-messages" && model.id.startsWith("claude-");
  const target = buildFactoryTargetModel(
    model,
    targetApi,
    effectiveOrgId,
    apiEndpoint,
    useClaudeThinkingInference,
  );
  const routedContext = prepareContextForFactory(context);
  const hasTools = (routedContext.tools?.length ?? 0) > 0;
  const resolvedToolChoice = options?.toolChoice ?? (hasTools ? "auto" : undefined);
  const resolvedReasoning = normalizeReasoningEffort(options?.reasoning);

  const inner = streamSimple(target, routedContext, {
    ...options,
    ...(useClaudeThinkingInference
      ? {
          thinkingBudgets: {
            [Effort.High]: 24_576,
            ...(options?.thinkingBudgets ?? {}),
          },
        }
      : {}),
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
}

function wrapWithPreflightQuotaGate(
  model: Model<Api>,
  context: Context,
  options: Parameters<NonNullable<ProviderConfig["streamSimple"]>>[2],
  credential: ParsedFactoryCredential,
  targetApi: FactoryTargetApi,
  apiEndpoint: string,
): AssistantMessageEventStream {
  const outer = new AssistantMessageEventStream();

  void (async () => {
    if (options?.signal?.aborted) {
      outer.fail(options.signal.reason ?? new Error("Request was aborted"));
      return;
    }

    try {
      const decision = await preflightQuotaCheck({
        modelId: model.id,
        credential,
        apiEndpoint,
        fetchFn: options?.fetch,
        signal: options?.signal,
      });

      if (options?.signal?.aborted) {
        outer.fail(options.signal.reason ?? new Error("Request was aborted"));
        return;
      }

      if (!decision.allow && decision.tier) {
        const exhausted = createQuotaExhaustedStream(model, decision.tier, decision.resetAtMs);
        for await (const event of exhausted) outer.push(event);
        return;
      }
    } catch {
      // Unknown usage state must never prevent the real model request.
    }

    try {
      const inner = streamSimpleDirect(model, context, options, credential, targetApi, apiEndpoint);
      for await (const event of inner) outer.push(event);
      if (!outer.done) outer.end(await inner.result());
    } catch (error) {
      outer.fail(error);
    }
  })();

  return outer;
}

/** Explicit preflight flag is an internal seam for deterministic integration tests. */
export function routeFactoryStream(
  model: Model<Api>,
  context: Context,
  options?: Parameters<NonNullable<ProviderConfig["streamSimple"]>>[2],
  quotaPreflightEnabled = isQuotaPreflightEnabled(),
): AssistantMessageEventStream {
  const rawApiKey = typeof options?.apiKey === "string" ? options.apiKey : undefined;
  const credential = parseFactoryCredential(rawApiKey);

  if (!credential.access) {
    return createFactoryErrorStream(model, "factory: no Factory credential; run `/login factory`");
  }

  const targetApi = resolveTargetApi(model.id);

  if (!targetApi) {
    return createFactoryErrorStream(model, `factory: model ${model.id} is not supported in v1 (Gemini/other)`);
  }

  try {
    const apiEndpoint = resolveFactoryApiBase(credential.apiEndpoint);

    if (quotaPreflightEnabled) {
      return wrapWithPreflightQuotaGate(model, context, options, credential, targetApi, apiEndpoint);
    }

    return streamSimpleDirect(model, context, options, credential, targetApi, apiEndpoint);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createFactoryErrorStream(model, `factory: failed to route model ${model.id}: ${message}`);
  }
}

export const factoryStreamSimple: NonNullable<ProviderConfig["streamSimple"]> = routeFactoryStream;
