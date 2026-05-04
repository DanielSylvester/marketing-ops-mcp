import { z } from 'zod'
import { GoogleAdsClient } from './client.js'
import { getGoogleAdsConfig } from '../config.js'

let _client: GoogleAdsClient | null = null
function client(): GoogleAdsClient {
  if (!_client) _client = new GoogleAdsClient(getGoogleAdsConfig())
  return _client
}

const DateRange = z.object({
  since: z.string().describe('YYYY-MM-DD inclusive'),
  until: z.string().describe('YYYY-MM-DD inclusive'),
})

// ---------------------------------------------------------------------------
// gads_list_campaigns
// ---------------------------------------------------------------------------

export const gads_list_campaigns = {
  name: 'gads_list_campaigns',
  description: 'List Google Ads campaigns. Optionally filter by status or name prefix (e.g. "SW_" for Smartworks).',
  inputSchema: z.object({
    status: z.enum(['ENABLED', 'PAUSED', 'REMOVED', 'ANY']).optional().default('ANY'),
    prefix: z.string().optional().describe('Match campaign.name LIKE "<prefix>%"'),
  }),
  async handler({ status, prefix }: { status?: 'ENABLED' | 'PAUSED' | 'REMOVED' | 'ANY'; prefix?: string }) {
    const wheres: string[] = []
    if (status && status !== 'ANY') wheres.push(`campaign.status = '${status}'`)
    else wheres.push(`campaign.status != 'REMOVED'`)
    if (prefix) wheres.push(`campaign.name LIKE '${prefix.replace(/'/g, "\\'")}%'`)
    const whereClause = wheres.length ? `WHERE ${wheres.join(' AND ')}` : ''

    const rows = await client().query<{
      campaign: { id: string; name: string; status: string; servingStatus: string; biddingStrategyType: string }
    }>(`
      SELECT campaign.id, campaign.name, campaign.status, campaign.serving_status, campaign.bidding_strategy_type
      FROM campaign
      ${whereClause}
      ORDER BY campaign.name
    `)

    return {
      campaigns: rows.map(r => r.campaign),
      count: rows.length,
    }
  },
}

// ---------------------------------------------------------------------------
// gads_insights
// ---------------------------------------------------------------------------

export const gads_insights = {
  name: 'gads_insights',
  description: 'Performance metrics for Google Ads — campaigns or keywords. Returns spend, impressions, clicks, ctr, conversions per row in the date range.',
  inputSchema: z.object({
    level: z.enum(['campaign', 'keyword']).default('campaign'),
    dateRange: DateRange,
    campaign_filter: z.string().optional().describe('Restrict to campaigns whose name LIKE "<filter>%"'),
  }),
  async handler({ level, dateRange, campaign_filter }: { level: 'campaign' | 'keyword'; dateRange: { since: string; until: string }; campaign_filter?: string }) {
    const wheres: string[] = [
      `segments.date BETWEEN '${dateRange.since}' AND '${dateRange.until}'`,
    ]
    if (campaign_filter) wheres.push(`campaign.name LIKE '${campaign_filter.replace(/'/g, "\\'")}%'`)
    const whereClause = `WHERE ${wheres.join(' AND ')}`

    if (level === 'campaign') {
      const rows = await client().query<{
        campaign: { id: string; name: string }
        metrics: { impressions: string; clicks: string; costMicros: string; ctr: string; conversions: string }
      }>(`
        SELECT campaign.id, campaign.name,
               metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.ctr, metrics.conversions
        FROM campaign
        ${whereClause}
        ORDER BY metrics.cost_micros DESC
      `)
      return {
        rows: rows.map(r => ({
          campaign_id: r.campaign.id,
          campaign_name: r.campaign.name,
          impressions: Number(r.metrics.impressions ?? 0),
          clicks: Number(r.metrics.clicks ?? 0),
          spend: Number(r.metrics.costMicros ?? 0) / 1_000_000,
          ctr: Number(r.metrics.ctr ?? 0),
          conversions: Number(r.metrics.conversions ?? 0),
        })),
      }
    }

    const rows = await client().query<{
      campaign: { name: string }
      adGroupCriterion: { keyword: { text: string; matchType: string } }
      metrics: { impressions: string; clicks: string; costMicros: string; conversions: string }
    }>(`
      SELECT campaign.name, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
             metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
      FROM keyword_view
      ${whereClause}
      AND ad_group_criterion.status != 'REMOVED'
      ORDER BY metrics.cost_micros DESC
      LIMIT 200
    `)
    return {
      rows: rows.map(r => ({
        campaign_name: r.campaign.name,
        keyword: r.adGroupCriterion.keyword.text,
        match_type: r.adGroupCriterion.keyword.matchType,
        impressions: Number(r.metrics.impressions ?? 0),
        clicks: Number(r.metrics.clicks ?? 0),
        spend: Number(r.metrics.costMicros ?? 0) / 1_000_000,
        conversions: Number(r.metrics.conversions ?? 0),
      })),
    }
  },
}

// ---------------------------------------------------------------------------
// gads_search_terms
// ---------------------------------------------------------------------------

export const gads_search_terms = {
  name: 'gads_search_terms',
  description: 'Search-term performance — what users actually typed when ads showed. Useful for finding negatives.',
  inputSchema: z.object({
    dateRange: DateRange,
    campaign_filter: z.string().optional(),
    min_spend: z.number().optional().default(0).describe('Filter to terms that spent at least this much (in account currency, not micros)'),
  }),
  async handler({ dateRange, campaign_filter, min_spend }: { dateRange: { since: string; until: string }; campaign_filter?: string; min_spend?: number }) {
    const wheres: string[] = [
      `segments.date BETWEEN '${dateRange.since}' AND '${dateRange.until}'`,
    ]
    if (campaign_filter) wheres.push(`campaign.name LIKE '${campaign_filter.replace(/'/g, "\\'")}%'`)
    const whereClause = `WHERE ${wheres.join(' AND ')}`

    const rows = await client().query<{
      campaign: { id: string; name: string }
      searchTermView: { searchTerm: string }
      metrics: { impressions: string; clicks: string; costMicros: string; conversions: string }
    }>(`
      SELECT campaign.id, campaign.name, search_term_view.search_term,
             metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
      FROM search_term_view
      ${whereClause}
      ORDER BY metrics.cost_micros DESC
      LIMIT 500
    `)

    const min = min_spend ?? 0
    const out = rows
      .map(r => ({
        campaign_id: r.campaign.id,
        campaign_name: r.campaign.name,
        search_term: r.searchTermView.searchTerm,
        impressions: Number(r.metrics.impressions ?? 0),
        clicks: Number(r.metrics.clicks ?? 0),
        spend: Number(r.metrics.costMicros ?? 0) / 1_000_000,
        conversions: Number(r.metrics.conversions ?? 0),
      }))
      .filter(r => r.spend >= min)

    return { rows: out, count: out.length }
  },
}

// ---------------------------------------------------------------------------
// gads_list_negatives
// ---------------------------------------------------------------------------

export const gads_list_negatives = {
  name: 'gads_list_negatives',
  description: 'List campaign-level negative keywords. Optionally filter by campaign.',
  inputSchema: z.object({
    campaign_id: z.string().optional(),
  }),
  async handler({ campaign_id }: { campaign_id?: string }) {
    const wheres: string[] = [`campaign_criterion.type = 'KEYWORD'`, `campaign_criterion.negative = TRUE`]
    if (campaign_id) wheres.push(`campaign.id = ${campaign_id}`)
    const whereClause = `WHERE ${wheres.join(' AND ')}`

    const rows = await client().query<{
      campaign: { id: string; name: string }
      campaignCriterion: { resourceName: string; keyword: { text: string; matchType: string } }
    }>(`
      SELECT campaign.id, campaign.name,
             campaign_criterion.resource_name,
             campaign_criterion.keyword.text, campaign_criterion.keyword.match_type
      FROM campaign_criterion
      ${whereClause}
      ORDER BY campaign.name, campaign_criterion.keyword.text
    `)

    return {
      negatives: rows.map(r => ({
        campaign_id: r.campaign.id,
        campaign_name: r.campaign.name,
        text: r.campaignCriterion.keyword.text,
        match_type: r.campaignCriterion.keyword.matchType,
        resource_name: r.campaignCriterion.resourceName,
      })),
      count: rows.length,
    }
  },
}

// ---------------------------------------------------------------------------
// gads_add_negative — MUTATION
// ---------------------------------------------------------------------------

export const gads_add_negative = {
  name: 'gads_add_negative',
  description: 'Add a campaign-level negative keyword. MUTATION — modifies the live ad account. Match types: EXACT, PHRASE, BROAD.',
  inputSchema: z.object({
    campaign_id: z.string(),
    text: z.string().describe('The keyword to negate'),
    match_type: z.enum(['EXACT', 'PHRASE', 'BROAD']).default('PHRASE'),
  }),
  async handler({ campaign_id, text, match_type }: { campaign_id: string; text: string; match_type: 'EXACT' | 'PHRASE' | 'BROAD' }) {
    const c = client()
    const result = await c.mutate([
      {
        campaignCriterionOperation: {
          create: {
            campaign: `customers/${c.customerId}/campaigns/${campaign_id}`,
            negative: true,
            keyword: { text, matchType: match_type },
          },
        },
      },
    ])
    return { ok: true, result }
  },
}

export const GOOGLE_ADS_TOOLS = [
  gads_list_campaigns,
  gads_insights,
  gads_search_terms,
  gads_list_negatives,
  gads_add_negative,
] as const
