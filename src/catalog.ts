import type { ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";

import { CUSTOM_API } from "./constants";

export type FactoryModelFamily =
  | "anthropic"
  | "openai-responses"
  | "openai-completions"
  | "unsupported";

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

  // GPT family (OpenAI does not bill prompt cache creation / cacheWrite = 0)
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

  // Core Open Models (Fireworks / Standard host rates)
  if (id === "inkling" || id.startsWith("inkling-")) {
    return { input: 1.0, output: 3.0, cacheRead: 0.1, cacheWrite: 0 };
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
    return { input: 0.1, output: 0.4, cacheRead: 0.02, cacheWrite: 0 };
  }
  if (id.startsWith("minimax-")) {
    return { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 };
  }
  if (id.startsWith("nemotron-")) {
    return { input: 0.4, output: 1.0, cacheRead: 0.04, cacheWrite: 0 };
  }

  // Default fallback
  return { input: 1.0, output: 3.0, cacheRead: 0.1, cacheWrite: 0 };
}

const FACTORY_DEFAULT_EFFORTS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as unknown as NonNullable<ProviderModelConfig["thinking"]>["efforts"];

const FACTORY_DEFAULT_EFFORT_MAP = {
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "high",
} as unknown as NonNullable<ProviderModelConfig["thinking"]>["effortMap"];

export function factoryModel(config: FactoryModelInput): ProviderModelConfig {
  return {
    id: config.id,
    name: config.name,
    api: CUSTOM_API,
    reasoning: config.reasoning,
    thinking: config.reasoning
      ? (config.thinking ?? {
          mode: "effort",
          efforts: FACTORY_DEFAULT_EFFORTS,
          effortMap: FACTORY_DEFAULT_EFFORT_MAP,
        })
      : undefined,
    input: config.input,
    cost: config.cost ?? defaultCostFor(config.id),
    premiumMultiplier: config.premiumMultiplier,
    contextWindow: config.contextWindow,
    maxTokens: config.maxTokens,
  };
}

export const FACTORY_MODELS: ProviderModelConfig[] = [
  // Claude and Anthropic-family models
  factoryModel({
    id: "claude-fable-5",
    name: "Claude Fable 5 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 867000,
    maxTokens: 128000,
    premiumMultiplier: 4,
  }),
  factoryModel({
    id: "claude-opus-5",
    name: "Claude Opus 5 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 64000,
    premiumMultiplier: 2,
  }),
  factoryModel({
    id: "claude-opus-5-fast",
    name: "Claude Opus 5 Fast (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 64000,
    premiumMultiplier: 4,
  }),
  factoryModel({
    id: "claude-opus-4-8",
    name: "Claude Opus 4.8 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 64000,
    premiumMultiplier: 2,
  }),
  factoryModel({
    id: "claude-opus-4-8-fast",
    name: "Claude Opus 4.8 Fast (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 64000,
    premiumMultiplier: 4,
  }),
  factoryModel({
    id: "claude-opus-4-7",
    name: "Claude Opus 4.7 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 64000,
    premiumMultiplier: 2,
  }),
  factoryModel({
    id: "claude-opus-4-7-fast",
    name: "Claude Opus 4.7 Fast (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 64000,
    premiumMultiplier: 4,
  }),
  factoryModel({
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 64000,
    premiumMultiplier: 2,
  }),
  factoryModel({
    id: "claude-opus-4-6-fast",
    name: "Claude Opus 4.6 Fast (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 64000,
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
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1000000,
    maxTokens: 128000,
    premiumMultiplier: 0.8,
  }),
  factoryModel({
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 64000,
    premiumMultiplier: 1.2,
  }),
  factoryModel({
    id: "claude-sonnet-4-5-20250929",
    name: "Claude Sonnet 4.5 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 64000,
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

  // GPT and Codex models
  factoryModel({
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 400000,
    maxTokens: 128000,
    premiumMultiplier: 0.8,
  }),
  factoryModel({
    id: "gpt-5.6-sol-fast",
    name: "GPT-5.6 Sol Fast (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 400000,
    maxTokens: 128000,
    premiumMultiplier: 1.6,
  }),
  factoryModel({
    id: "gpt-5.6-terra",
    name: "GPT-5.6 Terra (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 400000,
    maxTokens: 128000,
    premiumMultiplier: 0.32,
  }),
  factoryModel({
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 400000,
    maxTokens: 128000,
    premiumMultiplier: 0.032,
  }),
  factoryModel({
    id: "gpt-5.5",
    name: "GPT-5.5 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 400000,
    maxTokens: 128000,
    premiumMultiplier: 0.8,
  }),
  factoryModel({
    id: "gpt-5.5-fast",
    name: "GPT-5.5 Fast (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 400000,
    maxTokens: 128000,
    premiumMultiplier: 2,
  }),
  factoryModel({
    id: "gpt-5.5-pro",
    name: "GPT-5.5 Pro (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 400000,
    maxTokens: 128000,
    premiumMultiplier: 4.8,
  }),
  factoryModel({
    id: "gpt-5.4",
    name: "GPT-5.4 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 400000,
    maxTokens: 128000,
    premiumMultiplier: 0.4,
  }),
  factoryModel({
    id: "gpt-5.4-fast",
    name: "GPT-5.4 Fast (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 400000,
    maxTokens: 128000,
    premiumMultiplier: 0.8,
  }),
  factoryModel({
    id: "gpt-5.4-mini",
    name: "GPT-5.4 Mini (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 400000,
    maxTokens: 128000,
    premiumMultiplier: 0.12,
  }),
  factoryModel({
    id: "gpt-5.4-mini-fast",
    name: "GPT-5.4 Mini Fast (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 400000,
    maxTokens: 128000,
    premiumMultiplier: 0.24,
  }),
  factoryModel({
    id: "gpt-5.3-codex",
    name: "GPT-5.3 Codex (Factory)",
    reasoning: true,
    input: ["text"],
    contextWindow: 400000,
    maxTokens: 128000,
    premiumMultiplier: 0.28,
  }),
  factoryModel({
    id: "gpt-5.3-codex-fast",
    name: "GPT-5.3 Codex Fast (Factory)",
    reasoning: true,
    input: ["text"],
    contextWindow: 400000,
    maxTokens: 128000,
    premiumMultiplier: 0.56,
  }),
  factoryModel({
    id: "gpt-5.2",
    name: "GPT-5.2 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 400000,
    maxTokens: 128000,
    premiumMultiplier: 0.28,
  }),

  // Factory Core and open-weight chat models
  factoryModel({
    id: "inkling",
    name: "Inkling (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 262144,
    maxTokens: 65536,
    premiumMultiplier: 0.4,
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
    contextWindow: 1040000,
    maxTokens: 131072,
    premiumMultiplier: 0.84,
  }),
  factoryModel({
    id: "glm-5.1",
    name: "GLM 5.1 (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 190000,
    maxTokens: 131072,
    premiumMultiplier: 0.55,
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
    name: "Kimi K2.5 (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 256000,
    maxTokens: 32768,
    premiumMultiplier: 0.25,
  }),
  factoryModel({
    id: "deepseek-v4-flash-0731",
    name: "DeepSeek V4 Flash (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 1048576,
    maxTokens: 65536,
    premiumMultiplier: 0.176,
  }),
  factoryModel({
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 1048576,
    maxTokens: 65536,
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
    name: "MiniMax M2.7 (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 196600,
    maxTokens: 64000,
    premiumMultiplier: 0.12,
  }),
  factoryModel({
    id: "minimax-m2.5",
    name: "MiniMax M2.5 (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 204800,
    maxTokens: 64000,
    premiumMultiplier: 0.2,
  }),
  factoryModel({
    id: "nemotron-3-ultra",
    name: "Nemotron 3 Ultra (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 262144,
    maxTokens: 65536,
    premiumMultiplier: 0.24,
  }),
];

export function familyOf(id: string): FactoryModelFamily {
  if (id.startsWith("claude-") || id.startsWith("minimax-") || id.startsWith("atlas-") || id.startsWith("aster-")) {
    return "anthropic";
  }

  if (id.startsWith("gpt-") || id.endsWith("-codex")) {
    return "openai-responses";
  }

  if (
    id.startsWith("glm-") ||
    id.startsWith("kimi-") ||
    id.startsWith("deepseek-") ||
    id.startsWith("nemotron-") ||
    id.startsWith("grok-") ||
    id === "inkling" ||
    id.startsWith("inkling-")
  ) {
    return "openai-completions";
  }

  return "unsupported";
}

export type FactoryUpstreamProvider = "anthropic" | "openai" | "fireworks" | "xai";

// Factory's `x-api-provider` request header names the UPSTREAM the gateway routes
// to, independent of the wire API shape. Droid Core open models (GLM, Kimi,
// DeepSeek, MiniMax, Nemotron, Inkling) all resolve to "fireworks" — even MiniMax,
// which is served over the Anthropic-compatible API.
export function upstreamProviderFor(id: string): FactoryUpstreamProvider {
  if (id.startsWith("claude-") || id.startsWith("atlas-") || id.startsWith("aster-")) {
    return "anthropic";
  }

  if (id.startsWith("gpt-") || id.endsWith("-codex")) {
    return "openai";
  }

  if (id.startsWith("grok-")) {
    return "xai";
  }

  return "fireworks";
}
