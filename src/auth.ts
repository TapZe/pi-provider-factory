import { setTimeout as delay } from "node:timers/promises";

import type { OAuthCredentials, OAuthLoginCallbacks } from "@oh-my-pi/pi-ai/oauth/types";

import {
  emailFromAccessToken,
  expiresFromAccessToken,
  firstOrganizationId,
  formatErrorDetails,
  identityFromWhoami,
  parseDeviceAuthorization,
  parseTokenResponse,
  readJsonResponse,
  TOKEN_EXPIRY_SKEW_MS,
  type DeviceAuthorization,
  type ParsedTokenResponse,
} from "./auth-parsing";
import { FACTORY_API, WORKOS_CLIENT_ID, WORKOS_DEVICE_AUTHORIZE, WORKOS_TOKEN } from "./constants";
import { organizationIdFromAccessToken } from "./credential";
import { isRecord, stringField } from "./object-fields";

type Fetcher = NonNullable<OAuthLoginCallbacks["fetch"]>;

const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const AUTH_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_TOKEN_LIFETIME_MS = 5 * 60 * 1000;

async function requestDeviceAuthorization(fetchImpl: Fetcher): Promise<DeviceAuthorization> {
  const response = await fetchImpl(WORKOS_DEVICE_AUTHORIZE, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: WORKOS_CLIENT_ID,
    }),
    signal: AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS),
  });
  const parsed = await readJsonResponse(response, "device authorization");

  return parseDeviceAuthorization(parsed);
}

async function resolveOrganizationId(accessToken: string, fetchImpl: Fetcher): Promise<string | undefined> {
  const response = await fetchImpl(`${FACTORY_API}/api/cli/org`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    return undefined;
  }

  const parsed = await readJsonResponse(response, "organization membership");

  return firstOrganizationId(parsed);
}

async function resolveWhoami(
  accessToken: string,
  fetchImpl: Fetcher,
  organizationId?: string,
): Promise<{ accountId?: string; region?: string; apiEndpoint?: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  if (organizationId) {
    headers["X-Factory-Org-Id"] = organizationId;
  }

  const response = await fetchImpl(`${FACTORY_API}/api/cli/whoami`, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    return {};
  }

  const parsed = await readJsonResponse(response, "whoami");

  return identityFromWhoami(parsed);
}

async function pollDeviceToken(
  authorization: DeviceAuthorization,
  callbacks: OAuthLoginCallbacks,
  fetchImpl: Fetcher,
): Promise<ParsedTokenResponse> {
  const timeoutSignal = AbortSignal.timeout(authorization.expiresInSeconds * 1000);
  const signal = callbacks.signal ? AbortSignal.any([callbacks.signal, timeoutSignal]) : timeoutSignal;
  let intervalSeconds = authorization.intervalSeconds;

  while (!signal.aborted) {
    callbacks.onProgress?.("Waiting for Factory browser login...");
    await delay(intervalSeconds * 1000, undefined, { signal });

    const response = await fetchImpl(WORKOS_TOKEN, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: DEVICE_CODE_GRANT,
        device_code: authorization.deviceCode,
        client_id: WORKOS_CLIENT_ID,
      }),
      signal,
    });
    const responseBody = await response.text();

    if (response.ok) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(responseBody);
      } catch (error) {
        throw new Error(`Factory OAuth device token returned invalid JSON: ${formatErrorDetails(error)}`);
      }

      return parseTokenResponse(parsed, "device token");
    }

    let errorCode = "unknown";
    try {
      const parsed: unknown = JSON.parse(responseBody);

      if (isRecord(parsed)) {
        errorCode = stringField(parsed, "error") ?? errorCode;
      }
    } catch {
      throw new Error(`Factory OAuth device token failed. status=${response.status}; body=${responseBody}`);
    }

    switch (errorCode) {
      case "authorization_pending":
        break;
      case "slow_down":
        intervalSeconds += 1;
        callbacks.onProgress?.(`Factory asked us to slow polling to ${intervalSeconds}s`);
        break;
      case "access_denied":
      case "expired_token":
        throw new Error("Factory OAuth authorization failed or expired");
      default:
        throw new Error(`Factory OAuth device token failed with ${errorCode}`);
    }
  }

  throw new Error(`Factory OAuth device login cancelled: ${signal.reason}`);
}

async function postRefreshToken(
  refreshToken: string,
  fetchImpl: Fetcher,
  fallbackRefreshToken: string,
  organizationId?: string,
): Promise<ParsedTokenResponse> {
  const response = await fetchImpl(WORKOS_TOKEN, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: WORKOS_CLIENT_ID,
      ...(organizationId ? { organization_id: organizationId } : {}),
    }),
    signal: AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS),
  });
  const parsed = await readJsonResponse(response, "refresh token");

  return parseTokenResponse(parsed, "refresh token", fallbackRefreshToken);
}

function toCredentials(parsed: ParsedTokenResponse, prior?: OAuthCredentials): OAuthCredentials {
  const accountId = organizationIdFromAccessToken(parsed.accessToken);
  const email = parsed.email ?? emailFromAccessToken(parsed.accessToken) ?? prior?.email;
  const expires = parsed.expiresInSeconds
    ? Date.now() + parsed.expiresInSeconds * 1000 - TOKEN_EXPIRY_SKEW_MS
    : expiresFromAccessToken(parsed.accessToken) ?? Date.now() + DEFAULT_TOKEN_LIFETIME_MS;

  return {
    refresh: parsed.refreshToken,
    access: parsed.accessToken,
    expires,
    accountId,
    email,
    apiEndpoint: parsed.apiEndpoint ?? prior?.apiEndpoint,
    projectId: prior?.projectId,
  };
}

function requireOrgScopedCredential(credentials: OAuthCredentials, requestedOrganizationId: string): void {
  const orgId = organizationIdFromAccessToken(credentials.access);

  if (!orgId) {
    throw new Error(
      `Factory OAuth did not return an organization-scoped access token for ${requestedOrganizationId}; LLM calls would 403`,
    );
  }
}

async function loginWithBrowser(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const fetchImpl = callbacks.fetch ?? fetch;

  try {
    const authorization = await requestDeviceAuthorization(fetchImpl);
    callbacks.onAuth({
      url: authorization.verificationUriComplete,
      instructions: `Complete Factory login in your browser. If prompted, enter code ${authorization.userCode}.`,
    });
    callbacks.onProgress?.(`Factory device login code: ${authorization.userCode}`);

    const parsed = await pollDeviceToken(authorization, callbacks, fetchImpl);
    const credentials = toCredentials(parsed);
    const initialFactoryOrgId = organizationIdFromAccessToken(credentials.access);

    if (initialFactoryOrgId) {
      const identity = await resolveWhoami(credentials.access, fetchImpl, initialFactoryOrgId);

      return {
        ...credentials,
        accountId: identity.accountId ?? initialFactoryOrgId,
        apiEndpoint: identity.apiEndpoint ?? credentials.apiEndpoint,
      };
    }

    const workosOrganizationId = await resolveOrganizationId(credentials.access, fetchImpl);

    if (!workosOrganizationId) {
      throw new Error("Factory OAuth login did not expose an organization id; LLM calls would 403");
    }

    const organizationParsed = await postRefreshToken(
      credentials.refresh,
      fetchImpl,
      credentials.refresh,
      workosOrganizationId,
    );

    const credentialsWithOrg = {
      ...toCredentials(organizationParsed, credentials),
      projectId: workosOrganizationId,
    };
    requireOrgScopedCredential(credentialsWithOrg, workosOrganizationId);
    const identity = await resolveWhoami(credentialsWithOrg.access, fetchImpl, credentialsWithOrg.accountId);

    return {
      ...credentialsWithOrg,
      accountId: identity.accountId ?? credentialsWithOrg.accountId,
      apiEndpoint: identity.apiEndpoint ?? credentialsWithOrg.apiEndpoint,
    };
  } catch (error) {
    throw new Error(`Factory OAuth device login failed: ${formatErrorDetails(error)}`);
  }
}

export async function login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  return loginWithBrowser(callbacks);
}

export async function refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
  try {
    let workosOrganizationId = credentials.projectId;
    let parsed = await postRefreshToken(credentials.refresh, fetch, credentials.refresh, workosOrganizationId);
    let refreshed = {
      ...toCredentials(parsed, credentials),
      projectId: workosOrganizationId ?? credentials.projectId,
    };

    if (!organizationIdFromAccessToken(refreshed.access)) {
      workosOrganizationId = workosOrganizationId ?? (await resolveOrganizationId(refreshed.access, fetch));

      if (!workosOrganizationId) {
        throw new Error("Factory OAuth refresh did not expose an organization id; run `/logout factory` and `/login factory`");
      }

      parsed = await postRefreshToken(refreshed.refresh, fetch, refreshed.refresh, workosOrganizationId);
      refreshed = {
        ...toCredentials(parsed, { ...credentials, ...refreshed, projectId: workosOrganizationId }),
        projectId: workosOrganizationId,
      };
      requireOrgScopedCredential(refreshed, workosOrganizationId);
    }

    const identity = await resolveWhoami(refreshed.access, fetch, refreshed.accountId);

    return {
      ...refreshed,
      accountId: identity.accountId ?? refreshed.accountId,
      apiEndpoint: identity.apiEndpoint ?? refreshed.apiEndpoint,
    };
  } catch (error) {
    throw new Error(`Factory OAuth token refresh failed: ${formatErrorDetails(error)}`);
  }
}

export function getApiKey(credentials: OAuthCredentials): string {
  return JSON.stringify({
    access: credentials.access,
    orgId: credentials.accountId ?? null,
    apiEndpoint: credentials.apiEndpoint ?? null,
  });
}
