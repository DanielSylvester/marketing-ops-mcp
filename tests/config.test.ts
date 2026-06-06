import { describe, it } from "node:test";
import assert from "node:assert";
import { listConfiguredMetaBrands, getMetaAccount } from "../src/config.js";

describe("config", () => {
  it("discovers brands from META_BRANDS env", () => {
    const brands = listConfiguredMetaBrands();
    assert.deepStrictEqual(brands.sort(), ["acme", "globex"]);
  });

  it("returns correct config for a generic brand", () => {
    const cfg = getMetaAccount("acme");
    assert.strictEqual(cfg.brand, "acme");
    assert.strictEqual(cfg.currency, "USD");
    assert.strictEqual(cfg.campaignPrefix, "AC_");
    assert.strictEqual(cfg.timezone, "America/New_York");
    assert.ok(cfg.accessToken);
  });

  it("returns correct config for another generic brand", () => {
    const cfg = getMetaAccount("globex");
    assert.strictEqual(cfg.brand, "globex");
    assert.strictEqual(cfg.currency, "EUR");
    assert.strictEqual(cfg.campaignPrefix, "GL_");
    assert.strictEqual(cfg.timezone, "Europe/London");
    assert.ok(cfg.accessToken);
  });

  it("caches account config", () => {
    const a = getMetaAccount("acme");
    const b = getMetaAccount("acme");
    assert.strictEqual(a, b);
  });
});
