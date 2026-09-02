import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "bun:test";
import { streamSimple, type Context, type FetchImpl } from "@oh-my-pi/pi-ai";
import { unregisterCustomApis } from "@oh-my-pi/pi-ai/api-registry";
import { unregisterOAuthProviders } from "@oh-my-pi/pi-ai/oauth";
import type { ExtensionAPI, ProviderConfig } from "@oh-my-pi/pi-coding-agent";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";

import { PROVIDER_ID } from "./constants";
import registerFactoryProvider from "./index";

const SOURCE_ID = "factory-auth-rotation-test";
const CONTEXT: Context = {
  systemPrompt: [],
  messages: [{ role: "user", content: [{ type: "text", text: "ping" }], timestamp: 0 }],
  tools: [],
};

function unsignedOrgToken(orgId: string, revision: string): string {
  return `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ org_id: orgId, revision })).toString("base64url")}.signature`;
}

function chatSuccess(): Response {
  return new Response(
    [
      'data: {"id":"chatcmpl_rotation","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl_rotation","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ].join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
}

async function runAuthRotation(status: 401 | 403): Promise<{ orgAttempts: string[]; refreshes: number }> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "factory-auth-failure-rotation-"));
  const authStorage = await AuthStorage.create(path.join(directory, "auth.db"));
  const registry = new ModelRegistry(authStorage, path.join(directory, "models.yml"));
  const originalFetch = globalThis.fetch;

  try {
    const extension = {
      registerProvider(name: string, config: ProviderConfig) {
        registry.registerProvider(name, config, SOURCE_ID);
      },
      on() {},
    } as unknown as ExtensionAPI;
    registerFactoryProvider(extension);
    await authStorage.set(PROVIDER_ID, [
      {
        type: "oauth",
        refresh: "refresh-a",
        access: unsignedOrgToken("org-a", "initial"),
        expires: Date.now() + 3_600_000,
        accountId: "org-a",
        projectId: "org-a",
        apiEndpoint: "https://api.factory.ai",
      },
      {
        type: "oauth",
        refresh: "refresh-b",
        access: unsignedOrgToken("org-b", "initial"),
        expires: Date.now() + 3_600_000,
        accountId: "org-b",
        projectId: "org-b",
        apiEndpoint: "https://api.factory.ai",
      },
    ]);

    const model = registry.find(PROVIDER_ID, "glm-5.3");
    if (!model) throw new Error("Factory GLM model was not registered");
    const orgAttempts: string[] = [];
    let failedOrg: string | undefined;
    let refreshes = 0;
    const fetchImpl: FetchImpl = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      if (url.includes("api.workos.com/user_management/authenticate")) {
        refreshes += 1;
        const orgId = new URLSearchParams(String(init?.body)).get("organization_id");
        if (!orgId) throw new Error("Refresh request omitted organization_id");
        return Response.json({
          access_token: unsignedOrgToken(orgId, `refresh-${refreshes}`),
          refresh_token: `rotated-refresh-${refreshes}`,
          expires_in: 3_600,
        });
      }
      if (url.endsWith("/api/cli/whoami")) {
        const orgId = headers.get("x-factory-org-id");
        return Response.json({ orgId, region: "global" });
      }
      const orgId = headers.get("x-factory-org-id");
      if (!orgId) throw new Error("Model request omitted X-Factory-Org-Id");
      failedOrg ??= orgId;
      orgAttempts.push(orgId);
      if (orgId === failedOrg) {
        return Response.json({ error: { message: status === 403 ? "account not entitled" : "invalid token" } }, { status });
      }
      return chatSuccess();
    };
    globalThis.fetch = fetchImpl as typeof fetch;

    const stream = streamSimple(model, CONTEXT, {
      apiKey: registry.resolver(model, `factory-auth-${status}`),
      fetch: fetchImpl,
    });
    for await (const _event of stream) {
      // Drain refresh and sibling attempts.
    }
    const result = await stream.result();
    expect(result.stopReason).toBe("stop");
    expect(result.content).toContainEqual({ type: "text", text: "ok" });
    return { orgAttempts, refreshes };
  } finally {
    globalThis.fetch = originalFetch;
    unregisterCustomApis(SOURCE_ID);
    unregisterOAuthProviders(SOURCE_ID);
    authStorage.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

describe("Factory auth failure account rotation", () => {
  test("rotates directly to a sibling after an account-specific 403", async () => {
    const outcome = await runAuthRotation(403);
    expect(outcome.orgAttempts).toHaveLength(2);
    expect(new Set(outcome.orgAttempts).size).toBe(2);
    expect(outcome.refreshes).toBe(0);
  });

  test("refreshes the current account once, then rotates after a persistent 401", async () => {
    const outcome = await runAuthRotation(401);
    expect(outcome.orgAttempts).toHaveLength(3);
    expect(outcome.orgAttempts[0]).toBe(outcome.orgAttempts[1]);
    expect(outcome.orgAttempts[2]).not.toBe(outcome.orgAttempts[0]);
    expect(outcome.refreshes).toBe(1);
  });
});
