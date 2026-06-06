import { z } from "zod";
import { GoogleAdsClient } from "./client.js";
import { getGoogleAdsConfig } from "../config.js";
import { isDryRun, shouldExecute, dryRunResult } from "../safety.js";

let _client: GoogleAdsClient | null = null;
function client(): GoogleAdsClient {
  if (!_client) _client = new GoogleAdsClient(getGoogleAdsConfig());
  return _client;
}

function getClient(customerId?: string): GoogleAdsClient {
  if (!customerId) return client()
  const cfg = getGoogleAdsConfig()
  const clean = customerId.replace(/-/g, '')
  if (clean === cfg.customerId.replace(/-/g, '')) return client()
  return new GoogleAdsClient({ ...cfg, customerId: clean })
}

const DateRange = z.object({
  since: z.string().describe("YYYY-MM-DD inclusive"),
  until: z.string().describe("YYYY-MM-DD inclusive"),
});

// ---------------------------------------------------------------------------
// gads_gaql_search — universal GAQL
// ---------------------------------------------------------------------------

export const gads_gaql_search = {
  name: "gads_gaql_search",
  description:
    "[READ] Run any Google Ads Query Language (GAQL) query. Covers the entire Google Ads read surface: every resource, every metric, every segment. Returns up to max_rows (default 1000, hard cap 10000).",
  inputSchema: z.object({
    query: z
      .string()
      .describe('GAQL query, e.g. SELECT campaign.id, campaign.name FROM campaign WHERE campaign.status = "ENABLED"'),
    max_rows: z.number().optional().default(1000).describe("Max rows to return (default 1000, hard cap 10000)"),
  }),
  async handler({ query, max_rows }: { query: string; max_rows?: number }) {
    const cap = Math.min(Math.max(1, Math.trunc(max_rows ?? 1000)), 10_000);
    // Only append LIMIT if the query doesn't already have one
    const finalQuery = /\bLIMIT\s+\d+\b/i.test(query) ? query : `${query.trim().replace(/;\s*$/, "")} LIMIT ${cap}`;
    const rows = await client().query<Record<string, unknown>>(finalQuery);
    return { rows, row_count: rows.length, query: finalQuery };
  },
};

// ---------------------------------------------------------------------------
// gads_list_ad_groups
// ---------------------------------------------------------------------------

export const gads_list_ad_groups = {
  name: "gads_list_ad_groups",
  description: "[READ] List ad groups. Optionally scoped to a specific campaign.",
  inputSchema: z.object({
    campaign_id: z.string().optional().describe("Filter to one campaign"),
    status: z.enum(["ENABLED", "PAUSED", "REMOVED"]).optional(),
  }),
  async handler({ campaign_id, status }: { campaign_id?: string; status?: "ENABLED" | "PAUSED" | "REMOVED" }) {
    const conds: string[] = [];
    if (campaign_id) conds.push(`campaign.id = ${campaign_id}`);
    if (status) conds.push(`ad_group.status = '${status}'`);
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    const rows = await client().query<{
      adGroup: { id: string; name: string; status: string; type: string; cpcBidMicros: string };
      campaign: { id: string; name: string };
    }>(`
      SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.type, ad_group.cpc_bid_micros,
             campaign.id, campaign.name
      FROM ad_group
      ${where}
      ORDER BY campaign.name, ad_group.name
    `);

    return {
      ad_groups: rows.map((r) => ({
        id: r.adGroup.id,
        name: r.adGroup.name,
        status: r.adGroup.status,
        type: r.adGroup.type,
        cpc_bid: Number(r.adGroup.cpcBidMicros) / 1_000_000,
        campaign_id: r.campaign.id,
        campaign_name: r.campaign.name,
      })),
      count: rows.length,
    };
  },
};

// ---------------------------------------------------------------------------
// gads_list_keywords
// ---------------------------------------------------------------------------

export const gads_list_keywords = {
  name: "gads_list_keywords",
  description:
    "[READ] List keywords with match type and negative flag. Use enabled_only_at_every_level=true to filter to truly active keywords (campaign + ad group + keyword all ENABLED).",
  inputSchema: z.object({
    campaign_id: z.string().optional(),
    ad_group_id: z.string().optional(),
    status: z.enum(["ENABLED", "PAUSED", "REMOVED"]).optional(),
    match_type: z.enum(["EXACT", "PHRASE", "BROAD"]).optional(),
    negatives_only: z.boolean().optional().describe("Show only negative keywords"),
    enabled_only_at_every_level: z.boolean().optional().describe("Require campaign + ad group + keyword all ENABLED"),
  }),
  async handler({
    campaign_id,
    ad_group_id,
    status,
    match_type,
    negatives_only,
    enabled_only_at_every_level,
  }: {
    campaign_id?: string;
    ad_group_id?: string;
    status?: "ENABLED" | "PAUSED" | "REMOVED";
    match_type?: "EXACT" | "PHRASE" | "BROAD";
    negatives_only?: boolean;
    enabled_only_at_every_level?: boolean;
  }) {
    const conds: string[] = [`ad_group_criterion.type = 'KEYWORD'`];
    if (campaign_id) conds.push(`campaign.id = ${campaign_id}`);
    if (ad_group_id) conds.push(`ad_group.id = ${ad_group_id}`);
    if (status) conds.push(`ad_group_criterion.status = '${status}'`);
    if (match_type) conds.push(`ad_group_criterion.keyword.match_type = '${match_type}'`);
    if (typeof negatives_only === "boolean")
      conds.push(`ad_group_criterion.negative = ${negatives_only ? "TRUE" : "FALSE"}`);
    if (enabled_only_at_every_level) {
      conds.push(`campaign.status = 'ENABLED'`);
      conds.push(`ad_group.status = 'ENABLED'`);
      conds.push(`ad_group_criterion.status = 'ENABLED'`);
    }

    const rows = await client().query<{
      adGroupCriterion: {
        criterionId: string;
        keyword: { text: string; matchType: string };
        status: string;
        negative: boolean;
      };
      adGroup: { id: string; name: string };
      campaign: { id: string; name: string };
    }>(`
      SELECT ad_group_criterion.criterion_id,
             ad_group_criterion.keyword.text,
             ad_group_criterion.keyword.match_type,
             ad_group_criterion.status,
             ad_group_criterion.negative,
             ad_group.id, ad_group.name,
             campaign.id, campaign.name
      FROM keyword_view
      WHERE ${conds.join(" AND ")}
      ORDER BY campaign.name, ad_group.name, ad_group_criterion.keyword.text
    `);

    return {
      keywords: rows.map((r) => ({
        criterion_id: r.adGroupCriterion.criterionId,
        text: r.adGroupCriterion.keyword.text,
        match_type: r.adGroupCriterion.keyword.matchType,
        status: r.adGroupCriterion.status,
        negative: r.adGroupCriterion.negative,
        ad_group_id: r.adGroup.id,
        ad_group_name: r.adGroup.name,
        campaign_id: r.campaign.id,
        campaign_name: r.campaign.name,
      })),
      count: rows.length,
    };
  },
};

// ---------------------------------------------------------------------------
// gads_get_resource_metadata
// ---------------------------------------------------------------------------

export const gads_get_resource_metadata = {
  name: "gads_get_resource_metadata",
  description:
    "[READ] Returns the real selectable, filterable and sortable fields for a Google Ads resource (for example 'campaign' or 'ad_group'), plus the metrics and segments that can be queried alongside it. Use this before writing a gads_gaql_search query and build the query only from the fields it returns. Do not guess field names.",
  inputSchema: z.object({
    resource_name: z.string().describe("A Google Ads resource, e.g. 'campaign', 'ad_group', 'keyword_view'."),
  }),
  async handler({ resource_name }: { resource_name: string }) {
    const resource = resource_name.trim().toLowerCase();
    const c = client();

    // Resource node: category, compatible metrics/segments
    const nodeRows = await c.searchFields(
      `SELECT name, category, metrics, segments, attribute_resources WHERE name = '${resource}'`
    );
    const node = nodeRows[0] as
      | { category?: string; metrics?: string[]; segments?: string[]; attributeResources?: string[] }
      | undefined;
    if (!node || node.category !== "RESOURCE") {
      throw new Error(`'${resource}' is not a queryable Google Ads resource`);
    }

    // Attribute fields with capability flags
    const fieldRows = await c.searchFields(
      `SELECT name, selectable, filterable, sortable, data_type, is_repeated WHERE name LIKE '${resource}.%' AND category = 'ATTRIBUTE'`
    );

    const selectable: string[] = [];
    const filterable: string[] = [];
    const sortable: string[] = [];
    const fields: Record<string, unknown>[] = [];

    for (const r of fieldRows) {
      const f = r as {
        name?: string;
        selectable?: boolean;
        filterable?: boolean;
        sortable?: boolean;
        dataType?: string;
        isRepeated?: boolean;
      };
      if (f.name) {
        if (f.selectable) selectable.push(f.name);
        if (f.filterable) filterable.push(f.name);
        if (f.sortable) sortable.push(f.name);
        fields.push({
          name: f.name,
          data_type: f.dataType,
          is_repeated: f.isRepeated,
          selectable: f.selectable,
          filterable: f.filterable,
          sortable: f.sortable,
        });
      }
    }

    return {
      resource,
      category: node.category,
      compatible_metrics: node.metrics ?? [],
      compatible_segments: node.segments ?? [],
      attribute_resources: node.attributeResources ?? [],
      selectable_count: selectable.length,
      filterable_count: filterable.length,
      sortable_count: sortable.length,
      fields: fields.slice(0, 200), // cap to avoid huge responses
    };
  },
};

// ---------------------------------------------------------------------------
// gads_list_campaigns
// ---------------------------------------------------------------------------

export const gads_list_campaigns = {
  name: "gads_list_campaigns",
  description: 'List Google Ads campaigns. Optionally filter by status or name prefix (e.g. "SW_" for Smartworks).',
  inputSchema: z.object({
    status: z.enum(["ENABLED", "PAUSED", "REMOVED", "ANY"]).optional().default("ANY"),
    prefix: z.string().optional().describe('Match campaign.name LIKE "<prefix>%"'),
  }),
  async handler({ status, prefix }: { status?: "ENABLED" | "PAUSED" | "REMOVED" | "ANY"; prefix?: string }) {
    const wheres: string[] = [];
    if (status && status !== "ANY") wheres.push(`campaign.status = '${status}'`);
    else wheres.push(`campaign.status != 'REMOVED'`);
    if (prefix) wheres.push(`campaign.name LIKE '${prefix.replace(/'/g, "\\'")}%'`);
    const whereClause = wheres.length ? `WHERE ${wheres.join(" AND ")}` : "";

    const rows = await client().query<{
      campaign: { id: string; name: string; status: string; servingStatus: string; biddingStrategyType: string };
    }>(`
      SELECT campaign.id, campaign.name, campaign.status, campaign.serving_status, campaign.bidding_strategy_type
      FROM campaign
      ${whereClause}
      ORDER BY campaign.name
    `);

    return {
      campaigns: rows.map((r) => r.campaign),
      count: rows.length,
    };
  },
};

// ---------------------------------------------------------------------------
// gads_insights
// ---------------------------------------------------------------------------

export const gads_insights = {
  name: "gads_insights",
  description:
    "Performance metrics for Google Ads — campaigns or keywords. Returns spend, impressions, clicks, ctr, conversions per row in the date range.",
  inputSchema: z.object({
    level: z.enum(["campaign", "keyword"]).default("campaign"),
    dateRange: DateRange,
    campaign_filter: z.string().optional().describe('Restrict to campaigns whose name LIKE "<filter>%"'),
  }),
  async handler({
    level,
    dateRange,
    campaign_filter,
  }: {
    level: "campaign" | "keyword";
    dateRange: { since: string; until: string };
    campaign_filter?: string;
  }) {
    const wheres: string[] = [`segments.date BETWEEN '${dateRange.since}' AND '${dateRange.until}'`];
    if (campaign_filter) wheres.push(`campaign.name LIKE '${campaign_filter.replace(/'/g, "\\'")}%'`);
    const whereClause = `WHERE ${wheres.join(" AND ")}`;

    if (level === "campaign") {
      const rows = await client().query<{
        campaign: { id: string; name: string };
        metrics: { impressions: string; clicks: string; costMicros: string; ctr: string; conversions: string };
      }>(`
        SELECT campaign.id, campaign.name,
               metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.ctr, metrics.conversions
        FROM campaign
        ${whereClause}
        ORDER BY metrics.cost_micros DESC
      `);
      return {
        rows: rows.map((r) => ({
          campaign_id: r.campaign.id,
          campaign_name: r.campaign.name,
          impressions: Number(r.metrics.impressions ?? 0),
          clicks: Number(r.metrics.clicks ?? 0),
          spend: Number(r.metrics.costMicros ?? 0) / 1_000_000,
          ctr: Number(r.metrics.ctr ?? 0),
          conversions: Number(r.metrics.conversions ?? 0),
        })),
      };
    }

    const rows = await client().query<{
      campaign: { name: string };
      adGroupCriterion: { keyword: { text: string; matchType: string } };
      metrics: { impressions: string; clicks: string; costMicros: string; conversions: string };
    }>(`
      SELECT campaign.name, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
             metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
      FROM keyword_view
      ${whereClause}
      AND ad_group_criterion.status != 'REMOVED'
      ORDER BY metrics.cost_micros DESC
      LIMIT 200
    `);
    return {
      rows: rows.map((r) => ({
        campaign_name: r.campaign.name,
        keyword: r.adGroupCriterion.keyword.text,
        match_type: r.adGroupCriterion.keyword.matchType,
        impressions: Number(r.metrics.impressions ?? 0),
        clicks: Number(r.metrics.clicks ?? 0),
        spend: Number(r.metrics.costMicros ?? 0) / 1_000_000,
        conversions: Number(r.metrics.conversions ?? 0),
      })),
    };
  },
};

// ---------------------------------------------------------------------------
// gads_search_terms
// ---------------------------------------------------------------------------

export const gads_search_terms = {
  name: "gads_search_terms",
  description: "Search-term performance — what users actually typed when ads showed. Useful for finding negatives.",
  inputSchema: z.object({
    dateRange: DateRange,
    campaign_filter: z.string().optional(),
    min_spend: z
      .number()
      .optional()
      .default(0)
      .describe("Filter to terms that spent at least this much (in account currency, not micros)"),
  }),
  async handler({
    dateRange,
    campaign_filter,
    min_spend,
  }: {
    dateRange: { since: string; until: string };
    campaign_filter?: string;
    min_spend?: number;
  }) {
    const wheres: string[] = [`segments.date BETWEEN '${dateRange.since}' AND '${dateRange.until}'`];
    if (campaign_filter) wheres.push(`campaign.name LIKE '${campaign_filter.replace(/'/g, "\\'")}%'`);
    const whereClause = `WHERE ${wheres.join(" AND ")}`;

    const rows = await client().query<{
      campaign: { id: string; name: string };
      searchTermView: { searchTerm: string };
      metrics: { impressions: string; clicks: string; costMicros: string; conversions: string };
    }>(`
      SELECT campaign.id, campaign.name, search_term_view.search_term,
             metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
      FROM search_term_view
      ${whereClause}
      ORDER BY metrics.cost_micros DESC
      LIMIT 500
    `);

    const min = min_spend ?? 0;
    const out = rows
      .map((r) => ({
        campaign_id: r.campaign.id,
        campaign_name: r.campaign.name,
        search_term: r.searchTermView.searchTerm,
        impressions: Number(r.metrics.impressions ?? 0),
        clicks: Number(r.metrics.clicks ?? 0),
        spend: Number(r.metrics.costMicros ?? 0) / 1_000_000,
        conversions: Number(r.metrics.conversions ?? 0),
      }))
      .filter((r) => r.spend >= min);

    return { rows: out, count: out.length };
  },
};

// ---------------------------------------------------------------------------
// gads_list_negatives
// ---------------------------------------------------------------------------

export const gads_list_negatives = {
  name: "gads_list_negatives",
  description: "List campaign-level negative keywords. Optionally filter by campaign.",
  inputSchema: z.object({
    campaign_id: z.string().optional(),
  }),
  async handler({ campaign_id }: { campaign_id?: string }) {
    const wheres: string[] = [`campaign_criterion.type = 'KEYWORD'`, `campaign_criterion.negative = TRUE`];
    if (campaign_id) wheres.push(`campaign.id = ${campaign_id}`);
    const whereClause = `WHERE ${wheres.join(" AND ")}`;

    const rows = await client().query<{
      campaign: { id: string; name: string };
      campaignCriterion: { resourceName: string; keyword: { text: string; matchType: string } };
    }>(`
      SELECT campaign.id, campaign.name,
             campaign_criterion.resource_name,
             campaign_criterion.keyword.text, campaign_criterion.keyword.match_type
      FROM campaign_criterion
      ${whereClause}
      ORDER BY campaign.name, campaign_criterion.keyword.text
    `);

    return {
      negatives: rows.map((r) => ({
        campaign_id: r.campaign.id,
        campaign_name: r.campaign.name,
        text: r.campaignCriterion.keyword.text,
        match_type: r.campaignCriterion.keyword.matchType,
        resource_name: r.campaignCriterion.resourceName,
      })),
      count: rows.length,
    };
  },
};

// ---------------------------------------------------------------------------
// gads_add_negative — MUTATION
// ---------------------------------------------------------------------------

export const gads_add_negative = {
  name: "gads_add_negative",
  description:
    "Add a campaign-level negative keyword. MUTATION — modifies the live ad account. Match types: EXACT, PHRASE, BROAD. Safe by default: dry_run is true unless you set it to false, so by default the tool returns a preview and writes nothing.",
  inputSchema: z.object({
    campaign_id: z.string(),
    text: z.string().describe("The keyword to negate"),
    match_type: z.enum(["EXACT", "PHRASE", "BROAD"]).default("PHRASE"),
    dry_run: z
      .boolean()
      .optional()
      .default(true)
      .describe("Default true (preview only). Pass false to apply."),
  }),
  async handler({
    campaign_id,
    text,
    match_type,
    dry_run,
  }: {
    campaign_id: string;
    text: string;
    match_type: "EXACT" | "PHRASE" | "BROAD";
    dry_run?: boolean;
  }) {
    const preview = {
      action: "add_negative_keyword",
      campaign_id,
      text,
      match_type,
      negative: true,
    };

    if (isDryRun({ dry_run })) {
      return dryRunResult(preview);
    }
    const gate = shouldExecute({ toolName: 'gads_add_negative' });
    if (!gate.execute) {
      return { applied: false, reason: gate.reason, preview };
    }

    const c = client();
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
    ]);
    return { ok: true, result };
  },
};

// ---------------------------------------------------------------------------
// gads_add_negative_keyword — MUTATION (ad group level)
// ---------------------------------------------------------------------------

export const gads_add_negative_keyword = {
  name: "gads_add_negative_keyword",
  description:
    "Add an ad group-level negative keyword. MUTATION — modifies the live ad account. Match types: EXACT, PHRASE, BROAD. Safe by default: dry_run is true unless you set it to false, so by default the tool returns a preview and writes nothing. The call is idempotent: if the exact same negative keyword already exists on the ad group, it does nothing.",
  inputSchema: z.object({
    ad_group_id: z.string().describe("Numeric Google Ads ad group ID."),
    customer_id: z.string().optional().describe("10-digit customer ID (no dashes). Falls back to GOOGLE_ADS_CUSTOMER_ID."),
    text: z.string().describe("The keyword text to negate"),
    match_type: z.enum(["EXACT", "PHRASE", "BROAD"]).default("PHRASE"),
    dry_run: z
      .boolean()
      .optional()
      .default(true)
      .describe("Default true (preview only). Pass false to apply."),
  }),
  async handler({
    ad_group_id,
    customer_id,
    text,
    match_type,
    dry_run,
  }: {
    ad_group_id: string;
    customer_id?: string;
    text: string;
    match_type: "EXACT" | "PHRASE" | "BROAD";
    dry_run?: boolean;
  }) {
    const c = getClient(customer_id);
    const agId = ad_group_id.replace(/[^\d]/g, "");
    const keywordText = text.trim();
    if (!keywordText) throw new Error("text is required");
    const matchType = match_type;

    // Resolve ad group resource name
    const agRows = await c.query<{
      adGroup: { resourceName: string; name: string };
      campaign: { name: string };
    }>(
      `SELECT ad_group.resource_name, ad_group.name, campaign.name
       FROM ad_group
       WHERE ad_group.id = ${agId}`
    );
    const ag = agRows[0]?.adGroup;
    const campaignName = agRows[0]?.campaign?.name ?? "";
    if (!ag?.resourceName) {
      throw new Error(`ad_group_id ${agId} not found`);
    }

    // Check if the negative already exists on this ad group
    const existing = await c.query<{
      adGroupCriterion: {
        resourceName: string;
        keyword: { text: string; matchType: string };
      };
    }>(
      `SELECT ad_group_criterion.resource_name, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type
       FROM ad_group_criterion
       WHERE ad_group.id = ${agId}
         AND ad_group_criterion.type = 'KEYWORD'
         AND ad_group_criterion.negative = TRUE
         AND ad_group_criterion.keyword.text = '${keywordText.replace(/'/g, "\\'")}'
         AND ad_group_criterion.status != 'REMOVED'`
    );
    if (existing.length > 0) {
      const dup = existing[0].adGroupCriterion;
      return {
        applied: false,
        idempotent: true,
        ad_group: { id: agId, name: ag.name },
        campaign: campaignName,
        keyword: dup.keyword?.text ?? keywordText,
        match_type: dup.keyword?.matchType ?? matchType,
        message: `Negative keyword already exists on this ad group; no change.`,
      };
    }

    const preview = {
      ad_group: { id: agId, name: ag.name, resource_name: ag.resourceName },
      campaign: campaignName,
      keyword: keywordText,
      match_type: matchType,
      negative: true,
    };

    if (isDryRun({ dry_run })) {
      return dryRunResult(preview);
    }

    const gate = shouldExecute({ toolName: "gads_add_negative_keyword" });
    if (!gate.execute) {
      return { applied: false, reason: gate.reason, preview };
    }

    const result = await c.mutate([
      {
        adGroupCriterionOperation: {
          create: {
            adGroup: ag.resourceName,
            negative: true,
            keyword: { text: keywordText, matchType },
          },
        },
      },
    ]);

    return { applied: true, dry_run: false, ...preview, result };
  },
};

// ---------------------------------------------------------------------------
// gads_campaign_overlap
// ---------------------------------------------------------------------------

export const gads_campaign_overlap = {
  name: "gads_campaign_overlap",
  description:
    "Analyze keyword overlap, negative keyword cross-matching, and search-term cannibalization between primary campaigns and their _Secondary counterparts. Auto-detects pairs from a prefix or accepts explicit pairs.",
  inputSchema: z.object({
    campaign_prefix: z
      .string()
      .optional()
      .describe('Prefix to auto-detect pairs, e.g. "Test_". Finds campaigns where a "<name>_Secondary" also exists.'),
    campaign_pairs: z
      .array(z.object({ primary: z.string(), secondary: z.string() }))
      .optional()
      .describe("Explicit {primary, secondary} pairs. Overrides auto-detection."),
    date_range_days: z
      .number()
      .optional()
      .default(7)
      .describe("Days back for search-term and performance overlap (max 90)"),
  }),
  async handler({
    campaign_prefix,
    campaign_pairs,
    date_range_days,
  }: {
    campaign_prefix?: string;
    campaign_pairs?: { primary: string; secondary: string }[];
    date_range_days?: number;
  }) {
    const days = Math.max(1, Math.min(date_range_days ?? 7, 90));
    const end = new Date();
    const start = new Date(end.getTime() - (days - 1) * 86_400_000);
    const isoDate = (d: Date) => d.toISOString().slice(0, 10);

    let pairs: { primary: string; secondary: string }[] = [];
    if (campaign_pairs && campaign_pairs.length > 0) {
      pairs = campaign_pairs;
    } else if (campaign_prefix) {
      const prefixEscaped = campaign_prefix.replace(/'/g, "\\'");
      const campRows = await client().query<{ campaign: { name: string } }>(`
        SELECT campaign.name
        FROM campaign
        WHERE campaign.name LIKE '${prefixEscaped}%'
          AND campaign.status = 'ENABLED'
        ORDER BY campaign.name
      `);
      const names = campRows.map((r) => r.campaign.name);
      const primaryNames = names.filter((n) => !n.endsWith("_Secondary"));
      for (const p of primaryNames) {
        const s = `${p}_Secondary`;
        if (names.includes(s)) pairs.push({ primary: p, secondary: s });
      }
    } else {
      throw new Error("Either campaign_prefix or campaign_pairs is required");
    }

    if (pairs.length === 0) {
      return { pairs: [], message: "No campaign pairs found matching the criteria." };
    }

    const allNames = pairs.flatMap((p) => [p.primary, p.secondary]);
    const inClause = allNames.map((n) => `'${n.replace(/'/g, "\\'")}'`).join(", ");

    // Keywords & negatives
    const kwRows = await client().query<{
      campaign: { name: string };
      adGroup: { name: string };
      adGroupCriterion: { keyword: { text: string; matchType: string }; negative: boolean };
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
    `);

    const keywords = new Map<string, Set<string>>();
    const negatives = new Map<string, Set<string>>();
    const kwDetails = new Map<string, Map<string, { matchType: string; adGroup: string }>>();

    for (const r of kwRows) {
      const camp = r.campaign.name;
      const text = r.adGroupCriterion.keyword.text.toLowerCase().trim();
      const match = r.adGroupCriterion.keyword.matchType;
      const isNeg = r.adGroupCriterion.negative;
      if (isNeg) {
        if (!negatives.has(camp)) negatives.set(camp, new Set());
        negatives.get(camp)!.add(text);
      } else {
        if (!keywords.has(camp)) keywords.set(camp, new Set());
        keywords.get(camp)!.add(text);
        if (!kwDetails.has(camp)) kwDetails.set(camp, new Map());
        kwDetails.get(camp)!.set(text, { matchType: match, adGroup: r.adGroup.name });
      }
    }

    // Search terms
    const stRows = await client().query<{
      campaign: { name: string };
      searchTermView: { searchTerm: string };
      metrics: { costMicros: string; clicks: string; conversions: string };
    }>(`
      SELECT campaign.name, search_term_view.search_term,
             metrics.cost_micros, metrics.clicks, metrics.conversions
      FROM search_term_view
      WHERE campaign.name IN (${inClause})
        AND segments.date BETWEEN '${isoDate(start)}' AND '${isoDate(end)}'
    `);

    const searchTerms = new Map<string, Map<string, { spend: number; clicks: number; conv: number }>>();
    for (const r of stRows) {
      const camp = r.campaign.name;
      const term = r.searchTermView.searchTerm.toLowerCase().trim();
      if (!searchTerms.has(camp)) searchTerms.set(camp, new Map());
      const ex = searchTerms.get(camp)!.get(term) ?? { spend: 0, clicks: 0, conv: 0 };
      ex.spend += Number(r.metrics.costMicros) / 1_000_000;
      ex.clicks += Number(r.metrics.clicks);
      ex.conv += Number(r.metrics.conversions);
      searchTerms.get(camp)!.set(term, ex);
    }

    // Performance
    const perfRows = await client().query<{
      campaign: { name: string };
      metrics: { costMicros: string; clicks: string; conversions: string };
    }>(`
      SELECT campaign.name, metrics.cost_micros, metrics.clicks, metrics.conversions
      FROM campaign
      WHERE campaign.name IN (${inClause})
        AND segments.date BETWEEN '${isoDate(start)}' AND '${isoDate(end)}'
    `);

    const perf = new Map<string, { spend: number; clicks: number; conv: number }>();
    for (const r of perfRows) {
      perf.set(r.campaign.name, {
        spend: Number(r.metrics.costMicros) / 1_000_000,
        clicks: Number(r.metrics.clicks),
        conv: Number(r.metrics.conversions),
      });
    }

    const results = pairs.map(({ primary, secondary }) => {
      const pKws = keywords.get(primary) ?? new Set<string>();
      const sKws = keywords.get(secondary) ?? new Set<string>();
      const pNegs = negatives.get(primary) ?? new Set<string>();
      const sNegs = negatives.get(secondary) ?? new Set<string>();
      const pPerf = perf.get(primary) ?? { spend: 0, clicks: 0, conv: 0 };
      const sPerf = perf.get(secondary) ?? { spend: 0, clicks: 0, conv: 0 };

      const overlap = [...pKws]
        .filter((k) => sKws.has(k))
        .map((k) => {
          const pd = kwDetails.get(primary)?.get(k);
          const sd = kwDetails.get(secondary)?.get(k);
          return { keyword: k, primary_match_type: pd?.matchType, secondary_match_type: sd?.matchType };
        });

      const pBlockedByS = [...pKws].filter((k) => sNegs.has(k));
      const sBlockedByP = [...sKws].filter((k) => pNegs.has(k));

      const pTerms = searchTerms.get(primary) ?? new Map<string, { spend: number; clicks: number; conv: number }>();
      const sTerms = searchTerms.get(secondary) ?? new Map<string, { spend: number; clicks: number; conv: number }>();
      const sharedTerms = [...pTerms.keys()]
        .filter((t) => sTerms.has(t))
        .map((t) => ({
          term: t,
          primary_spend: Math.round(pTerms.get(t)!.spend * 100) / 100,
          secondary_spend: Math.round(sTerms.get(t)!.spend * 100) / 100,
          total_spend: Math.round((pTerms.get(t)!.spend + sTerms.get(t)!.spend) * 100) / 100,
          primary_clicks: pTerms.get(t)!.clicks,
          secondary_clicks: sTerms.get(t)!.clicks,
        }))
        .sort((a, b) => b.total_spend - a.total_spend);

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
      };
    });

    return {
      pairs: results,
      date_range: { since: isoDate(start), until: isoDate(end), days },
    };
  },
};

// ---------------------------------------------------------------------------
// gads_pause_campaign — MUTATION
// ---------------------------------------------------------------------------

async function setCampaignStatus(args: {
  campaign_id: string
  status: 'PAUSED' | 'ENABLED'
  dry_run?: boolean
  confirm_high_impact?: boolean
  customer_id?: string
}) {
  const c = getClient(args.customer_id)
  const campaignId = args.campaign_id.replace(/[^\d]/g, '')
  const target = args.status

  const rows = await c.query<{
    campaign: { resourceName: string; name: string; status: string }
  }>(
    `SELECT campaign.resource_name, campaign.name, campaign.status
     FROM campaign WHERE campaign.id = ${campaignId}`
  )
  const camp = rows[0]?.campaign
  if (!camp?.resourceName) {
    throw new Error(`campaign_id ${campaignId} not found`)
  }
  const before = camp.status

  if (before === target) {
    return {
      applied: false,
      idempotent: true,
      campaign: { id: campaignId, name: camp.name },
      message: `Campaign already ${target}; no change.`,
    }
  }

  const end = new Date()
  const start = new Date(end.getTime() - 6 * 86_400_000)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const costRows = await c.query<{ metrics: { costMicros: string } }>(
    `SELECT metrics.cost_micros FROM campaign
     WHERE campaign.id = ${campaignId}
     AND segments.date BETWEEN '${iso(start)}' AND '${iso(end)}'`
  )
  const totalMicros = costRows.reduce((s, r) => s + Number(r.metrics?.costMicros ?? 0), 0)
  const estDailyCost = Math.round(totalMicros / 1e6 / 7)

  const preview = {
    campaign: { id: campaignId, name: camp.name, resource_name: camp.resourceName },
    before_status: before,
    after_status: target,
    est_daily_cost_impact: estDailyCost,
    currency_note: "account's currency major units (the currency unit, not micros)",
  }

  if (isDryRun(args)) {
    return dryRunResult(preview)
  }

  const gate = shouldExecute({
    toolName: `gads_${target.toLowerCase()}_campaign`,
    costImpactAbsolute: estDailyCost,
    confirmHighImpact: args.confirm_high_impact,
  })
  if (!gate.execute) {
    return { applied: false, reason: gate.reason, preview }
  }

  const result = await c.mutate([
    {
      campaignOperation: {
        update: { resourceName: camp.resourceName, status: target },
        updateMask: 'status',
      },
    },
  ])

  return { applied: true, dry_run: false, ...preview, result }
}

export const gads_pause_campaign = {
  name: 'gads_pause_campaign',
  description:
    '[MUTATION] Pause a campaign, identified by its numeric campaign_id. Safe by default: dry_run is true unless you set it to false, so by default the tool returns a preview (the status change and the estimated daily cost impact) and writes nothing. The call is idempotent: it does nothing if the campaign is already paused.',
  inputSchema: z.object({
    campaign_id: z.string().describe('Numeric Google Ads campaign ID.'),
    customer_id: z.string().optional().describe('10-digit customer ID (no dashes). Falls back to GOOGLE_ADS_CUSTOMER_ID.'),
    dry_run: z.boolean().optional().default(true).describe('Default true (preview only). Pass false to apply.'),
    confirm_high_impact: z.boolean().optional().describe('Required to override the high-impact cost threshold.'),
  }),
  async handler(args: { campaign_id: string; customer_id?: string; dry_run?: boolean; confirm_high_impact?: boolean }) {
    return setCampaignStatus({ ...args, status: 'PAUSED' })
  },
}

export const gads_resume_campaign = {
  name: 'gads_resume_campaign',
  description:
    '[MUTATION] Resume a paused campaign by setting it back to ENABLED, identified by its numeric campaign_id. Safe by default: dry_run is true unless you set it to false, so by default the tool returns a preview and writes nothing. The call is idempotent: it does nothing if the campaign is already enabled.',
  inputSchema: z.object({
    campaign_id: z.string().describe('Numeric Google Ads campaign ID.'),
    customer_id: z.string().optional().describe('10-digit customer ID (no dashes). Falls back to GOOGLE_ADS_CUSTOMER_ID.'),
    dry_run: z.boolean().optional().default(true).describe('Default true (preview only). Pass false to apply.'),
    confirm_high_impact: z.boolean().optional().describe('Required to override the high-impact cost threshold.'),
  }),
  async handler(args: { campaign_id: string; customer_id?: string; dry_run?: boolean; confirm_high_impact?: boolean }) {
    return setCampaignStatus({ ...args, status: 'ENABLED' })
  },
}

// ---------------------------------------------------------------------------
// gads_update_campaign_budget — MUTATION
// ---------------------------------------------------------------------------

function fmtAmount(n: number): string {
  return String(Number(n.toFixed(2)))
}

function canonical(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

function confirmPhrase(curDaily: number, newDaily: number): string {
  const delta = newDaily - curDaily
  const dir = delta >= 0 ? 'increase' : 'decrease'
  const pct = Math.round((Math.abs(delta) / curDaily) * 100)
  return canonical(
    `confirm budget change from ${fmtAmount(curDaily)} to ${fmtAmount(newDaily)} (${dir} of ${pct}%)`
  )
}

interface BudgetState {
  campaignName: string
  budgetResourceName: string
  currentMicros: number
  explicitlyShared: boolean
}

async function fetchBudget(c: GoogleAdsClient, campaignId: string): Promise<BudgetState> {
  const rows = await c.query<{
    campaign: { name: string }
    campaignBudget: { resourceName: string; amountMicros: string; explicitlyShared: boolean }
  }>(
    `SELECT campaign.name, campaign_budget.resource_name,
            campaign_budget.amount_micros, campaign_budget.explicitly_shared
     FROM campaign WHERE campaign.id = ${campaignId}`
  )
  const r = rows[0]
  if (!r?.campaignBudget?.resourceName) {
    throw new Error(`campaign_id ${campaignId} not found, or it has no budget`)
  }
  return {
    campaignName: String(r.campaign?.name ?? ''),
    budgetResourceName: r.campaignBudget.resourceName,
    currentMicros: Number(r.campaignBudget.amountMicros ?? 0),
    explicitlyShared: r.campaignBudget.explicitlyShared === true,
  }
}

export const gads_update_campaign_budget = {
  name: 'gads_update_campaign_budget',
  description:
    '[MUTATION] Set a campaign\'s daily budget in the account\'s currency major units (the currency unit itself, NOT micros). Refuses shared budgets. Four gates, in order: (1) dry_run is true by default and only returns a preview showing current budget, new budget, the change amount and percent, and the exact confirmation string to use; (2) you must pass `confirm` exactly equal to the required_confirmation string from the dry-run (it encodes the precise from/to amounts, so a large change cannot be applied without acknowledging its magnitude); (3) large changes also need confirm_high_impact. The budget is re-read immediately before writing; if it moved since the dry-run the change is refused with a fresh confirmation string. The typed confirmation is a real safety gate when a human reviews the dry-run. Idempotent: no-op if the budget already equals the requested amount.',
  inputSchema: z.object({
    campaign_id: z.string().describe('Numeric Google Ads campaign ID.'),
    customer_id: z.string().optional().describe('10-digit customer ID (no dashes). Falls back to GOOGLE_ADS_CUSTOMER_ID.'),
    new_daily_budget: z.number().describe("New daily budget in account currency major units (e.g. 2000 means 2000 per day in that currency). Not micros."),
    dry_run: z.boolean().optional().default(true).describe('Default true (preview only). Pass false to apply.'),
    confirm: z.string().optional().describe('Must exactly equal the required_confirmation string returned by the dry-run.'),
    confirm_high_impact: z.boolean().optional().describe('Required to override the high-impact cost threshold for large budget deltas.'),
  }),
  async handler(args: {
    campaign_id: string
    customer_id?: string
    new_daily_budget: number
    dry_run?: boolean
    confirm?: string
    confirm_high_impact?: boolean
  }) {
    const c = getClient(args.customer_id)
    const campaignId = args.campaign_id.replace(/[^\d]/g, '')
    const newDaily = Number(args.new_daily_budget)
    if (!Number.isFinite(newDaily) || newDaily <= 0) {
      throw new Error(`new_daily_budget must be a positive number, got: ${JSON.stringify(args.new_daily_budget)}`)
    }

    const b = await fetchBudget(c, campaignId)

    if (b.explicitlyShared) {
      const siblings = await c.query<{ campaign: { id: string } }>(
        `SELECT campaign.id FROM campaign
         WHERE campaign_budget.resource_name = '${b.budgetResourceName}'`
      )
      const ids = siblings.map((s) => s.campaign?.id).filter(Boolean)
      throw new Error(
        `Refusing: budget ${b.budgetResourceName} is shared by ${ids.length} campaigns (${ids.join(', ')}). ` +
          `update_campaign_budget only handles unshared budgets.`
      )
    }
    if (b.currentMicros === 0) {
      throw new Error(
        `campaign ${campaignId} has no budget amount set (0). That is budget creation, not an update.`
      )
    }

    const newMicros = Math.round(newDaily * 1e6)
    const curDaily = b.currentMicros / 1e6
    const deltaDaily = newMicros / 1e6 - curDaily

    if (newMicros === b.currentMicros) {
      return {
        applied: false,
        idempotent: true,
        campaign: { id: campaignId, name: b.campaignName },
        current_daily_budget: curDaily,
        new_daily_budget: curDaily,
        message: `Budget already ${fmtAmount(curDaily)}; no change.`,
      }
    }

    const direction = deltaDaily >= 0 ? 'increase' : 'decrease'
    const changePct = Math.round((Math.abs(deltaDaily) / curDaily) * 100)
    const required = confirmPhrase(curDaily, newMicros / 1e6)
    const preview = {
      campaign: { id: campaignId, name: b.campaignName },
      budget_resource_name: b.budgetResourceName,
      current_daily_budget: curDaily,
      new_daily_budget: newMicros / 1e6,
      change_amount: Number(deltaDaily.toFixed(2)),
      change_pct: changePct,
      direction,
      required_confirmation: required,
    }

    if (isDryRun(args)) {
      return dryRunResult(preview)
    }

    if (canonical(String(args.confirm ?? '')) !== required) {
      return {
        applied: false,
        dry_run: false,
        reason: `Confirmation required. Pass confirm exactly as: "${required}"`,
        ...preview,
      }
    }

    const impactGate = shouldExecute({
      toolName: 'gads_update_campaign_budget',
      costImpactAbsolute: Math.abs(deltaDaily),
      confirmHighImpact: args.confirm_high_impact,
    })
    if (!impactGate.execute) {
      return { applied: false, dry_run: false, reason: impactGate.reason, ...preview }
    }

    const fresh = await fetchBudget(c, campaignId)
    if (fresh.explicitlyShared) {
      throw new Error(`Refusing: budget ${fresh.budgetResourceName} became shared since preview.`)
    }
    if (fresh.currentMicros !== b.currentMicros) {
      const freshPhrase = confirmPhrase(fresh.currentMicros / 1e6, newMicros / 1e6)
      return {
        applied: false,
        dry_run: false,
        reason: `Budget changed since preview (was ${fmtAmount(curDaily)}, now ${fmtAmount(
          fresh.currentMicros / 1e6
        )}). Re-confirm with: "${freshPhrase}"`,
        ...preview,
        current_daily_budget: fresh.currentMicros / 1e6,
      }
    }

    const result = await c.mutate([
      {
        campaignBudgetOperation: {
          update: { resourceName: b.budgetResourceName, amountMicros: String(newMicros) },
          updateMask: 'amount_micros',
        },
      },
    ])
    return { applied: true, dry_run: false, ...preview, result }
  },
}

export const GOOGLE_ADS_TOOLS = [
  gads_get_resource_metadata,
  gads_gaql_search,
  gads_list_campaigns,
  gads_list_ad_groups,
  gads_list_keywords,
  gads_insights,
  gads_search_terms,
  gads_list_negatives,
  gads_add_negative,
  gads_add_negative_keyword,
  gads_campaign_overlap,
  gads_pause_campaign,
  gads_resume_campaign,
  gads_update_campaign_budget,
] as const;
