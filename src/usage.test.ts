import { describe, expect, test } from "bun:test";
import type { UsageFetchContext, UsageFetchParams, UsageLimit, UsageReport } from "@oh-my-pi/pi-ai";

import { FACTORY_HEADERS } from "./constants";
import { factoryUsageProvider, parseFactoryUsagePayload, type FactoryUsageParseContext } from "./usage";

const FETCHED_AT = Date.parse("2026-07-30T12:00:00.000Z");
const ACCOUNT_ID = "org-sanitized-123";
const ENDPOINT = "https://api.factory.ai";

const CONTEXT: FactoryUsageParseContext = {
  accountId: ACCOUNT_ID,
  email: "user@example.com",
  endpoint: ENDPOINT,
  fetchedAt: FETCHED_AT,
};

// Sanitized replica of the live `GET /api/billing/limits` probe: plan-level
// fields, six Standard/Droid Core buckets, and Extra Usage balance fields.
const FIXTURE = {
  planType: "pro",
  tokenRateLimitsRolloutEligible: true,
  usesTokenRateLimitsBilling: false,
  extraUsageBalanceCents: 1234,
  extraUsageAllowed: true,
  overagePreference: "auto",
  limits: {
    standard: {
      fiveHour: { usedPercent: 42.5, windowEnd: "2026-07-30T16:00:00.000Z", secondsRemaining: 14400 },
      weekly: { usedPercent: 91.2, windowEnd: "2026-08-03T00:00:00.000Z", secondsRemaining: 302400 },
      monthly: { usedPercent: 100, windowEnd: "2026-08-01T00:00:00.000Z", secondsRemaining: 172800 },
    },
    core: {
      fiveHour: { usedPercent: 0, windowEnd: "2026-07-30T17:00:00.000Z", secondsRemaining: 18000 },
      weekly: { usedPercent: 7.75, windowEnd: "2026-08-03T00:00:00.000Z", secondsRemaining: 302400 },
      monthly: { usedPercent: 12, windowEnd: "2026-08-01T00:00:00.000Z", secondsRemaining: 172800 },
    },
  },
};

function requireLimit(report: UsageReport, id: string): UsageLimit {
  const limit = report.limits.find((entry) => entry.id === id);
  if (!limit) throw new Error(`expected limit ${id}`);
  return limit;
}

describe("parseFactoryUsagePayload", () => {
  const report = parseFactoryUsagePayload(FIXTURE, CONTEXT);
  if (!report) throw new Error("fixture must parse");

  test("emits the six tier buckets and the Extra Usage balance in stable order", () => {
    expect(report.limits.map((limit) => limit.id)).toEqual([
      "factory:standard:5h",
      "factory:standard:weekly",
      "factory:standard:monthly",
      "factory:core:5h",
      "factory:core:weekly",
      "factory:core:monthly",
      "factory:extra-usage-balance",
    ]);
    expect(report.limits.map((limit) => limit.label)).toEqual([
      "Standard 5 Hour",
      "Standard Weekly",
      "Standard Monthly",
      "Droid Core 5 Hour",
      "Droid Core Weekly",
      "Droid Core Monthly",
      "Extra Usage balance",
    ]);
  });

  test("normalizes percentages, statuses, scopes, and reset timestamps", () => {
    const fiveHour = requireLimit(report, "factory:standard:5h");
    expect(fiveHour.amount).toEqual({
      used: 42.5,
      limit: 100,
      remaining: 57.5,
      usedFraction: 0.425,
      remainingFraction: 0.575,
      unit: "percent",
    });
    expect(fiveHour.status).toBe("ok");
    expect(fiveHour.scope).toEqual({
      provider: "factory",
      tier: "standard",
      windowId: "5h",
      shared: true,
      accountId: ACCOUNT_ID,
      orgId: ACCOUNT_ID,
    });
    expect(fiveHour.window).toEqual({
      id: "5h",
      label: "5 Hour",
      durationMs: 5 * 60 * 60 * 1000,
      resetsAt: Date.parse("2026-07-30T16:00:00.000Z"),
    });

    expect(requireLimit(report, "factory:standard:weekly").status).toBe("warning");
    expect(requireLimit(report, "factory:standard:weekly").amount.used).toBeCloseTo(91.2);
    expect(requireLimit(report, "factory:standard:monthly").status).toBe("exhausted");

    const coreMonthly = requireLimit(report, "factory:core:monthly");
    expect(coreMonthly.scope.tier).toBe("core");
    expect(coreMonthly.status).toBe("ok");
    // Factory's monthly window is calendar-based: no synthetic duration.
    expect(coreMonthly.window?.durationMs).toBeUndefined();
    expect(coreMonthly.window?.resetsAt).toBe(Date.parse("2026-08-01T00:00:00.000Z"));
  });

  test("converts Extra Usage cents to a USD balance with eligibility notes", () => {
    const balance = requireLimit(report, "factory:extra-usage-balance");
    expect(balance.amount).toEqual({ unit: "usd", remaining: 12.34 });
    expect(balance.status).toBeUndefined();
    expect(balance.window).toBeUndefined();
    expect(balance.notes).toEqual(["Extra usage allowed", "Overage preference: auto"]);
    expect(balance.scope).toEqual({
      provider: "factory",
      shared: true,
      accountId: ACCOUNT_ID,
      orgId: ACCOUNT_ID,
    });
  });

  test("preserves plan and Extra Usage metadata plus the resolved endpoint", () => {
    expect(report.metadata).toEqual({
      endpoint: ENDPOINT,
      accountId: ACCOUNT_ID,
      orgId: ACCOUNT_ID,
      email: "user@example.com",
      planType: "pro",
      tokenRateLimitsRolloutEligible: true,
      usesTokenRateLimitsBilling: false,
      extraUsageAllowed: true,
      overagePreference: "auto",
    });
    // The full upstream payload must not be embedded in the report.
    expect(report.raw).toBeUndefined();
    expect(report.notes).toBeUndefined();
  });

  test("adds one provider-level note when token rate limit billing is enabled", () => {
    const billed = parseFactoryUsagePayload({ ...FIXTURE, usesTokenRateLimitsBilling: true }, CONTEXT);
    expect(billed?.notes).toHaveLength(1);
    expect(billed?.notes?.[0]).toContain("token-based rate limits");
    expect(billed?.metadata?.usesTokenRateLimitsBilling).toBe(true);
  });

  test("marks buckets without an active window unknown instead of available", () => {
    const inactive = parseFactoryUsagePayload(
      {
        planType: "standard",
        limits: {
          core: {
            fiveHour: { usedPercent: 0, windowEnd: null, secondsRemaining: null },
            weekly: { usedPercent: 3 },
          },
        },
      },
      CONTEXT,
    );
    const fiveHour = requireLimit(inactive!, "factory:core:5h");
    expect(fiveHour.status).toBe("unknown");
    expect(fiveHour.notes).toEqual(["No active window for this plan"]);
    expect(fiveHour.amount.used).toBe(0);
    const weekly = requireLimit(inactive!, "factory:core:weekly");
    expect(weekly.status).toBe("unknown");
    expect(weekly.window?.resetsAt).toBeUndefined();
  });

  test("clamps out-of-range percentages and skips malformed buckets", () => {
    const clamped = parseFactoryUsagePayload(
      {
        limits: {
          standard: {
            fiveHour: { usedPercent: 137, windowEnd: "2026-07-30T16:00:00.000Z" },
            weekly: { usedPercent: -5, windowEnd: "2026-08-03T00:00:00.000Z" },
            monthly: "broken",
          },
          core: {
            fiveHour: { usedPercent: "high", windowEnd: "2026-07-30T17:00:00.000Z" },
          },
        },
      },
      CONTEXT,
    );
    const fiveHour = requireLimit(clamped!, "factory:standard:5h");
    expect(fiveHour.amount.used).toBe(100);
    expect(fiveHour.amount.usedFraction).toBe(1);
    expect(fiveHour.status).toBe("exhausted");
    const weekly = requireLimit(clamped!, "factory:standard:weekly");
    expect(weekly.amount.used).toBe(0);
    expect(weekly.status).toBe("ok");
    // Malformed buckets are skipped without discarding the whole report.
    expect(clamped!.limits.some((limit) => limit.id === "factory:standard:monthly")).toBe(false);
    expect(clamped!.limits.some((limit) => limit.id === "factory:core:5h")).toBe(false);
  });

  test("prefers windowEnd and only falls back to secondsRemaining", () => {
    const both = parseFactoryUsagePayload(
      {
        limits: {
          standard: {
            fiveHour: { usedPercent: 10, windowEnd: "2026-07-30T16:00:00.000Z", secondsRemaining: 60 },
          },
        },
      },
      CONTEXT,
    );
    expect(requireLimit(both!, "factory:standard:5h").window?.resetsAt).toBe(Date.parse("2026-07-30T16:00:00.000Z"));

    const invalidEnd = parseFactoryUsagePayload(
      {
        limits: {
          standard: {
            fiveHour: { usedPercent: 10, windowEnd: "not-a-date", secondsRemaining: 3600 },
          },
        },
      },
      CONTEXT,
    );
    expect(requireLimit(invalidEnd!, "factory:standard:5h").window?.resetsAt).toBe(FETCHED_AT + 3600 * 1000);
  });

  test("returns an empty report for a recognized legacy/unlimited payload", () => {
    const legacy = parseFactoryUsagePayload({ planType: "enterprise" }, CONTEXT);
    expect(legacy).not.toBeNull();
    expect(legacy!.limits).toEqual([]);
    expect(legacy!.metadata?.planType).toBe("enterprise");
  });

  test("returns null for unrecognized top-level payloads", () => {
    expect(parseFactoryUsagePayload(null, CONTEXT)).toBeNull();
    expect(parseFactoryUsagePayload("nope", CONTEXT)).toBeNull();
    expect(parseFactoryUsagePayload([1, 2, 3], CONTEXT)).toBeNull();
    expect(parseFactoryUsagePayload({ error: "unauthorized" }, CONTEXT)).toBeNull();
  });
});

describe("factoryUsageProvider.supports", () => {
  function params(credential: UsageFetchParams["credential"], provider = "factory"): UsageFetchParams {
    return { provider, credential };
  }

  test("accepts only factory OAuth credentials with a non-empty access token", () => {
    expect(factoryUsageProvider.supports(params({ type: "oauth", accessToken: "tok" }))).toBe(true);
    expect(factoryUsageProvider.supports(params({ type: "oauth", accessToken: "  " }))).toBe(false);
    expect(factoryUsageProvider.supports(params({ type: "oauth" }))).toBe(false);
  });

  test("rejects Factory API keys and other providers", () => {
    expect(factoryUsageProvider.supports(params({ type: "api_key", apiKey: "fk-secret" }))).toBe(false);
    expect(factoryUsageProvider.supports(params({ type: "oauth", accessToken: "tok" }, "other"))).toBe(false);
  });

  test("opts into credential validation", () => {
    expect(factoryUsageProvider.validatesCredentials).toBe(true);
  });
});

describe("factoryUsageProvider.fetchUsage", () => {
  const SECRET_TOKEN = "live-secret-token";

  interface FetchCall {
    url: string;
    init?: RequestInit;
  }

  function makeContext(responder: () => Response | Promise<Response>) {
    const calls: FetchCall[] = [];
    const warnings: { message: string; meta?: Record<string, unknown> }[] = [];
    const ctx: UsageFetchContext = {
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return responder();
      }) as UsageFetchContext["fetch"],
      logger: {
        debug: () => {},
        warn: (message, meta) => {
          warnings.push({ message, meta });
        },
      },
    };
    return { calls, warnings, ctx };
  }

  function oauthParams(credential: Partial<UsageFetchParams["credential"]> = {}): UsageFetchParams {
    return {
      provider: "factory",
      credential: { type: "oauth", accessToken: SECRET_TOKEN, accountId: ACCOUNT_ID, ...credential },
    };
  }

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }

  test("requests the default billing-limits URL with Droid headers and the org header", async () => {
    const { calls, ctx } = makeContext(() => jsonResponse(FIXTURE));
    const report = await factoryUsageProvider.fetchUsage(oauthParams({ accountId: ACCOUNT_ID }), ctx);

    expect(report).not.toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.factory.ai/api/billing/limits");
    expect(calls[0]!.init?.method).toBe("GET");
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${SECRET_TOKEN}`);
    expect(headers.Accept).toBe("application/json");
    expect(headers["X-Factory-Org-Id"]).toBe(ACCOUNT_ID);
    for (const [key, value] of Object.entries(FACTORY_HEADERS)) {
      expect(headers[key]).toBe(value);
    }
  });

  test("uses the credential's regional apiEndpoint and strips trailing slashes", async () => {
    const { calls, ctx } = makeContext(() => jsonResponse(FIXTURE));
    await factoryUsageProvider.fetchUsage(oauthParams({ apiEndpoint: "https://api.eu.factory.ai/" }), ctx);

    expect(calls[0]!.url).toBe("https://api.eu.factory.ai/api/billing/limits");
  });

  test("omits the org header when the credential has no accountId", async () => {
    const { calls, ctx } = makeContext(() => jsonResponse(FIXTURE));
    await factoryUsageProvider.fetchUsage(oauthParams({ accountId: undefined }), ctx);

    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers["X-Factory-Org-Id"]).toBeUndefined();
  });

  test("returns the parsed report on success", async () => {
    const { ctx } = makeContext(() => jsonResponse(FIXTURE));
    const report = await factoryUsageProvider.fetchUsage(oauthParams(), ctx);

    expect(report?.provider).toBe("factory");
    expect(report?.limits).toHaveLength(7);
    expect(report?.metadata?.accountId).toBe(ACCOUNT_ID);
  });

  test("never calls the endpoint for API-key credentials, even with an accessToken present", async () => {
    const { calls, ctx } = makeContext(() => jsonResponse(FIXTURE));
    const report = await factoryUsageProvider.fetchUsage(
      { provider: "factory", credential: { type: "api_key", apiKey: "fk-secret", accessToken: SECRET_TOKEN } },
      ctx,
    );

    expect(report).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test("returns null on non-2xx and logs only the redacted status", async () => {
    const { warnings, ctx } = makeContext(() => jsonResponse({ detail: "denied" }, 401));
    const report = await factoryUsageProvider.fetchUsage(oauthParams(), ctx);

    expect(report).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.meta?.status).toBe(401);
    expect(JSON.stringify(warnings)).not.toContain(SECRET_TOKEN);
    expect(JSON.stringify(warnings)).not.toContain(ACCOUNT_ID);
  });

  test("returns null on invalid JSON", async () => {
    const { warnings, ctx } = makeContext(() => new Response("not json", { status: 200 }));
    const report = await factoryUsageProvider.fetchUsage(oauthParams(), ctx);

    expect(report).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(JSON.stringify(warnings)).not.toContain(SECRET_TOKEN);
  });

  test("returns null on an unrecognized 2xx payload", async () => {
    const { warnings, ctx } = makeContext(() => jsonResponse({ hello: "world" }));
    const report = await factoryUsageProvider.fetchUsage(oauthParams(), ctx);

    expect(report).toBeNull();
    expect(warnings).toHaveLength(1);
  });

  test("returns null silently on abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const { warnings, ctx } = makeContext(() => {
      throw new DOMException("The operation was aborted", "AbortError");
    });
    const params = oauthParams();
    params.signal = controller.signal;
    const report = await factoryUsageProvider.fetchUsage(params, ctx);

    expect(report).toBeNull();
    expect(warnings).toHaveLength(0);
  });

  test("returns null silently when aborted while reading the body", async () => {
    const controller = new AbortController();
    const abortedBody = {
      ok: true,
      status: 200,
      json: async () => {
        controller.abort();
        throw new DOMException("The operation was aborted", "AbortError");
      },
    } as unknown as Response;
    const { warnings, ctx } = makeContext(() => abortedBody);
    const params = oauthParams();
    params.signal = controller.signal;
    const report = await factoryUsageProvider.fetchUsage(params, ctx);

    expect(report).toBeNull();
    expect(warnings).toHaveLength(0);
  });

  test("returns null on network failure without leaking credentials", async () => {
    // A hostile/lossy transport whose error message embeds the bearer token:
    // the warning must carry the error class name only, never the message.
    const { warnings, ctx } = makeContext(() => {
      throw new TypeError(`connect ECONNREFUSED (sent Authorization: Bearer ${SECRET_TOKEN})`);
    });
    const report = await factoryUsageProvider.fetchUsage(oauthParams(), ctx);

    expect(report).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.meta?.reason).toBe("TypeError");
    expect(JSON.stringify(warnings)).not.toContain(SECRET_TOKEN);
  });
});
