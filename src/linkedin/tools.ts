import { z } from "zod";
import { LinkedInClient } from "./client.js";
import { getLinkedInConfig } from "./config.js";
import { isDryRun, shouldExecute, dryRunResult } from "../safety.js";
import { calculateStandardMetrics } from "../lib/metrics.js";
import { mapLinkedInRecord } from "../lib/mappers.js";

let _client: LinkedInClient | null = null;
function client(): LinkedInClient {
  if (!_client) _client = new LinkedInClient(getLinkedInConfig());
  return _client;
}

const AccountId = z.string().describe("LinkedIn ad account ID (numeric)");

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export const linkedin_ads_list_accounts = {
  name: "linkedin_ads_list_accounts",
  description: "List LinkedIn ad accounts accessible to the current access token.",
  inputSchema: z.object({
    status: z.array(z.string()).optional(),
    type: z.string().optional(),
    include_test: z.boolean().optional().default(false),
  }),
  async handler(args: { status?: string[]; type?: string; include_test?: boolean }) {
    try {
      const accounts = await client().listAdAccounts({
        status: args.status,
        type: args.type,
        includeTest: args.include_test,
      });
      return { accounts, count: accounts.length };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const linkedin_ads_get_account = {
  name: "linkedin_ads_get_account",
  description: "Get detailed information for a specific LinkedIn ad account.",
  inputSchema: z.object({
    account_id: AccountId,
  }),
  async handler(args: { account_id: string }) {
    try {
      const account = await client().getAccountDetails(args.account_id);
      return { account };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

// ---------------------------------------------------------------------------
// Campaign Groups
// ---------------------------------------------------------------------------

export const linkedin_ads_list_campaign_groups = {
  name: "linkedin_ads_list_campaign_groups",
  description: "List campaign groups for a LinkedIn ad account.",
  inputSchema: z.object({
    account_id: AccountId,
    status: z.array(z.string()).optional(),
  }),
  async handler(args: { account_id: string; status?: string[] }) {
    try {
      const groups = await client().listCampaignGroups(args.account_id, { status: args.status });
      return { groups, count: groups.length };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const linkedin_ads_get_campaign_group = {
  name: "linkedin_ads_get_campaign_group",
  description: "Get a single campaign group by ID.",
  inputSchema: z.object({
    account_id: AccountId,
    campaign_group_id: z.string(),
  }),
  async handler(args: { account_id: string; campaign_group_id: string }) {
    try {
      const group = await client().getCampaignGroup(args.account_id, args.campaign_group_id);
      return { group };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const linkedin_ads_create_campaign_group = {
  name: "linkedin_ads_create_campaign_group",
  description: "[MUTATION] Create a new LinkedIn campaign group. Always create as PAUSED for review.",
  inputSchema: z.object({
    account_id: AccountId,
    name: z.string(),
    status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]).optional().default("PAUSED"),
    budget: z.number().optional().describe("Total budget amount in account currency units"),
    currency_code: z.string().optional().default("USD"),
    dry_run: z.boolean().optional().default(true),
  }),
  async handler(args: {
    account_id: string;
    name: string;
    status?: "ACTIVE" | "PAUSED" | "ARCHIVED";
    budget?: number;
    currency_code?: string;
    dry_run?: boolean;
  }) {
    try {
      const body: Record<string, unknown> = { name: args.name, status: args.status };
      if (args.budget !== undefined) {
        body.totalBudget = { amount: args.budget, currencyCode: args.currency_code ?? "USD" };
      }

      if (isDryRun(args)) {
        return dryRunResult({ action: "create_campaign_group", account_id: args.account_id, body });
      }
      const gate = shouldExecute("linkedin_ads_create_campaign_group");
      if (!gate.execute) {
        return { applied: false, reason: gate.reason, preview: body };
      }

      const result = await client().createCampaignGroup(args.account_id, body);
      return { campaign_group_id: result.id, success: true, note: `Created in ${args.status} state.` };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const linkedin_ads_update_campaign_group = {
  name: "linkedin_ads_update_campaign_group",
  description: "[MUTATION] Update an existing LinkedIn campaign group. Provide only fields to change.",
  inputSchema: z.object({
    account_id: AccountId,
    campaign_group_id: z.string(),
    name: z.string().optional(),
    status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]).optional(),
    budget: z.number().optional(),
    currency_code: z.string().optional().default("USD"),
    dry_run: z.boolean().optional().default(true),
  }),
  async handler(args: {
    account_id: string;
    campaign_group_id: string;
    name?: string;
    status?: "ACTIVE" | "PAUSED" | "ARCHIVED";
    budget?: number;
    currency_code?: string;
    dry_run?: boolean;
  }) {
    try {
      const updates: Record<string, unknown> = {};
      if (args.name !== undefined) updates.name = args.name;
      if (args.status !== undefined) updates.status = args.status;
      if (args.budget !== undefined) {
        updates.totalBudget = { amount: args.budget, currencyCode: args.currency_code ?? "USD" };
      }
      if (Object.keys(updates).length === 0) {
        return { error: "No fields provided to update" };
      }

      if (isDryRun(args)) {
        return dryRunResult({ action: "update_campaign_group", campaign_group_id: args.campaign_group_id, updates });
      }
      const gate = shouldExecute("linkedin_ads_update_campaign_group");
      if (!gate.execute) {
        return { applied: false, reason: gate.reason, preview: updates };
      }

      await client().updateCampaignGroup(args.account_id, args.campaign_group_id, updates);
      return { campaign_group_id: args.campaign_group_id, success: true, changed_fields: Object.keys(updates) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const linkedin_ads_delete_campaign_group = {
  name: "linkedin_ads_delete_campaign_group",
  description: "[MUTATION] Delete a draft campaign group or mark a live one for deletion.",
  inputSchema: z.object({
    account_id: AccountId,
    campaign_group_id: z.string(),
    is_draft: z.boolean().optional().default(false),
    dry_run: z.boolean().optional().default(true),
  }),
  async handler(args: { account_id: string; campaign_group_id: string; is_draft?: boolean; dry_run?: boolean }) {
    try {
      const preview = {
        action: "delete_campaign_group",
        account_id: args.account_id,
        campaign_group_id: args.campaign_group_id,
        is_draft: args.is_draft,
      };
      if (isDryRun(args)) {
        return dryRunResult(preview);
      }
      const gate = shouldExecute("linkedin_ads_delete_campaign_group");
      if (!gate.execute) {
        return { applied: false, reason: gate.reason, preview };
      }

      await client().deleteCampaignGroup(args.account_id, args.campaign_group_id, args.is_draft ?? false);
      return { campaign_group_id: args.campaign_group_id, success: true, deleted: args.is_draft };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export const linkedin_ads_list_campaigns = {
  name: "linkedin_ads_list_campaigns",
  description: "List campaigns for a LinkedIn ad account. Optionally filter by campaign group or status.",
  inputSchema: z.object({
    account_id: AccountId,
    campaign_group_ids: z.array(z.string()).optional(),
    status: z.array(z.string()).optional(),
  }),
  async handler(args: { account_id: string; campaign_group_ids?: string[]; status?: string[] }) {
    try {
      const campaigns = await client().listCampaigns(args.account_id, {
        campaignGroupIds: args.campaign_group_ids,
        status: args.status,
      });
      return { campaigns, count: campaigns.length };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const linkedin_ads_get_campaign = {
  name: "linkedin_ads_get_campaign",
  description: "Get a single LinkedIn campaign by ID.",
  inputSchema: z.object({
    account_id: AccountId,
    campaign_id: z.string(),
  }),
  async handler(args: { account_id: string; campaign_id: string }) {
    try {
      const campaign = await client().getCampaign(args.account_id, args.campaign_id);
      return { campaign };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const linkedin_ads_create_campaign = {
  name: "linkedin_ads_create_campaign",
  description:
    "[MUTATION] Create a new LinkedIn campaign. Always create as DRAFT or PAUSED for review before activating.",
  inputSchema: z.object({
    account_id: AccountId,
    name: z.string(),
    status: z.enum(["ACTIVE", "PAUSED", "DRAFT", "ARCHIVED"]).optional().default("DRAFT"),
    type: z.string().optional().describe("e.g. SPONSORED_UPDATES, TEXT_AD, SPONSORED_INMAILS"),
    campaign_group_id: z.string().optional(),
    daily_budget: z.number().optional().describe("Daily budget amount in account currency units"),
    currency_code: z.string().optional().default("USD"),
    dry_run: z.boolean().optional().default(true),
  }),
  async handler(args: {
    account_id: string;
    name: string;
    status?: "ACTIVE" | "PAUSED" | "DRAFT" | "ARCHIVED";
    type?: string;
    campaign_group_id?: string;
    daily_budget?: number;
    currency_code?: string;
    dry_run?: boolean;
  }) {
    try {
      const body: Record<string, unknown> = { name: args.name, status: args.status };
      if (args.type) body.type = args.type;
      if (args.campaign_group_id) {
        body.campaignGroup = `urn:li:sponsoredCampaignGroup:${args.campaign_group_id}`;
      }
      if (args.daily_budget !== undefined) {
        body.dailyBudget = { amount: args.daily_budget, currencyCode: args.currency_code ?? "USD" };
      }

      if (isDryRun(args)) {
        return dryRunResult({ action: "create_campaign", account_id: args.account_id, body });
      }
      const gate = shouldExecute("linkedin_ads_create_campaign");
      if (!gate.execute) {
        return { applied: false, reason: gate.reason, preview: body };
      }

      const result = await client().createCampaign(args.account_id, body);
      return { campaign_id: result.id, success: true, note: `Created in ${args.status} state.` };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const linkedin_ads_update_campaign = {
  name: "linkedin_ads_update_campaign",
  description: "[MUTATION] Update an existing LinkedIn campaign. Provide only fields to change.",
  inputSchema: z.object({
    account_id: AccountId,
    campaign_id: z.string(),
    name: z.string().optional(),
    status: z.enum(["ACTIVE", "PAUSED", "DRAFT", "ARCHIVED"]).optional(),
    daily_budget: z.number().optional(),
    currency_code: z.string().optional().default("USD"),
    dry_run: z.boolean().optional().default(true),
  }),
  async handler(args: {
    account_id: string;
    campaign_id: string;
    name?: string;
    status?: "ACTIVE" | "PAUSED" | "DRAFT" | "ARCHIVED";
    daily_budget?: number;
    currency_code?: string;
    dry_run?: boolean;
  }) {
    try {
      const updates: Record<string, unknown> = {};
      if (args.name !== undefined) updates.name = args.name;
      if (args.status !== undefined) updates.status = args.status;
      if (args.daily_budget !== undefined) {
        updates.dailyBudget = { amount: args.daily_budget, currencyCode: args.currency_code ?? "USD" };
      }
      if (Object.keys(updates).length === 0) {
        return { error: "No fields provided to update" };
      }

      if (isDryRun(args)) {
        return dryRunResult({ action: "update_campaign", campaign_id: args.campaign_id, updates });
      }
      const gate = shouldExecute("linkedin_ads_update_campaign");
      if (!gate.execute) {
        return { applied: false, reason: gate.reason, preview: updates };
      }

      await client().updateCampaign(args.account_id, args.campaign_id, updates);
      return { campaign_id: args.campaign_id, success: true, changed_fields: Object.keys(updates) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const linkedin_ads_delete_campaign = {
  name: "linkedin_ads_delete_campaign",
  description: "[MUTATION] Delete a draft LinkedIn campaign or mark a live one for deletion.",
  inputSchema: z.object({
    account_id: AccountId,
    campaign_id: z.string(),
    is_draft: z.boolean().optional().default(false),
    dry_run: z.boolean().optional().default(true),
  }),
  async handler(args: { account_id: string; campaign_id: string; is_draft?: boolean; dry_run?: boolean }) {
    try {
      const preview = {
        action: "delete_campaign",
        account_id: args.account_id,
        campaign_id: args.campaign_id,
        is_draft: args.is_draft,
      };
      if (isDryRun(args)) {
        return dryRunResult(preview);
      }
      const gate = shouldExecute("linkedin_ads_delete_campaign");
      if (!gate.execute) {
        return { applied: false, reason: gate.reason, preview };
      }

      await client().deleteCampaign(args.account_id, args.campaign_id, args.is_draft ?? false);
      return { campaign_id: args.campaign_id, success: true, deleted: args.is_draft };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

export const linkedin_ads_get_campaign_performance = {
  name: "linkedin_ads_get_campaign_performance",
  description: "Get performance analytics for LinkedIn campaigns.",
  inputSchema: z.object({
    account_id: AccountId,
    start_date: z.string().describe("YYYY-MM-DD"),
    end_date: z.string().optional(),
    campaign_ids: z.array(z.string()).optional(),
    campaign_group_ids: z.array(z.string()).optional(),
    time_granularity: z.string().optional().default("ALL").describe("ALL, DAILY, WEEKLY, MONTHLY"),
    metrics: z.array(z.string()).optional(),
  }),
  async handler(args: {
    account_id: string;
    start_date: string;
    end_date?: string;
    campaign_ids?: string[];
    campaign_group_ids?: string[];
    time_granularity?: string;
    metrics?: string[];
  }) {
    try {
      const rows = await client().getCampaignPerformance({
        accountId: args.account_id,
        startDate: args.start_date,
        endDate: args.end_date,
        campaignIds: args.campaign_ids,
        campaignGroupIds: args.campaign_group_ids,
        timeGranularity: args.time_granularity,
        metrics: args.metrics,
      });
      return { rows, count: rows.length };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

// ---------------------------------------------------------------------------
// Creatives
// ---------------------------------------------------------------------------

export const linkedin_ads_list_creatives = {
  name: "linkedin_ads_list_creatives",
  description: "List creatives for a LinkedIn ad account. Optionally filter by campaign or creative IDs.",
  inputSchema: z.object({
    account_id: AccountId,
    campaign_ids: z.array(z.string()).optional(),
    creative_ids: z.array(z.string()).optional(),
    page_size: z.number().optional().default(100),
  }),
  async handler(args: { account_id: string; campaign_ids?: string[]; creative_ids?: string[]; page_size?: number }) {
    try {
      const creatives = await client().listCreatives(args.account_id, {
        campaignIds: args.campaign_ids,
        creativeIds: args.creative_ids,
        pageSize: args.page_size,
      });
      return { creatives, count: creatives.length };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const linkedin_ads_get_creative = {
  name: "linkedin_ads_get_creative",
  description: "Get a single LinkedIn creative by ID.",
  inputSchema: z.object({
    account_id: AccountId,
    creative_id: z.string(),
  }),
  async handler(args: { account_id: string; creative_id: string }) {
    try {
      const creative = await client().getCreative(args.account_id, args.creative_id);
      return { creative };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const linkedin_ads_create_creative = {
  name: "linkedin_ads_create_creative",
  description: "[MUTATION] Create a new LinkedIn creative.",
  inputSchema: z.object({
    account_id: AccountId,
    creative: z.record(z.any()).describe("Full creative object per LinkedIn API spec"),
    dry_run: z.boolean().optional().default(true),
  }),
  async handler(args: { account_id: string; creative: Record<string, unknown>; dry_run?: boolean }) {
    try {
      if (isDryRun(args)) {
        return dryRunResult({ action: "create_creative", account_id: args.account_id, creative: args.creative });
      }
      const gate = shouldExecute("linkedin_ads_create_creative");
      if (!gate.execute) {
        return { applied: false, reason: gate.reason, preview: args.creative };
      }

      const result = await client().createCreative(args.account_id, args.creative);
      return { creative_id: result.id, success: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const linkedin_ads_create_inline_ad = {
  name: "linkedin_ads_create_inline_ad",
  description: "[MUTATION] Create a new inline LinkedIn ad creative.",
  inputSchema: z.object({
    account_id: AccountId,
    creative: z.record(z.any()).describe("Inline creative object per LinkedIn API spec"),
    dry_run: z.boolean().optional().default(true),
  }),
  async handler(args: { account_id: string; creative: Record<string, unknown>; dry_run?: boolean }) {
    try {
      if (isDryRun(args)) {
        return dryRunResult({ action: "create_inline_ad", account_id: args.account_id, creative: args.creative });
      }
      const gate = shouldExecute("linkedin_ads_create_inline_ad");
      if (!gate.execute) {
        return { applied: false, reason: gate.reason, preview: args.creative };
      }

      const result = await client().createInlineCreative(args.account_id, args.creative);
      return { creative_id: result.id, success: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const linkedin_ads_update_creative_status = {
  name: "linkedin_ads_update_creative_status",
  description: "[MUTATION] Update a LinkedIn creative's status or other fields. Provide only fields to change.",
  inputSchema: z.object({
    account_id: AccountId,
    creative_id: z.string(),
    status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]).optional(),
    updates: z.record(z.any()).optional().describe("Additional creative fields to update"),
    dry_run: z.boolean().optional().default(true),
  }),
  async handler(args: {
    account_id: string;
    creative_id: string;
    status?: "ACTIVE" | "PAUSED" | "ARCHIVED";
    updates?: Record<string, unknown>;
    dry_run?: boolean;
  }) {
    try {
      const merged: Record<string, unknown> = { ...(args.updates || {}) };
      if (args.status !== undefined) merged.status = args.status;
      if (Object.keys(merged).length === 0) {
        return { error: "No fields provided to update" };
      }

      if (isDryRun(args)) {
        return dryRunResult({ action: "update_creative", creative_id: args.creative_id, updates: merged });
      }
      const gate = shouldExecute("linkedin_ads_update_creative_status");
      if (!gate.execute) {
        return { applied: false, reason: gate.reason, preview: merged };
      }

      await client().updateCreative(args.account_id, args.creative_id, merged);
      return { creative_id: args.creative_id, success: true, changed_fields: Object.keys(merged) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const linkedin_ads_get_creative_performance = {
  name: "linkedin_ads_get_creative_performance",
  description: "Get performance analytics for LinkedIn creatives.",
  inputSchema: z.object({
    account_id: AccountId,
    start_date: z.string(),
    end_date: z.string().optional(),
    campaign_ids: z.array(z.string()).optional(),
    time_granularity: z.string().optional().default("ALL"),
    include_video_metrics: z.boolean().optional().default(true),
  }),
  async handler(args: {
    account_id: string;
    start_date: string;
    end_date?: string;
    campaign_ids?: string[];
    time_granularity?: string;
    include_video_metrics?: boolean;
  }) {
    try {
      const rows = await client().getCreativePerformance({
        accountId: args.account_id,
        startDate: args.start_date,
        endDate: args.end_date,
        campaignIds: args.campaign_ids,
        timeGranularity: args.time_granularity,
        includeVideoMetrics: args.include_video_metrics,
      });
      return { rows, count: rows.length };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export const linkedin_ads_upload_image = {
  name: "linkedin_ads_upload_image",
  description: "[MUTATION] Upload an image to LinkedIn for use in creatives.",
  inputSchema: z.object({
    owner: z.string().describe("Organization URN or numeric organization ID"),
    file_path: z.string().describe("Absolute local file path"),
    account_id: z.string().optional().describe("Associated ad account for media library metadata"),
    asset_name: z.string().optional(),
    dry_run: z.boolean().optional().default(true),
  }),
  async handler(args: {
    owner: string;
    file_path: string;
    account_id?: string;
    asset_name?: string;
    dry_run?: boolean;
  }) {
    try {
      const preview = {
        action: "upload_image",
        owner: args.owner,
        file_path: args.file_path,
        account_id: args.account_id,
        asset_name: args.asset_name,
      };
      if (isDryRun(args)) {
        return dryRunResult(preview);
      }
      const gate = shouldExecute("linkedin_ads_upload_image");
      if (!gate.execute) {
        return { applied: false, reason: gate.reason, preview };
      }

      const result = await client().uploadImage({
        owner: args.owner,
        filePath: args.file_path,
        accountId: args.account_id,
        assetName: args.asset_name,
      });
      return { image_urn: result.imageUrn, success: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export const linkedin_ads_get_analytics = {
  name: "linkedin_ads_get_analytics",
  description: "Get raw LinkedIn ad analytics with a custom pivot and metrics.",
  inputSchema: z.object({
    account_id: AccountId,
    pivot: z.string().describe("CAMPAIGN, CREATIVE, CAMPAIGN_GROUP, CONVERSION, etc."),
    start_date: z.string(),
    end_date: z.string().optional(),
    time_granularity: z.string().optional().default("ALL"),
    campaigns: z.array(z.string()).optional(),
    campaign_groups: z.array(z.string()).optional(),
    metrics: z.array(z.string()).optional(),
  }),
  async handler(args: {
    account_id: string;
    pivot: string;
    start_date: string;
    end_date?: string;
    time_granularity?: string;
    campaigns?: string[];
    campaign_groups?: string[];
    metrics?: string[];
  }) {
    try {
      const rows = await client().getAnalytics({
        accountId: args.account_id,
        pivot: args.pivot,
        startDate: args.start_date,
        endDate: args.end_date,
        timeGranularity: args.time_granularity,
        campaigns: args.campaigns,
        campaignGroups: args.campaign_groups,
        metrics: args.metrics,
      });
      return { rows, count: rows.length };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const linkedin_ads_get_campaign_stats = {
  name: "linkedin_ads_get_campaign_stats",
  description:
    "Get LinkedIn campaign performance with standardized metrics (spend, CTR, CPC, CPM, conversion rate, etc.).",
  inputSchema: z.object({
    account_id: AccountId,
    start_date: z.string(),
    end_date: z.string().optional(),
    campaign_ids: z.array(z.string()).optional(),
  }),
  async handler(args: {
    account_id: string;
    start_date: string;
    end_date?: string;
    campaign_ids?: string[];
  }) {
    try {
      const rows = await client().getCampaignPerformance({
        accountId: args.account_id,
        startDate: args.start_date,
        endDate: args.end_date,
        campaignIds: args.campaign_ids,
      });
      const stats = rows.map((r) => {
        const normalized = mapLinkedInRecord(r);
        const metrics = calculateStandardMetrics(normalized);
        return { raw: r, standard_metrics: metrics };
      });
      return { stats, count: stats.length };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

// ---------------------------------------------------------------------------
// Audience & Demographics
// ---------------------------------------------------------------------------

export const linkedin_ads_get_audience_demographics = {
  name: "linkedin_ads_get_audience_demographics",
  description:
    "Get audience demographic breakdown for LinkedIn campaigns with standardized metrics per segment.",
  inputSchema: z.object({
    account_id: AccountId,
    demographic_type: z.string().describe("MEMBER_JOB_FUNCTION, MEMBER_SENIORITY, MEMBER_INDUSTRY, etc."),
    start_date: z.string(),
    end_date: z.string().optional(),
    campaign_ids: z.array(z.string()).optional(),
  }),
  async handler(args: {
    account_id: string;
    demographic_type: string;
    start_date: string;
    end_date?: string;
    campaign_ids?: string[];
  }) {
    try {
      const rows = await client().getAudienceDemographics({
        accountId: args.account_id,
        demographicType: args.demographic_type,
        startDate: args.start_date,
        endDate: args.end_date,
        campaignIds: args.campaign_ids,
      });
      const stats = rows.map((r) => {
        const normalized = mapLinkedInRecord(r);
        const metrics = calculateStandardMetrics(normalized);
        return { raw: r, standard_metrics: metrics };
      });
      return { stats, count: stats.length };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const linkedin_ads_get_audience_reach = {
  name: "linkedin_ads_get_audience_reach",
  description: "Get audience reach metrics for LinkedIn campaigns or campaign groups.",
  inputSchema: z.object({
    account_id: AccountId,
    start_date: z.string(),
    end_date: z.string().optional(),
    campaign_ids: z.array(z.string()).optional(),
    campaign_group_ids: z.array(z.string()).optional(),
  }),
  async handler(args: {
    account_id: string;
    start_date: string;
    end_date?: string;
    campaign_ids?: string[];
    campaign_group_ids?: string[];
  }) {
    try {
      const rows = await client().getAudienceReach({
        accountId: args.account_id,
        startDate: args.start_date,
        endDate: args.end_date,
        campaignIds: args.campaign_ids,
        campaignGroupIds: args.campaign_group_ids,
      });
      return { rows, count: rows.length };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const linkedin_ads_list_saved_audiences = {
  name: "linkedin_ads_list_saved_audiences",
  description: "List saved audiences (DMP segments) for a LinkedIn ad account.",
  inputSchema: z.object({
    account_id: AccountId,
    status: z.array(z.string()).optional(),
    type: z.string().optional(),
  }),
  async handler(args: { account_id: string; status?: string[]; type?: string }) {
    try {
      const audiences = await client().listSavedAudiences(args.account_id, {
        status: args.status,
        type: args.type,
      });
      return { audiences, count: audiences.length };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

// ---------------------------------------------------------------------------
// Conversions & Leads
// ---------------------------------------------------------------------------

export const linkedin_ads_get_conversion_performance = {
  name: "linkedin_ads_get_conversion_performance",
  description: "Get conversion performance for LinkedIn campaigns.",
  inputSchema: z.object({
    account_id: AccountId,
    start_date: z.string(),
    end_date: z.string().optional(),
    campaign_ids: z.array(z.string()).optional(),
    include_post_view: z.boolean().optional().default(true),
    time_granularity: z.string().optional().default("ALL"),
  }),
  async handler(args: {
    account_id: string;
    start_date: string;
    end_date?: string;
    campaign_ids?: string[];
    include_post_view?: boolean;
    time_granularity?: string;
  }) {
    try {
      const rows = await client().getConversionPerformance({
        accountId: args.account_id,
        startDate: args.start_date,
        endDate: args.end_date,
        campaignIds: args.campaign_ids,
        includePostView: args.include_post_view,
        timeGranularity: args.time_granularity,
      });
      return { rows, count: rows.length };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const linkedin_ads_list_conversions = {
  name: "linkedin_ads_list_conversions",
  description: "List conversion actions for a LinkedIn ad account.",
  inputSchema: z.object({
    account_id: AccountId,
    enabled_only: z.boolean().optional().default(false),
  }),
  async handler(args: { account_id: string; enabled_only?: boolean }) {
    try {
      const conversions = await client().listConversions(args.account_id, args.enabled_only);
      return { conversions, count: conversions.length };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const linkedin_ads_get_lead_gen_performance = {
  name: "linkedin_ads_get_lead_gen_performance",
  description: "Get lead generation performance for LinkedIn campaigns.",
  inputSchema: z.object({
    account_id: AccountId,
    start_date: z.string(),
    end_date: z.string().optional(),
    campaign_ids: z.array(z.string()).optional(),
    time_granularity: z.string().optional().default("ALL"),
  }),
  async handler(args: {
    account_id: string;
    start_date: string;
    end_date?: string;
    campaign_ids?: string[];
    time_granularity?: string;
  }) {
    try {
      const rows = await client().getLeadGenPerformance({
        accountId: args.account_id,
        startDate: args.start_date,
        endDate: args.end_date,
        campaignIds: args.campaign_ids,
        timeGranularity: args.time_granularity,
      });
      return { rows, count: rows.length };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const linkedin_ads_list_lead_forms = {
  name: "linkedin_ads_list_lead_forms",
  description: "List lead forms for a LinkedIn ad account.",
  inputSchema: z.object({
    account_id: AccountId,
    status: z.array(z.string()).optional(),
  }),
  async handler(args: { account_id: string; status?: string[] }) {
    try {
      const forms = await client().listLeadForms(args.account_id, args.status);
      return { forms, count: forms.length };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

// ---------------------------------------------------------------------------
// Compute
// ---------------------------------------------------------------------------

export const linkedin_ads_compare_performance = {
  name: "linkedin_ads_compare_performance",
  description:
    "Compare LinkedIn campaign performance between two date ranges. Returns absolute and percentage changes for each standard metric.",
  inputSchema: z.object({
    account_id: AccountId,
    range_a: z.object({
      start_date: z.string(),
      end_date: z.string(),
    }),
    range_b: z.object({
      start_date: z.string(),
      end_date: z.string(),
    }),
    campaign_ids: z.array(z.string()).optional(),
  }),
  async handler(args: {
    account_id: string;
    range_a: { start_date: string; end_date: string };
    range_b: { start_date: string; end_date: string };
    campaign_ids?: string[];
  }) {
    try {
      const [rowsA, rowsB] = await Promise.all([
        client().getCampaignPerformance({
          accountId: args.account_id,
          startDate: args.range_a.start_date,
          endDate: args.range_a.end_date,
          campaignIds: args.campaign_ids,
        }),
        client().getCampaignPerformance({
          accountId: args.account_id,
          startDate: args.range_b.start_date,
          endDate: args.range_b.end_date,
          campaignIds: args.campaign_ids,
        }),
      ]);

      function mapByCampaign(rows: Record<string, unknown>[]) {
        const m = new Map<string, Record<string, unknown>>();
        for (const r of rows) {
          const pivotValues = r.pivotValues as string[] | undefined;
          const key = pivotValues?.[0] || (r.id as string) || "unknown";
          m.set(key, r);
        }
        return m;
      }

      const mapA = mapByCampaign(rowsA);
      const mapB = mapByCampaign(rowsB);
      const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);

      function diff<T extends number | null>(va: T, vb: T) {
        const a = va ?? 0;
        const b = vb ?? 0;
        const absolute_change = Number((b - a).toFixed(2));
        const percent_change = a !== 0 ? Number(((absolute_change / a) * 100).toFixed(2)) : null;
        return { a, b, absolute_change, percent_change };
      }

      const comparisons = [];
      for (const key of allKeys) {
        const recA = mapA.get(key) || {};
        const recB = mapB.get(key) || {};
        const metricsA = calculateStandardMetrics(mapLinkedInRecord(recA));
        const metricsB = calculateStandardMetrics(mapLinkedInRecord(recB));

        comparisons.push({
          campaign: key,
          spend: diff(metricsA.spend, metricsB.spend),
          impressions: diff(metricsA.impressions, metricsB.impressions),
          clicks: diff(metricsA.clicks, metricsB.clicks),
          ctr: diff(metricsA.ctr, metricsB.ctr),
          cpc: diff(metricsA.cpc, metricsB.cpc),
          cpm: diff(metricsA.cpm, metricsB.cpm),
          conversions: diff(metricsA.conversions, metricsB.conversions),
          costPerConversion: diff(metricsA.costPerConversion, metricsB.costPerConversion),
        });
      }

      return { comparisons, range_a: args.range_a, range_b: args.range_b };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const linkedin_ads_get_daily_trends = {
  name: "linkedin_ads_get_daily_trends",
  description:
    "Get daily time-series campaign performance with weekday averages and peak/lowest day detection.",
  inputSchema: z.object({
    account_id: AccountId,
    start_date: z.string(),
    end_date: z.string(),
    campaign_ids: z.array(z.string()).optional(),
  }),
  async handler(args: {
    account_id: string;
    start_date: string;
    end_date: string;
    campaign_ids?: string[];
  }) {
    try {
      const rows = await client().getCampaignPerformance({
        accountId: args.account_id,
        startDate: args.start_date,
        endDate: args.end_date,
        campaignIds: args.campaign_ids,
        timeGranularity: "DAILY",
      });

      const daily = rows
        .map((r) => {
          const dr = r.dateRange as
            | { start?: { year: number; month: number; day: number } }
            | undefined;
          const dateStr = dr?.start
            ? `${dr.start.year}-${String(dr.start.month).padStart(2, "0")}-${String(dr.start.day).padStart(2, "0")}`
            : "unknown";
          const normalized = mapLinkedInRecord(r);
          const metrics = calculateStandardMetrics(normalized);
          return { date: dateStr, ...metrics };
        })
        .filter((d) => d.date !== "unknown")
        .sort((a, b) => a.date.localeCompare(b.date));

      const weekdayTotals = new Map<
        number,
        { count: number; spend: number; clicks: number; impressions: number }
      >();
      for (const d of daily) {
        const dayOfWeek = new Date(d.date).getDay();
        const ex = weekdayTotals.get(dayOfWeek) || { count: 0, spend: 0, clicks: 0, impressions: 0 };
        ex.count++;
        ex.spend += d.spend;
        ex.clicks += d.clicks;
        ex.impressions += d.impressions;
        weekdayTotals.set(dayOfWeek, ex);
      }

      const weekday_averages = Array.from(weekdayTotals.entries()).map(([day, vals]) => ({
        day,
        day_name: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day],
        avg_spend: vals.count > 0 ? Number((vals.spend / vals.count).toFixed(2)) : 0,
        avg_clicks: vals.count > 0 ? Number((vals.clicks / vals.count).toFixed(2)) : 0,
        avg_impressions: vals.count > 0 ? Math.round(vals.impressions / vals.count) : 0,
      }));

      const sortedBySpend = [...daily].sort((a, b) => b.spend - a.spend);
      const peak_day = sortedBySpend[0] ? { date: sortedBySpend[0].date, spend: sortedBySpend[0].spend } : null;
      const lowest_day = sortedBySpend[sortedBySpend.length - 1]
        ? { date: sortedBySpend[sortedBySpend.length - 1].date, spend: sortedBySpend[sortedBySpend.length - 1].spend }
        : null;

      return { daily, weekday_averages, peak_day, lowest_day };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

export const LINKEDIN_TOOLS = [
  linkedin_ads_list_accounts,
  linkedin_ads_get_account,
  linkedin_ads_list_campaign_groups,
  linkedin_ads_get_campaign_group,
  linkedin_ads_create_campaign_group,
  linkedin_ads_update_campaign_group,
  linkedin_ads_delete_campaign_group,
  linkedin_ads_list_campaigns,
  linkedin_ads_get_campaign,
  linkedin_ads_create_campaign,
  linkedin_ads_update_campaign,
  linkedin_ads_delete_campaign,
  linkedin_ads_get_campaign_performance,
  linkedin_ads_list_creatives,
  linkedin_ads_get_creative,
  linkedin_ads_create_creative,
  linkedin_ads_create_inline_ad,
  linkedin_ads_update_creative_status,
  linkedin_ads_get_creative_performance,
  linkedin_ads_upload_image,
  linkedin_ads_get_analytics,
  linkedin_ads_get_campaign_stats,
  linkedin_ads_get_audience_demographics,
  linkedin_ads_get_audience_reach,
  linkedin_ads_list_saved_audiences,
  linkedin_ads_get_conversion_performance,
  linkedin_ads_list_conversions,
  linkedin_ads_get_lead_gen_performance,
  linkedin_ads_list_lead_forms,
  linkedin_ads_compare_performance,
  linkedin_ads_get_daily_trends,
] as const;
