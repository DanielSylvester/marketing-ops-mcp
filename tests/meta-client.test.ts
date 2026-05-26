import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { MetaClient, MetaClientError } from "../src/meta/client.js";

const TEST_ACCOUNT = {
  brand: "test",
  name: "Test Account",
  accountId: "act_123456789",
  accessToken: "test-token",
  currency: "INR",
  currencySymbol: "₹",
  timezone: "Asia/Kolkata",
  campaignPrefix: "TEST_",
};

let originalFetch: typeof global.fetch;
let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
let fetchResponseQueue: Array<ReturnType<typeof makeResponse>> = [];

function mockFetch(responseOrQueue: Array<ReturnType<typeof makeResponse>> | ReturnType<typeof makeResponse>) {
  fetchResponseQueue = Array.isArray(responseOrQueue) ? [...responseOrQueue] : [responseOrQueue];
  fetchCalls = [];
  global.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: url.toString(), init });
    const res = fetchResponseQueue.shift() ?? fetchResponseQueue[fetchResponseQueue.length - 1] ?? responseOrQueue;
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

describe("MetaClient — request core", () => {
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

  it("performs a successful GET request", async () => {
    const client = new MetaClient(TEST_ACCOUNT);
    mockFetch(makeResponse({ body: { data: [{ id: "1" }] } }));

    const result = await client.get("/me/adaccounts");
    assert.strictEqual(fetchCalls.length, 1);
    assert.ok(fetchCalls[0].url.includes("access_token=test-token"));
    assert.deepStrictEqual(result, { data: [{ id: "1" }] });
  });

  it("performs a successful POST request", async () => {
    const client = new MetaClient(TEST_ACCOUNT);
    mockFetch(makeResponse({ body: { success: true } }));

    await client.post("/act_123/campaigns", { name: "Test", status: "PAUSED" });
    assert.strictEqual(fetchCalls.length, 1);
    assert.strictEqual(fetchCalls[0].init?.method, "POST");
    const bodyText = fetchCalls[0].init?.body as string;
    assert.ok(bodyText.includes("name=Test"));
  });

  it("retries on 500 errors with exponential backoff", async () => {
    const client = new MetaClient(TEST_ACCOUNT);
    mockFetch([
      makeResponse({ status: 500, body: { error: { message: "fail", code: 1 } } }),
      makeResponse({ status: 500, body: { error: { message: "fail", code: 1 } } }),
      makeResponse({ body: { ok: true } }),
    ]);

    const result = await client.get("/test");
    assert.strictEqual(fetchCalls.length, 3);
    assert.deepStrictEqual(result, { ok: true });
  });

  it("throws MetaClientError after exhausting retries", async () => {
    const client = new MetaClient(TEST_ACCOUNT);
    mockFetch([
      makeResponse({ status: 500, body: { error: { message: "fail", code: 1 } } }),
      makeResponse({ status: 500, body: { error: { message: "fail", code: 1 } } }),
      makeResponse({ status: 500, body: { error: { message: "fail", code: 1 } } }),
    ]);

    await assert.rejects(async () => client.get("/test"), (err) => {
      assert.ok(err instanceof MetaClientError);
      assert.strictEqual(err.statusCode, 500);
      return true;
    });
  });

  it("does not retry 401 auth errors", async () => {
    const client = new MetaClient(TEST_ACCOUNT);
    mockFetch(makeResponse({ status: 401, body: { error: { message: "Unauthorized", code: 190 } } }));

    await assert.rejects(async () => client.get("/test"), (err) => {
      assert.ok(err instanceof MetaClientError);
      assert.strictEqual(err.statusCode, 401);
      return true;
    });
    assert.strictEqual(fetchCalls.length, 1);
  });

  it("reads Retry-After header on 429 and uses it", async () => {
    const client = new MetaClient(TEST_ACCOUNT);
    mockFetch([
      makeResponse({ status: 429, body: { error: { message: "Rate limit", code: 4 } }, headers: { "retry-after": "2" } }),
      makeResponse({ body: { ok: true } }),
    ]);

    const start = Date.now();
    const result = await client.get("/test");
    const elapsed = Date.now() - start;

    assert.deepStrictEqual(result, { ok: true });
    assert.strictEqual(fetchCalls.length, 2);
    assert.ok(elapsed >= 1500, `Expected at least 1500ms delay, got ${elapsed}ms`);
  });

  it("paginates through multiple pages", async () => {
    const client = new MetaClient(TEST_ACCOUNT);
    mockFetch([
      makeResponse({
        body: {
          data: [{ id: "1" }, { id: "2" }],
          paging: { next: "https://graph.facebook.com/v25.0/next?page=2" },
        },
      }),
      makeResponse({ body: { data: [{ id: "3" }] } }),
    ]);

    const results = await client.getPaginated("/act_123/campaigns", {}, 5);
    assert.strictEqual(results.length, 3);
    assert.strictEqual(results[2].id, "3");
  });
});
