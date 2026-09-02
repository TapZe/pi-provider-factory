import type { FetchImpl, UsageFetchContext, UsageFetchParams, UsageProvider, UsageReport } from "@oh-my-pi/pi-ai";

import { FACTORY_HEADERS, PROVIDER_ID, resolveFactoryApiBase } from "./constants";
import { parseFactoryUsagePayload, type FactoryUsageParseContext } from "./usage-parsing";

export { parseFactoryUsagePayload };
export type { FactoryUsageParseContext };

/**
 * Factory account/quota reporting for Oh My Pi's native `/usage`.
 *
 * Droid 0.181.0 calls `GET {apiEndpoint}/api/billing/limits` with the OAuth
 * bearer and Droid-compatible client headers. A live probe showed the endpoint
 * accepts the OAuth token (with or without an organization header) and rejects
 * `fk-...` API keys with 401, so this fetcher is intentionally OAuth-only.
 */

export const BILLING_LIMITS_PATH = "/api/billing/limits";
export const DEFAULT_USAGE_CACHE_TTL_MS = 30_000;
export const DEFAULT_USAGE_REQUEST_TIMEOUT_MS = 10_000;
export const MAX_USAGE_CACHE_ENTRIES = 64;

export interface UsageSnapshot {
  report: UsageReport;
  expiresAt: number;
}

const usageSnapshots = new Map<string, UsageSnapshot>();
const inFlightUsageFetches = new Map<string, Promise<UsageReport | null>>();

export function usageCacheKey(apiEndpoint: string, orgId?: string | null): string | null {
  const cleanEndpoint = apiEndpoint.trim().replace(/\/+$/, "").toLowerCase();
  const cleanOrg = orgId?.trim().toLowerCase();
  if (!cleanOrg) return null;
  return `${cleanEndpoint}|${cleanOrg}`;
}

function waitForUsageFetch(
  promise: Promise<UsageReport | null>,
  signal: AbortSignal | undefined,
): Promise<UsageReport | null> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.resolve(null);

  const pending = Promise.withResolvers<UsageReport | null>();
  let settled = false;
  const cleanup = () => signal.removeEventListener("abort", onAbort);
  const finish = (report: UsageReport | null) => {
    if (settled) return;
    settled = true;
    cleanup();
    pending.resolve(report);
  };
  const fail = (error: unknown) => {
    if (settled) return;
    settled = true;
    cleanup();
    pending.reject(error);
  };
  const onAbort = () => finish(null);
  signal.addEventListener("abort", onAbort, { once: true });
  void promise.then(finish, fail);
  return pending.promise;
}


export function getCachedUsageSnapshot(key: string, nowMs: number = Date.now()): UsageReport | null {
  const entry = usageSnapshots.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= nowMs) {
    usageSnapshots.delete(key);
    return null;
  }
  return entry.report;
}

export function setCachedUsageSnapshot(
  key: string,
  report: UsageReport,
  ttlMs: number = DEFAULT_USAGE_CACHE_TTL_MS,
  nowMs: number = Date.now(),
): void {
  // Opportunistic bounded cache cleanup
  if (usageSnapshots.size >= MAX_USAGE_CACHE_ENTRIES) {
    for (const [k, v] of usageSnapshots.entries()) {
      if (v.expiresAt <= nowMs) {
        usageSnapshots.delete(k);
      }
    }
    if (usageSnapshots.size >= MAX_USAGE_CACHE_ENTRIES) {
      const firstKey = usageSnapshots.keys().next().value;
      if (firstKey) usageSnapshots.delete(firstKey);
    }
  }

  usageSnapshots.set(key, {
    report,
    expiresAt: nowMs + ttlMs,
  });
}

export function resetUsageCacheForTests(): void {
  usageSnapshots.clear();
  inFlightUsageFetches.clear();
}

/** Same base-URL precedence as model routing in router.ts. */
function resolveUsageBaseUrl(params: UsageFetchParams): string {
  const base = resolveFactoryApiBase(params.credential.apiEndpoint);
  return base.replace(/\/+$/, "");
}

export interface FetchFactoryUsageDirectOptions {
  apiEndpoint: string;
  orgId?: string | null;
  email?: string;
  accessToken?: string;
  fetchFn?: FetchImpl;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Skip cache reads for an explicit usage refresh while still publishing its result. */
  readCache?: boolean;
  logger?: UsageFetchContext["logger"];
}

export async function fetchFactoryUsageDirect(
  opts: FetchFactoryUsageDirectOptions,
): Promise<UsageReport | null> {
  const accessToken = opts.accessToken?.trim();
  if (!accessToken) return null;

  let base: string;
  try {
    base = resolveFactoryApiBase(opts.apiEndpoint).replace(/\/+$/, "");
  } catch (error) {
    opts.logger?.warn("Factory usage endpoint validation failed", {
      reason: error instanceof Error ? error.name : "unknown",
    });
    return null;
  }

  const key = usageCacheKey(base, opts.orgId);
  const now = Date.now();
  if (key && opts.readCache !== false) {
    const cached = getCachedUsageSnapshot(key, now);
    if (cached) return cached;
  }

  const existingFetch = key ? inFlightUsageFetches.get(key) : undefined;
  if (existingFetch) {
    return waitForUsageFetch(existingFetch, opts.signal);
  }

  const performFetch = async (): Promise<UsageReport | null> => {
    const headers: Record<string, string> = {
      ...FACTORY_HEADERS,
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    };
    if (opts.orgId) {
      headers["X-Factory-Org-Id"] = opts.orgId;
    }

    const requestTimeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_USAGE_REQUEST_TIMEOUT_MS;
    const effectiveSignal = AbortSignal.timeout(requestTimeoutMs);

    const actualFetch = opts.fetchFn ?? globalThis.fetch;
    let response: Response;
    try {
      response = await actualFetch(`${base}${BILLING_LIMITS_PATH}`, {
        method: "GET",
        headers,
        signal: effectiveSignal,
      });
    } catch (error) {
      if (effectiveSignal?.aborted || (error instanceof Error && error.name === "AbortError")) return null;
      opts.logger?.warn("Factory usage fetch failed", {
        reason: error instanceof Error ? error.name : "unknown",
      });
      return null;
    }

    if (!response.ok) {
      opts.logger?.warn("Factory usage request was rejected", { status: response.status });
      return null;
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      if (effectiveSignal?.aborted || (error instanceof Error && error.name === "AbortError")) return null;
      opts.logger?.warn("Factory usage response was not valid JSON", { status: response.status });
      return null;
    }

    const report = parseFactoryUsagePayload(payload, {
      accountId: opts.orgId ?? undefined,
      email: opts.email,
      endpoint: base,
      fetchedAt: Date.now(),
    });
    if (!report) {
      opts.logger?.warn("Factory usage response was not a recognized billing-limits payload", {
        status: response.status,
      });
      return null;
    }

    if (key) {
      setCachedUsageSnapshot(key, report);
    }

    return report;
  };

  if (key && inFlightUsageFetches.size < MAX_USAGE_CACHE_ENTRIES) {
    const fetchPromise = performFetch().finally(() => {
      inFlightUsageFetches.delete(key);
    });
    inFlightUsageFetches.set(key, fetchPromise);
    return waitForUsageFetch(fetchPromise, opts.signal);
  }

  return waitForUsageFetch(performFetch(), opts.signal);
}

export const factoryUsageProvider: UsageProvider = {
  id: PROVIDER_ID,
  // The endpoint authenticates the bearer, so a fetch doubles as a health check.
  validatesCredentials: true,

  supports(params: UsageFetchParams): boolean {
    // OAuth-only: the live `fk-...` API-key probe returned 401, so never send
    // API-key credentials to this endpoint.
    return (
      params.provider === PROVIDER_ID &&
      params.credential.type === "oauth" &&
      (params.credential.accessToken?.trim().length ?? 0) > 0
    );
  },

  async fetchUsage(params: UsageFetchParams, ctx: UsageFetchContext): Promise<UsageReport | null> {
    const credential = params.credential;
    if (credential.type !== "oauth") return null;
    const accessToken = credential.accessToken?.trim();
    if (!accessToken) return null;

    let base: string;
    try {
      base = resolveUsageBaseUrl(params);
    } catch (error) {
      ctx.logger?.warn("Factory usage endpoint validation failed", {
        reason: error instanceof Error ? error.name : "unknown",
      });
      return null;
    }

    return fetchFactoryUsageDirect({
      apiEndpoint: base,
      orgId: credential.accountId,
      email: credential.email,
      accessToken,
      fetchFn: ctx.fetch,
      signal: params.signal,
      logger: ctx.logger,
      readCache: false,
    });
  },
};
