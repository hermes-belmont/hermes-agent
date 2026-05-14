export type ModelTier = "FRONTIER" | "STRONG" | "FAST";

export const MODEL_TIERS: ModelTier[] = ["FRONTIER", "STRONG", "FAST"];

/**
 * Explicit per-model overrides. Keys are matched case-insensitively against the
 * canonical model id and against its trailing path segment so both
 * "claude-opus-4-7" and "anthropic/claude-opus-4-7" resolve identically.
 */
const MODEL_TIER_OVERRIDES: Record<string, ModelTier> = {
  // FRONTIER
  "claude-opus-4-7": "FRONTIER",
  "claude-opus-4-6": "FRONTIER",
  "claude-opus-4-5-20251101": "FRONTIER",
  "claude-opus-4-1-20250805": "FRONTIER",
  "gpt-5.5": "FRONTIER",
  "gpt-5.4": "FRONTIER",
  "anthropic/claude-opus-4-7": "FRONTIER",
  "openai/gpt-5.5": "FRONTIER",
  "openai/gpt-5.4": "FRONTIER",

  // STRONG
  "claude-sonnet-4-6": "STRONG",
  "claude-sonnet-4.6": "STRONG",
  "claude-sonnet-4-5-20250929": "STRONG",
  "gpt-5.4-mini": "STRONG",
  "openrouter/openai/gpt-5-mini": "STRONG",
  "anthropic/claude-sonnet-4-6": "STRONG",
  "nous/hermes-4": "STRONG",

  // FAST
  "claude-haiku-4-5-20251001": "FAST",
  "claude-haiku-4-5": "FAST",
  "openai/gpt-5-nano": "FAST",
  "anthropic/claude-haiku-4-5": "FAST",
};

function normalize(modelId: string): string {
  return modelId.trim().toLowerCase();
}

function tail(modelId: string): string {
  const norm = normalize(modelId);
  const parts = norm.split("/");
  return parts[parts.length - 1] ?? norm;
}

/**
 * Resolve a model's tier. Strategy:
 *   1. Explicit overrides (full id, then trailing segment).
 *   2. Name-pattern classifier — opus / gpt-5.5 / gpt-5.4 ⇒ FRONTIER,
 *      sonnet / mini ⇒ STRONG, haiku / flash / nano / turbo ⇒ FAST.
 *   3. Last-resort fallback ⇒ STRONG.
 */
export function getModelTier(modelId: string): ModelTier {
  if (!modelId) return "STRONG";
  const full = normalize(modelId);
  const segment = tail(modelId);
  const override = MODEL_TIER_OVERRIDES[modelId] ?? MODEL_TIER_OVERRIDES[full] ?? MODEL_TIER_OVERRIDES[segment];
  if (override) return override;

  // FAST (check before STRONG so "gpt-5-nano" and "haiku" win over "sonnet" /
  // "mini" substrings if both happened to be present).
  if (/\b(haiku|flash|nano|turbo)\b/.test(segment) || /-nano\b|-flash\b|-turbo\b/.test(segment)) return "FAST";
  // FRONTIER — opus or top-of-stack gpt-5.5 / gpt-5.4 (not "-mini" variants).
  if (/\bopus\b/.test(segment)) return "FRONTIER";
  if (/gpt-5\.5\b/.test(segment) && !/-mini\b|-nano\b/.test(segment)) return "FRONTIER";
  if (/gpt-5\.4\b/.test(segment) && !/-mini\b|-nano\b/.test(segment)) return "FRONTIER";
  // STRONG — sonnet, mini variants, hermes mid-tier.
  if (/\bsonnet\b/.test(segment)) return "STRONG";
  if (/-mini\b/.test(segment)) return "STRONG";
  if (/\bhermes\b/.test(segment)) return "STRONG";

  return "STRONG";
}

export function providerKeyForModel(modelId: string): string {
  return modelId.includes("/") ? modelId.split("/")[0] : "route";
}
