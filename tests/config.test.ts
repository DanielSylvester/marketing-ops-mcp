import { describe, it } from "node:test";
import assert from "node:assert";
import { listConfiguredMetaBrands, getMetaAccount } from "../src/config.js";

describe("config", () => {
  it("discovers legacy brands from env", () => {
    const brands = listConfiguredMetaBrands();
    assert.deepStrictEqual(brands.sort(), ["smartworks", "workstudio"]);
  });

  it("returns correct smartworks config", () => {
    const cfg = getMetaAccount("smartworks");
    assert.strictEqual(cfg.brand, "smartworks");
    assert.strictEqual(cfg.currency, "INR");
    assert.strictEqual(cfg.campaignPrefix, "SW_");
    assert.strictEqual(cfg.timezone, "Asia/Kolkata");
    assert.ok(cfg.accessToken);
  });

  it("returns correct workstudio config", () => {
    const cfg = getMetaAccount("workstudio");
    assert.strictEqual(cfg.brand, "workstudio");
    assert.strictEqual(cfg.currency, "SGD");
    assert.strictEqual(cfg.campaignPrefix, "WS_");
    assert.strictEqual(cfg.timezone, "Asia/Singapore");
    assert.ok(cfg.accessToken);
  });

  it("caches account config", () => {
    const a = getMetaAccount("smartworks");
    const b = getMetaAccount("smartworks");
    assert.strictEqual(a, b);
  });
});
