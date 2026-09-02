import { describe, expect, test } from "bun:test";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@oh-my-pi/pi-ai/oauth/types";

import { login, refreshToken } from "./auth";
import { formatErrorDetails, parseUniqueOrganizationIds, readJsonResponse } from "./auth-parsing";
import { factoryApiForRegion, validateHostedFactoryApiOrigin } from "./constants";

type OAuthFetch = NonNullable<OAuthLoginCallbacks["fetch"]>;

function unsignedJwt(payload: Record<string, unknown>): string {
  return `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

const EXPIRED_CREDENTIAL: OAuthCredentials = {
  refresh: "original-refresh",
  access: "original-access",
  expires: 1,
  accountId: "org_saved",
  projectId: "org_saved",
  apiEndpoint: "https://api.factory.ai",
};

async function loginWithWhoamiResponse(whoamiResponse: Response): Promise<OAuthCredentials> {
  const scopedToken = unsignedJwt({ org_id: "org_verified" });
  const fetchImpl: OAuthFetch = async (input) => {
    const url = String(input);
    if (url.includes("authorize/device")) {
      return jsonResponse({
        device_code: "device-code",
        user_code: "ABCD-1234",
        verification_uri: "https://factory.ai/verify",
        verification_uri_complete: "https://factory.ai/verify?code=ABCD-1234",
        expires_in: 300,
        interval: 0.001,
      });
    }
    if (url.includes("authenticate")) {
      return jsonResponse({ access_token: scopedToken, refresh_token: "refresh-token", expires_in: 3_600 });
    }
    if (url.endsWith("/api/cli/whoami")) return whoamiResponse;
    return new Response("Not Found", { status: 404 });
  };
  return login({ fetch: fetchImpl, onAuth() {}, async onPrompt() { return "1"; } });
}

describe("Factory hosted endpoint validation", () => {
  test("accepts canonical Factory origins and region labels", () => {
    expect(validateHostedFactoryApiOrigin("https://api.factory.ai")).toBe("https://api.factory.ai");
    expect(validateHostedFactoryApiOrigin("https://api.eu.factory.ai/")).toBe("https://api.eu.factory.ai");
    expect(factoryApiForRegion(undefined)).toBe("https://api.factory.ai");
    expect(factoryApiForRegion("global")).toBe("https://api.factory.ai");
    expect(factoryApiForRegion("eu")).toBe("https://api.eu.factory.ai");
    expect(factoryApiForRegion("us-east")).toBe("https://api.us-east.factory.ai");
  });

  test("rejects endpoints that could exfiltrate a selected bearer", () => {
    const rejected = [
      "http://api.factory.ai",
      "https://api.factory.ai.evil.example",
      "https://user:pass@api.factory.ai",
      "https://api.factory.ai:8443",
      "https://api.factory.ai/v1",
      "https://api.factory.ai?query=1",
      "https://api.factory.ai#fragment",
    ];
    for (const endpoint of rejected) expect(() => validateHostedFactoryApiOrigin(endpoint)).toThrow();
    expect(() => factoryApiForRegion("evil.example")).toThrow();
    expect(() => factoryApiForRegion("https://evil.example")).toThrow();
  });
});

describe("Factory organization selection", () => {
  test("parses every unique non-empty organization in response order", () => {
    expect(
      parseUniqueOrganizationIds({
        workosOrgIds: ["org_1", "org_2", "org_1", "", "   ", "org_3", 123, null],
      }),
    ).toEqual(["org_1", "org_2", "org_3"]);
    expect(parseUniqueOrganizationIds({})).toEqual([]);
  });

  test("prompts for multiple organizations and persists the selected organization", async () => {
    const unscopedToken = unsignedJwt({ sub: "user_123" });
    const scopedToken = unsignedJwt({ org_id: "org_selected_2" });
    const fetchImpl: OAuthFetch = async (input, init) => {
      const url = String(input);
      if (url.includes("authorize/device")) {
        return jsonResponse({
          device_code: "device-code",
          user_code: "ABCD-1234",
          verification_uri: "https://factory.ai/verify",
          verification_uri_complete: "https://factory.ai/verify?code=ABCD-1234",
          expires_in: 300,
          interval: 0.001,
        });
      }
      if (url.includes("authenticate")) {
        const grantType = new URLSearchParams(String(init?.body)).get("grant_type");
        return grantType === "refresh_token"
          ? jsonResponse({ access_token: scopedToken, refresh_token: "scoped-refresh", expires_in: 3_600 })
          : jsonResponse({ access_token: unscopedToken, refresh_token: "initial-refresh", expires_in: 3_600 });
      }
      if (url.endsWith("/api/cli/org")) {
        return jsonResponse({ workosOrgIds: ["org_option_1", "org_selected_2"] });
      }
      if (url.endsWith("/api/cli/whoami")) {
        return jsonResponse({ orgId: "org_selected_2", region: "eu" });
      }
      return new Response("Not Found", { status: 404 });
    };
    const prompts: string[] = [];

    const credentials = await login({
      fetch: fetchImpl,
      onAuth() {},
      async onPrompt(prompt) {
        prompts.push(prompt.message);
        return "2";
      },
    });

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("1. org_option_1");
    expect(prompts[0]).toContain("2. org_selected_2");
    expect(credentials.accountId).toBe("org_selected_2");
    expect(credentials.projectId).toBe("org_selected_2");
    expect(credentials.apiEndpoint).toBe("https://api.eu.factory.ai");
  });

  test("requires whoami to confirm the token organization", async () => {
    await expect(loginWithWhoamiResponse(jsonResponse({ error: "unavailable" }, 503))).rejects.toThrow(
      /whoami request failed.*status=503/,
    );
    await expect(loginWithWhoamiResponse(jsonResponse({ region: "eu" }))).rejects.toThrow(
      /whoami response did not include an organization ID/,
    );
    await expect(loginWithWhoamiResponse(jsonResponse({ orgId: "org_other", region: "eu" }))).rejects.toThrow(
      /whoami returned a different organization/,
    );
  });

  test("refuses to guess during legacy refresh when multiple organizations exist", async () => {
    const unscopedToken = unsignedJwt({ sub: "user_legacy" });
    const fetchImpl: OAuthFetch = async (input) => {
      const url = String(input);
      if (url.includes("authenticate")) {
        return jsonResponse({ access_token: unscopedToken, refresh_token: "new-refresh", expires_in: 3_600 });
      }
      if (url.endsWith("/api/cli/org")) return jsonResponse({ workosOrgIds: ["org_a", "org_b"] });
      return new Response("Not Found", { status: 404 });
    };

    await expect(
      refreshToken({ refresh: "old-refresh", access: unscopedToken, expires: 1 }, undefined, fetchImpl),
    ).rejects.toThrow(/multiple organizations.*\/login factory/);
  });
});

describe("Factory OAuth error handling", () => {
  test("bounds response bodies and exposes only allowlisted upstream error codes", async () => {
    const secret = "refresh-secret-that-must-not-leak";
    let message = "";
    try {
      await readJsonResponse(jsonResponse({ error: "invalid_grant", refresh_token: secret }, 400), "refresh token");
    } catch (error) {
      message = formatErrorDetails(error);
    }

    expect(message).toContain("status=400; code=invalid_grant");
    expect(message).not.toContain(secret);
    await expect(
      readJsonResponse(new Response("x".repeat(65_537), { status: 500 }), "oversized"),
    ).rejects.toThrow(/exceeded 65536 bytes/);
  });

  test("redacts token-shaped values from nested error text", () => {
    const details = formatErrorDetails(
      new Error("access_token=secret-access refresh-token: secret-refresh Bearer secret-bearer"),
    );
    expect(details).not.toContain("secret-access");
    expect(details).not.toContain("secret-refresh");
    expect(details).not.toContain("secret-bearer");
  });
});

describe("Factory OAuth cancellation", () => {
  test("threads caller cancellation into refresh requests", async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | null | undefined;
    const fetchImpl: OAuthFetch = async (_input, init) => {
      requestSignal = init?.signal;
      const pending = Promise.withResolvers<Response>();
      const signal = init?.signal;
      if (!signal) pending.reject(new Error("missing signal"));
      else if (signal.aborted) pending.reject(signal.reason);
      else signal.addEventListener("abort", () => pending.reject(signal.reason), { once: true });
      return pending.promise;
    };

    const pending = refreshToken(EXPIRED_CREDENTIAL, controller.signal, fetchImpl);
    controller.abort(new Error("caller cancelled refresh"));

    await expect(pending).rejects.toThrow(/caller cancelled refresh/);
    expect(requestSignal).toBeDefined();
    expect(requestSignal?.aborted).toBe(true);
  });
});
