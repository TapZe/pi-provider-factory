import { wrapInbandToolStream } from "@oh-my-pi/pi-ai/dialect";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import type { AssistantMessage, Context, ToolCall } from "@oh-my-pi/pi-ai";

function embeddedToolCallFromName(name: string): { name: string; arguments: Record<string, unknown> } | null {
  if (!name.trimStart().startsWith("{")) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(name);
    if (!isObjectRecord(parsed) || typeof parsed.name !== "string" || parsed.name.length === 0) {
      return null;
    }

    let args: unknown = parsed.arguments ?? {};
    if (typeof args === "string") {
      args = JSON.parse(args);
    }
    if (!isObjectRecord(args)) {
      return null;
    }

    return { name: parsed.name, arguments: args };
  } catch {
    return null;
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type FactoryStreamMarkupHealingPattern = "kimi" | "dsml" | "thinking";

export function factoryStreamMarkupHealingPattern(modelId: string): FactoryStreamMarkupHealingPattern | undefined {
  if (modelId.startsWith("deepseek-")) return "dsml";
  if (modelId.startsWith("kimi-")) return "kimi";
  if (modelId.startsWith("glm-")) return "thinking";
  return undefined;
}

function normalizeFactoryToolCall(toolCall: ToolCall): void {
  const embedded = embeddedToolCallFromName(toolCall.name);
  if (!embedded) {
    return;
  }

  toolCall.name = embedded.name;
  toolCall.arguments = embedded.arguments;
}

function normalizeFactoryToolCalls(message: AssistantMessage): void {
  for (const content of message.content) {
    if (content.type === "toolCall") {
      normalizeFactoryToolCall(content);
    }
  }
}

function normalizeFactoryToolCallEvents(inner: AssistantMessageEventStream): AssistantMessageEventStream {
  const outer = new AssistantMessageEventStream();

  void (async () => {
    try {
      for await (const event of inner) {
        if (event.type === "done") {
          normalizeFactoryToolCalls(event.message);
        } else if (event.type === "error") {
          normalizeFactoryToolCalls(event.error);
        } else {
          normalizeFactoryToolCalls(event.partial);
          if (event.type === "toolcall_end") {
            normalizeFactoryToolCall(event.toolCall);
          }
        }

        outer.push(event);
        if (outer.done) {
          return;
        }
      }

      if (!outer.done) {
        const result = await inner.result();
        normalizeFactoryToolCalls(result);
        outer.end(result);
      }
    } catch (error) {
      outer.fail(error);
    }
  })();

  return outer;
}

/**
 * Droid repairs generic Hermes markup after model-specific parsing. Factory can
 * also return the same JSON body as an already-structured function name, so
 * normalize both channels before OMP dispatches the call.
 */
export function normalizeFactoryToolCallStream(
  inner: AssistantMessageEventStream,
  tools: Context["tools"],
  healTextMarkup: boolean,
): AssistantMessageEventStream {
  const healed = healTextMarkup && tools?.length
    ? wrapInbandToolStream(inner, tools, "hermes", undefined, false)
    : inner;

  return normalizeFactoryToolCallEvents(healed);
}
