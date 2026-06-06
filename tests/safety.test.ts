import { describe, it } from "node:test";
import assert from "node:assert";
import { isDryRun, shouldExecute, dryRunResult } from "../src/safety.js";

describe("safety", () => {
  describe("isDryRun", () => {
    it("defaults to true when dry_run is undefined", () => {
      assert.strictEqual(isDryRun({}), true);
    });

    it("returns true when dry_run is true", () => {
      assert.strictEqual(isDryRun({ dry_run: true }), true);
    });

    it("returns false when dry_run is false", () => {
      assert.strictEqual(isDryRun({ dry_run: false }), false);
    });
  });

  describe("shouldExecute", () => {
    it("allows string form (backward compat)", () => {
      const gate = shouldExecute("test_tool");
      assert.strictEqual(gate.execute, true);
    });

    it("allows when cost impact is below threshold", () => {
      const original = process.env.MARKETING_OPS_MCP_HIGH_IMPACT_THRESHOLD;
      process.env.MARKETING_OPS_MCP_HIGH_IMPACT_THRESHOLD = "5000";
      const gate = shouldExecute({ toolName: "test_tool", costImpactAbsolute: 100 });
      assert.strictEqual(gate.execute, true);
      if (original) process.env.MARKETING_OPS_MCP_HIGH_IMPACT_THRESHOLD = original;
      else delete process.env.MARKETING_OPS_MCP_HIGH_IMPACT_THRESHOLD;
    });

    it("blocks when cost impact exceeds threshold", () => {
      const original = process.env.MARKETING_OPS_MCP_HIGH_IMPACT_THRESHOLD;
      process.env.MARKETING_OPS_MCP_HIGH_IMPACT_THRESHOLD = "5000";
      const gate = shouldExecute({ toolName: "test_tool", costImpactAbsolute: 10000 });
      assert.strictEqual(gate.execute, false);
      assert.ok(gate.reason?.includes("High-impact change blocked"));
      if (original) process.env.MARKETING_OPS_MCP_HIGH_IMPACT_THRESHOLD = original;
      else delete process.env.MARKETING_OPS_MCP_HIGH_IMPACT_THRESHOLD;
    });

    it("allows high impact when confirmHighImpact is true", () => {
      const original = process.env.MARKETING_OPS_MCP_HIGH_IMPACT_THRESHOLD;
      process.env.MARKETING_OPS_MCP_HIGH_IMPACT_THRESHOLD = "5000";
      const gate = shouldExecute({
        toolName: "test_tool",
        costImpactAbsolute: 10000,
        confirmHighImpact: true,
      });
      assert.strictEqual(gate.execute, true);
      if (original) process.env.MARKETING_OPS_MCP_HIGH_IMPACT_THRESHOLD = original;
      else delete process.env.MARKETING_OPS_MCP_HIGH_IMPACT_THRESHOLD;
    });
  });

  describe("dryRunResult", () => {
    it("returns a structured dry-run response", () => {
      const result = dryRunResult({ action: "test" });
      assert.strictEqual(result.applied, false);
      assert.strictEqual(result.dry_run, true);
      assert.deepStrictEqual(result.preview, { action: "test" });
      assert.ok(result.reason.includes("dry_run"));
    });
  });
});
