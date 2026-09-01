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
    expect(FACTORY_DROID_SYSTEM_PROMPT).toStartWith(
      "You are Droid, an AI software engineering agent built by Factory.",
    );
    expect(FACTORY_DROID_SYSTEM_PROMPT).toContain("tools");
  });

  it("prepends Droid system prompt prefix and aliases tools to Droid PascalCase names", () => {
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
    expect(prepared.tools?.[0].name).toBe("Read");
    expect(prepared.tools?.[0].customWireName).toBe("Read");
    expect(prepared.tools?.[1].name).toBe("Execute");
    expect(prepared.tools?.[1].customWireName).toBe("Execute");
  });

  it("maps assistant toolCall and toolResult in message history to Droid names", () => {
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
    expect((assistantMsg?.content as any[])[0].name).toBe("Read");
    expect((assistantMsg?.content as any[])[0].customWireName).toBe("Read");

    const toolResultMsg = prepared.messages?.[1] as any;
    expect(toolResultMsg?.toolName).toBe("Read");
    expect(toolResultMsg?.customWireName).toBe("Read");
  });

  it("configures thinking capabilities with max/xhigh effort support for reasoning models", () => {
    const { FACTORY_MODELS } = require("./catalog");
    const kimiK3 = FACTORY_MODELS.find((m: any) => m.id === "kimi-k3");
    expect(kimiK3).toBeDefined();
    expect(kimiK3.reasoning).toBe(true);
    expect(kimiK3.thinking).toBeDefined();
    expect(kimiK3.thinking.efforts).toContain("xhigh");
    expect(kimiK3.thinking.effortMap.xhigh).toBeDefined();
  });
});
