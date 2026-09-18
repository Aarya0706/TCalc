import { describe, it, expect } from "vitest";
import { recommendModels } from "../src/recommendModels.js";
import type { ModelInfo } from "@wma/core";

const tinyModel: ModelInfo = {
  id: "tiny",
  displayName: "Tiny Model",
  provider: "test",
  contextWindow: 4000,
  maxOutputTokens: 1024,
  inputPricePerMillion: 0.05,
  cachedInputPricePerMillion: 0.025,
  outputPricePerMillion: 0.1,
  supportsTools: false,
  supportsImages: false,
  supportsLocal: true,
  privacyMode: "local",
  codingScore: 25,
  latencyScore: 95,
  updatedAt: "2025-01-01",
};

const cheapModel: ModelInfo = {
  id: "cheap",
  displayName: "Cheap Model",
  provider: "test",
  contextWindow: 16000,
  maxOutputTokens: 4096,
  inputPricePerMillion: 0.15,
  cachedInputPricePerMillion: 0.075,
  outputPricePerMillion: 0.6,
  supportsTools: false,
  supportsImages: false,
  supportsLocal: true,
  privacyMode: "local",
  codingScore: 40,
  latencyScore: 90,
  updatedAt: "2025-01-01",
};

const midModel: ModelInfo = {
  id: "mid",
  displayName: "Mid Model",
  provider: "test",
  contextWindow: 128000,
  maxOutputTokens: 4096,
  inputPricePerMillion: 1.0,
  cachedInputPricePerMillion: 0.5,
  outputPricePerMillion: 4.0,
  supportsTools: true,
  supportsImages: false,
  supportsLocal: false,
  privacyMode: "hybrid",
  codingScore: 70,
  latencyScore: 70,
  updatedAt: "2025-01-01",
};

const bigModel: ModelInfo = {
  id: "big",
  displayName: "Big Model",
  provider: "test",
  contextWindow: 200000,
  maxOutputTokens: 8192,
  inputPricePerMillion: 15,
  cachedInputPricePerMillion: 7.5,
  outputPricePerMillion: 75,
  supportsTools: true,
  supportsImages: true,
  supportsLocal: false,
  privacyMode: "cloud",
  codingScore: 95,
  latencyScore: 40,
  updatedAt: "2025-01-01",
};

const weakModel: ModelInfo = {
  ...midModel,
  id: "weak",
  displayName: "Weak Model",
  codingScore: 45,
  reasoningScore: 40,
  inputPricePerMillion: 2,
  outputPricePerMillion: 8,
};

// Two candidates identical in every scored dimension, so only the tiebreak separates them.
// The preferred id sorts after the other, making localeCompare pick the wrong one without a
// preference tiebreak.
const tiedBase: ModelInfo = {
  id: "alpha/tied",
  displayName: "Tied Model",
  provider: "test",
  contextWindow: 128000,
  maxOutputTokens: 4096,
  inputPricePerMillion: 0.02,
  cachedInputPricePerMillion: 0.01,
  outputPricePerMillion: 0.04,
  supportsTools: false,
  supportsImages: false,
  supportsLocal: true,
  privacyMode: "local",
  codingScore: 90,
  reasoningScore: 90,
  latencyScore: 10,
  updatedAt: "2025-01-01",
};

const tiedAlpha: ModelInfo = { ...tiedBase, id: "alpha/tied" };
const tiedZeta: ModelInfo = { ...tiedBase, id: "zeta/tied" };

// Strictly cheapest, so it consumes the cheapest-sufficient tier and leaves the tied pair to
// contest the later tiers.
const cheapestDecoy: ModelInfo = {
  ...tiedBase,
  id: "decoy/cheapest",
  displayName: "Cheapest Decoy",
  inputPricePerMillion: 0.001,
  cachedInputPricePerMillion: 0.0005,
  outputPricePerMillion: 0.002,
  codingScore: 20,
  reasoningScore: 20,
};

// Higher totalScore than the tied pair (tool support and latency) but lower confidenceScore
// (weaker coding/reasoning), so it consumes the balanced tier without touching high-confidence.
const balancedDecoy: ModelInfo = {
  ...tiedBase,
  id: "decoy/balanced",
  displayName: "Balanced Decoy",
  supportsTools: true,
  latencyScore: 100,
  codingScore: 80,
  reasoningScore: 80,
};

describe("recommendModels", () => {
  it("should select cheapest sufficient model based on total cost", () => {
    const result = recommendModels({
      models: [cheapModel, midModel, bigModel],
      workspaceTokens: 5000,
      goal: "debug",
    });
    expect(result.cheapestSufficient.modelId).toBe("cheap");
  });

  it("should select high-confidence model with highest coding score", () => {
    const result = recommendModels({
      models: [cheapModel, midModel, bigModel],
      workspaceTokens: 5000,
      goal: "build-mvp",
      privacyMode: "cloud-ok",
    });
    expect(result.highConfidence.modelId).toBe("big");
  });

  it("should select balanced model with highest total score", () => {
    const result = recommendModels({
      models: [cheapModel, midModel, bigModel],
      workspaceTokens: 5000,
      goal: "debug",
    });
    expect(result.balanced).toBeDefined();
  });

  it("should reject models with insufficient context window", () => {
    const result = recommendModels({
      models: [tinyModel, cheapModel],
      workspaceTokens: 5000,
      goal: "debug",
    });
    expect(result.rejected).toContain("tiny");
    expect(result.rejected).not.toContain("cheap");
  });

  it("should skip cloud models in local-first privacy mode", () => {
    const result = recommendModels({
      models: [cheapModel, bigModel],
      workspaceTokens: 5000,
      goal: "debug",
      privacyMode: "local-first",
    });
    const cheapInAll = result.allScored.find((m) => m.modelId === "cheap");
    const bigInAll = result.allScored.find((m) => m.modelId === "big");
    expect(cheapInAll).toBeDefined();
    expect(bigInAll).toBeUndefined();
  });

  it("skips hybrid models without local execution support in local-first privacy mode", () => {
    const remoteHybrid: ModelInfo = {
      ...midModel,
      id: "remote-hybrid",
      displayName: "Remote Hybrid",
      privacyMode: "hybrid",
      supportsLocal: false,
    };

    const result = recommendModels({
      models: [cheapModel, remoteHybrid],
      workspaceTokens: 5000,
      goal: "debug",
      privacyMode: "local-first",
    });

    expect(result.allScored.map((m) => m.modelId)).toContain("cheap");
    expect(result.allScored.map((m) => m.modelId)).not.toContain("remote-hybrid");
  });

  it("allows hybrid models with verified local execution support in local-first privacy mode", () => {
    const localHybrid: ModelInfo = {
      ...midModel,
      id: "local-hybrid",
      displayName: "Local Hybrid",
      privacyMode: "hybrid",
      supportsLocal: true,
    };

    const result = recommendModels({
      models: [localHybrid],
      workspaceTokens: 5000,
      goal: "debug",
      privacyMode: "local-first",
    });

    expect(result.allScored.map((m) => m.modelId)).toContain("local-hybrid");
  });

  it("reports when privacy filtering leaves no eligible models", () => {
    expect(() => recommendModels({
      models: [bigModel],
      workspaceTokens: 5000,
      goal: "debug",
      privacyMode: "local-first",
    })).toThrow('No models are eligible for privacy mode "local-first"');
  });

  it("should include cloud models when privacy mode is cloud-ok", () => {
    const result = recommendModels({
      models: [cheapModel, bigModel],
      workspaceTokens: 5000,
      goal: "debug",
      privacyMode: "cloud-ok",
    });
    const bigInAll = result.allScored.find((m) => m.modelId === "big");
    expect(bigInAll).toBeDefined();
  });

  it("should return recommendations for all three tiers", () => {
    const result = recommendModels({
      models: [cheapModel, midModel, bigModel],
      workspaceTokens: 5000,
      goal: "build-mvp",
    });
    expect(result.cheapestSufficient).toBeDefined();
    expect(result.balanced).toBeDefined();
    expect(result.highConfidence).toBeDefined();
  });

  it("should include assumptions in result", () => {
    const result = recommendModels({
      models: [cheapModel],
      workspaceTokens: 5000,
      goal: "debug",
    });
    expect(result.assumptions.length).toBeGreaterThan(0);
  });

  it("should include overflow models when no model fits context", () => {
    const result = recommendModels({
      models: [tinyModel],
      workspaceTokens: 10000,
      goal: "build-mvp",
    });
    expect(result.allScored.length).toBeGreaterThan(0);
    expect(result.rejected).toContain("tiny");
  });

  it("should respect user-specified output tokens", () => {
    const result = recommendModels({
      models: [cheapModel],
      workspaceTokens: 5000,
      goal: "debug",
      outputTokens: 2000,
    });
    expect(result.assumptions.some((a) => a.includes("2000"))).toBe(true);
  });

  it("should respect user-specified budget", () => {
    const result = recommendModels({
      models: [cheapModel],
      workspaceTokens: 5000,
      goal: "debug",
      budget: 3000,
    });
    expect(result.assumptions.some((a) => a.includes("3000"))).toBe(true);
  });

  it("does not inflate a workspace to fill a larger token budget", () => {
    const result = recommendModels({
      models: [cheapModel],
      workspaceTokens: 5000,
      goal: "debug",
      budget: 10000,
    });
    expect(result.cheapestSufficient.costEstimate.inputTokens).toBe(6000);
    expect(result.cheapestSufficient.costEstimate.cachedInputTokens).toBe(1500);
  });

  it("should provide expected quality in recommendations", () => {
    const result = recommendModels({
      models: [bigModel],
      workspaceTokens: 5000,
      goal: "build-mvp",
      privacyMode: "cloud-ok",
    });
    expect(["high", "medium", "low"]).toContain(result.balanced.expectedQuality);
  });

  it("should provide overflow risk in recommendations", () => {
    const result = recommendModels({
      models: [bigModel],
      workspaceTokens: 5000,
      goal: "debug",
      privacyMode: "cloud-ok",
    });
    expect(typeof result.balanced.overflowRisk).toBe("number");
  });

  it("should provide warnings for low coding score models", () => {
    const result = recommendModels({
      models: [tinyModel],
      workspaceTokens: 2000,
      goal: "build-mvp",
    });
    expect(result.balanced.warnings).toBeDefined();
  });

  it("should deduplicate tiers when same model wins multiple", () => {
    const result = recommendModels({
      models: [cheapModel, midModel],
      workspaceTokens: 5000,
      goal: "debug",
      privacyMode: "cloud-ok",
    });
    const tierIds = [
      result.cheapestSufficient.modelId,
      result.balanced.modelId,
      result.highConfidence.modelId,
    ];
    const uniqueIds = new Set(tierIds);
    expect(uniqueIds.size).toBeGreaterThanOrEqual(2);
  });

  it("should handle only one fitting model gracefully", () => {
    const result = recommendModels({
      models: [cheapModel],
      workspaceTokens: 5000,
      goal: "debug",
    });
    expect(result.cheapestSufficient).toBeDefined();
    expect(result.balanced).toBeDefined();
    expect(result.highConfidence).toBeDefined();
    const tierIds = new Set([
      result.cheapestSufficient.modelId,
      result.balanced.modelId,
      result.highConfidence.modelId,
    ]);
    expect(tierIds.size).toBe(1);
    expect(result.cheapestSufficient.modelId).toBe("cheap");
  });

  it("should deduplicate across all three tiers when enough models exist", () => {
    const result = recommendModels({
      models: [cheapModel, midModel],
      workspaceTokens: 5000,
      goal: "debug",
      privacyMode: "cloud-ok",
    });
    const tierIds = [
      result.cheapestSufficient.modelId,
      result.balanced.modelId,
      result.highConfidence.modelId,
    ];
    const uniqueIds = new Set(tierIds);
    expect(uniqueIds.size).toBeGreaterThanOrEqual(2);
  });

  it("breaks cheapest-tier ties toward preferred models", () => {
    const options = { models: [tiedAlpha, tiedZeta], workspaceTokens: 5000, goal: "debug" as const };

    expect(recommendModels(options).cheapestSufficient.modelId).toBe("alpha/tied");
    expect(recommendModels({ ...options, preferredModelIds: ["zeta/tied"] }).cheapestSufficient.modelId)
      .toBe("zeta/tied");
  });

  it("breaks balanced-tier ties toward preferred models", () => {
    const options = { models: [tiedAlpha, tiedZeta, cheapestDecoy], workspaceTokens: 5000, goal: "debug" as const };

    const baseline = recommendModels(options);
    expect(baseline.cheapestSufficient.modelId).toBe("decoy/cheapest");
    expect(baseline.balanced.modelId).toBe("alpha/tied");

    const preferred = recommendModels({ ...options, preferredModelIds: ["zeta/tied"] });
    expect(preferred.balanced.modelId).toBe("zeta/tied");
  });

  it("breaks high-confidence ties toward preferred models", () => {
    const options = {
      models: [tiedAlpha, tiedZeta, cheapestDecoy, balancedDecoy],
      workspaceTokens: 5000,
      goal: "debug" as const,
    };

    const baseline = recommendModels(options);
    expect(baseline.cheapestSufficient.modelId).toBe("decoy/cheapest");
    expect(baseline.balanced.modelId).toBe("decoy/balanced");
    expect(baseline.highConfidence.modelId).toBe("alpha/tied");

    const preferred = recommendModels({ ...options, preferredModelIds: ["zeta/tied"] });
    expect(preferred.highConfidence.modelId).toBe("zeta/tied");
  });

  it("never lets preference override a real scoring difference", () => {
    // cheapestDecoy is strictly cheaper, so preferring a tied model must not steal that tier.
    const result = recommendModels({
      models: [tiedAlpha, tiedZeta, cheapestDecoy],
      workspaceTokens: 5000,
      goal: "debug",
      preferredModelIds: ["zeta/tied"],
    });

    expect(result.cheapestSufficient.modelId).toBe("decoy/cheapest");
  });

  it("ignores preferred ids that are not in the catalog", () => {
    const options = { models: [tiedAlpha, tiedZeta], workspaceTokens: 5000, goal: "debug" as const };

    expect(recommendModels({ ...options, preferredModelIds: ["nope/missing"] }).cheapestSufficient.modelId)
      .toBe(recommendModels(options).cheapestSufficient.modelId);
  });

  it("uses each tier's ranking when selecting a distinct fallback", () => {
    const result = recommendModels({
      models: [cheapModel, weakModel, midModel, bigModel],
      workspaceTokens: 5000,
      goal: "build-mvp",
      privacyMode: "cloud-ok",
    });
    const tierIds = [
      result.cheapestSufficient.modelId,
      result.balanced.modelId,
      result.highConfidence.modelId,
    ];
    expect(new Set(tierIds).size).toBe(3);
    expect(tierIds).not.toContain("weak");
  });
});
