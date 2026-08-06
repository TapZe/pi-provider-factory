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
};

export function factoryModel(config: FactoryModelInput): ProviderModelConfig {
  return {
    id: config.id,
    name: config.name,
    api: CUSTOM_API,
    reasoning: config.reasoning,
    input: config.input,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
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
