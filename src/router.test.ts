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
    expect(prepared.tools?.[0].customWireName).toBe("Read");
    expect(prepared.tools?.[1].customWireName).toBe("Execute");
  });

  it("does not duplicate Droid system prompt prefix if already present", () => {
    const context = {
      systemPrompt: [FACTORY_DROID_SYSTEM_PROMPT, "Additional prompt"],
      messages: [],
    };

    const prepared = prepareContextForFactory(context);

    expect(prepared.systemPrompt?.length).toBe(2);
    expect(prepared.systemPrompt?.[0]).toBe(FACTORY_DROID_SYSTEM_PROMPT);
  });
});
