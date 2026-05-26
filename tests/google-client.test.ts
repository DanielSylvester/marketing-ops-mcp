import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { GoogleAdsClient, GoogleAdsClientError } from "../src/google/client.js";

const TEST_CONFIG = {
  clientId: "test-client-id",
  clientSecret: "test-secret",
  refreshToken: "test-refresh",
  developerToken: "test-dev-token",
  loginCustomerId: "1234567899",
  customerId: "1234567890",
};

let originalFetch: typeof global.fetch;
let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
let fetchResponseQueue: Array<ReturnType<typeof makeResponse>> = [];

function mockFetch(responseOrQueue: Array<ReturnType<typeof makeResponse>> | ReturnType<typeof makeResponse>) {
  fetchResponseQueue = Array.isArray(responseOrQueue) ? [...responseOrQueue] : [responseOrQueue];
  fetchCalls = [];
  global.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: url.toString(), init });
    const res = fetchResponseQueue.shift() ?? fetchResponseQueue[fetchResponseQueue.length - 1];
    if (!res) throw new Error("No mock response available");
    return res;
  };
}

function makeResponse({
  status = 200,
  body = {},
  headers = {},
}: {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}) {
  const h = new Map(Object.entries(headers));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (key: string) => h.get(key.toLowerCase()) ?? null,
    },
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response;
}

describe("GoogleAdsClient — auth", () => {
  before(() => {
    originalFetch = global.fetch;
  });

  after(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    fetchCalls = [];
    fetchResponseQueue = [];
  });

  it("refreshes access token on first call", async () => {
    const client = new GoogleAdsClient(TEST_CONFIG);
    mockFetch([
      makeResponse({ body: { access_token: "fresh-token", expires_in: 3600 } }),
      makeResponse({ body: { results: [{ campaign: { id: "1" } }] } }),
    ]);

    const rows = await client.query("SELECT campaign.id FROM campaign");
    assert.strictEqual(rows.length, 1);
    assert.ok(fetchCalls[0].url.includes("oauth2.googleapis.com/token"));
    assert.ok(fetchCalls[1].init?.headers && JSON.stringify(fetchCalls[1].init.headers).includes("fresh-token"));
  });

  it("caches access token and reuses it", async () => {
    const client = new GoogleAdsClient(TEST_CONFIG);
    mockFetch([
      makeResponse({ body: { access_token: "cached-token", expires_in: 3600 } }),
      makeResponse({ body: { results: [] } }),
      makeResponse({ body: { results: [] } }),
    ]);

    await client.query("SELECT 1");
    await client.query("SELECT 2");
    assert.strictEqual(fetchCalls.length, 3); // 1 token + 2 queries
  });
});

describe("GoogleAdsClient — request core", () => {
  before(() => {
    originalFetch = global.fetch;
  });

  after(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    fetchCalls = [];
    fetchResponseQueue = [];
  });

  it("performs a successful GAQL query", async () => {
    const client = new GoogleAdsClient(TEST_CONFIG);
    mockFetch([
      makeResponse({ body: { access_token: "token", expires_in: 3600 } }),
      makeResponse({ body: { results: [{ campaign: { id: "1", name: "Test" } }] } }),
    ]);

    const rows = await client.query<{ campaign: { id: string; name: string } }>(
      "SELECT campaign.id, campaign.name FROM campaign"
    );
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].campaign.name, "Test");
  });

  it("retries on 500 errors", async () => {
    const client = new GoogleAdsClient(TEST_CONFIG);
    mockFetch([
      makeResponse({ body: { access_token: "token", expires_in: 3600 } }),
      makeResponse({ status: 500, body: { error: "Internal" } }),
      makeResponse({ body: { results: [] } }),
    ]);

    const rows = await client.query("SELECT 1");
    assert.strictEqual(rows.length, 0);
    assert.strictEqual(fetchCalls.length, 3);
  });

  it("does not retry 401 errors", async () => {
    const client = new GoogleAdsClient(TEST_CONFIG);
    mockFetch([
      makeResponse({ body: { access_token: "token", expires_in: 3600 } }),
      makeResponse({ status: 401, body: { error: "Unauthorized" } }),
    ]);

    await assert.rejects(async () => client.query("SELECT 1"), (err) => {
      assert.ok(err instanceof GoogleAdsClientError);
      assert.strictEqual(err.statusCode, 401);
      return true;
    });
    assert.strictEqual(fetchCalls.length, 2);
  });

  it("reads Retry-After on 429", async () => {
    const client = new GoogleAdsClient(TEST_CONFIG);
    mockFetch([
      makeResponse({ body: { access_token: "token", expires_in: 3600 } }),
      makeResponse({ status: 429, body: { error: "Rate limited" }, headers: { "retry-after": "2" } }),
      makeResponse({ body: { results: [] } }),
    ]);

    const start = Date.now();
    await client.query("SELECT 1");
    const elapsed = Date.now() - start;

    assert.ok(elapsed >= 1500, `Expected delay, got ${elapsed}ms`);
  });
});
