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
    it("blocks when env is not set", () => {
      const original = process.env.MARKETING_OPS_MCP_EXECUTE;
      delete process.env.MARKETING_OPS_MCP_EXECUTE;
      const gate = shouldExecute("test_tool");
      assert.strictEqual(gate.execute, false);
      assert.ok(gate.reason?.includes("MARKETING_OPS_MCP_EXECUTE"));
      // Restore
      if (original) process.env.MARKETING_OPS_MCP_EXECUTE = original;
    });

    it("allows when env is set to 1", () => {
      const original = process.env.MARKETING_OPS_MCP_EXECUTE;
      process.env.MARKETING_OPS_MCP_EXECUTE = "1";
      const gate = shouldExecute("test_tool");
      assert.strictEqual(gate.execute, true);
      // Restore
      if (original) process.env.MARKETING_OPS_MCP_EXECUTE = original;
      else delete process.env.MARKETING_OPS_MCP_EXECUTE;
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
