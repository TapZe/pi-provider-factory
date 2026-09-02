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
  if (!(error instanceof Error)) {
    return String(error);
  }

  const details = [`${error.name}: ${error.message}`];
  const errorWithCode: Error & { code?: string; errno?: number | string } = error;

  if (errorWithCode.code) {
    details.push(`code=${errorWithCode.code}`);
  }

  if (typeof errorWithCode.errno !== "undefined") {
    details.push(`errno=${String(errorWithCode.errno)}`);
  }

  if (typeof error.cause !== "undefined") {
    details.push(`cause=${formatErrorDetails(error.cause)}`);
  }

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

export function firstOrganizationId(value: unknown): string | undefined {
  if (!isRecord(value) || !Array.isArray(value.workosOrgIds)) {
    return undefined;
  }

  for (const organizationId of value.workosOrgIds) {
    if (typeof organizationId === "string" && organizationId.length > 0) {
      return organizationId;
    }
  }

  return undefined;
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

export async function readJsonResponse(response: Response, label: string): Promise<unknown> {
  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(`Factory OAuth ${label} request failed. status=${response.status}; body=${responseBody}`);
  }

  try {
    return JSON.parse(responseBody);
  } catch (error) {
    throw new Error(`Factory OAuth ${label} returned invalid JSON: ${formatErrorDetails(error)}`);
  }
}
