import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "bun:test";
import { streamSimple, type AssistantMessage, type Context, type FetchImpl } from "@oh-my-pi/pi-ai";
import { registerCustomApi, unregisterCustomApis } from "@oh-my-pi/pi-ai/api-registry";
import { unregisterOAuthProviders } from "@oh-my-pi/pi-ai/oauth";
import type { ExtensionAPI, ProviderConfig } from "@oh-my-pi/pi-coding-agent";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";

import { CUSTOM_API, PROVIDER_ID } from "./constants";
import registerFactoryProvider from "./index";
import { routeFactoryStream } from "./router";
import { resetUsageCacheForTests } from "./usage";

const SOURCE_ID = "factory-quota-rotation-test";
const CONTEXT: Context = {
  systemPrompt: [],
  messages: [{ role: "user", content: [{ type: "text", text: "ping" }], timestamp: 0 }],
  tools: [],
};

function billingResponse(exhausted: boolean): Response {
  const usedPercent = exhausted ? 100 : 10;
  return Response.json({
    planType: "pro",
    limits: {
      standard: {
        fiveHour: { usedPercent, secondsRemaining: 3_600 },
        weekly: { usedPercent, secondsRemaining: 86_400 },
        monthly: { usedPercent: 5, secondsRemaining: 172_800 },
      },
      core: {
        fiveHour: { usedPercent: 5, secondsRemaining: 3_600 },
        weekly: { usedPercent: 5, secondsRemaining: 86_400 },
        monthly: { usedPercent: 5, secondsRemaining: 172_800 },
      },
    },
  });
}

function anthropicSuccessResponse(): Response {
  return new Response(
    [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_quota","type":"message","role":"assistant","model":"claude-opus-5","content":[],"stop_reason":null,"usage":{"input_tokens":1,"output_tokens":0}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ].join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
}

interface RotationScenarioResult {
  result: AssistantMessage;
  billingTokens: string[];
  modelRequests: number;
}

async function runRotationScenario(allAccountsExhausted: boolean): Promise<RotationScenarioResult> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "factory-quota-rotation-"));
  const authStorage = await AuthStorage.create(path.join(directory, "auth.db"));
  const registry = new ModelRegistry(authStorage, path.join(directory, "models.yml"));

  try {
    const extension = {
      registerProvider(name: string, config: ProviderConfig) {
        registry.registerProvider(name, config, SOURCE_ID);
      },
      on() {},
    } as unknown as ExtensionAPI;
    registerFactoryProvider(extension);
    registerCustomApi(
      CUSTOM_API,
      (model, context, options) => routeFactoryStream(model, context, options, true),
      SOURCE_ID,
    );
    await authStorage.set(PROVIDER_ID, [
      {
        type: "oauth",
        refresh: "refresh-account-a",
        access: "access-account-a",
        expires: Date.now() + 3_600_000,
        accountId: "org-account-a",
        apiEndpoint: "https://api.factory.ai",
      },
      {
        type: "oauth",
        refresh: "refresh-account-b",
        access: "access-account-b",
        expires: Date.now() + 3_600_000,
        accountId: "org-account-b",
        apiEndpoint: "https://api.factory.ai",
      },
    ]);

    const model = registry.find(PROVIDER_ID, "claude-opus-5");
    if (!model) throw new Error("Factory Claude model was not registered");
    let firstToken: string | undefined;
    const billingTokens: string[] = [];
    let modelRequests = 0;
    const fetchImpl: FetchImpl = async (input, init) => {
      if (String(input).endsWith("/api/billing/limits")) {
        const token = new Headers(init?.headers).get("authorization")?.replace(/^Bearer\s+/i, "");
        if (!token) throw new Error("Billing request omitted its selected bearer");
        firstToken ??= token;
        billingTokens.push(token);
        return billingResponse(allAccountsExhausted || token === firstToken);
      }
      modelRequests += 1;
      return anthropicSuccessResponse();
    };

    const stream = streamSimple(model, CONTEXT, {
      apiKey: registry.resolver(model, "factory-quota-session"),
      fetch: fetchImpl,
    });
    for await (const _event of stream) {
      // Drain all retry attempts.
    }

    return { result: await stream.result(), billingTokens, modelRequests };
  } finally {
    resetUsageCacheForTests();
    unregisterCustomApis(SOURCE_ID);
    unregisterOAuthProviders(SOURCE_ID);
    authStorage.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

describe("Factory quota preflight account rotation", () => {
  test("OMP retries a preflight-exhausted account with a healthy sibling", async () => {
    const scenario = await runRotationScenario(false);

    expect(scenario.result.stopReason).toBe("stop");
    expect(scenario.result.content).toContainEqual({ type: "text", text: "ok" });
    expect(new Set(scenario.billingTokens).size).toBe(2);
    expect(scenario.modelRequests).toBe(1);
  });

  test("OMP stops after trying each sibling once when every account is exhausted", async () => {
    const scenario = await runRotationScenario(true);

    expect(scenario.result.stopReason).toBe("error");
    expect(new Set(scenario.billingTokens).size).toBe(2);
    expect(scenario.billingTokens).toHaveLength(2);
    expect(scenario.modelRequests).toBe(0);
  });
});
