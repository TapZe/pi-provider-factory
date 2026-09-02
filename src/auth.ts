import { setTimeout as delay } from "node:timers/promises";

import type { OAuthCredentials, OAuthLoginCallbacks } from "@oh-my-pi/pi-ai/oauth/types";

import {
  emailFromAccessToken,
  expiresFromAccessToken,
  formatErrorDetails,
  identityFromWhoami,
  oauthErrorCodeFromResponse,
  parseDeviceAuthorization,
  parseTokenResponse,
  parseUniqueOrganizationIds,
  readJsonResponse,
  readJsonResponseBody,
  TOKEN_EXPIRY_SKEW_MS,
  type DeviceAuthorization,
  type ParsedTokenResponse,
} from "./auth-parsing";
import { FACTORY_API, WORKOS_CLIENT_ID, WORKOS_DEVICE_AUTHORIZE, WORKOS_TOKEN } from "./constants";
import { organizationIdFromAccessToken } from "./credential";

type Fetcher = NonNullable<OAuthLoginCallbacks["fetch"]>;

const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const AUTH_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_TOKEN_LIFETIME_MS = 5 * 60 * 1000;

function combineSignalWithTimeout(callerSignal?: AbortSignal, timeoutMs = AUTH_REQUEST_TIMEOUT_MS): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
}

async function requestDeviceAuthorization(fetchImpl: Fetcher, signal?: AbortSignal): Promise<DeviceAuthorization> {
  const response = await fetchImpl(WORKOS_DEVICE_AUTHORIZE, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: WORKOS_CLIENT_ID,
    }),
    signal: combineSignalWithTimeout(signal),
  });
  const parsed = await readJsonResponse(response, "device authorization");

  return parseDeviceAuthorization(parsed);
}

async function resolveOrganizationIds(accessToken: string, fetchImpl: Fetcher, signal?: AbortSignal): Promise<string[]> {
  const response = await fetchImpl(`${FACTORY_API}/api/cli/org`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    signal: combineSignalWithTimeout(signal),
  });


  const parsed = await readJsonResponse(response, "organization membership");
  return parseUniqueOrganizationIds(parsed);
}

async function resolveWhoami(
  accessToken: string,
  fetchImpl: Fetcher,
  organizationId?: string,
  signal?: AbortSignal,
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
    signal: combineSignalWithTimeout(signal),
  });

  const parsed = await readJsonResponse(response, "whoami");
  return identityFromWhoami(parsed);
}

async function selectOrganizationId(
  organizations: string[],
  callbacks: OAuthLoginCallbacks,
): Promise<string> {
  if (organizations.length === 0) {
    throw new Error("Factory OAuth login did not expose an organization id; LLM calls would 403");
  }

  if (organizations.length === 1) {
    return organizations[0];
  }

  if (!callbacks.onPrompt) {
    throw new Error("Factory OAuth account has multiple organizations, but prompt callback is unavailable");
  }

  const promptMessage =
    "Select Factory organization:\n" +
    organizations.map((org, idx) => `  ${idx + 1}. ${org}`).join("\n") +
    "\nEnter number or organization ID: ";

  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const rawAnswer = await callbacks.onPrompt({
      message: promptMessage,
      placeholder: "1",
    });
    const answer = rawAnswer?.trim();

    if (answer) {
      const index = Number(answer);
      if (Number.isInteger(index) && index >= 1 && index <= organizations.length) {
        return organizations[index - 1];
      }

      if (organizations.includes(answer)) {
        return answer;
      }
    }

    if (attempt < MAX_ATTEMPTS) {
      callbacks.onProgress?.(
        `Invalid Factory organization selection. Choose between 1 and ${organizations.length} or enter an exact organization ID.`,
      );
    }
  }

  throw new Error(`Factory OAuth organization selection failed after ${MAX_ATTEMPTS} attempts`);
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
      signal: combineSignalWithTimeout(signal),
    });
    const parsed = await readJsonResponseBody(response, "device token");

    if (response.ok) {
      return parseTokenResponse(parsed, "device token");
    }

    const errorCode = oauthErrorCodeFromResponse(parsed) ?? "unknown";

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
  signal?: AbortSignal,
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
    signal: combineSignalWithTimeout(signal),
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

function requireOrgScopedCredential(credentials: OAuthCredentials, requestedOrganizationId: string): string {
  const orgId = organizationIdFromAccessToken(credentials.access);

  if (!orgId) {
    throw new Error("Factory OAuth did not return an organization-scoped access token; LLM calls would 403");
  }
  if (orgId !== requestedOrganizationId) {
    throw new Error("Factory OAuth returned a token for a different organization than the selected account");
  }
  return orgId;
}

function requireMatchingWhoamiOrganization(accountId: string | undefined, expectedOrganizationId: string): void {
  if (!accountId) {
    throw new Error("Factory whoami response did not include an organization ID");
  }
  if (accountId !== expectedOrganizationId) {
    throw new Error("Factory whoami returned a different organization than the selected account");
  }
}

async function loginWithBrowser(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const fetchImpl = callbacks.fetch ?? fetch;
  const callerSignal = callbacks.signal;

  try {
    const authorization = await requestDeviceAuthorization(fetchImpl, callerSignal);
    callbacks.onAuth({
      url: authorization.verificationUriComplete,
      instructions: `Complete Factory login in your browser. If prompted, enter code ${authorization.userCode}.`,
    });
    callbacks.onProgress?.(`Factory device login code: ${authorization.userCode}`);

    const parsed = await pollDeviceToken(authorization, callbacks, fetchImpl);
    const credentials = toCredentials(parsed);
    const initialFactoryOrgId = organizationIdFromAccessToken(credentials.access);

    if (initialFactoryOrgId) {
      const identity = await resolveWhoami(credentials.access, fetchImpl, initialFactoryOrgId, callerSignal);
      requireMatchingWhoamiOrganization(identity.accountId, initialFactoryOrgId);

      return {
        ...credentials,
        accountId: initialFactoryOrgId,
        apiEndpoint: identity.apiEndpoint ?? credentials.apiEndpoint,
        projectId: initialFactoryOrgId,
      };
    }

    const workosOrganizations = await resolveOrganizationIds(credentials.access, fetchImpl, callerSignal);
    const selectedOrganizationId = await selectOrganizationId(workosOrganizations, callbacks);

    const organizationParsed = await postRefreshToken(
      credentials.refresh,
      fetchImpl,
      credentials.refresh,
      selectedOrganizationId,
      callerSignal,
    );

    const credentialsWithOrg = {
      ...toCredentials(organizationParsed, credentials),
      projectId: selectedOrganizationId,
    };
    requireOrgScopedCredential(credentialsWithOrg, selectedOrganizationId);
    const identity = await resolveWhoami(
      credentialsWithOrg.access,
      fetchImpl,
      selectedOrganizationId,
      callerSignal,
    );
    requireMatchingWhoamiOrganization(identity.accountId, selectedOrganizationId);

    return {
      ...credentialsWithOrg,
      accountId: selectedOrganizationId,
      apiEndpoint: identity.apiEndpoint ?? credentialsWithOrg.apiEndpoint,
    };
  } catch (error) {
    throw new Error(`Factory OAuth device login failed: ${formatErrorDetails(error)}`);
  }
}

export async function login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  return loginWithBrowser(callbacks);
}

export async function refreshToken(
  credentials: OAuthCredentials,
  signal?: AbortSignal,
  fetchImpl: Fetcher = fetch,
): Promise<OAuthCredentials> {
  try {
    let workosOrganizationId = credentials.projectId;
    let parsed = await postRefreshToken(
      credentials.refresh,
      fetchImpl,
      credentials.refresh,
      workosOrganizationId,
      signal,
    );
    let refreshed = {
      ...toCredentials(parsed, credentials),
      projectId: workosOrganizationId ?? credentials.projectId,
    };

    let tokenOrganizationId = organizationIdFromAccessToken(refreshed.access);
    if (tokenOrganizationId && workosOrganizationId && tokenOrganizationId !== workosOrganizationId) {
      throw new Error("Factory OAuth refresh returned a token for a different organization than the stored account");
    }
    workosOrganizationId = workosOrganizationId ?? tokenOrganizationId;

    if (!tokenOrganizationId) {
      if (!workosOrganizationId) {
        const orgs = await resolveOrganizationIds(refreshed.access, fetchImpl, signal);
        if (orgs.length === 1) {
          workosOrganizationId = orgs[0];
        } else if (orgs.length > 1) {
          throw new Error(
            "Factory OAuth refresh encountered multiple organizations without a stored projectId; run `/logout factory` and `/login factory` to select an organization",
          );
        } else {
          throw new Error("Factory OAuth refresh did not expose an organization id; run `/logout factory` and `/login factory`");
        }
      }

      parsed = await postRefreshToken(
        refreshed.refresh,
        fetchImpl,
        refreshed.refresh,
        workosOrganizationId,
        signal,
      );
      refreshed = {
        ...toCredentials(parsed, { ...credentials, ...refreshed, projectId: workosOrganizationId }),
        projectId: workosOrganizationId,
      };
      tokenOrganizationId = requireOrgScopedCredential(refreshed, workosOrganizationId);
    }

    if (!tokenOrganizationId) {
      throw new Error("Factory OAuth refresh did not produce an organization-scoped token");
    }
    const identity = await resolveWhoami(refreshed.access, fetchImpl, tokenOrganizationId, signal);
    requireMatchingWhoamiOrganization(identity.accountId, tokenOrganizationId);

    return {
      ...refreshed,
      accountId: tokenOrganizationId,
      projectId: workosOrganizationId ?? tokenOrganizationId,
      apiEndpoint: identity.apiEndpoint ?? refreshed.apiEndpoint,
    };
  } catch (error) {
    throw new Error(`Factory OAuth token refresh failed: ${formatErrorDetails(error)}`);
  }
}

export function getApiKey(credentials: OAuthCredentials): string {
  return JSON.stringify({
    token: credentials.access,
    orgId: credentials.accountId ?? null,
    apiEndpoint: credentials.apiEndpoint ?? null,
  });
}
