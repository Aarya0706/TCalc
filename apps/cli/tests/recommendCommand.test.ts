import { describe, it, expect } from "vitest";
import { executeRecommend } from "../src/commands/recommend.js";

describe("recommend command", () => {
  it("recommends models from catalog", async () => {
    const output = await executeRecommend({
      target: "fixtures/small-node-app",
      format: "json",
    });
    const parsed = JSON.parse(output);
    expect(parsed.goal).toBeDefined();
    expect(parsed.cheapestSufficient).toBeDefined();
    expect(parsed.balanced).toBeDefined();
    expect(parsed.highConfidence).toBeDefined();
  });

  it("respects local-first privacy mode", async () => {
    const output = await executeRecommend({
      target: "fixtures/small-node-app",
      privacy: "local-first",
      format: "json",
    });
    const parsed = JSON.parse(output);
    expect(parsed.goal).toBeDefined();
  });

  it("returns table format output", async () => {
    const output = await executeRecommend({
      target: "fixtures/small-node-app",
      format: "table",
    });
    expect(output).toContain("Recommendations for goal:");
    expect(output).toContain("Workspace tokens:");
    expect(output).toContain("Cheapest Sufficient");
    expect(output).toContain("Balanced");
    expect(output).toContain("High Confidence");
  });

  it("E2E: preferred tied model from team.json reaches recommendation output", async () => {
    // Build a temp workspace with two models that are identical in every scoring
    // dimension (same price, context window, scores) so that preferredModelIds is the
    // only differentiator.  The preferred model must appear in at least one tier.
    //
    // Node built-ins are imported dynamically to stay within the CLI tsconfig's
    // "include": ["src"] scope and avoid top-level node:* IDE errors in this file.
    const { join } = await import("node:path");
    const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import("node:fs");

    const root = mkdtempSync(join(process.cwd(), ".tcalc-e2e-preferred-"));
    try {
      // Minimal source file so the scanner has something to measure.
      writeFileSync(join(root, "index.ts"), "export const x = 1;\n");

      // Custom catalog with two identical-scoring models; only their IDs differ.
      const catalogDir = join(root, "catalogs");
      mkdirSync(catalogDir);
      const sharedModel = {
        displayName: "Twin",
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
        updatedAt: "2026-01-01",
      };
      writeFileSync(
        join(catalogDir, "models.json"),
        JSON.stringify({
          version: "1.0",
          updatedAt: "2026-01-01",
          models: [
            { ...sharedModel, id: "twin-a", displayName: "Twin A" },
            { ...sharedModel, id: "twin-b", displayName: "Twin B" },
          ],
        }),
      );

      // Team policy: prefer twin-b (alphabetically second, so it would lose the
      // localeCompare tiebreaker without the fix).
      mkdirSync(join(root, ".tcalc"));
      writeFileSync(
        join(root, ".tcalc", "team.json"),
        JSON.stringify({
          schemaVersion: "1.0",
          modelProfiles: [{ id: "default", preferredModelIds: ["twin-b"] }],
          activeProfile: "default",
        }),
      );

      const output = await executeRecommend({
        target: root,
        format: "json",
        privacy: "cloud-ok",
      });
      const parsed = JSON.parse(output);

      const tierIds = [
        parsed.cheapestSufficient.modelId,
        parsed.balanced.modelId,
        parsed.highConfidence.modelId,
      ];

      // twin-b is preferred and scores identically to twin-a in every substantive criterion.
      // Without the fix, the localeCompare fallback ('a' < 'b') would always pick twin-a.
      // With the fix, twin-b wins cheapest-sufficient (first pick, all criteria tied).
      // The dedup mechanism forces the balanced slot to the other model,
      // but twin-b must appear in at least one tier.
      expect(parsed.cheapestSufficient.modelId).toBe("twin-b");
      expect(tierIds).toContain("twin-b");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
