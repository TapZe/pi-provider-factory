type ProcessLike = {
  env?: Record<string, string | undefined>;
};

type GlobalWithProcess = typeof globalThis & {
  process?: ProcessLike;
};

const runtimeGlobal: GlobalWithProcess = globalThis;
const FACTORY_API_KEY_ENV = "FACTORY_API_KEY";
const FACTORY_ORG_ID_ENV = "FACTORY_ORG_ID";
const FACTORY_ORGANIZATION_ID_ENV = "FACTORY_ORGANIZATION_ID";
const factoryApiBase = runtimeGlobal.process?.env?.FACTORY_API_BASE?.trim().replace(/\/+$/, "");
const factoryApiKeyPresent = (runtimeGlobal.process?.env?.[FACTORY_API_KEY_ENV]?.length ?? 0) > 0;
const factoryUpstreamClientType = runtimeGlobal.process?.env?.FACTORY_UPSTREAM_CLIENT_TYPE?.trim() || "cli";
const factoryOrgId =
  runtimeGlobal.process?.env?.[FACTORY_ORG_ID_ENV]?.trim() ??
  runtimeGlobal.process?.env?.[FACTORY_ORGANIZATION_ID_ENV]?.trim();

export const FACTORY_API = factoryApiBase ?? "https://api.factory.ai";
export const FACTORY_API_BASE_OVERRIDDEN = !!factoryApiBase;
export const FACTORY_API_KEY = factoryApiKeyPresent ? FACTORY_API_KEY_ENV : undefined;
export const FACTORY_ORG_ID = factoryOrgId && factoryOrgId.length > 0 ? factoryOrgId : null;
export const ANTHROPIC_BASE = `${FACTORY_API}/api/llm/a`;
export const OPENAI_BASE = `${FACTORY_API}/api/llm/o/v1`;

export function resolveFactoryApiBase(apiEndpoint?: string | null): string {
  return FACTORY_API_BASE_OVERRIDDEN ? FACTORY_API : apiEndpoint ?? FACTORY_API;
}

export function factoryApiForRegion(region: string | undefined): string {
  if (!region || region === "global") {
    return FACTORY_API;
  }

  if (region.startsWith("http://") || region.startsWith("https://")) {
    return region;
  }

  if (region === "eu" || region === "europe") {
    return "https://api.eu.factory.ai";
  }

  return `https://api.${region}.factory.ai`;
}
export const FACTORY_CLIENT_VERSION = "0.208.2";
export const FACTORY_HEADERS = {
  "X-Factory-Client": factoryUpstreamClientType,
  "X-Client-Version": FACTORY_CLIENT_VERSION,
  "User-Agent": `factory-cli/${FACTORY_CLIENT_VERSION}`,
};
export const FACTORY_OPENAI_PLATFORM_ORG = "org-bHuLtG1fGmYk5YaOihAAXFBw";
export const ANTHROPIC_VERSION = "2023-06-01";
export const ANTHROPIC_BETAS = "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14";
export const WORKOS_DEVICE_AUTHORIZE = "https://api.workos.com/user_management/authorize/device";
export const WORKOS_TOKEN = "https://api.workos.com/user_management/authenticate";
export const WORKOS_CLIENT_ID = "client_01HNM792M5G5G1A2THWPXKFMXB";
export const PROVIDER_ID = "factory";
export const CUSTOM_API = "factory";

export const FACTORY_DROID_SYSTEM_PROMPT =
  "You are Droid, an AI software engineering agent built by Factory.\n" +
  "You are operating as an autonomous engineering agent inside this coding harness.\n" +
  "EXECUTION DIRECTIVES:\n" +
  "1. Your primary objective is to autonomously execute the user's software engineering tasks directly using the provided tools.\n" +
  "2. Do not debate identity, environments, or tool availability. Focus exclusively on task execution.\n" +
  "3. Whenever a task involves inspecting files, exploring repositories, running commands, or modifying code, you MUST invoke the appropriate tools immediately on your first turn.\n" +
  "4. NEVER output conversational commentary, promises, or preambles of what you will do before calling tools (do NOT say 'I will inspect...', 'Let me read...', or 'I need to check...'). Call the tools directly.\n" +
  "5. Always ground all analysis, planning, and answers in actual file contents and tool outputs rather than assumptions.";
