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

// ---------------------------------------------------------------------------
// gads_campaign_overlap
// ---------------------------------------------------------------------------

export const gads_campaign_overlap = {
  name: 'gads_campaign_overlap',
  description: 'Analyze keyword overlap, negative keyword cross-matching, and search-term cannibalization between primary campaigns and their _Secondary counterparts. Auto-detects pairs from a prefix or accepts explicit pairs.',
  inputSchema: z.object({
    campaign_prefix: z.string().optional().describe('Prefix to auto-detect pairs, e.g. "Test_". Finds campaigns where a "<name>_Secondary" also exists.'),
    campaign_pairs: z.array(z.object({ primary: z.string(), secondary: z.string() })).optional().describe('Explicit {primary, secondary} pairs. Overrides auto-detection.'),
    date_range_days: z.number().optional().default(7).describe('Days back for search-term and performance overlap (max 90)'),
  }),
  async handler({ campaign_prefix, campaign_pairs, date_range_days }: {
    campaign_prefix?: string
    campaign_pairs?: { primary: string; secondary: string }[]
    date_range_days?: number
  }) {
    const days = Math.max(1, Math.min(date_range_days ?? 7, 90))
    const end = new Date()
    const start = new Date(end.getTime() - (days - 1) * 86_400_000)
    const isoDate = (d: Date) => d.toISOString().slice(0, 10)

    let pairs: { primary: string; secondary: string }[] = []
    if (campaign_pairs && campaign_pairs.length > 0) {
      pairs = campaign_pairs
    } else if (campaign_prefix) {
      const prefixEscaped = campaign_prefix.replace(/'/g, "\\'")
      const campRows = await client().query<{ campaign: { name: string } }>(`
        SELECT campaign.name
        FROM campaign
        WHERE campaign.name LIKE '${prefixEscaped}%'
          AND campaign.status = 'ENABLED'
        ORDER BY campaign.name
      `)
      const names = campRows.map(r => r.campaign.name)
      const primaryNames = names.filter(n => !n.endsWith('_Secondary'))
      for (const p of primaryNames) {
        const s = `${p}_Secondary`
        if (names.includes(s)) pairs.push({ primary: p, secondary: s })
      }
    } else {
      throw new Error('Either campaign_prefix or campaign_pairs is required')
    }

    if (pairs.length === 0) {
      return { pairs: [], message: 'No campaign pairs found matching the criteria.' }
    }

    const allNames = pairs.flatMap(p => [p.primary, p.secondary])
    const inClause = allNames.map(n => `'${n.replace(/'/g, "\\'")}'`).join(', ')

    // Keywords & negatives
    const kwRows = await client().query<{
      campaign: { name: string }
      adGroup: { name: string }
      adGroupCriterion: { keyword: { text: string; matchType: string }; negative: boolean }
    }>(`
      SELECT campaign.name, ad_group.name,
             ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
             ad_group_criterion.negative
      FROM ad_group_criterion
      WHERE campaign.name IN (${inClause})
        AND ad_group_criterion.type = 'KEYWORD'
        AND campaign.status = 'ENABLED'
        AND ad_group.status = 'ENABLED'
        AND ad_group_criterion.status = 'ENABLED'
    `)

    const keywords = new Map<string, Set<string>>()
    const negatives = new Map<string, Set<string>>()
    const kwDetails = new Map<string, Map<string, { matchType: string; adGroup: string }>>()

    for (const r of kwRows) {
      const camp = r.campaign.name
      const text = r.adGroupCriterion.keyword.text.toLowerCase().trim()
      const match = r.adGroupCriterion.keyword.matchType
      const isNeg = r.adGroupCriterion.negative
      if (isNeg) {
        if (!negatives.has(camp)) negatives.set(camp, new Set())
        negatives.get(camp)!.add(text)
      } else {
        if (!keywords.has(camp)) keywords.set(camp, new Set())
        keywords.get(camp)!.add(text)
        if (!kwDetails.has(camp)) kwDetails.set(camp, new Map())
        kwDetails.get(camp)!.set(text, { matchType: match, adGroup: r.adGroup.name })
      }
    }

    // Search terms
    const stRows = await client().query<{
      campaign: { name: string }
      searchTermView: { searchTerm: string }
      metrics: { costMicros: string; clicks: string; conversions: string }
    }>(`
      SELECT campaign.name, search_term_view.search_term,
             metrics.cost_micros, metrics.clicks, metrics.conversions
      FROM search_term_view
      WHERE campaign.name IN (${inClause})
        AND segments.date BETWEEN '${isoDate(start)}' AND '${isoDate(end)}'
    `)

    const searchTerms = new Map<string, Map<string, { spend: number; clicks: number; conv: number }>>()
    for (const r of stRows) {
      const camp = r.campaign.name
      const term = r.searchTermView.searchTerm.toLowerCase().trim()
      if (!searchTerms.has(camp)) searchTerms.set(camp, new Map())
      const ex = searchTerms.get(camp)!.get(term) ?? { spend: 0, clicks: 0, conv: 0 }
      ex.spend += Number(r.metrics.costMicros) / 1_000_000
      ex.clicks += Number(r.metrics.clicks)
      ex.conv += Number(r.metrics.conversions)
      searchTerms.get(camp)!.set(term, ex)
    }

    // Performance
    const perfRows = await client().query<{
      campaign: { name: string }
      metrics: { costMicros: string; clicks: string; conversions: string }
    }>(`
      SELECT campaign.name, metrics.cost_micros, metrics.clicks, metrics.conversions
      FROM campaign
      WHERE campaign.name IN (${inClause})
        AND segments.date BETWEEN '${isoDate(start)}' AND '${isoDate(end)}'
    `)

    const perf = new Map<string, { spend: number; clicks: number; conv: number }>()
    for (const r of perfRows) {
      perf.set(r.campaign.name, {
        spend: Number(r.metrics.costMicros) / 1_000_000,
        clicks: Number(r.metrics.clicks),
        conv: Number(r.metrics.conversions),
      })
    }

    const results = pairs.map(({ primary, secondary }) => {
      const pKws = keywords.get(primary) ?? new Set<string>()
      const sKws = keywords.get(secondary) ?? new Set<string>()
      const pNegs = negatives.get(primary) ?? new Set<string>()
      const sNegs = negatives.get(secondary) ?? new Set<string>()
      const pPerf = perf.get(primary) ?? { spend: 0, clicks: 0, conv: 0 }
      const sPerf = perf.get(secondary) ?? { spend: 0, clicks: 0, conv: 0 }

      const overlap = [...pKws].filter(k => sKws.has(k)).map(k => {
        const pd = kwDetails.get(primary)?.get(k)
        const sd = kwDetails.get(secondary)?.get(k)
        return { keyword: k, primary_match_type: pd?.matchType, secondary_match_type: sd?.matchType }
      })

      const pBlockedByS = [...pKws].filter(k => sNegs.has(k))
      const sBlockedByP = [...sKws].filter(k => pNegs.has(k))

      const pTerms = searchTerms.get(primary) ?? new Map<string, { spend: number; clicks: number; conv: number }>()
      const sTerms = searchTerms.get(secondary) ?? new Map<string, { spend: number; clicks: number; conv: number }>()
      const sharedTerms = [...pTerms.keys()]
        .filter(t => sTerms.has(t))
        .map(t => ({
          term: t,
          primary_spend: Math.round(pTerms.get(t)!.spend * 100) / 100,
          secondary_spend: Math.round(sTerms.get(t)!.spend * 100) / 100,
          total_spend: Math.round((pTerms.get(t)!.spend + sTerms.get(t)!.spend) * 100) / 100,
          primary_clicks: pTerms.get(t)!.clicks,
          secondary_clicks: sTerms.get(t)!.clicks,
        }))
        .sort((a, b) => b.total_spend - a.total_spend)

      return {
        primary,
        secondary,
        primary_metrics: {
          spend: Math.round(pPerf.spend * 100) / 100,
          clicks: pPerf.clicks,
          conversions: pPerf.conv,
          keyword_count: pKws.size,
          negative_count: pNegs.size,
        },
        secondary_metrics: {
          spend: Math.round(sPerf.spend * 100) / 100,
          clicks: sPerf.clicks,
          conversions: sPerf.conv,
          keyword_count: sKws.size,
          negative_count: sNegs.size,
        },
        keyword_overlap: overlap,
        primary_keywords_blocked_by_secondary: pBlockedByS,
        secondary_keywords_blocked_by_primary: sBlockedByP,
        search_term_overlap: {
          shared_term_count: sharedTerms.length,
          top_shared_terms: sharedTerms.slice(0, 20),
        },
      }
    })

    return {
      pairs: results,
      date_range: { since: isoDate(start), until: isoDate(end), days },
    }
  },
}

export const GOOGLE_ADS_TOOLS = [
  gads_list_campaigns,
  gads_insights,
  gads_search_terms,
  gads_list_negatives,
  gads_add_negative,
  gads_campaign_overlap,
] as const
