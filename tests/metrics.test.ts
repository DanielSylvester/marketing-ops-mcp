import { describe, it } from "node:test";
import assert from "node:assert";
import { calculateStandardMetrics, DEMOGRAPHIC_TYPE_MAP } from "../src/lib/metrics.js";
import { mapLinkedInRecord, mapMetaRecord, mapGoogleAdsRecord } from "../src/lib/mappers.js";

describe("calculateStandardMetrics", () => {
  it("returns zeroed metrics for an empty record", () => {
    const result = calculateStandardMetrics({});
    assert.strictEqual(result.spend, 0);
    assert.strictEqual(result.impressions, 0);
    assert.strictEqual(result.clicks, 0);
    assert.strictEqual(result.reach, 0);
    assert.strictEqual(result.frequency, null);
    assert.strictEqual(result.engagements, 0);
    assert.strictEqual(result.engagementRate, null);
    assert.strictEqual(result.ctr, null);
    assert.strictEqual(result.cpm, null);
    assert.strictEqual(result.cpc, null);
    assert.strictEqual(result.conversions, 0);
    assert.strictEqual(result.conversionRate, null);
    assert.strictEqual(result.costPerConversion, null);
    assert.strictEqual(result.audiencePenetration, null);
    assert.strictEqual(result.averageDwellTime, null);
  });

  it("calculates CTR, CPM, CPC correctly with typical values", () => {
    const result = calculateStandardMetrics({
      impressions: 10000,
      clicks: 150,
      spend: 250,
      engagements: 300,
      conversions: 5,
    });

    assert.strictEqual(result.ctr, 1.5);
    assert.strictEqual(result.cpm, 25);
    assert.strictEqual(result.cpc, 1.67);
    assert.strictEqual(result.engagementRate, 3);
    assert.strictEqual(result.conversionRate, 3.33);
    assert.strictEqual(result.costPerConversion, 50);
  });

  it("falls back to 70% of impressions for reach when not provided", () => {
    const result = calculateStandardMetrics({ impressions: 1000 });
    assert.strictEqual(result.reach, 700);
    assert.strictEqual(result.frequency, 1.43);
  });

  it("uses provided reach when available", () => {
    const result = calculateStandardMetrics({ impressions: 1000, reach: 800 });
    assert.strictEqual(result.reach, 800);
    assert.strictEqual(result.frequency, 1.25);
  });

  it("handles zero impressions without division-by-zero", () => {
    const result = calculateStandardMetrics({ impressions: 0, clicks: 0, spend: 0 });
    assert.strictEqual(result.ctr, null);
    assert.strictEqual(result.cpm, null);
    assert.strictEqual(result.engagementRate, null);
  });

  it("handles zero clicks without division-by-zero", () => {
    const result = calculateStandardMetrics({ impressions: 1000, clicks: 0, spend: 100 });
    assert.strictEqual(result.cpc, null);
    assert.strictEqual(result.conversionRate, null);
  });

  it("calculates audiencePenetration from estimatedAudienceSize fallback", () => {
    const result = calculateStandardMetrics({ reach: 500 }, 10000);
    assert.strictEqual(result.audiencePenetration, 5);
  });

  it("prefers native audiencePenetration over fallback", () => {
    const result = calculateStandardMetrics({ reach: 500, audiencePenetration: 7.5 }, 10000);
    assert.strictEqual(result.audiencePenetration, 7.5);
  });

  it("rounds averageDwellTime to 2 decimals", () => {
    const result = calculateStandardMetrics({ averageDwellTime: 3.14159 });
    assert.strictEqual(result.averageDwellTime, 3.14);
  });
});

describe("DEMOGRAPHIC_TYPE_MAP", () => {
  it("contains expected pivot names", () => {
    assert.strictEqual(DEMOGRAPHIC_TYPE_MAP.MEMBER_JOB_FUNCTION, "Job Function");
    assert.strictEqual(DEMOGRAPHIC_TYPE_MAP.MEMBER_SENIORITY, "Seniority");
    assert.strictEqual(DEMOGRAPHIC_TYPE_MAP.MEMBER_COUNTRY, "Country");
    assert.strictEqual(DEMOGRAPHIC_TYPE_MAP.MEMBER_REGION_V2, "Region");
  });
});

describe("mapLinkedInRecord", () => {
  it("maps raw LinkedIn fields to normalized shape", () => {
    const result = mapLinkedInRecord({
      impressions: 1000,
      clicks: 50,
      costInUsd: "125.50",
      externalWebsiteConversions: 3,
      totalEngagements: 120,
      approximateUniqueImpressions: 700,
      averageDwellTime: 2.5,
    });
    assert.strictEqual(result.impressions, 1000);
    assert.strictEqual(result.clicks, 50);
    assert.strictEqual(result.spend, 125.5);
    assert.strictEqual(result.conversions, 3);
    assert.strictEqual(result.engagements, 120);
    assert.strictEqual(result.reach, 700);
    assert.strictEqual(result.averageDwellTime, 2.5);
  });

  it("falls back to approximateMemberReach", () => {
    const result = mapLinkedInRecord({
      approximateMemberReach: 600,
      impressions: 1000,
    });
    assert.strictEqual(result.reach, 600);
  });

  it("multiplies audiencePenetration by 100", () => {
    const result = mapLinkedInRecord({ audiencePenetration: 0.075 });
    assert.strictEqual(result.audiencePenetration, 7.5);
  });
});

describe("mapMetaRecord", () => {
  it("maps raw Meta fields to normalized shape", () => {
    const result = mapMetaRecord({
      impressions: 5000,
      clicks: 100,
      spend: 200,
      engagement: 250,
      reach: 3500,
    });
    assert.strictEqual(result.impressions, 5000);
    assert.strictEqual(result.clicks, 100);
    assert.strictEqual(result.spend, 200);
    assert.strictEqual(result.engagements, 250);
    assert.strictEqual(result.reach, 3500);
  });

  it("extracts lead conversions from actions array", () => {
    const result = mapMetaRecord({
      actions: [
        { action_type: "onsite_conversion.lead_grouped", value: "15" },
        { action_type: "link_click", value: "100" },
      ],
    });
    assert.strictEqual(result.conversions, 15);
  });

  it("returns 0 conversions when no actions match", () => {
    const result = mapMetaRecord({ actions: [{ action_type: "link_click", value: "50" }] });
    assert.strictEqual(result.conversions, 0);
  });
});

describe("mapGoogleAdsRecord", () => {
  it("maps raw Google Ads metrics to normalized shape", () => {
    const result = mapGoogleAdsRecord({
      metrics: {
        impressions: 8000,
        clicks: 120,
        costMicros: "250000000",
        conversions: 4,
        interactions: 300,
      },
    });
    assert.strictEqual(result.impressions, 8000);
    assert.strictEqual(result.clicks, 120);
    assert.strictEqual(result.spend, 250);
    assert.strictEqual(result.conversions, 4);
    assert.strictEqual(result.engagements, 300);
  });

  it("handles missing metrics gracefully", () => {
    const result = mapGoogleAdsRecord({});
    assert.strictEqual(result.impressions, 0);
    assert.strictEqual(result.spend, 0);
  });
});
