import { afterEach, describe, expect, test } from "bun:test";

import { fetchFactoryDynamicModels, parseFactoryModelDocs } from "./model-refresh";

// Replicates the live docs.factory.ai/models.md shape: section headings with
// styled spans, header/separator rows, footnote daggers, and a section
// (Google) the parser has never seen before.
const FIXTURE = `
# Models

## <span style="color:#000">Anthropic</span>

| Model | Model ID | Multiplier | Reasoning |
| --- | --- | --- | --- |
| Claude Fable 5<sup>\\*†</sup> | \`claude-fable-5\` | 4× | Standard |
| Claude Opus 4.8 | \`claude-opus-4-8\` | 2× | Standard |

## <span style="color:#000">Google</span>

| Model | Model ID | Multiplier | Reasoning |
| --- | --- | --- | --- |
| Gemini 3.5 Flash | \`gemini-3.5-flash\` | 0.5× | Standard |

## <span style="color:#000">Droid Core (Open Models)</span>

| Model | Model ID | Multiplier | Reasoning |
| --- | --- | --- | --- |
| Kimi K2.6 | \`kimi-k2.6\` | 0.4× | Standard |
| Claude Opus 4.8 | \`claude-opus-4-8\` | 2× | Standard |
`;

describe("parseFactoryModelDocs", () => {
  const entries = parseFactoryModelDocs(FIXTURE);

  test("keeps daggered rows and strips footnote glyphs from the display name", () => {
    const fable = entries.find((entry) => entry.id === "claude-fable-5");
    expect(fable).toBeDefined();
    expect(fable?.displayName).toBe("Claude Fable 5");
  });

  test("parses rows regardless of section heading", () => {
    expect(entries.some((entry) => entry.id === "kimi-k2.6")).toBe(true);
    expect(entries.some((entry) => entry.id === "claude-opus-4-8")).toBe(true);
  });

  test("excludes unsupported families (gemini)", () => {
    expect(entries.some((entry) => entry.id.startsWith("gemini-"))).toBe(false);
  });

  test("returns no entries for non-markdown input", () => {
    expect(parseFactoryModelDocs("<html>not markdown</html>")).toEqual([]);
  });
});

describe("fetchFactoryDynamicModels failure paths", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("throws on non-OK response instead of returning the fallback catalog", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(new Response("", { status: 503 }))) as unknown as typeof fetch;
    await expect(fetchFactoryDynamicModels()).rejects.toThrow(/model docs/);
  });

  test("throws when the docs parse to zero entries", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(new Response("<html>not markdown</html>", { status: 200 }))) as unknown as typeof fetch;
    await expect(fetchFactoryDynamicModels()).rejects.toThrow(/zero entries/);
  });
});
