import { firstStringField, isRecord, stringField } from "./object-fields";

const ORGANIZATION_ID_CLAIMS = [
  "external_org_id",
  "org_id",
  "organization_id",
  "organizationId",
  "orgId",
] as const;

export interface ParsedFactoryCredential {
  access?: string;
  orgId: string | null;
  apiEndpoint: string | null;
}

function decodeBase64UrlBinary(segment: string): string {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const paddedBase64 = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return atob(paddedBase64);
}

function decodeBase64UrlUtf8(segment: string): string {
  const binary = decodeBase64UrlBinary(segment);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function parseJwtPayload(
  accessToken: string,
  decodeSegment: (segment: string) => string,
): Record<string, unknown> | null {
  const [, payloadSegment] = accessToken.split(".");
  if (!payloadSegment) {
    return null;
  }

  try {
    const payload: unknown = JSON.parse(decodeSegment(payloadSegment));
    return isRecord(payload) ? payload : null;
  } catch {
    return null;
  }
}

export function decodeJwtPayload(accessToken: string): Record<string, unknown> | null {
  return parseJwtPayload(accessToken, decodeBase64UrlUtf8);
}

export function organizationIdFromAccessToken(accessToken: string): string | undefined {
  const payload = decodeJwtPayload(accessToken);
  return payload ? firstStringField(payload, ORGANIZATION_ID_CLAIMS) : undefined;
}

function organizationIdFromCredentialToken(accessToken: string): string | undefined {
  const payload = parseJwtPayload(accessToken, decodeBase64UrlBinary);
  return payload ? firstStringField(payload, ORGANIZATION_ID_CLAIMS) : undefined;
}

function rawFactoryCredential(access: string): ParsedFactoryCredential {
  return {
    access,
    orgId: organizationIdFromCredentialToken(access) ?? null,
    apiEndpoint: null,
  };
}

export function parseFactoryCredential(raw: string | undefined): ParsedFactoryCredential {
  if (!raw) {
    return { orgId: null, apiEndpoint: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }

  if (!isRecord(parsed)) {
    return rawFactoryCredential(raw);
  }

  const access = stringField(parsed, "access");
  if (!access) {
    return rawFactoryCredential(raw);
  }

  return {
    access,
    orgId: stringField(parsed, "orgId") ?? organizationIdFromCredentialToken(access) ?? null,
    apiEndpoint: stringField(parsed, "apiEndpoint") ?? null,
  };
}
