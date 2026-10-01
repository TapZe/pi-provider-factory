import { Effort } from "@oh-my-pi/pi-ai";
import type { ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";

import { CUSTOM_API } from "./constants";

export type FactoryModelFamily =
  | "anthropic"
  | "openai-responses"
  | "openai-completions"
  | "google"
  | "unsupported";

const FACTORY_MAX_EFFORT = "max" as Effort;

export const FACTORY_EFFORTS = [
  Effort.Minimal,
  Effort.Low,
  Effort.Medium,
  Effort.High,
  Effort.XHigh,
  FACTORY_MAX_EFFORT,
] as const;

export interface ModelIdentity {
  class: string;
  family?: string;
  revision?: string;
  effort?: Effort | "off";
  thinkingVariant?: boolean;
  logicalId?: string;
}

export type FactoryModelInput = {
  id: string;
  name: string;
  reasoning: boolean;
  thinking?: ProviderModelConfig["thinking"];
  input: ProviderModelConfig["input"];
  contextWindow: number;
  maxTokens: number;
  cost?: ProviderModelConfig["cost"];
  premiumMultiplier?: number;
};

export function defaultCostFor(id: string): ProviderModelConfig["cost"] {
  // Claude family
  if (id.startsWith("claude-fable-")) {
    return { input: 10, output: 50, cacheRead: 1.0, cacheWrite: 12.5 };
  }
  if (id.startsWith("claude-opus-5-5-fast")) {
    return { input: 8, output: 40, cacheRead: 0.8, cacheWrite: 10 };
  }
  if (id.startsWith("claude-opus-5-5")) {
    return { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 };
  }
  if (id.includes("-fast") && id.startsWith("claude-opus-")) {
    return { input: 10, output: 50, cacheRead: 1.0, cacheWrite: 12.5 };
  }
  if (id.startsWith("claude-opus-")) {
    return { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };
  }
  if (id.startsWith("claude-sonnet-5")) {
    return { input: 2.0, output: 10.0, cacheRead: 0.2, cacheWrite: 2.5 };
  }
  if (id.startsWith("claude-sonnet-")) {
    return { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 };
  }
  if (id.startsWith("claude-haiku-")) {
    return { input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite: 1.25 };
  }
  if (id.startsWith("atlas-") || id.startsWith("aster-")) {
    return { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 };
  }

  // GPT family (OpenAI does not bill prompt cache creation / cacheWrite = 0)
  if (
    id === "gpt-6-astra" ||
    id.startsWith("gpt-6-astra") ||
    id === "gpt6-astra" ||
    id.startsWith("gpt6-astra")
  ) {
    return { input: 10, output: 50, cacheRead: 1.0, cacheWrite: 0 };
  }
  // Factory publishes only GPT-6.1 Sol's 0.8x subscription multiplier, not
  // token prices; use the existing GPT-6 Sol estimate until live pricing resolves.
  if (
    id === "gpt-6-sol" ||
    id.startsWith("gpt-6-sol-") ||
    id === "gpt-6.1-sol" ||
    id.startsWith("gpt-6.1-sol-")
  ) {
    return { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 };
  }
  if (id === "gpt-6-luna" || id.startsWith("gpt-6-luna-")) {
    return { input: 0.1, output: 0.6, cacheRead: 0.01, cacheWrite: 0 };
  }
  if (id === "gpt-5.6-sol-fast" || id.startsWith("gpt-5.6-sol-fast")) {
    return { input: 10, output: 60, cacheRead: 1.0, cacheWrite: 0 };
  }
  if (id === "gpt-5.6-sol" || id.startsWith("gpt-5.6-sol-")) {
    return { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 };
  }
  if (id === "gpt-5.6-terra" || id.startsWith("gpt-5.6-terra-")) {
    return { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 };
  }
  if (id === "gpt-5.6-luna" || id.startsWith("gpt-5.6-luna-")) {
    return { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0 };
  }
  if (id.startsWith("gpt-5.5-pro")) {
    return { input: 30, output: 180, cacheRead: 3.0, cacheWrite: 0 };
  }
  if (id.startsWith("gpt-5.5-fast")) {
    return { input: 10, output: 60, cacheRead: 1.0, cacheWrite: 0 };
  }
  if (id.startsWith("gpt-5.5")) {
    return { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 };
  }
  if (id.startsWith("gpt-5.4-mini-fast")) {
    return { input: 1.5, output: 9.0, cacheRead: 0.15, cacheWrite: 0 };
  }
  if (id.startsWith("gpt-5.4-mini")) {
    return { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 };
  }
  if (id.startsWith("gpt-5.4-fast")) {
    return { input: 5.0, output: 30.0, cacheRead: 0.5, cacheWrite: 0 };
  }
  if (id.startsWith("gpt-5.4")) {
    return { input: 2.5, output: 15.0, cacheRead: 0.25, cacheWrite: 0 };
  }
  if (id.startsWith("gpt-5.3-codex-fast")) {
    return { input: 3.5, output: 28.0, cacheRead: 0.35, cacheWrite: 0 };
  }
  if (id.startsWith("gpt-5.3-codex") || id.startsWith("gpt-5.2")) {
    return { input: 1.75, output: 14.0, cacheRead: 0.175, cacheWrite: 0 };
  }

  // Grok family
  if (id.startsWith("grok-")) {
    return { input: 2.0, output: 10.0, cacheRead: 0.5, cacheWrite: 0 };
  }

  // Core Open Models (Fireworks / Standard host rates)
  if (id === "inkling" || id.startsWith("inkling-")) {
    return { input: 1.0, output: 3.0, cacheRead: 0.1, cacheWrite: 0 };
  }
  // `deepseek-v4.1-*` keeps its own branch: the static catalog entry plus any
  // future docs-published V4.1 revisions bill below the generic DeepSeek rate.
  if (id === "deepseek-v4.1-flash" || id.startsWith("deepseek-v4.1-")) {
    return { input: 0.1, output: 0.27, cacheRead: 0.01, cacheWrite: 0 };
  }
  if (id.startsWith("deepseek-v4-flash")) {
    return { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 };
  }
  if (id.startsWith("deepseek-v4-pro") || id.startsWith("deepseek-")) {
    return { input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0 };
  }
  if (id.startsWith("glm-5.2-fast")) {
    return { input: 1.8, output: 6.0, cacheRead: 0.3, cacheWrite: 0 };
  }
  if (id === "glm-5.3-flash" || id.startsWith("glm-5.3-flash")) {
    return { input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0 };
  }
  if (id.startsWith("glm-5.3") || id.startsWith("glm-5.1")) {
    return { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 };
  }
  if (id.startsWith("glm-")) {
    return { input: 1.0, output: 3.2, cacheRead: 0.2, cacheWrite: 0 };
  }
  if (id.startsWith("kimi-k3")) {
    return { input: 1.5, output: 6.0, cacheRead: 0.2, cacheWrite: 0 };
  }
  if (id.startsWith("kimi-k2.7") || id.startsWith("kimi-k2.6")) {
    return { input: 0.95, output: 4.0, cacheRead: 0.19, cacheWrite: 0 };
  }
  if (id.startsWith("kimi-k2.5") || id.startsWith("kimi-")) {
    return { input: 0.6, output: 3.0, cacheRead: 0.1, cacheWrite: 0 };
  }
  if (id.startsWith("minimax-m3")) {
    return { input: 0.12, output: 0.48, cacheRead: 0.012, cacheWrite: 0 };
  }
  if (id.startsWith("minimax-")) {
    return { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 };
  }
  if (id.startsWith("nemotron-")) {
    return { input: 0.4, output: 1.0, cacheRead: 0.04, cacheWrite: 0 };
  }
  if (id.startsWith("qwen")) {
    return { input: 0.8, output: 2.4, cacheRead: 0.08, cacheWrite: 0 };
  }
  if (id.startsWith("mistral-")) {
    return { input: 0.6, output: 3.0, cacheRead: 0.06, cacheWrite: 0 };
  }

  // Google Gemini & Garnet family
  if (id.startsWith("garnet-")) {
    return { input: 0.6, output: 2.4, cacheRead: 0.06, cacheWrite: 0 };
  }
  if (id.startsWith("gemini-3.1-pro") || id.startsWith("gemini-3-pro")) {
    return { input: 2.0, output: 8.0, cacheRead: 0.5, cacheWrite: 0 };
  }
  if (
    id.startsWith("gemini-3.8-flash") ||
    id.startsWith("gemini-3.7-flash") ||
    id.startsWith("gemini-3.6-flash") ||
    id.startsWith("gemini-3.5-flash")
  ) {
    return { input: 0.3, output: 1.5, cacheRead: 0.075, cacheWrite: 0 };
  }
  if (id.startsWith("gemini-3-flash") || id.startsWith("gemini-")) {
    return { input: 0.15, output: 0.6, cacheRead: 0.0375, cacheWrite: 0 };
  }

  // Default fallback
  return { input: 1.0, output: 3.0, cacheRead: 0.1, cacheWrite: 0 };
}

export function factoryThinkingFor(
  modelId: string,
  reasoning: boolean,
  configuredThinking: ProviderModelConfig["thinking"] | undefined,
): ProviderModelConfig["thinking"] {
  if (configuredThinking) {
    return configuredThinking;
  }

  if (!reasoning) {
    return undefined;
  }

  if (familyOf(modelId) === "google") {
    const supportsMinimal = modelId === "gemini-3-flash-preview" || modelId === "gemini-3.5-flash";
    return {
      mode: "google-level",
      efforts: supportsMinimal
        ? [Effort.Minimal, Effort.Low, Effort.Medium, Effort.High]
        : [Effort.Low, Effort.Medium, Effort.High],
      defaultLevel: Effort.High,
    };
  }

  if (modelId.startsWith("atlas-") || modelId.startsWith("aster-")) {
    return {
      mode: "anthropic-adaptive",
      efforts: [Effort.Minimal, Effort.Low, Effort.Medium, Effort.High, Effort.XHigh],
      supportsDisplay: true,
    };
  }

  const supportsExtraHighEffort =
    modelId === "grok-4.6" ||
    modelId === "grok-4.7" ||
    modelId.startsWith("gpt-6") ||
    modelId.startsWith("gpt-5.6") ||
    modelId.startsWith("glm-5.3") ||
    modelId.startsWith("claude-opus-5") ||
    modelId.startsWith("claude-sonnet-5") ||
    modelId.startsWith("claude-fable-5") ||
    modelId.startsWith("qwen");

  return {
    mode: "effort",
    efforts: FACTORY_EFFORTS,
    defaultLevel: Effort.High,
    effortMap: supportsExtraHighEffort
      ? { [Effort.Minimal]: "low", [FACTORY_MAX_EFFORT]: "xhigh" }
      : { [Effort.Minimal]: "low", [Effort.XHigh]: "high", [FACTORY_MAX_EFFORT]: "high" },
  };
}

export function factoryModel(config: FactoryModelInput): ProviderModelConfig {
  const thinking = factoryThinkingFor(config.id, config.reasoning, config.thinking);

  return {
    id: config.id,
    name: config.name,
    api: CUSTOM_API,
    reasoning: config.reasoning,
    thinking,
    input: config.input,
    cost: config.cost ?? defaultCostFor(config.id),
    premiumMultiplier: config.premiumMultiplier,
    contextWindow: config.contextWindow,
    maxTokens: config.maxTokens,
  };
}

// `contextWindow` is the total context exposed to OMP, not Droid's smaller
// `maxInputTokens` compaction threshold. Prefer the upstream total window; use
// Droid's lower hosted-route cap when Factory deliberately constrains a model.
// `maxTokens` mirrors Droid's synchronous request ceiling for that route.
export const FACTORY_MODELS: ProviderModelConfig[] = [
  // Claude and Anthropic-family models
  factoryModel({
    id: "claude-fable-5.1",
    name: "Claude Fable 5.1 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 995_000,
    maxTokens: 128_000,
    premiumMultiplier: 4,
  }),
  factoryModel({
    id: "claude-fable-5",
    name: "Claude Fable 5 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 995_000,
    maxTokens: 128000,
    premiumMultiplier: 4,
  }),
  factoryModel({
    id: "claude-opus-5-5",
    name: "Claude Opus 5.5 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    premiumMultiplier: 1.6,
  }),
  factoryModel({
    id: "claude-opus-5-5-fast",
    name: "Claude Opus 5.5 Fast (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    premiumMultiplier: 3.2,
  }),
  factoryModel({
    id: "claude-opus-5",
    name: "Claude Opus 5 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 995_000,
    maxTokens: 128_000,
    premiumMultiplier: 2,
  }),
  factoryModel({
    id: "claude-opus-5-fast",
    name: "Claude Opus 5 Fast (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 995_000,
    maxTokens: 128_000,
    premiumMultiplier: 4,
  }),
  factoryModel({
    id: "claude-opus-4-8",
    name: "Claude Opus 4.8 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 995_000,
    maxTokens: 128_000,
    premiumMultiplier: 2,
  }),
  factoryModel({
    id: "claude-opus-4-8-fast",
    name: "Claude Opus 4.8 Fast (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 995_000,
    maxTokens: 128_000,
    premiumMultiplier: 4,
  }),
  factoryModel({
    id: "claude-opus-4-7",
    name: "Claude Opus 4.7 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 995_000,
    maxTokens: 128_000,
    premiumMultiplier: 2,
  }),
  factoryModel({
    id: "claude-opus-4-7-fast",
    name: "Claude Opus 4.7 Fast [Deprecated] (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 995_000,
    maxTokens: 128_000,
    premiumMultiplier: 4,
  }),
  factoryModel({
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 995_000,
    maxTokens: 128_000,
    premiumMultiplier: 2,
  }),
  factoryModel({
    id: "claude-opus-4-6-fast",
    name: "Claude Opus 4.6 Fast [Deprecated] (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 995_000,
    maxTokens: 128_000,
    premiumMultiplier: 4,
  }),
  factoryModel({
    id: "claude-opus-4-5-20251101",
    name: "Claude Opus 4.5 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 64000,
    premiumMultiplier: 2,
  }),
  factoryModel({
    id: "claude-sonnet-5-5",
    name: "Claude Sonnet 5.5 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    premiumMultiplier: 0.8,
  }),
  factoryModel({
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    premiumMultiplier: 0.8,
  }),
  factoryModel({
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 995_000,
    maxTokens: 64000,
    premiumMultiplier: 1.2,
  }),
  factoryModel({
    id: "claude-sonnet-4-5-20250929",
    name: "Claude Sonnet 4.5 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 32_000,
    premiumMultiplier: 1.2,
  }),
  factoryModel({
    id: "claude-haiku-4-5-20251001",
    name: "Claude Haiku 4.5 (Factory)",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 32000,
    premiumMultiplier: 0.4,
  }),
  factoryModel({
    id: "atlas-07-21",
    name: "Atlas 07/21 Preview (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 995_000,
    maxTokens: 128_000,
    premiumMultiplier: 2,
  }),
  factoryModel({
    id: "aster-07-15",
    name: "Aster 07/15 Preview (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 995_000,
    maxTokens: 128_000,
    premiumMultiplier: 2,
  }),
  // GPT and Codex models
  factoryModel({
    id: "gpt-6-astra",
    name: "GPT-6 Astra (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_050_000,
    maxTokens: 128_000,
    premiumMultiplier: 4,
  }),
  factoryModel({
    id: "gpt-6-sol",
    name: "GPT-6 Sol (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_050_000,
    maxTokens: 128_000,
    premiumMultiplier: 0.8,
  }),
  factoryModel({
    id: "gpt-6.1-sol",
    name: "GPT-6.1 Sol (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_050_000,
    maxTokens: 128_000,
    premiumMultiplier: 0.8,
    // Droid 0.230.0 registry: default medium, ladder low→max. Minimal is not
    // wire-supported and degrades to low; xhigh/max pass through unchanged.
    thinking: {
      mode: "effort",
      efforts: [Effort.Low, Effort.Medium, Effort.High, Effort.XHigh, FACTORY_MAX_EFFORT],
      defaultLevel: Effort.Medium,
      effortMap: { [Effort.Minimal]: "low" },
    },
  }),
  factoryModel({
    id: "gpt-6-luna",
    name: "GPT-6 Luna (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_050_000,
    maxTokens: 128_000,
    premiumMultiplier: 0.04,
  }),
  factoryModel({
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_050_000,
    maxTokens: 128_000,
    premiumMultiplier: 2,
  }),
  factoryModel({
    id: "gpt-5.6-sol-fast",
    name: "GPT-5.6 Sol Fast (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_050_000,
    maxTokens: 128_000,
    premiumMultiplier: 4,
  }),
  factoryModel({
    id: "gpt-5.6-terra",
    name: "GPT-5.6 Terra (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_050_000,
    maxTokens: 128_000,
    premiumMultiplier: 0.8,
  }),
  factoryModel({
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_050_000,
    maxTokens: 128_000,
    premiumMultiplier: 0.08,
  }),
  factoryModel({
    id: "gpt-5.5",
    name: "GPT-5.5 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_050_000,
    maxTokens: 128_000,
    premiumMultiplier: 2,
  }),
  factoryModel({
    id: "gpt-5.5-fast",
    name: "GPT-5.5 Fast (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_050_000,
    maxTokens: 128_000,
    premiumMultiplier: 5,
  }),
  factoryModel({
    id: "gpt-5.5-pro",
    name: "GPT-5.5 Pro (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_050_000,
    maxTokens: 128_000,
    premiumMultiplier: 12,
  }),
  factoryModel({
    id: "gpt-5.4",
    name: "GPT-5.4 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_050_000,
    maxTokens: 128_000,
    premiumMultiplier: 1,
  }),
  factoryModel({
    id: "gpt-5.4-fast",
    name: "GPT-5.4 Fast (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_050_000,
    maxTokens: 128_000,
    premiumMultiplier: 2,
  }),
  factoryModel({
    id: "gpt-5.4-mini",
    name: "GPT-5.4 Mini (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 400000,
    maxTokens: 128000,
    premiumMultiplier: 0.3,
  }),
  factoryModel({
    id: "gpt-5.4-mini-fast",
    name: "GPT-5.4 Mini Fast (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 400000,
    maxTokens: 128000,
    premiumMultiplier: 0.6,
  }),
  factoryModel({
    id: "gpt-5.3-codex",
    name: "GPT-5.3 Codex (Factory)",
    reasoning: true,
    input: ["text"],
    contextWindow: 400000,
    maxTokens: 128000,
    premiumMultiplier: 0.7,
  }),
  factoryModel({
    id: "gpt-5.3-codex-fast",
    name: "GPT-5.3 Codex Fast (Factory)",
    reasoning: true,
    input: ["text"],
    contextWindow: 400000,
    maxTokens: 128000,
    premiumMultiplier: 1.4,
  }),
  factoryModel({
    id: "gpt-5.2",
    name: "GPT-5.2 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 400000,
    maxTokens: 128000,
    premiumMultiplier: 0.7,
  }),
  factoryModel({
    id: "gpt-5.2-codex",
    name: "GPT-5.2 Codex [Deprecated] (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 400000,
    maxTokens: 128000,
    premiumMultiplier: 0.7,
  }),
  factoryModel({
    id: "gpt-5.1-codex-max",
    name: "GPT-5.1 Codex Max [Deprecated] (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 400000,
    maxTokens: 32768,
    premiumMultiplier: 0.5,
  }),

  // Grok family (routed through OpenAI Responses gateway with x-api-provider: xai)
  factoryModel({
    id: "grok-4.7",
    name: "Grok 4.7 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 500_000,
    maxTokens: 63_356,
    premiumMultiplier: 0.8,
  }),
  factoryModel({
    id: "grok-4.6",
    name: "Grok 4.6 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 263_356,
    maxTokens: 63356,
    premiumMultiplier: 0.8,
  }),
  factoryModel({
    id: "grok-4.5",
    name: "Grok 4.5 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 263_356,
    maxTokens: 63356,
    premiumMultiplier: 0.8,
  }),

  // Factory Core and open-weight chat models
  factoryModel({
    id: "inkling",
    name: "Inkling (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 1_040_000,
    maxTokens: 32_768,
    premiumMultiplier: 0.4,
  }),
  factoryModel({
    id: "mistral-medium-3.5",
    name: "Mistral Medium 3.5 (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 256_000,
    maxTokens: 64_000,
    premiumMultiplier: 0.6,
  }),
  factoryModel({
    id: "glm-5.3",
    name: "GLM 5.3 (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 1040000,
    maxTokens: 131072,
    premiumMultiplier: 0.56,
  }),
  factoryModel({
    id: "glm-5.3-flash",
    name: "GLM 5.3 Flash (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 1_048_576,
    maxTokens: 131_072,
    premiumMultiplier: 0.06,
  }),
  factoryModel({
    id: "glm-5.2",
    name: "GLM 5.2 (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 1040000,
    maxTokens: 131072,
    premiumMultiplier: 0.56,
  }),
  factoryModel({
    id: "glm-5.2-fast",
    name: "GLM 5.2 Fast (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 524_288,
    maxTokens: 131_072,
    premiumMultiplier: 0.84,
  }),
  factoryModel({
    id: "glm-5.1",
    name: "GLM 5.1 [Deprecated] (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 200_000,
    maxTokens: 65_536,
    premiumMultiplier: 0.55,
  }),
  factoryModel({
    id: "glm-5",
    name: "GLM 5 [Deprecated] (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 222_000,
    maxTokens: 32_000,
    premiumMultiplier: 0.55,
  }),
  factoryModel({
    id: "glm-4.7",
    name: "GLM 4.7 [Deprecated] (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 223_344,
    maxTokens: 25_344,
    premiumMultiplier: 0.4,
  }),
  factoryModel({
    id: "glm-4.6",
    name: "GLM 4.6 (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 328_000,
    maxTokens: 128_000,
    premiumMultiplier: 0.25,
  }),
  factoryModel({
    id: "kimi-k3",
    name: "Kimi K3 (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 262144,
    maxTokens: 65536,
    premiumMultiplier: 1.2,
  }),
  factoryModel({
    id: "kimi-k2.7-code",
    name: "Kimi K2.7 Code (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 262144,
    maxTokens: 65536,
    premiumMultiplier: 0.38,
  }),
  factoryModel({
    id: "kimi-k2.6",
    name: "Kimi K2.6 (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 262144,
    maxTokens: 65536,
    premiumMultiplier: 0.4,
  }),
  factoryModel({
    id: "kimi-k2.5",
    name: "Kimi K2.5 [Deprecated] (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 288_768,
    maxTokens: 32_768,
    premiumMultiplier: 0.25,
  }),
  // Promoted to the static catalog 2026-09: docs.factory.ai/models now publishes
  // `deepseek-v4.1-flash` and Droid 0.228.1 ships binary-audited limits for it.
  factoryModel({
    id: "deepseek-v4.1-flash",
    name: "DeepSeek V4.1 Flash (Factory Core)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_040_000,
    maxTokens: 131_072,
    premiumMultiplier: 0.12,
  }),
  factoryModel({
    id: "deepseek-v4-flash-0731",
    name: "DeepSeek V4 Flash [Deprecated] (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 1_040_000,
    maxTokens: 131_072,
    premiumMultiplier: 0.176,
  }),
  factoryModel({
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro [Deprecated] (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 1_040_000,
    maxTokens: 131_072,
    premiumMultiplier: 0.528,
  }),
  factoryModel({
    id: "minimax-m3",
    name: "MiniMax M3 (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 512000,
    maxTokens: 64000,
    premiumMultiplier: 0.12,
  }),
  factoryModel({
    id: "minimax-m2.7",
    name: "MiniMax M2.7 [Deprecated] (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 260_600,
    maxTokens: 64_000,
    premiumMultiplier: 0.12,
  }),
  factoryModel({
    id: "minimax-m2.5",
    name: "MiniMax M2.5 [Deprecated] (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 268_800,
    maxTokens: 64000,
    premiumMultiplier: 0.2,
  }),
  factoryModel({
    id: "nemotron-3-ultra",
    name: "Nemotron 3 Ultra (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 202_000,
    maxTokens: 65_536,
    premiumMultiplier: 0.24,
  }),
  factoryModel({
    id: "qwen3.8-max",
    name: "Qwen3.8 Max (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 262_144,
    maxTokens: 131_072,
    premiumMultiplier: 0.8,
  }),

  // Google Gemini family
  factoryModel({
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_065_536,
    maxTokens: 65_536,
    premiumMultiplier: 0.6,
  }),
  factoryModel({
    id: "gemini-3.7-flash",
    name: "Gemini 3.7 Flash (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_065_536,
    maxTokens: 65_536,
    premiumMultiplier: 0.6,
  }),
  factoryModel({
    id: "gemini-3.6-flash",
    name: "Gemini 3.6 Flash (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_065_536,
    maxTokens: 65_536,
    premiumMultiplier: 0.6,
  }),
  factoryModel({
    id: "gemini-3.5-flash",
    name: "Gemini 3.5 Flash (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_065_536,
    maxTokens: 65_536,
    premiumMultiplier: 0.6,
  }),
  factoryModel({
    id: "gemini-3-flash-preview",
    name: "Gemini 3 Flash Preview (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_065_536,
    maxTokens: 65_536,
    premiumMultiplier: 0.2,
  }),
  factoryModel({
    id: "gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro Preview (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_065_536,
    maxTokens: 65_536,
    premiumMultiplier: 0.8,
  }),
  factoryModel({
    id: "gemini-3-pro-preview",
    name: "Gemini 3 Pro Preview (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_065_536,
    maxTokens: 65_536,
    premiumMultiplier: 0.8,
  }),
  factoryModel({
    id: "garnet-07-15",
    name: "Garnet 07/15 Preview (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_065_536,
    maxTokens: 65_536,
    premiumMultiplier: 0.6,
  }),
];

export function familyOf(id: string): FactoryModelFamily {
  if (id.startsWith("claude-") || id.startsWith("minimax-") || id.startsWith("atlas-") || id.startsWith("aster-")) {
    return "anthropic";
  }

  if (id.startsWith("gemini-") || id.startsWith("garnet-")) {
    return "google";
  }

  if (id.startsWith("gpt-") || id.startsWith("gpt6") || id.endsWith("-codex") || id.startsWith("grok-")) {
    return "openai-responses";
  }

  if (
    id.startsWith("glm-") ||
    id.startsWith("kimi-") ||
    id.startsWith("deepseek-") ||
    id.startsWith("nemotron-") ||
    id.startsWith("qwen") ||
    id.startsWith("mistral-") ||
    id === "inkling" ||
    id.startsWith("inkling-")
  ) {
    return "openai-completions";
  }

  return "unsupported";
}

export type FactoryUpstreamProvider = "anthropic" | "openai" | "fireworks" | "xai" | "google" | "mistral";

// Factory's `x-api-provider` request header names the UPSTREAM the gateway routes
// to, independent of the wire API shape. Droid Core open models (GLM, Kimi,
// DeepSeek, MiniMax, Nemotron, Inkling, Qwen) resolve to "fireworks" — even MiniMax,
// which is served over the Anthropic-compatible API. Mistral routes to direct "mistral",
// and Grok routes to direct "xai".
export function upstreamProviderFor(id: string): FactoryUpstreamProvider {
  if (id.startsWith("claude-") || id.startsWith("atlas-") || id.startsWith("aster-")) {
    return "anthropic";
  }

  if (id.startsWith("gemini-") || id.startsWith("garnet-")) {
    return "google";
  }

  if (id.startsWith("gpt-") || id.startsWith("gpt6") || id.endsWith("-codex")) {
    return "openai";
  }

  if (id.startsWith("grok-")) {
    return "xai";
  }

  if (id.startsWith("mistral-")) {
    return "mistral";
  }

  return "fireworks";
}

export function identityFor(id: string): ModelIdentity {
  if (id.startsWith("claude-")) {
    const parts = id.split("-");
    return { class: "anthropic", family: parts[1] ?? "claude" };
  }
  if (id.startsWith("atlas-") || id.startsWith("aster-")) {
    const parts = id.split("-");
    return { class: "anthropic", family: parts[0] };
  }
  if (id.startsWith("gemini-") || id.startsWith("garnet-")) {
    const parts = id.split("-");
    return { class: "google", family: parts[0] ?? "gemini" };
  }
  if (id.startsWith("mistral-")) {
    return { class: "mistral", family: "mistral" };
  }
  if (id.startsWith("minimax-")) {
    return { class: "minimax", family: "minimax" };
  }
  if (id.startsWith("gpt-") || id.startsWith("gpt6") || id.endsWith("-codex")) {
    return { class: "openai", family: "gpt" };
  }
  if (id.startsWith("grok-")) {
    return { class: "xai", family: "grok" };
  }
  if (id.startsWith("glm-")) {
    return { class: "glm", family: "glm" };
  }
  if (id.startsWith("kimi-")) {
    return { class: "kimi", family: "kimi" };
  }
  if (id.startsWith("deepseek-")) {
    return { class: "deepseek", family: "deepseek" };
  }
  if (id.startsWith("nemotron-")) {
    return { class: "nemotron", family: "nemotron" };
  }
  if (id.startsWith("qwen")) {
    return { class: "qwen", family: "qwen" };
  }
  if (id.startsWith("inkling")) {
    return { class: "inkling", family: "inkling" };
  }
  return { class: "unknown" };
}

export type FactoryQuotaTier = "standard" | "core";

export function factoryQuotaTierFor(id: string): FactoryQuotaTier {
  if (
    id.startsWith("claude-") ||
    id.startsWith("atlas-") ||
    id.startsWith("aster-") ||
    id.startsWith("gpt-") ||
    id.startsWith("gpt6") ||
    id.endsWith("-codex") ||
    id.startsWith("grok-") ||
    id.startsWith("gemini-") ||
    id.startsWith("garnet-")
  ) {
    return "standard";
  }
  return "core";
}

