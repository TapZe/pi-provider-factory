import { describe, expect, it } from "bun:test";
import { ANTHROPIC_BETAS, FACTORY_CLIENT_VERSION, FACTORY_DROID_SYSTEM_PROMPT } from "./constants";
import { prepareContextForFactory } from "./router";

describe("Factory Router & Tool Execution Configuration", () => {
  it("uses the latest Droid CLI client version", () => {
    expect(FACTORY_CLIENT_VERSION).toBe("0.208.2");
  });

  it("includes required Anthropic betas for tool streaming and thinking", () => {
    expect(ANTHROPIC_BETAS).toContain("fine-grained-tool-streaming-2025-05-14");
    expect(ANTHROPIC_BETAS).toContain("interleaved-thinking-2025-05-14");
  });

  it("contains the Droid system prompt prefix enforcing tool usage", () => {
    expect(FACTORY_DROID_SYSTEM_PROMPT).toBe(
      "You are Droid, an AI software engineering agent built by Factory.",
    );
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
});
