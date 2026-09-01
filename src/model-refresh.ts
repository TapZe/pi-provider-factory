import type { ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";

import { defaultCostFor, FACTORY_MODELS, factoryModel, familyOf } from "./catalog";

const FACTORY_MODEL_DOCS_URL = "https://docs.factory.ai/models.md";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

export type FactoryModelDocsEntry = {
  id: string;
  displayName: string;
  multiplier?: number;
  reasoning: string;
};

export type LiveTokenCost = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

function stripDocsMarkup(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/\\(.)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMultiplier(cell: string | undefined): number | undefined {
  if (!cell) return undefined;
  const match = cell.match(/([\d.]+)[\s*×xX]/);
  if (match && match[1]) {
    const parsed = parseFloat(match[1]);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export async function fetchOpenRouterPrices(): Promise<Map<string, LiveTokenCost>> {
  const priceMap = new Map<string, LiveTokenCost>();
  try {
    const res = await fetch(OPENROUTER_MODELS_URL, {
      signal: AbortSignal.timeout(2500),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return priceMap;
    const data = (await res.json()) as {
      data?: Array<{
        id: string;
        pricing?: { prompt?: string; completion?: string; input_cache_read?: string };
      }>;
    };
    if (!Array.isArray(data.data)) return priceMap;

    for (const m of data.data) {
      if (m.id && m.pricing) {
        const input = Math.round(Number(m.pricing.prompt || 0) * 1_000_000 * 1000) / 1000;
        const output = Math.round(Number(m.pricing.completion || 0) * 1_000_000 * 1000) / 1000;
        const cacheRead = Math.round(Number(m.pricing.input_cache_read || 0) * 1_000_000 * 1000) / 1000;
        if (input > 0 || output > 0) {
          priceMap.set(m.id.toLowerCase(), { input, output, cacheRead, cacheWrite: 0 });
        }
      }
    }
  } catch {
    // Non-critical: network timeout or offline falls back cleanly to default catalog pricing
  }
  return priceMap;
}

export function matchLivePrice(id: string, priceMap: Map<string, LiveTokenCost>): LiveTokenCost | undefined {
  if (priceMap.size === 0) return undefined;
  const norm = id.toLowerCase();
  const direct = priceMap.get(norm);
  if (direct) return direct;

  for (const prefix of ["anthropic/", "openai/", "moonshotai/", "deepseek/", "z-ai/", "minimax/", "x-ai/", "nvidia/"]) {
    const prefixed = priceMap.get(prefix + norm);
    if (prefixed) return prefixed;
  }

  for (const [k, v] of priceMap.entries()) {
    if (k.endsWith("/" + norm) || k.endsWith(":" + norm)) return v;
  }
  return undefined;
}

// Section-independent: the model ID's family is the only gate. Any table row
// with a backticked ID whose family we can route is kept, no matter which
// heading it appears under and no matter what footnote glyphs decorate it —
// new or renamed docs sections must never silently drop models.
export function parseFactoryModelDocs(markdown: string): FactoryModelDocsEntry[] {
  const entries: FactoryModelDocsEntry[] = [];

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();

    if (!line.startsWith("|")) {
      continue;
    }

    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 4) {
      continue;
    }

    // Header/separator rows have no backticked ID, so this skips them too.
    const idMatch = (cells[2] ?? "").match(/`([^`]+)`/);
    if (!idMatch) {
      continue;
    }

    const id = idMatch[1].trim();
    if (id.length === 0 || familyOf(id) === "unsupported") {
      continue;
    }

    const displayName = stripDocsMarkup(cells[1] ?? "").replace(/[\s*†‡§]+$/u, "");
    const multiplier = parseMultiplier(cells[3]);

    entries.push({
      id,
      displayName: displayName.length > 0 ? displayName : id,
      multiplier,
      reasoning: cells[4] ?? "",
    });
  }

  return entries;
}

function docsEntryToModel(entry: FactoryModelDocsEntry, liveCost?: LiveTokenCost): ProviderModelConfig | null {
  const cost = liveCost ?? defaultCostFor(entry.id);
  switch (familyOf(entry.id)) {
    case "anthropic":
      return factoryModel({
        id: entry.id,
        name: `${entry.displayName} (Factory)`,
        reasoning: true,
        input: ["text", "image"],
        cost,
        premiumMultiplier: entry.multiplier,
        contextWindow: 200000,
        maxTokens: 64000,
      });
    case "openai-responses":
      return factoryModel({
        id: entry.id,
        name: `${entry.displayName} (Factory)`,
        reasoning: true,
        input: ["text", "image"],
        cost,
        premiumMultiplier: entry.multiplier,
        contextWindow: 400000,
        maxTokens: 128000,
      });
    case "openai-completions":
      return factoryModel({
        id: entry.id,
        name: `${entry.displayName} (Factory Core)`,
        reasoning: true,
        input: ["text"],
        cost,
        premiumMultiplier: entry.multiplier,
        contextWindow: 200000,
        maxTokens: 32000,
      });
    case "unsupported":
      return null;
  }
}

function mergeDocsModels(
  entries: FactoryModelDocsEntry[],
  livePrices: Map<string, LiveTokenCost> = new Map(),
): ProviderModelConfig[] {
  const merged: ProviderModelConfig[] = FACTORY_MODELS.map((model) => {
    const live = matchLivePrice(model.id, livePrices);
    return live ? { ...model, cost: live } : model;
  });

  const seen = new Set<string>(merged.map((model) => model.id));

  for (const entry of entries) {
    if (seen.has(entry.id)) {
      continue;
    }

    const live = matchLivePrice(entry.id, livePrices);
    const model = docsEntryToModel(entry, live);
    if (!model) {
      continue;
    }

    merged.push(model);
    seen.add(entry.id);
  }

  return merged;
}

// Throws on any fetch/parse failure. pi-catalog catches the error, keeps the
// last-good cached catalog non-authoritatively, and retries in 5 minutes —
// strictly better than returning the static fallback, which would be recorded
// as a successful authoritative fetch and drop every docs-only model for 24 h.
export async function fetchFactoryDynamicModels(_apiKey?: string): Promise<readonly ProviderModelConfig[]> {
  const [docsRes, livePrices] = await Promise.all([
    fetch(FACTORY_MODEL_DOCS_URL, {
      headers: { Accept: "text/markdown,text/plain;q=0.9,*/*;q=0.1" },
    }),
    fetchOpenRouterPrices(),
  ]);

  if (!docsRes.ok) {
    throw new Error(`factory: model docs fetch failed: HTTP ${docsRes.status}`);
  }

  const markdown = await docsRes.text();

  const entries = parseFactoryModelDocs(markdown);
  if (entries.length === 0) {
    throw new Error("factory: model docs parsed to zero entries — docs format changed?");
  }

  return mergeDocsModels(entries, livePrices);
}
