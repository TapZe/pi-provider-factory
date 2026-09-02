import type { AssistantMessage, AssistantMessageEventStream, FetchImpl, Model, UsageLimit, UsageReport } from "@oh-my-pi/pi-ai";
import type { Api } from "@oh-my-pi/pi-catalog/types";
import { createProviderErrorMessage } from "@oh-my-pi/pi-ai/providers/error-message";
import { AssistantMessageEventStream as EventStream } from "@oh-my-pi/pi-ai/utils/event-stream";

import { factoryQuotaTierFor, type FactoryQuotaTier } from "./catalog";
import type { ParsedFactoryCredential } from "./credential";
import { fetchFactoryUsageDirect, usageCacheKey } from "./usage";

export const PREFLIGHT_TIMEOUT_MS = 2500;

type ProcessLike = {
  env?: Record<string, string | undefined>;
};

type GlobalWithProcess = typeof globalThis & {
  process?: ProcessLike;
};

const runtimeGlobal: GlobalWithProcess = globalThis;

export function isQuotaPreflightEnabled(
  rawValue: string | undefined = runtimeGlobal.process?.env?.FACTORY_QUOTA_PREFLIGHT,
): boolean {
  const normalized = rawValue?.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

export interface QuotaGateDecision {
  allow: boolean;
  tier?: FactoryQuotaTier;
  resetAtMs?: number;
  exhaustedLimit?: UsageLimit;
}

export function evaluateUsageReport(
  report: UsageReport | null | undefined,
  tier: FactoryQuotaTier,
): QuotaGateDecision {
  if (!report?.limits || report.limits.length === 0) {
    return { allow: true };
  }
  if (report.metadata?.extraUsageAllowed === true) {
    return { allow: true };
  }

  // Look for limits scoped to this tier
  const tierLimits = report.limits.filter((limit) => {
    const scopeTier = limit.scope?.tier;
    return scopeTier === tier || limit.id.includes(`:${tier}:`);
  });

  const exhaustedLimits = tierLimits.filter((limit) => limit.status === "exhausted");
  if (exhaustedLimits.length === 0) {
    return { allow: true };
  }

  // Find the latest reset timestamp among exhausted limits
  let latestResetMs: number | undefined;
  for (const limit of exhaustedLimits) {
    const reset = limit.window?.resetsAt;
    if (typeof reset === "number" && Number.isFinite(reset)) {
      if (latestResetMs === undefined || reset > latestResetMs) {
        latestResetMs = reset;
      }
    }
  }

  return {
    allow: false,
    tier,
    resetAtMs: latestResetMs,
    exhaustedLimit: exhaustedLimits[0],
  };
}

export function buildUsageLimitErrorMessage(tier: FactoryQuotaTier, resetAtMs: number | undefined, nowMs: number): string {
  const tierLabel = tier === "standard" ? "Standard" : "Core";
  let message = `429 factory: Factory ${tierLabel} usage limit reached (code=usage_limit_reached)`;

  if (resetAtMs !== undefined) {
    const retryAfterMs = Math.max(1000, resetAtMs - nowMs);
    message += ` retry-after-ms=${Math.round(retryAfterMs)}`;
  }

  return message;
}

export function createQuotaExhaustedStream(
  model: Model<Api>,
  tier: FactoryQuotaTier,
  resetAtMs: number | undefined,
  nowMs: number = Date.now(),
): AssistantMessageEventStream {
  const stream = new EventStream();
  const errorMessage = buildUsageLimitErrorMessage(tier, resetAtMs, nowMs);
  const error: AssistantMessage = {
    ...createProviderErrorMessage(model, new Error(errorMessage)),
    errorMessage,
    errorStatus: 429,
  };
  stream.push({ type: "error", reason: "error", error });
  return stream;
}

export async function preflightQuotaCheck(params: {
  modelId: string;
  credential: ParsedFactoryCredential;
  apiEndpoint: string;
  fetchFn?: FetchImpl;
  signal?: AbortSignal;
}): Promise<QuotaGateDecision> {
  const tier = factoryQuotaTierFor(params.modelId);
  if (params.credential.source !== "oauth-envelope" || !params.credential.access || !params.credential.orgId) {
    return { allow: true };
  }
  const accountKey = usageCacheKey(params.apiEndpoint, params.credential.orgId);
  if (!accountKey) return { allow: true };

  const report = await fetchFactoryUsageDirect({
    apiEndpoint: params.apiEndpoint,
    orgId: params.credential.orgId,
    accessToken: params.credential.access,
    fetchFn: params.fetchFn,
    signal: params.signal,
    timeoutMs: PREFLIGHT_TIMEOUT_MS,
  });

  return evaluateUsageReport(report, tier);
}
