import { describe, expect, it } from "bun:test";
import { ANTHROPIC_BETAS, FACTORY_CLIENT_VERSION, FACTORY_DROID_SYSTEM_PROMPT } from "./constants";

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
});
