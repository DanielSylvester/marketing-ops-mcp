/**
 * Channel-specific field mappers.
 *
 * Each advertising platform uses different field names for the same concepts.
 * These functions convert raw API records into the channel-agnostic NormalizedRecord
 * shape so that calculateStandardMetrics() can be used everywhere.
 */

import type { NormalizedRecord } from "./metrics.js";

// ── LinkedIn ───────────────────────────────────────────────────────────────

export function mapLinkedInRecord(record: Record<string, unknown>): NormalizedRecord {
  return {
    impressions: Number(record.impressions ?? 0),
    clicks: Number(record.clicks ?? 0),
    spend: parseFloat(String(record.costInUsd ?? 0)),
    conversions: Number(record.externalWebsiteConversions ?? 0),
    engagements: Number(record.totalEngagements ?? 0),
    reach: Number(record.approximateUniqueImpressions ?? 0) || Number(record.approximateMemberReach ?? 0) || undefined,
    audiencePenetration:
      record.audiencePenetration != null ? Number((Number(record.audiencePenetration) * 100).toFixed(2)) : undefined,
    averageDwellTime: record.averageDwellTime != null ? Number(record.averageDwellTime) : undefined,
  };
}

// ── Meta ───────────────────────────────────────────────────────────────────

function extractMetaSpend(record: Record<string, unknown>): number {
  // Meta reports spend in account currency (e.g. INR, SGD)
  const spend = Number(record.spend ?? 0);
  return spend;
}

function extractMetaConversions(record: Record<string, unknown>): number {
  const actions = record.actions;
  if (!Array.isArray(actions)) return 0;
  // Look for standard conversion action types
  const convTypes = [
    "onsite_conversion.lead_grouped",
    "lead",
    "offsite_conversion",
    "purchase",
    "complete_registration",
  ];
  for (const type of convTypes) {
    const found = actions.find(
      (a: unknown) => typeof a === "object" && a !== null && (a as Record<string, unknown>).action_type === type
    );
    if (found) return Math.round(Number((found as Record<string, unknown>).value ?? 0));
  }
  return 0;
}

export function mapMetaRecord(record: Record<string, unknown>): NormalizedRecord {
  return {
    impressions: Number(record.impressions ?? 0),
    clicks: Number(record.clicks ?? 0),
    spend: extractMetaSpend(record),
    conversions: extractMetaConversions(record),
    engagements: Number(record.engagement ?? record.engagements ?? 0),
    reach: Number(record.reach ?? 0) || undefined,
  };
}

// ── Google Ads ─────────────────────────────────────────────────────────────

export function mapGoogleAdsRecord(record: Record<string, unknown>): NormalizedRecord {
  const metrics =
    typeof record.metrics === "object" && record.metrics !== null ? (record.metrics as Record<string, unknown>) : {};

  const costMicros = Number(metrics.costMicros ?? 0);
  const spend = costMicros / 1_000_000;

  return {
    impressions: Number(metrics.impressions ?? 0),
    clicks: Number(metrics.clicks ?? 0),
    spend,
    conversions: Number(metrics.conversions ?? 0),
    engagements: Number(metrics.interactions ?? 0),
    reach: undefined, // Google Ads does not expose reach in GAQL for most reports
    averageDwellTime: undefined, // Not available in Google Ads
  };
}
