import type { UsageLimit, UsageReport, UsageStatus } from "@oh-my-pi/pi-ai";

import { PROVIDER_ID } from "./constants";
import { isRecord } from "./object-fields";

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

type TierId = "standard" | "core";
type WindowId = "5h" | "weekly" | "monthly";

interface TierBucketSpec {
  tier: TierId;
  payloadKey: "fiveHour" | "weekly" | "monthly";
  windowId: WindowId;
  label: string;
  windowLabel: string;
  /** Omitted for monthly: Factory's monthly window is calendar-based. */
  durationMs?: number;
}

/** Fixed emission order: all Standard windows, then all Droid Core windows. */
const TIER_BUCKETS: readonly TierBucketSpec[] = [
  {
    tier: "standard",
    payloadKey: "fiveHour",
    windowId: "5h",
    label: "Standard 5 Hour",
    windowLabel: "5 Hour",
    durationMs: FIVE_HOURS_MS,
  },
  {
    tier: "standard",
    payloadKey: "weekly",
    windowId: "weekly",
    label: "Standard Weekly",
    windowLabel: "Weekly",
    durationMs: WEEK_MS,
  },
  {
    tier: "standard",
    payloadKey: "monthly",
    windowId: "monthly",
    label: "Standard Monthly",
    windowLabel: "Monthly",
  },
  {
    tier: "core",
    payloadKey: "fiveHour",
    windowId: "5h",
    label: "Droid Core 5 Hour",
    windowLabel: "5 Hour",
    durationMs: FIVE_HOURS_MS,
  },
  {
    tier: "core",
    payloadKey: "weekly",
    windowId: "weekly",
    label: "Droid Core Weekly",
    windowLabel: "Weekly",
    durationMs: WEEK_MS,
  },
  {
    tier: "core",
    payloadKey: "monthly",
    windowId: "monthly",
    label: "Droid Core Monthly",
    windowLabel: "Monthly",
  },
];

/**
 * Top-level keys that mark a body as a billing-limits response. A 2xx body
 * without any of them is treated as an unrecognized payload (transport-level
 * failure) rather than a valid legacy/unlimited account.
 */
const RECOGNIZED_PAYLOAD_KEYS = [
  "limits",
  "planType",
  "extraUsageBalanceCents",
  "extraUsageAllowed",
  "overagePreference",
  "usesTokenRateLimitsBilling",
  "tokenRateLimitsRolloutEligible",
] as const;

export interface FactoryUsageParseContext {
  /** Factory organization id (from `OAuthCredentials.accountId`). */
  accountId?: string;
  email?: string;
  /** Resolved Factory API base the payload was fetched from. */
  endpoint: string;
  fetchedAt: number;
}

interface BucketResetInfo {
  resetsAt: number | undefined;
  hasActiveWindow: boolean;
}

function resolveBucketReset(record: Record<string, unknown>, fetchedAt: number): BucketResetInfo {
  const windowEndMs = typeof record.windowEnd === "string" ? Date.parse(record.windowEnd) : Number.NaN;
  const secondsRemaining =
    typeof record.secondsRemaining === "number" &&
    Number.isFinite(record.secondsRemaining) &&
    record.secondsRemaining >= 0
      ? record.secondsRemaining
      : undefined;

  // Prefer the absolute window end; only fall back to the relative seconds
  // when windowEnd is absent or unparseable.
  const resetsAt = Number.isFinite(windowEndMs)
    ? windowEndMs
    : secondsRemaining !== undefined
      ? fetchedAt + secondsRemaining * 1000
      : undefined;

  // A bucket whose reset is not in the future and that reports no remaining
  // seconds has no live window (e.g. Droid Core allowances on a Standard-only
  // plan). Keep it visible but neutral so it does not look available.
  const hasActiveWindow = (resetsAt !== undefined && resetsAt > fetchedAt) || secondsRemaining !== undefined;

  return { resetsAt, hasActiveWindow };
}

interface BucketStatusResolution {
  status: UsageStatus;
  notes?: string[];
}

function resolveBucketStatus(usedPercent: number, hasActiveWindow: boolean): BucketStatusResolution {
  if (!hasActiveWindow) {
    return { status: "unknown", notes: ["No active window for this plan"] };
  }
  if (usedPercent >= 100) {
    return { status: "exhausted" };
  }
  if (usedPercent >= 90) {
    return { status: "warning" };
  }
  return { status: "ok" };
}

function parseTierBucket(
  bucket: unknown,
  spec: TierBucketSpec,
  context: FactoryUsageParseContext,
): UsageLimit | undefined {
  if (!isRecord(bucket)) return undefined;
  const record = bucket;
  const usedPercent = record.usedPercent;
  if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent)) return undefined;

  const used = Math.min(100, Math.max(0, usedPercent));
  const { resetsAt, hasActiveWindow } = resolveBucketReset(record, context.fetchedAt);
  const { status, notes } = resolveBucketStatus(used, hasActiveWindow);

  return {
    id: `${PROVIDER_ID}:${spec.tier}:${spec.windowId}`,
    label: spec.label,
    scope: {
      provider: PROVIDER_ID,
      tier: spec.tier,
      windowId: spec.windowId,
      shared: true,
      ...(context.accountId ? { accountId: context.accountId, orgId: context.accountId } : {}),
    },
    window: {
      id: spec.windowId,
      label: spec.windowLabel,
      ...(spec.durationMs !== undefined ? { durationMs: spec.durationMs } : {}),
      ...(resetsAt !== undefined ? { resetsAt } : {}),
    },
    amount: {
      used,
      limit: 100,
      remaining: 100 - used,
      usedFraction: used / 100,
      remainingFraction: (100 - used) / 100,
      unit: "percent",
    },
    status,
    ...(notes ? { notes } : {}),
  };
}

function createExtraUsageLimit(body: Record<string, unknown>, accountId?: string): UsageLimit | undefined {
  const balanceCents = body.extraUsageBalanceCents;
  if (typeof balanceCents !== "number" || !Number.isFinite(balanceCents) || balanceCents < 0) {
    return undefined;
  }

  const notes: string[] = [];
  if (typeof body.extraUsageAllowed === "boolean") {
    notes.push(`Extra usage ${body.extraUsageAllowed ? "allowed" : "not allowed"}`);
  }
  if (typeof body.overagePreference === "string" && body.overagePreference.trim().length > 0) {
    notes.push(`Overage preference: ${body.overagePreference}`);
  }

  return {
    id: `${PROVIDER_ID}:extra-usage-balance`,
    label: "Extra Usage balance",
    scope: {
      provider: PROVIDER_ID,
      shared: true,
      ...(accountId ? { accountId, orgId: accountId } : {}),
    },
    amount: { unit: "usd", remaining: balanceCents / 100 },
    ...(notes.length > 0 ? { notes } : {}),
  };
}

function createFactoryUsageMetadata(
  body: Record<string, unknown>,
  context: FactoryUsageParseContext,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = { endpoint: context.endpoint };
  if (context.accountId) {
    metadata.accountId = context.accountId;
    metadata.orgId = context.accountId;
  }
  if (context.email) metadata.email = context.email;
  if (typeof body.planType === "string") metadata.planType = body.planType;
  if (typeof body.tokenRateLimitsRolloutEligible === "boolean") {
    metadata.tokenRateLimitsRolloutEligible = body.tokenRateLimitsRolloutEligible;
  }
  if (typeof body.usesTokenRateLimitsBilling === "boolean") {
    metadata.usesTokenRateLimitsBilling = body.usesTokenRateLimitsBilling;
  }
  if (typeof body.extraUsageAllowed === "boolean") metadata.extraUsageAllowed = body.extraUsageAllowed;
  if (typeof body.overagePreference === "string") metadata.overagePreference = body.overagePreference;
  return metadata;
}

/**
 * Pure normalizer for the `/api/billing/limits` payload. Returns `null` when
 * the body is not a recognized billing-limits response; returns a report with
 * zero limits for a recognized response that carries no usable bucket (valid
 * legacy/unlimited account).
 */
export function parseFactoryUsagePayload(
  payload: unknown,
  context: FactoryUsageParseContext,
): UsageReport | null {
  if (!isRecord(payload)) return null;
  const body = payload;
  if (!RECOGNIZED_PAYLOAD_KEYS.some((key) => key in body)) return null;

  const limits: UsageLimit[] = [];
  const rawLimits = body.limits;
  const payloadLimits = isRecord(rawLimits) ? rawLimits : undefined;

  for (const spec of TIER_BUCKETS) {
    const tierSection = payloadLimits?.[spec.tier];
    const bucket = isRecord(tierSection) ? tierSection[spec.payloadKey] : undefined;
    const limit = parseTierBucket(bucket, spec, context);
    if (limit) limits.push(limit);
  }

  const extraUsageLimit = createExtraUsageLimit(body, context.accountId);
  if (extraUsageLimit) {
    limits.push(extraUsageLimit);
  }

  const metadata = createFactoryUsageMetadata(body, context);

  return {
    provider: PROVIDER_ID,
    fetchedAt: context.fetchedAt,
    limits,
    ...(body.usesTokenRateLimitsBilling === true
      ? { notes: ["This plan bills usage with token-based rate limits; window percentages reflect token quotas."] }
      : {}),
    metadata,
  };
}
