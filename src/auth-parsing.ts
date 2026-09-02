import { factoryApiForRegion } from "./constants";
import { decodeJwtPayload } from "./credential";
import { firstStringField, isRecord, numberField, stringField } from "./object-fields";

export const TOKEN_EXPIRY_SKEW_MS = 60_000;

export interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresInSeconds: number;
  intervalSeconds: number;
}

export interface ParsedTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds?: number;
  email?: string;
  apiEndpoint?: string;
}

export interface FactoryIdentity {
  accountId?: string;
  region?: string;
  apiEndpoint?: string;
}

export function formatErrorDetails(error: unknown): string {
  if (!(error instanceof Error)) return String(error).slice(0, 500);

  const sanitizedMessage = error.message
    .replace(/(bearer\s+)[^\s,;]+/gi, "$1[redacted]")
    .replace(/((?:access|refresh)[_-]?token[\s=:"']+)[^\s,;}"']+/gi, "$1[redacted]")
    .slice(0, 500);
  const details = [`${error.name}: ${sanitizedMessage}`];
  const errorWithCode: Error & { code?: string; errno?: number | string } = error;
  if (errorWithCode.code) details.push(`code=${errorWithCode.code}`);
  if (typeof errorWithCode.errno !== "undefined") details.push(`errno=${String(errorWithCode.errno)}`);
  return details.join("; ");
}

export function emailFromAccessToken(accessToken: string): string | undefined {
  const payload = decodeJwtPayload(accessToken);
  return payload ? stringField(payload, "email") : undefined;
}

export function expiresFromAccessToken(accessToken: string): number | undefined {
  const payload = decodeJwtPayload(accessToken);
  if (!payload) {
    return undefined;
  }

  const expiresAtSeconds = numberField(payload, "exp");
  return expiresAtSeconds ? expiresAtSeconds * 1000 - TOKEN_EXPIRY_SKEW_MS : undefined;
}

export function parseDeviceAuthorization(value: unknown): DeviceAuthorization {
  if (!isRecord(value)) {
    throw new Error("Factory device authorization returned a non-object response");
  }

  const deviceCode = stringField(value, "device_code");
  const userCode = stringField(value, "user_code");
  const verificationUri = stringField(value, "verification_uri");
  const verificationUriComplete = stringField(value, "verification_uri_complete");
  const expiresInSeconds = numberField(value, "expires_in");
  const intervalSeconds = numberField(value, "interval");

  if (!deviceCode || !userCode || !verificationUri || !verificationUriComplete || !expiresInSeconds || !intervalSeconds) {
    throw new Error("Factory device authorization response is missing required fields");
  }

  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete,
    expiresInSeconds,
    intervalSeconds,
  };
}

export function parseTokenResponse(
  value: unknown,
  label: string,
  fallbackRefreshToken?: string,
): ParsedTokenResponse {
  if (!isRecord(value)) {
    throw new Error(`Factory OAuth ${label} returned a non-object response`);
  }

  const accessToken = stringField(value, "access_token");
  if (!accessToken) {
    throw new Error(`Factory OAuth ${label} response did not include access_token`);
  }

  const refreshToken = stringField(value, "refresh_token") ?? fallbackRefreshToken;
  if (!refreshToken) {
    throw new Error(`Factory OAuth ${label} response did not include refresh_token`);
  }

  const user = value.user;
  return {
    accessToken,
    refreshToken,
    expiresInSeconds: numberField(value, "expires_in"),
    email: isRecord(user) ? stringField(user, "email") : undefined,
  };
}

export function parseUniqueOrganizationIds(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.workosOrgIds)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const organizationId of value.workosOrgIds) {
    if (typeof organizationId === "string") {
      const trimmed = organizationId.trim();
      if (trimmed.length > 0 && !seen.has(trimmed)) {
        seen.add(trimmed);
        result.push(trimmed);
      }
    }
  }

  return result;
}

export function identityFromWhoami(value: unknown): FactoryIdentity {
  if (!isRecord(value)) {
    return {};
  }

  const accountId = firstStringField(value, ["orgId", "org_id", "organization_id", "organizationId"]);
  const region = stringField(value, "region");
  return {
    accountId,
    region,
    apiEndpoint: factoryApiForRegion(region),
  };
}

const MAX_OAUTH_RESPONSE_BYTES = 64 * 1024;
const SAFE_ERROR_CODE = /^[a-z0-9_.:-]{1,80}$/i;

async function readBoundedResponseText(response: Response, label: string): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let text = "";

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    receivedBytes += chunk.value.byteLength;
    if (receivedBytes > MAX_OAUTH_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(`Factory OAuth ${label} response exceeded ${MAX_OAUTH_RESPONSE_BYTES} bytes`);
    }
    text += decoder.decode(chunk.value, { stream: true });
  }

  return text + decoder.decode();
}

export function oauthErrorCodeFromResponse(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const code = firstStringField(value, ["error", "code", "type"]);
  return code && SAFE_ERROR_CODE.test(code) ? code : undefined;
}

export async function readJsonResponseBody(response: Response, label: string): Promise<unknown> {
  const responseBody = await readBoundedResponseText(response, label);
  try {
    return JSON.parse(responseBody);
  } catch (error) {
    if (!response.ok) {
      throw new Error(`Factory OAuth ${label} request failed. status=${response.status}`);
    }
    throw new Error(`Factory OAuth ${label} returned invalid JSON: ${formatErrorDetails(error)}`);
  }
}

export async function readJsonResponse(response: Response, label: string): Promise<unknown> {
  const parsed = await readJsonResponseBody(response, label);
  if (!response.ok) {
    const code = oauthErrorCodeFromResponse(parsed);
    throw new Error(
      `Factory OAuth ${label} request failed. status=${response.status}${code ? `; code=${code}` : ""}`,
    );
  }
  return parsed;
}
