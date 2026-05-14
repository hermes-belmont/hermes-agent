import { describe, expect, it } from "vitest";
import { getModelTier, providerKeyForModel } from "./model-tiers";

describe("getModelTier", () => {
  it("classifies explicit FRONTIER ids (full + tail forms)", () => {
    expect(getModelTier("claude-opus-4-7")).toBe("FRONTIER");
    expect(getModelTier("anthropic/claude-opus-4-7")).toBe("FRONTIER");
    expect(getModelTier("claude-opus-4-1-20250805")).toBe("FRONTIER");
    expect(getModelTier("gpt-5.5")).toBe("FRONTIER");
    expect(getModelTier("openai/gpt-5.4")).toBe("FRONTIER");
  });

  it("classifies STRONG ids including dated sonnet + openrouter mini", () => {
    expect(getModelTier("claude-sonnet-4-6")).toBe("STRONG");
    expect(getModelTier("claude-sonnet-4-5-20250929")).toBe("STRONG");
    expect(getModelTier("openrouter/openai/gpt-5-mini")).toBe("STRONG");
    expect(getModelTier("gpt-5.4-mini")).toBe("STRONG");
  });

  it("classifies FAST ids by suffix patterns", () => {
    expect(getModelTier("claude-haiku-4-5-20251001")).toBe("FAST");
    expect(getModelTier("openai/gpt-5-nano")).toBe("FAST");
    expect(getModelTier("anthropic/claude-haiku-4-5")).toBe("FAST");
  });

  it("falls back to name-pattern classification for unknown ids", () => {
    expect(getModelTier("foo/opus-new-2026")).toBe("FRONTIER");
    expect(getModelTier("vendor/sonnet-mystery")).toBe("STRONG");
    expect(getModelTier("provider/some-haiku-x")).toBe("FAST");
    expect(getModelTier("noprovider/randommodel")).toBe("STRONG");
  });

  it("is case-insensitive", () => {
    expect(getModelTier("Anthropic/Claude-Opus-4-7")).toBe("FRONTIER");
    expect(getModelTier("OPENAI/GPT-5-NANO")).toBe("FAST");
  });
});

describe("providerKeyForModel", () => {
  it("returns provider prefix when present", () => {
    expect(providerKeyForModel("anthropic/claude-opus-4-7")).toBe("anthropic");
    expect(providerKeyForModel("openrouter/openai/gpt-5-mini")).toBe("openrouter");
  });
  it("returns 'route' for bare model ids", () => {
    expect(providerKeyForModel("claude-opus-4-7")).toBe("route");
  });
});
