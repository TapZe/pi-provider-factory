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
  input: ProviderModelConfig["input"];
  contextWindow: number;
  maxTokens: number;
  cost?: ProviderModelConfig["cost"];
};

export function defaultCostFor(id: string): ProviderModelConfig["cost"] {
  // Claude family
  if (id.startsWith("claude-opus-")) {
    return { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 };
  }
  if (id.startsWith("claude-sonnet-") || id.startsWith("claude-fable-")) {
    return { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
  }
  if (id.startsWith("claude-haiku-")) {
    return { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1.0 };
  }

  // GPT family
  if (id === "gpt-5.6-sol" || id.startsWith("gpt-5.6-sol-")) {
    return { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 6.25 };
  }
  if (id === "gpt-5.6-terra" || id.startsWith("gpt-5.6-terra-")) {
    return { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5 };
  }
  if (id === "gpt-5.6-luna" || id.startsWith("gpt-5.6-luna-")) {
    return { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 };
  }
  if (id.startsWith("gpt-5.5-pro")) {
    return { input: 10, output: 40, cacheRead: 1.0, cacheWrite: 12.5 };
  }
  if (id.startsWith("gpt-5.5")) {
    return { input: 5, output: 20, cacheRead: 0.5, cacheWrite: 6.25 };
  }
  if (id.startsWith("gpt-5.4-mini")) {
    return { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0.1875 };
  }
  if (id.startsWith("gpt-5.4") || id.startsWith("gpt-5.3-codex") || id.startsWith("gpt-5.2")) {
    return { input: 2.5, output: 10, cacheRead: 0.25, cacheWrite: 3.125 };
  }

  // Core Open Models (Fireworks / Standard host rates)
  if (id.startsWith("deepseek-v4-flash")) {
    return { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 };
  }
  if (id.startsWith("deepseek-v4-pro") || id.startsWith("deepseek-")) {
    return { input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0 };
  }
  if (id.startsWith("glm-")) {
    return { input: 0.4, output: 1.0, cacheRead: 0.04, cacheWrite: 0 };
  }
  if (id.startsWith("kimi-")) {
    return { input: 0.4, output: 1.2, cacheRead: 0.04, cacheWrite: 0 };
  }
  if (id.startsWith("minimax-")) {
    return { input: 0.2, output: 0.8, cacheRead: 0.02, cacheWrite: 0 };
  }
  if (id.startsWith("nemotron-")) {
    return { input: 0.4, output: 1.0, cacheRead: 0.04, cacheWrite: 0 };
  }

  // Default fallback
  return { input: 1.0, output: 3.0, cacheRead: 0.1, cacheWrite: 0 };
}

export function factoryModel(config: FactoryModelInput): ProviderModelConfig {
  return {
    id: config.id,
    name: config.name,
    api: CUSTOM_API,
    reasoning: config.reasoning,
    input: config.input,
    cost: config.cost ?? defaultCostFor(config.id),
    contextWindow: config.contextWindow,
    maxTokens: config.maxTokens,
  };
}

export const FACTORY_MODELS: ProviderModelConfig[] = [
  factoryModel({
    id: "claude-opus-4-8",
    name: "Claude Opus 4.8 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 64000,
  }),
  factoryModel({
    id: "claude-opus-4-8-fast",
    name: "Claude Opus 4.8 Fast (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 64000,
  }),
  factoryModel({
    id: "claude-opus-4-7",
    name: "Claude Opus 4.7 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 64000,
  }),
  factoryModel({
    id: "claude-opus-4-7-fast",
    name: "Claude Opus 4.7 Fast (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 64000,
  }),
  factoryModel({
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 64000,
  }),
  factoryModel({
    id: "claude-opus-4-6-fast",
    name: "Claude Opus 4.6 Fast (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 64000,
  }),
  factoryModel({
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1000000,
    maxTokens: 128000,
  }),
  factoryModel({
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 64000,
  }),
  factoryModel({
    id: "claude-opus-4-5-20251101",
    name: "Claude Opus 4.5 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 64000,
  }),
  factoryModel({
    id: "claude-fable-5",
    name: "Claude Fable 5 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 867000,
    maxTokens: 128000,
  }),
  factoryModel({
    id: "claude-sonnet-4-5-20250929",
    name: "Claude Sonnet 4.5 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 64000,
  }),
  factoryModel({
    id: "claude-haiku-4-5-20251001",
    name: "Claude Haiku 4.5 (Factory)",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 32000,
  }),
  factoryModel({
    id: "gpt-5.5",
    name: "GPT-5.5 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 400000,
    maxTokens: 128000,
  }),
  factoryModel({
    id: "gpt-5.5-fast",
    name: "GPT-5.5 Fast (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 400000,
    maxTokens: 128000,
  }),
  factoryModel({
    id: "gpt-5.5-pro",
    name: "GPT-5.5 Pro (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 400000,
    maxTokens: 128000,
  }),
  factoryModel({
    id: "gpt-5.4",
    name: "GPT-5.4 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 400000,
    maxTokens: 128000,
  }),
  factoryModel({
    id: "gpt-5.4-fast",
    name: "GPT-5.4 Fast (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 400000,
    maxTokens: 128000,
  }),
  factoryModel({
    id: "gpt-5.4-mini",
    name: "GPT-5.4 Mini (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 400000,
    maxTokens: 128000,
  }),
  factoryModel({
    id: "gpt-5.3-codex",
    name: "GPT-5.3 Codex (Factory)",
    reasoning: true,
    input: ["text"],
    contextWindow: 400000,
    maxTokens: 128000,
  }),
  factoryModel({
    id: "gpt-5.3-codex-fast",
    name: "GPT-5.3 Codex Fast (Factory)",
    reasoning: true,
    input: ["text"],
    contextWindow: 400000,
    maxTokens: 128000,
  }),
  factoryModel({
    id: "gpt-5.2",
    name: "GPT-5.2 (Factory)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 400000,
    maxTokens: 128000,
  }),
  factoryModel({
    id: "glm-5.2",
    name: "GLM 5.2 (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 1040000,
    maxTokens: 131072,
  }),
  factoryModel({
    id: "glm-5.1",
    name: "GLM 5.1 (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 190000,
    maxTokens: 131072,
  }),
  factoryModel({
    id: "kimi-k2.7-code",
    name: "Kimi K2.7 Code (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 262144,
    maxTokens: 65536,
  }),
  factoryModel({
    id: "kimi-k2.6",
    name: "Kimi K2.6 (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 262144,
    maxTokens: 65536,
  }),
  factoryModel({
    id: "kimi-k2.5",
    name: "Kimi K2.5 (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 256000,
    maxTokens: 32768,
  }),
  factoryModel({
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 1048576,
    maxTokens: 65536,
  }),
  factoryModel({
    id: "minimax-m3",
    name: "MiniMax M3 (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 512000,
    maxTokens: 64000,
  }),
  factoryModel({
    id: "minimax-m2.7",
    name: "MiniMax M2.7 (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 196600,
    maxTokens: 64000,
  }),
  factoryModel({
    id: "minimax-m2.5",
    name: "MiniMax M2.5 (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 204800,
    maxTokens: 64000,
  }),
  factoryModel({
    id: "nemotron-3-ultra",
    name: "Nemotron 3 Ultra (Factory Core)",
    reasoning: true,
    input: ["text"],
    contextWindow: 262144,
    maxTokens: 65536,
  }),
];

export function familyOf(id: string): FactoryModelFamily {
  if (id.startsWith("claude-")) {
    return "anthropic";
  }

  if (id.startsWith("gpt-") || id.endsWith("-codex")) {
    return "openai-responses";
  }

  if (
    id.startsWith("glm-") ||
    id.startsWith("kimi-") ||
    id.startsWith("deepseek-") ||
    id.startsWith("minimax-") ||
    id.startsWith("nemotron-")
  ) {
    return "openai-completions";
  }

  return "unsupported";
}

export type FactoryUpstreamProvider = "anthropic" | "openai" | "fireworks";

// Factory's `x-api-provider` request header names the UPSTREAM the gateway routes
// to, independent of the wire API shape. Droid Core open models (GLM, Kimi,
// DeepSeek, MiniMax, Nemotron) all resolve to "fireworks" — even MiniMax, which
// is served over the Anthropic-compatible API. Observed from droid 0.153.1
// traffic; grouping confirmed by https://docs.factory.ai/models.
export function upstreamProviderFor(id: string): FactoryUpstreamProvider {
  if (id.startsWith("claude-")) {
    return "anthropic";
  }

  if (id.startsWith("gpt-") || id.endsWith("-codex")) {
    return "openai";
  }

  return "fireworks";
}
