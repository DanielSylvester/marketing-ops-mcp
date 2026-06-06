import { describe, it } from "node:test";
import assert from "node:assert";

// Minimal in-memory mock of GoogleAdsClient
class MockClient {
  customerId = "6478965464";
  private responses: Map<string, unknown[]> = new Map();

  setResponse(key: string, rows: unknown[]) {
    this.responses.set(key, rows);
  }

  async query<T>(_gaql: string): Promise<T[]> {
    for (const [key, rows] of this.responses) {
      if (_gaql.includes(key)) return rows as T[];
    }
    return [];
  }

  async mutate(_operations: unknown[]): Promise<unknown> {
    return { mutateOperationResponses: [{ campaignResult: { resourceName: "customers/1/campaigns/2" } }] };
  }
}

// We can't easily import the tools because they import the real client.
// Instead, test the confirmation-phrase logic inline.
function fmtAmount(n: number): string {
  return String(Number(n.toFixed(2)));
}

function canonical(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function confirmPhrase(curDaily: number, newDaily: number): string {
  const delta = newDaily - curDaily;
  const dir = delta >= 0 ? "increase" : "decrease";
  const pct = Math.round((Math.abs(delta) / curDaily) * 100);
  return canonical(
    `confirm budget change from ${fmtAmount(curDaily)} to ${fmtAmount(newDaily)} (${dir} of ${pct}%)`
  );
}

describe("gads mutation tools", () => {
  describe("confirmPhrase", () => {
    it("produces the expected phrase for an increase", () => {
      const phrase = confirmPhrase(500, 1000);
      assert.strictEqual(phrase, "confirm budget change from 500 to 1000 (increase of 100%)");
    });

    it("produces the expected phrase for a decrease", () => {
      const phrase = confirmPhrase(1000, 500);
      assert.strictEqual(phrase, "confirm budget change from 1000 to 500 (decrease of 50%)");
    });

    it("rounds to whole percent", () => {
      const phrase = confirmPhrase(333, 500);
      assert.strictEqual(phrase, "confirm budget change from 333 to 500 (increase of 50%)");
    });

    it("strips trailing zeros from amounts", () => {
      const phrase = confirmPhrase(500.0, 750.5);
      assert.strictEqual(phrase, "confirm budget change from 500 to 750.5 (increase of 50%)");
    });
  });

  describe("MockClient", () => {
    it("returns injected rows for matching queries", async () => {
      const c = new MockClient();
      c.setResponse("campaign.id = 123", [{ campaign: { id: "123", name: "Test" } }]);
      const rows = await c.query("SELECT campaign.id FROM campaign WHERE campaign.id = 123");
      assert.strictEqual((rows[0] as any).campaign.name, "Test");
    });

    it("returns empty array for unmatched queries", async () => {
      const c = new MockClient();
      const rows = await c.query("SELECT 1");
      assert.strictEqual(rows.length, 0);
    });
  });
});
