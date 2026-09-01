import { describe, expect, it } from "bun:test";
import type { AssistantMessage, Context, ToolCall } from "@oh-my-pi/pi-ai";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import { StreamMarkupHealing } from "@oh-my-pi/pi-ai/utils/stream-markup-healing";
import { ANTHROPIC_BETAS, FACTORY_CLIENT_VERSION, FACTORY_DROID_SYSTEM_PROMPT } from "./constants";
import { factoryStreamSimple, prepareContextForFactory } from "./router";
import { FACTORY_MODELS } from "./catalog";
import {
  factoryStreamMarkupHealingPattern,
  normalizeFactoryToolCallStream,
} from "./tool-call-normalization";

const READ_TOOL: NonNullable<Context["tools"]>[number] = {
  name: "read",
  description: "Read a file",
  parameters: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
};

function assistantMessage(model: string, content: AssistantMessage["content"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "factory",
    model,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 0,
  };
}

async function normalizeLeakedText(model: string, markup: string): Promise<AssistantMessage> {
  const inner = new AssistantMessageEventStream();
  const normalized = normalizeFactoryToolCallStream(inner, [READ_TOOL], true);
  const empty = assistantMessage(model, []);
  const complete = assistantMessage(model, [{ type: "text", text: markup }]);
  const splitAt = Math.floor(markup.length / 2);

  inner.push({ type: "start", partial: empty });
  inner.push({ type: "text_start", contentIndex: 0, partial: complete });
  inner.push({ type: "text_delta", contentIndex: 0, delta: markup.slice(0, splitAt), partial: complete });
  inner.push({ type: "text_delta", contentIndex: 0, delta: markup.slice(splitAt), partial: complete });
  inner.push({ type: "text_end", contentIndex: 0, content: markup, partial: complete });
  inner.push({ type: "done", reason: "stop", message: complete });

  return normalized.result();
}

function testFactoryModel(modelId: string): Parameters<typeof factoryStreamSimple>[0] {
  const model = FACTORY_MODELS.find((candidate) => candidate.id === modelId);
  if (!model) {
    throw new Error(`Missing Factory model fixture: ${modelId}`);
  }

  return model as unknown as Parameters<typeof factoryStreamSimple>[0];
}

async function captureFactoryCoreRequest(modelId: string): Promise<Record<string, unknown>> {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;

  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    const [input, init] = args;
    const request = input instanceof Request ? input : new Request(typeof input === "string" ? input : input.toString(), init);
    requestBody = (await request.json()) as Record<string, unknown>;

    return new Response(
      [
        'data: {"id":"chatcmpl_factory","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl_factory","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ].join(""),
      { headers: { "content-type": "text/event-stream" } },
    );
  }) as typeof fetch;

  try {
    const toolCall: ToolCall = {
      type: "toolCall",
      id: "call_factory_1",
      name: "read",
      arguments: { path: "src/index.ts" },
    };
    const stream = factoryStreamSimple(
      testFactoryModel(modelId),
      {
        systemPrompt: [],
        messages: [
          assistantMessage(modelId, [toolCall]),
          {
            role: "toolResult",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            content: [{ type: "text", text: "source" }],
            isError: false,
            timestamp: Date.now(),
          },
        ],
        tools: [READ_TOOL],
      },
      {
        apiKey: JSON.stringify({
          access: "test-factory-oauth-token",
          orgId: "test-org",
          apiEndpoint: "http://factory.test",
        }),
        sessionId: "test-session",
      },
    );

    await stream.result();
  } finally {
    globalThis.fetch = originalFetch;
  }

  if (!requestBody) {
    throw new Error("Factory request was not captured");
  }

  return requestBody;
}

describe("Factory Router & Tool Execution Configuration", () => {
  it("uses the latest Droid CLI client version", () => {
    expect(FACTORY_CLIENT_VERSION).toBe("0.208.2");
  });

  it("includes required Anthropic betas for tool streaming and thinking", () => {
    expect(ANTHROPIC_BETAS).toContain("fine-grained-tool-streaming-2025-05-14");
    expect(ANTHROPIC_BETAS).toContain("interleaved-thinking-2025-05-14");
  });

  it("contains the Droid system prompt prefix enforcing tool usage", () => {
    expect(FACTORY_DROID_SYSTEM_PROMPT).toStartWith(
      "You are Droid, an AI software engineering agent built by Factory.",
    );
    expect(FACTORY_DROID_SYSTEM_PROMPT).toContain("EXECUTION DIRECTIVES");
  });

  it("prepends Droid system prompt prefix while preserving tools and messages", () => {
    const context = {
      systemPrompt: ["You are Oh My Pi coding assistant."],
      messages: [],
      tools: [
        {
          name: "read_file",
          description: "Read a file",
          parameters: { type: "object", properties: { path: { type: "string" } } },
        },
        {
          name: "bash",
          description: "Run bash command",
          parameters: { type: "object", properties: { command: { type: "string" } } },
        },
      ],
    };

    const prepared = prepareContextForFactory(context);

    expect(prepared.systemPrompt?.[0]).toBe(FACTORY_DROID_SYSTEM_PROMPT);
    expect(prepared.systemPrompt?.[1]).toBe("You are Oh My Pi coding assistant.");
    expect(prepared.tools?.[0].name).toBe("read_file");
    expect(prepared.tools?.[1].name).toBe("bash");
  });

  it("preserves assistant messages and tool results verbatim", () => {
    const context = {
      messages: [
        {
          role: "assistant" as const,
          content: [
            {
              type: "toolCall" as const,
              id: "tc_1",
              name: "read_file",
              arguments: { path: "src/index.ts" },
            },
          ],
        },
        {
          role: "toolResult" as const,
          toolCallId: "tc_1",
          toolName: "read_file",
          content: [{ type: "text" as const, text: "file content" }],
          isError: false,
        },
      ],
    };

    const prepared = prepareContextForFactory(context as any);

    const assistantMsg = prepared.messages?.[0];
    expect((assistantMsg?.content as any[])[0].name).toBe("read_file");

    const toolResultMsg = prepared.messages?.[1] as any;
    expect(toolResultMsg?.toolName).toBe("read_file");
  });

  it("correctly maps model families and upstream providers", () => {
    const { familyOf, upstreamProviderFor } = require("./catalog");
    expect(familyOf("claude-opus-5")).toBe("anthropic");
    expect(upstreamProviderFor("claude-opus-5")).toBe("anthropic");
    expect(familyOf("minimax-m3")).toBe("anthropic");
    expect(upstreamProviderFor("minimax-m3")).toBe("fireworks");
    expect(familyOf("gpt-5.6-sol")).toBe("openai-responses");
    expect(upstreamProviderFor("gpt-5.6-sol")).toBe("openai");
    expect(familyOf("kimi-k3")).toBe("openai-completions");
    expect(upstreamProviderFor("kimi-k3")).toBe("fireworks");
  });
  it("preserves Factory Core reasoning and tool-call history", async () => {
    const expectedReasoningContent = new Map([
      ["glm-5.3", "."],
      ["kimi-k3", "."],
      ["deepseek-v4-pro", ""],
    ]);

    for (const [modelId, reasoningContent] of expectedReasoningContent) {
      const request = await captureFactoryCoreRequest(modelId);
      const messages = request.messages as Array<Record<string, unknown>>;
      const assistantToolCall = messages.find((message) => Array.isArray(message.tool_calls));

      expect(request.reasoning_history).toBe("preserved");
      expect(request.tool_choice).toBe("auto");
      expect(request.tools).toHaveLength(1);
      expect(assistantToolCall?.reasoning_content).toBe(reasoningContent);
      const [wireToolCall] = (assistantToolCall?.tool_calls ?? []) as Array<{
        id: string;
        function: { name: string; arguments: string };
      }>;
      const toolResult = messages.find(
        (message) => message.role === "tool" && message.tool_call_id === "call_factory_1",
      );

      expect(wireToolCall?.id).toBe("call_factory_1");
      expect(wireToolCall?.function.name).toBe("read");
      expect(JSON.parse(wireToolCall?.function.arguments ?? "{}")).toEqual({
        path: "src/index.ts",
      });
      expect(toolResult).toMatchObject({
        role: "tool",
        tool_call_id: "call_factory_1",
        content: "source",
      });
      expect(toolResult?.name).toBe(modelId.startsWith("kimi-") ? "read" : undefined);
    }
  });

});

describe("Factory Droid tool-call normalization", () => {

  it("selects Droid-compatible markup healing per open model family", () => {
    expect(factoryStreamMarkupHealingPattern("glm-5")).toBe("thinking");
    expect(factoryStreamMarkupHealingPattern("kimi-k3")).toBe("kimi");
    expect(factoryStreamMarkupHealingPattern("deepseek-v4-flash")).toBe("dsml");
    expect(factoryStreamMarkupHealingPattern("claude-opus-5")).toBeUndefined();
  });

  it("repairs GLM JSON markup instead of dispatching the JSON as the tool name", async () => {
    const markup = [
      "<tool_",
      'call>{"name":"read","arguments":{"path":"src/index.ts"}}</tool_',
      "call>",
    ].join("");
    const result = await normalizeLeakedText("glm-5", markup);
    const call = result.content.find((content): content is ToolCall => content.type === "toolCall");

    expect(result.stopReason).toBe("toolUse");
    expect(call?.name).toBe("read");
    expect(call?.arguments).toEqual({ path: "src/index.ts" });
    expect(result.content.some((content) => content.type === "text" && content.text.includes("<tool_call>"))).toBe(false);
  });

  it("repairs JSON embedded in an already-structured Factory tool name", async () => {
    const inner = new AssistantMessageEventStream();
    const normalized = normalizeFactoryToolCallStream(inner, [READ_TOOL], false);
    const call: ToolCall = {
      type: "toolCall",
      id: "call_factory_1",
      name: '{"name":"read","arguments":"{\\"path\\":\\"src/router.ts\\"}"}',
      arguments: {},
    };
    const message = assistantMessage("glm-5", [call]);

    inner.push({ type: "start", partial: message });
    inner.push({ type: "toolcall_start", contentIndex: 0, partial: message });
    inner.push({ type: "toolcall_end", contentIndex: 0, toolCall: call, partial: message });
    inner.push({ type: "done", reason: "toolUse", message: { ...message, stopReason: "toolUse" } });

    const result = await normalized.result();
    const repaired = result.content[0] as ToolCall;
    expect(repaired.name).toBe("read");
    expect(repaired.arguments).toEqual({ path: "src/router.ts" });
  });

  it("heals Kimi section and DeepSeek DSML calls", () => {
    const kimi = new StreamMarkupHealing({ pattern: "kimi" });
    const kimiMarkup = [
      "<|tool_calls_section_begin|><|tool_call_begin|>functions.read:0",
      '<|tool_call_argument_begin|>{"path":"a.ts"}<|tool_call_end|>',
      "<|tool_calls_section_end|>",
    ].join("");
    const kimiCall = kimi.feedEvents(kimiMarkup).find((event) => event.type === "toolCall");

    const deepseek = new StreamMarkupHealing({ pattern: "dsml" });
    const deepseekMarkup = [
      '<|DSML|tool_calls><|DSML|invoke name="read">',
      '<|DSML|parameter name="path">b.ts</|DSML|parameter>',
      "</|DSML|invoke></|DSML|tool_calls>",
    ].join("");
    const deepseekCall = deepseek.feedEvents(deepseekMarkup).find((event) => event.type === "toolCall");

    expect(kimiCall?.type === "toolCall" ? kimiCall.call.name : undefined).toBe("read");
    expect(kimiCall?.type === "toolCall" ? JSON.parse(kimiCall.call.arguments) : undefined).toEqual({ path: "a.ts" });
    expect(deepseekCall?.type === "toolCall" ? deepseekCall.call.name : undefined).toBe("read");
    expect(deepseekCall?.type === "toolCall" ? JSON.parse(deepseekCall.call.arguments) : undefined).toEqual({
      path: "b.ts",
    });
  });
});
