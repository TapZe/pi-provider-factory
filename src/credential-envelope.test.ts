import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "bun:test";
import type { OAuthCredentials } from "@oh-my-pi/pi-ai/oauth/types";
import { unregisterCustomApis } from "@oh-my-pi/pi-ai/api-registry";
import { unregisterOAuthProviders } from "@oh-my-pi/pi-ai/oauth";
import type { ExtensionAPI, ProviderConfig } from "@oh-my-pi/pi-coding-agent";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";

import { getApiKey } from "./auth";
import { PROVIDER_ID } from "./constants";
import { parseFactoryCredential } from "./credential";
import registerFactoryProvider from "./index";

const SAMPLE_CREDENTIAL: OAuthCredentials = {
  refresh: "test-refresh-token",
  access: "test-access-token-123",
  expires: Date.now() + 3_600_000,
  accountId: "org_factory_main",
  apiEndpoint: "https://api.factory.ai",
};

describe("Factory credential envelope contract", () => {
  test("emits the OMP-compatible token envelope without refresh or access fields", () => {
    const serialized = getApiKey(SAMPLE_CREDENTIAL);
    const parsed = JSON.parse(serialized);

    expect(parsed).toEqual({
      token: "test-access-token-123",
      orgId: "org_factory_main",
      apiEndpoint: "https://api.factory.ai",
    });
    expect(parsed.access).toBeUndefined();
    expect(parsed.refresh).toBeUndefined();
    expect(serialized).not.toContain("test-refresh-token");
  });

  test("maps a token envelope to the router's internal credential shape", () => {
    expect(
      parseFactoryCredential(
        JSON.stringify({
          token: "test-token-abc",
          orgId: "org_custom",
          apiEndpoint: "https://api.eu.factory.ai",
        }),
      ),
    ).toEqual({
      source: "oauth-envelope",
      access: "test-token-abc",
      orgId: "org_custom",
      apiEndpoint: "https://api.eu.factory.ai",
    });
  });

  test("rejects non-canonical JSON envelopes instead of treating them as raw keys", () => {
    expect(
      parseFactoryCredential(
        JSON.stringify({
          access: "legacy-access-token",
          orgId: "org_legacy",
          apiEndpoint: "https://api.factory.ai",
        }),
      ),
    ).toEqual({ source: "invalid", orgId: null, apiEndpoint: null });
    expect(parseFactoryCredential(JSON.stringify({ arbitrary: "value" }))).toEqual({
      source: "invalid",
      orgId: null,
      apiEndpoint: null,
    });
  });

  test("preserves raw API keys and handles missing values", () => {
    expect(parseFactoryCredential("fk-live-direct-api-key")).toEqual({
      source: "raw",
      access: "fk-live-direct-api-key",
      orgId: null,
      apiEndpoint: null,
    });
    expect(parseFactoryCredential(undefined)).toEqual({ source: "missing", orgId: null, apiEndpoint: null });
    expect(parseFactoryCredential(" ")).toEqual({ source: "missing", orgId: null, apiEndpoint: null });
  });

  test("round-trips the selected token, organization, and endpoint atomically", () => {
    expect(parseFactoryCredential(getApiKey(SAMPLE_CREDENTIAL))).toEqual({
      source: "oauth-envelope",
      access: "test-access-token-123",
      orgId: "org_factory_main",
      apiEndpoint: "https://api.factory.ai",
    });
  });
});

describe("Factory structured-key account attribution", () => {
  test("installed OMP public APIs identify the failed envelope and select its sibling", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-auth-rotation-test-"));
    const authStorage = await AuthStorage.create(path.join(dir, "auth.db"));

    try {
      const registry = new ModelRegistry(authStorage, path.join(dir, "models.yml"));
      const mockPi = {
        registerProvider(name: string, config: ProviderConfig) {
          registry.registerProvider(name, config, "test-factory-source");
        },
        on() {},
      } as unknown as ExtensionAPI;
      registerFactoryProvider(mockPi);

      await authStorage.set(PROVIDER_ID, [
        {
          type: "oauth",
          refresh: "refresh-token-account-1",
          access: "access-token-account-1",
          expires: Date.now() + 3_600_000,
          accountId: "org_1",
          apiEndpoint: "https://api.factory.ai",
        },
        {
          type: "oauth",
          refresh: "refresh-token-account-2",
          access: "access-token-account-2",
          expires: Date.now() + 3_600_000,
          accountId: "org_2",
          apiEndpoint: "https://api.factory.ai",
        },
      ]);

      const sessionId = "test-rotation-session";
      const initialKey = await authStorage.getApiKey(PROVIDER_ID, sessionId);
      if (!initialKey) throw new Error("Factory account was not selected");
      const initial = parseFactoryCredential(initialKey);

      expect(await authStorage.invalidateCredentialMatching(PROVIDER_ID, initialKey, { sessionId })).toBe(true);

      const rotatedKey = await authStorage.getApiKey(PROVIDER_ID, sessionId);
      if (!rotatedKey) throw new Error("Factory sibling account was not selected");
      const rotated = parseFactoryCredential(rotatedKey);
      expect(rotated.access).not.toBe(initial.access);
      expect(rotated.orgId).not.toBe(initial.orgId);
    } finally {
      unregisterCustomApis("test-factory-source");
      unregisterOAuthProviders("test-factory-source");
      authStorage.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
