import type { Api, Model } from "@oh-my-pi/pi-catalog/types";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { createProviderErrorMessage } from "@oh-my-pi/pi-ai/providers/error-message";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";

import { FACTORY_API_BASE_OVERRIDDEN, FACTORY_ORG_ID } from "./constants";
import type { ParsedFactoryCredential } from "./credential";
import { isRecord } from "./object-fields";

export type FactoryDiagnosticTargetApi = "anthropic-messages" | "openai-responses" | "openai-completions";

interface FactoryDiagnosticArgs {
  model: Model<Api>;
  targetApi: FactoryDiagnosticTargetApi;
  credential: ParsedFactoryCredential;
  apiEndpoint: string;
}

export function createFactoryErrorStream(model: Model<Api>, message: string): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const error: AssistantMessage = { ...createProviderErrorMessage(model, new Error(message)), errorMessage: message };
  stream.push({ type: "error", reason: "error", error });
  return stream;
}

function looksLikeFactoryForbidden(status: number | undefined, message: string | undefined): boolean {
  if (status === 403) return true;
  return Boolean(message?.startsWith("403") && /forbidden/i.test(message));
}

function redactIdentifier(value: string | null | undefined): string {
  if (!value) return "missing";
  if (value.length <= 4) return "****";
  return `${value.slice(0, 3)}…${value.slice(-2)}`;
}

function safeEndpointLabel(value: string | null | undefined): string {
  if (!value) return "default";
  try {
    return new URL(value).origin;
  } catch {
    return "invalid endpoint";
  }
}

function sanitizeUpstreamError(message: string | undefined, credential: ParsedFactoryCredential): string {
  let sanitized = message ?? "403 Forbidden";
  for (const sensitiveValue of [credential.access, credential.orgId]) {
    if (sensitiveValue) sanitized = sanitized.replaceAll(sensitiveValue, "[redacted]");
  }
  return sanitized
    .replace(/("?(?:access|refresh)?token"?\s*[:=]\s*")[^"]+/gi, "$1[redacted]")
    .replace(/(bearer\s+)[^\s,;]+/gi, "$1[redacted]")
    .slice(0, 1_000);
}

function statusFromUnknownError(error: unknown): number | undefined {
  return isRecord(error) && typeof error.status === "number" ? error.status : undefined;
}

function factoryForbiddenDiagnostic(args: FactoryDiagnosticArgs & { originalMessage: string | undefined }): string {
  const orgId = args.credential.source === "raw" ? (args.credential.orgId ?? FACTORY_ORG_ID) : args.credential.orgId;
  const credentialEndpoint = safeEndpointLabel(args.credential.apiEndpoint);
  const requestEndpoint = safeEndpointLabel(args.apiEndpoint);
  const baseOverride = FACTORY_API_BASE_OVERRIDDEN ? "yes" : "no";
  const orgOverride = args.credential.source === "raw" && !args.credential.orgId && FACTORY_ORG_ID ? "yes" : "no";
  const upstream = sanitizeUpstreamError(args.originalMessage, args.credential);

  return (
    `factory: Factory gateway returned 403 Forbidden for ${args.model.provider}/${args.model.id} ` +
    `via ${args.targetApi} at ${requestEndpoint}. ` +
    "The credential resolved, but Factory refused the LLM request. " +
    "Check Factory org/model entitlement for this account, unset FACTORY_API_KEY/FACTORY_API_BASE if they are " +
    "overriding OAuth, then run `/logout factory` and `/login factory` if the org changed. " +
    `Request context: source=${args.credential.source}; X-Factory-Org-Id=${redactIdentifier(orgId)}; ` +
    `credentialApiEndpoint=${credentialEndpoint}; FACTORY_API_BASE override=${baseOverride}; ` +
    `FACTORY_ORG_ID fallback=${orgOverride}. Upstream response: ${upstream}`
  );
}

function enrichFactoryForbiddenError(message: AssistantMessage, args: FactoryDiagnosticArgs): AssistantMessage {
  if (!looksLikeFactoryForbidden(message.errorStatus, message.errorMessage)) return message;
  return {
    ...message,
    content: [],
    errorMessage: factoryForbiddenDiagnostic({ ...args, originalMessage: message.errorMessage }),
  };
}

function wrapThrownFactoryForbidden(error: unknown, args: FactoryDiagnosticArgs): unknown {
  const status = statusFromUnknownError(error);
  if (!(error instanceof Error) || !looksLikeFactoryForbidden(status, error.message)) return error;
  return Object.assign(new Error(factoryForbiddenDiagnostic({ ...args, originalMessage: error.message })), {
    status: status ?? 403,
  });
}

export function routeWithFactoryDiagnostics(
  inner: AssistantMessageEventStream,
  args: FactoryDiagnosticArgs,
): AssistantMessageEventStream {
  const outer = new AssistantMessageEventStream();
  void (async () => {
    try {
      for await (const event of inner) {
        outer.push(event.type === "error" ? { ...event, error: enrichFactoryForbiddenError(event.error, args) } : event);
        if (outer.done) return;
      }
      if (!outer.done) outer.end(await inner.result());
    } catch (error) {
      outer.fail(wrapThrownFactoryForbidden(error, args));
    }
  })();
  return outer;
}
