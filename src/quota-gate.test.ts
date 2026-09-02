import { beforeEach, describe, expect, it } from "bun:test";
import type { Context, FetchImpl, Model } from "@oh-my-pi/pi-ai";
import { FACTORY_MODELS, factoryQuotaTierFor } from "./catalog";
import { buildUsageLimitErrorMessage, evaluateUsageReport, isQuotaPreflightEnabled } from "./quota-gate";
import { routeFactoryStream } from "./router";
import { fetchFactoryUsageDirect, getCachedUsageSnapshot, resetUsageCacheForTests, usageCacheKey } from "./usage";

const API_ENDPOINT = "https://api.factory.ai";
const ORG_ID = "org-test-123";
const TOKEN = "test-token";
const ENVELOPE = JSON.stringify({
  token: TOKEN,
  orgId: ORG_ID,
  apiEndpoint: API_ENDPOINT,
});

const CLAUDE_MODEL = FACTORY_MODELS.find((model) => model.id.startsWith("claude-"))!;

function makeBillingLimitsResponse(options: {
  standardExhausted?: boolean;
  coreExhausted?: boolean;
  standardReset?: string;
  coreReset?: string;
}): Record<string, unknown> {
  return {
    planType: "pro",
    limits: {
      standard: {
        fiveHour: {
          usedPercent: options.standardExhausted ? 100 : 40,
          windowEnd: options.standardReset ?? "2026-09-02T16:00:00.000Z",
          secondsRemaining: options.standardExhausted ? 3600 : 7200,
        },
        weekly: { usedPercent: options.standardExhausted ? 100 : 50, windowEnd: "2026-09-07T00:00:00.000Z" },
        monthly: { usedPercent: 20, windowEnd: "2026-10-01T00:00:00.000Z" },
      },
      core: {
        fiveHour: {
          usedPercent: options.coreExhausted ? 100 : 10,
          windowEnd: options.coreReset ?? "2026-09-02T17:00:00.000Z",
          secondsRemaining: options.coreExhausted ? 7200 : 14400,
        },
        weekly: { usedPercent: options.coreExhausted ? 100 : 15, windowEnd: "2026-09-07T00:00:00.000Z" },
        monthly: { usedPercent: 5, windowEnd: "2026-10-01T00:00:00.000Z" },
      },
    },
  };
}

describe("Quota Preflight and Model Tier Classification", () => {
  beforeEach(() => {
    resetUsageCacheForTests();
  });

  it("classifies models canonically into Standard and Core tiers", () => {
    expect(factoryQuotaTierFor("claude-opus-5")).toBe("standard");
    expect(factoryQuotaTierFor("claude-sonnet-4-6")).toBe("standard");
    expect(factoryQuotaTierFor("gpt-5.6-sol")).toBe("standard");
    expect(factoryQuotaTierFor("gpt-5.3-codex")).toBe("standard");
    expect(factoryQuotaTierFor("grok-4.6")).toBe("standard");
    expect(factoryQuotaTierFor("glm-5.3")).toBe("core");
    expect(factoryQuotaTierFor("kimi-k3")).toBe("core");
    expect(factoryQuotaTierFor("deepseek-v4-pro")).toBe("core");
    expect(factoryQuotaTierFor("minimax-m3")).toBe("core");
    expect(factoryQuotaTierFor("nemotron-3-ultra")).toBe("core");
    expect(factoryQuotaTierFor("inkling")).toBe("core");
  });

  it("is disabled by default and accepts only explicit 1 or true values", () => {
    expect(isQuotaPreflightEnabled("")).toBe(false);
    expect(isQuotaPreflightEnabled(undefined)).toBe(false);
    expect(isQuotaPreflightEnabled("1")).toBe(true);
    expect(isQuotaPreflightEnabled(" TRUE ")).toBe(true);
    expect(isQuotaPreflightEnabled("0")).toBe(false);
  });

  it("evaluates usage report correctly for Standard vs Core isolation", async () => {
    let fetchCount = 0;
    const fetchMock: FetchImpl = async () => {
      fetchCount++;
      return new Response(JSON.stringify(makeBillingLimitsResponse({ standardExhausted: true, coreExhausted: false })), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const report = await fetchFactoryUsageDirect({
      apiEndpoint: API_ENDPOINT,
      orgId: ORG_ID,
      accessToken: TOKEN,
      fetchFn: fetchMock,
    });

    const standardDecision = evaluateUsageReport(report, "standard");
    expect(standardDecision.allow).toBe(false);
    expect(standardDecision.tier).toBe("standard");
    expect(standardDecision.resetAtMs).toBeDefined();

    const coreDecision = evaluateUsageReport(report, "core");
    expect(coreDecision.allow).toBe(true);
  });

  it("handles Core exhaustion without blocking Standard", async () => {
    const fetchMock: FetchImpl = async () => {
      return new Response(JSON.stringify(makeBillingLimitsResponse({ standardExhausted: false, coreExhausted: true })), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const report = await fetchFactoryUsageDirect({
      apiEndpoint: API_ENDPOINT,
      orgId: ORG_ID,
      accessToken: TOKEN,
      fetchFn: fetchMock,
    });

    expect(evaluateUsageReport(report, "standard").allow).toBe(true);
    expect(evaluateUsageReport(report, "core").allow).toBe(false);
  });

  it("fails open when Factory explicitly allows extra usage", async () => {
    const fetchMock: FetchImpl = async () =>
      Response.json({
        ...makeBillingLimitsResponse({ standardExhausted: true }),
        extraUsageAllowed: true,
        extraUsageBalanceCents: 1_000,
      });
    const report = await fetchFactoryUsageDirect({
      apiEndpoint: API_ENDPOINT,
      orgId: ORG_ID,
      accessToken: TOKEN,
      fetchFn: fetchMock,
    });

    expect(evaluateUsageReport(report, "standard").allow).toBe(true);
  });

  it("shares cache and single-flight in-flight fetch across concurrent requests", async () => {
    let fetchCount = 0;
    const { promise: blockPromise, resolve: unblock } = Promise.withResolvers<void>();
    const fetchMock: FetchImpl = async () => {
      fetchCount++;
      await blockPromise;
      return new Response(JSON.stringify(makeBillingLimitsResponse({ standardExhausted: false, coreExhausted: false })), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const key = usageCacheKey(API_ENDPOINT, ORG_ID)!;
    expect(getCachedUsageSnapshot(key)).toBeNull();
    expect(key).not.toContain(TOKEN);

    // Fire 2 concurrent fetches
    const fetchPromise1 = fetchFactoryUsageDirect({
      apiEndpoint: API_ENDPOINT,
      orgId: ORG_ID,
      accessToken: TOKEN,
      fetchFn: fetchMock,
    });
    const fetchPromise2 = fetchFactoryUsageDirect({
      apiEndpoint: API_ENDPOINT,
      orgId: ORG_ID,
      accessToken: TOKEN,
      fetchFn: fetchMock,
    });

    unblock();
    const [res1, res2] = await Promise.all([fetchPromise1, fetchPromise2]);

    expect(fetchCount).toBe(1);
    expect(res1).not.toBeNull();
    expect(res2).not.toBeNull();
    expect(getCachedUsageSnapshot(key)).not.toBeNull();

    // Next fetch uses cache
    const res3 = await fetchFactoryUsageDirect({
      apiEndpoint: API_ENDPOINT,
      orgId: ORG_ID,
      accessToken: TOKEN,
      fetchFn: fetchMock,
    });
    expect(fetchCount).toBe(1);
    expect(res3).not.toBeNull();
  });

  it("lets one joined caller abort without cancelling the shared usage fetch", async () => {
    const transport = Promise.withResolvers<Response>();
    let transportSignal: AbortSignal | null | undefined;
    let fetchCount = 0;
    const fetchMock: FetchImpl = async (_input, init) => {
      fetchCount += 1;
      transportSignal = init?.signal;
      return transport.promise;
    };
    const owner = new AbortController();
    const joiner = new AbortController();
    const request = (signal: AbortSignal) =>
      fetchFactoryUsageDirect({
        apiEndpoint: API_ENDPOINT,
        orgId: ORG_ID,
        accessToken: TOKEN,
        fetchFn: fetchMock,
        signal,
      });

    const ownerResult = request(owner.signal);
    const joinerResult = request(joiner.signal);
    owner.abort();
    expect(await ownerResult).toBeNull();
    expect(transportSignal?.aborted).toBe(false);

    transport.resolve(Response.json(makeBillingLimitsResponse({})));
    expect(await joinerResult).not.toBeNull();
    expect(fetchCount).toBe(1);
  });

  it("fails open on billing limits timeout or network error", async () => {
    const failingFetch: FetchImpl = async () => {
      throw new Error("Network error");
    };

    const report = await fetchFactoryUsageDirect({
      apiEndpoint: API_ENDPOINT,
      orgId: ORG_ID,
      accessToken: TOKEN,
      fetchFn: failingFetch,
    });

    expect(report).toBeNull();
    const decision = evaluateUsageReport(report, "standard");
    expect(decision.allow).toBe(true);
  });

  it("formats retry-after hint and usage_limit_reached error message correctly", () => {
    const now = 1000000;
    const reset = 1015000; // 15 seconds later
    const msg = buildUsageLimitErrorMessage("standard", reset, now);
    expect(msg).toContain("429 factory: Factory Standard usage limit reached (code=usage_limit_reached)");
    expect(msg).toContain("retry-after-ms=15000");
  });

  it("router performs preflight and emits 429 error stream when enabled and exhausted", async () => {

    let billingFetchCalled = false;
    let modelFetchCalled = false;

    const customFetch: FetchImpl = async (input) => {
      const url = String(input);
      if (url.includes("/api/billing/limits")) {
        billingFetchCalled = true;
        return new Response(JSON.stringify(makeBillingLimitsResponse({ standardExhausted: true, coreExhausted: false })), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      modelFetchCalled = true;
      return new Response("ok", { status: 200 });
    };

    const stream = routeFactoryStream(
      CLAUDE_MODEL as unknown as Model<"anthropic-messages">,
      { messages: [] } as unknown as Context,
      {
        apiKey: ENVELOPE,
        fetch: customFetch,
      },
      true,
    );

    const events: unknown[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(billingFetchCalled).toBe(true);
    expect(modelFetchCalled).toBe(false);
    expect(events.length).toBe(1);
    const firstEvent = events[0] as { type: string; error: { errorMessage: string; errorStatus?: number } };
    expect(firstEvent.type).toBe("error");
    expect(firstEvent.error.errorStatus).toBe(429);
    expect(firstEvent.error.errorMessage).toContain("Factory Standard usage limit reached");
    expect(firstEvent.error.errorMessage).toContain("code=usage_limit_reached");
    expect(firstEvent.error.errorMessage).toContain("retry-after-ms=");
  });

  it("router does zero extra requests when disabled", async () => {

    let billingFetchCalled = false;
    let modelFetchCalled = false;

    const customFetch: FetchImpl = async (input, init) => {
      const url = String(input);
      if (url.includes("/api/billing/limits")) {
        billingFetchCalled = true;
        return new Response("{}", { status: 200 });
      }
      modelFetchCalled = true;
      return new Response(
        [
          'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"claude-opus-5","usage":{"input_tokens":10,"output_tokens":0}}}\n\n',
          'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"hello"}}\n\n',
          'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
          'event: message_stop\ndata: {"type":"message_stop"}\n\n',
        ].join(""),
        {
          headers: { "content-type": "text/event-stream" },
          status: 200,
        },
      );
    };

    const stream = routeFactoryStream(
      CLAUDE_MODEL as unknown as Model<"anthropic-messages">,
      { messages: [] } as unknown as Context,
      {
        apiKey: ENVELOPE,
        fetch: customFetch,
      },
      false,
    );

    for await (const _event of stream) {
      // consume
    }

    expect(billingFetchCalled).toBe(false);
    expect(modelFetchCalled).toBe(true);
  });

  it("never preflights raw API keys even when the option is enabled", async () => {
    let billingRequests = 0;
    let modelRequests = 0;
    const customFetch: FetchImpl = async (input) => {
      if (String(input).includes("/api/billing/limits")) {
        billingRequests += 1;
        return Response.json({});
      }
      modelRequests += 1;
      return new Response(
        [
          'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_raw","type":"message","role":"assistant","content":[],"model":"claude-opus-5","stop_reason":null,"usage":{"input_tokens":1,"output_tokens":0}}}\n\n',
          'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n',
          'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
          'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}\n\n',
          'event: message_stop\ndata: {"type":"message_stop"}\n\n',
        ].join(""),
        { headers: { "content-type": "text/event-stream" } },
      );
    };
    const stream = routeFactoryStream(
      CLAUDE_MODEL as unknown as Model<"anthropic-messages">,
      { messages: [] } as unknown as Context,
      { apiKey: "fk-test-raw-key", fetch: customFetch },
      true,
    );
    for await (const _event of stream) {
      // Drain the real model request.
    }

    expect(billingRequests).toBe(0);
    expect(modelRequests).toBe(1);
  });
});
