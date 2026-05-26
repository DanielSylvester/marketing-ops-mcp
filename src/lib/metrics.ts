/**
 * Channel-agnostic standard KPI calculator.
 *
 * Every performance report across Meta, Google Ads, and LinkedIn
 * normalizes to this single set of metrics.
 */

export interface StandardMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  frequency: number | null;
  engagements: number;
  engagementRate: number | null;
  ctr: number | null;
  cpm: number | null;
  cpc: number | null;
  conversions: number;
  conversionRate: number | null;
  costPerConversion: number | null;
  audiencePenetration: number | null;
  averageDwellTime: number | null;
}

export interface NormalizedRecord {
  impressions?: number;
  clicks?: number;
  spend?: number;
  conversions?: number;
  engagements?: number;
  reach?: number;
  audiencePenetration?: number;
  averageDwellTime?: number;
}

/**
 * Calculates a standardized set of performance metrics from a normalized record.
 *
 * Each channel should map its raw API fields to NormalizedRecord before calling.
 */
export function calculateStandardMetrics(record: NormalizedRecord, estimatedAudienceSize?: number): StandardMetrics {
  const impressions = record.impressions ?? 0;
  const clicks = record.clicks ?? 0;
  const spend = record.spend ?? 0;
  const conversions = record.conversions ?? 0;
  const engagements = record.engagements ?? 0;

  // Reach: use provided value, or fall back to 70% of impressions (industry heuristic)
  const reach = record.reach ?? (impressions > 0 ? Math.round(impressions * 0.7) : 0);

  // Audience penetration: native API value or client-side fallback
  const nativeAudiencePenetration =
    record.audiencePenetration != null ? Number(record.audiencePenetration.toFixed(2)) : null;
  const fallbackAudiencePenetration =
    estimatedAudienceSize && estimatedAudienceSize > 0
      ? Number(((reach / estimatedAudienceSize) * 100).toFixed(2))
      : null;

  return {
    spend,
    impressions,
    clicks,
    reach,
    frequency: reach > 0 ? Number((impressions / reach).toFixed(2)) : null,
    engagements,
    engagementRate: impressions > 0 ? Number(((engagements / impressions) * 100).toFixed(2)) : null,
    ctr: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : null,
    cpm: impressions > 0 ? Number(((spend / impressions) * 1000).toFixed(2)) : null,
    cpc: clicks > 0 ? Number((spend / clicks).toFixed(2)) : null,
    conversions,
    conversionRate: clicks > 0 ? Number(((conversions / clicks) * 100).toFixed(2)) : null,
    costPerConversion: conversions > 0 ? Number((spend / conversions).toFixed(2)) : null,
    audiencePenetration: nativeAudiencePenetration ?? fallbackAudiencePenetration,
    averageDwellTime: record.averageDwellTime != null ? Number(Number(record.averageDwellTime).toFixed(2)) : null,
  };
}

// Demographic / pivot type name mapping (LinkedIn convention, shared)
export const DEMOGRAPHIC_TYPE_MAP: Record<string, string> = {
  MEMBER_JOB_FUNCTION: "Job Function",
  MEMBER_SENIORITY: "Seniority",
  MEMBER_INDUSTRY: "Industry",
  MEMBER_COMPANY_SIZE: "Company Size",
  MEMBER_JOB_TITLE: "Job Title",
  MEMBER_COMPANY: "Company",
  MEMBER_COUNTRY: "Country",
  MEMBER_COUNTRY_V2: "Country",
  MEMBER_REGION: "Region",
  MEMBER_REGION_V2: "Region",
};
