import { z } from 'zod'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MetaClient } from './client.js'
import { getMetaAccount, listConfiguredMetaBrands, type Brand } from '../config.js'

const BrandSchema = z.enum(['smartworks', 'workstudio'])

function clientFor(brand: Brand): MetaClient {
  return new MetaClient(getMetaAccount(brand))
}

function leadCount(actions?: Array<{ action_type: string; value: string }>): number {
  if (!actions) return 0
  for (const a of actions) {
    if (a.action_type === 'onsite_conversion.lead_grouped') return Math.round(Number(a.value))
  }
  for (const a of actions) {
    if (a.action_type === 'lead') return Math.round(Number(a.value))
  }
  return 0
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const meta_list_accounts = {
  name: 'meta_list_accounts',
  description: 'List configured Meta ad accounts (Smartworks India, Workstudio Singapore) with brand metadata. Run this first to discover what is available.',
  inputSchema: z.object({}),
  async handler() {
    const brands = listConfiguredMetaBrands()
    const accounts = brands.map(b => {
      const a = getMetaAccount(b)
      return {
        brand: a.brand,
        name: a.name,
        accountId: a.accountId,
        currency: a.currency,
        timezone: a.timezone,
        campaignPrefix: a.campaignPrefix,
      }
    })
    return { accounts }
  },
}

export const meta_list_campaigns = {
  name: 'meta_list_campaigns',
  description: 'List campaigns for a Meta ad account. Returns id, name, objective, effective_status. Filter by status if needed.',
  inputSchema: z.object({
    brand: BrandSchema,
    status: z.enum(['ACTIVE', 'PAUSED', 'ANY']).optional().default('ANY'),
    objective: z.string().optional().describe('e.g. OUTCOME_LEADS, OUTCOME_AWARENESS'),
  }),
  async handler({ brand, status, objective }: { brand: Brand; status?: 'ACTIVE' | 'PAUSED' | 'ANY'; objective?: string }) {
    const c = clientFor(brand)
    const data = await c.getPaginated<{ id: string; name: string; objective: string; effective_status: string }>(
      `/${c.accountId}/campaigns`,
      { fields: 'id,name,objective,effective_status' },
    )
    const filtered = data.filter(camp => {
      if (status && status !== 'ANY' && camp.effective_status !== status) return false
      if (objective && camp.objective !== objective) return false
      return true
    })
    return { campaigns: filtered, count: filtered.length }
  },
}

export const meta_insights = {
  name: 'meta_insights',
  description: 'Get performance insights for a Meta account, campaign, or ad. Returns spend, impressions, clicks, ctr, leads. Date range required.',
  inputSchema: z.object({
    brand: BrandSchema,
    level: z.enum(['account', 'campaign', 'adset', 'ad']).default('campaign'),
    since: z.string().describe('YYYY-MM-DD inclusive'),
    until: z.string().describe('YYYY-MM-DD inclusive'),
    campaign_id: z.string().optional().describe('Restrict to a single campaign'),
    time_increment: z.union([z.literal('all_days'), z.string()]).optional().default('all_days')
      .describe('"all_days" for one row, "1" for daily breakdown'),
  }),
  async handler(args: { brand: Brand; level: 'account' | 'campaign' | 'adset' | 'ad'; since: string; until: string; campaign_id?: string; time_increment?: string }) {
    const c = clientFor(args.brand)
    const target = args.campaign_id ?? c.accountId
    const data = await c.get<{ data: any[] }>(`/${target}/insights`, {
      level: args.level,
      fields: 'campaign_name,adset_name,ad_name,spend,impressions,clicks,ctr,cpc,actions',
      time_range: JSON.stringify({ since: args.since, until: args.until }),
      time_increment: args.time_increment ?? 'all_days',
      limit: 200,
    })
    const rows = (data.data ?? []).map((r: any) => ({
      date_start: r.date_start,
      date_stop: r.date_stop,
      campaign_name: r.campaign_name,
      adset_name: r.adset_name,
      ad_name: r.ad_name,
      spend: Number(r.spend ?? 0),
      impressions: Number(r.impressions ?? 0),
      clicks: Number(r.clicks ?? 0),
      ctr: Number(r.ctr ?? 0),
      cpc: Number(r.cpc ?? 0),
      leads: leadCount(r.actions),
    }))
    return { rows, count: rows.length, currency: c.currency }
  },
}

export const meta_get_creative = {
  name: 'meta_get_creative',
  description: 'Get full creative spec for a Meta creative — image hashes, copy variants (titles/bodies/descriptions), CTAs, lead form ID, page IDs.',
  inputSchema: z.object({
    brand: BrandSchema,
    creative_id: z.string(),
  }),
  async handler({ brand, creative_id }: { brand: Brand; creative_id: string }) {
    const c = clientFor(brand)
    return c.get(`/${creative_id}`, {
      fields: 'id,name,image_url,thumbnail_url,video_id,asset_feed_spec,object_story_spec',
    })
  },
}

export const meta_download_creatives = {
  name: 'meta_download_creatives',
  description: 'Download every image creative for a Meta campaign to a local folder. Resolves image hashes from the asset_feed_spec, fetches permalink URLs, writes JPGs. Returns a list of downloaded files.',
  inputSchema: z.object({
    brand: BrandSchema,
    campaign_id: z.string(),
    dest_path: z.string().describe('Absolute local folder path. Will be created if missing.'),
  }),
  async handler({ brand, campaign_id, dest_path }: { brand: Brand; campaign_id: string; dest_path: string }) {
    const c = clientFor(brand)
    mkdirSync(dest_path, { recursive: true })

    const adsResp = await c.get<{ data: Array<{ id: string }> }>(`/${campaign_id}/ads`, { fields: 'id', limit: 100 })
    const ads = adsResp.data ?? []
    if (ads.length === 0) return { downloaded: [], note: 'No ads under this campaign' }

    const downloaded: Array<{ file: string; hash: string; width: number; height: number; sizeKb: number }> = []
    const seenHashes = new Set<string>()

    for (const ad of ads) {
      const adResp = await c.get<{ creative?: { id: string } }>(`/${ad.id}`, { fields: 'creative{id}' })
      const creativeId = adResp.creative?.id
      if (!creativeId) continue
      const creative = await c.get<{ asset_feed_spec?: { images?: Array<{ hash: string }> } }>(`/${creativeId}`, {
        fields: 'asset_feed_spec',
      })
      const hashes = creative.asset_feed_spec?.images?.map(i => i.hash) ?? []
      if (hashes.length === 0) continue

      const imgResp = await c.get<{ data: Array<{ hash: string; url: string; name?: string; width: number; height: number }> }>(
        `/${c.accountId}/adimages`,
        { fields: 'hash,url,name,width,height', hashes: JSON.stringify(hashes) },
      )

      for (const img of imgResp.data ?? []) {
        if (seenHashes.has(img.hash)) continue
        seenHashes.add(img.hash)
        const safeName = (img.name ?? `${img.hash}.jpg`).replace(/[^\w.\-]+/g, '_')
        const fname = safeName.endsWith('.jpg') || safeName.endsWith('.jpeg') ? safeName : `${safeName}.jpg`
        const filePath = join(dest_path, fname)
        const fileResp = await fetch(img.url)
        if (!fileResp.ok) continue
        const buf = Buffer.from(await fileResp.arrayBuffer())
        writeFileSync(filePath, buf)
        downloaded.push({ file: filePath, hash: img.hash, width: img.width, height: img.height, sizeKb: Math.round(buf.length / 1024) })
      }
    }

    return { downloaded, count: downloaded.length, dest_path }
  },
}

function budgetToMicro(major: number, _currency: string): number {
  // Meta API budgets are in the currency's smallest unit (cents / paise)
  return Math.round(major * 100)
}

// ---------------------------------------------------------------------------
// Additional read tools
// ---------------------------------------------------------------------------

export const meta_list_adsets = {
  name: 'meta_list_adsets',
  description: 'List ad sets for a Meta campaign or account. Returns id, name, campaign_id, daily_budget, status, targeting summary.',
  inputSchema: z.object({
    brand: BrandSchema,
    campaign_id: z.string().optional().describe('Filter to a specific campaign'),
    status: z.enum(['ACTIVE', 'PAUSED', 'ANY']).optional().default('ANY'),
  }),
  async handler({ brand, campaign_id, status }: { brand: Brand; campaign_id?: string; status?: 'ACTIVE' | 'PAUSED' | 'ANY' }) {
    const c = clientFor(brand)
    const target = campaign_id ?? c.accountId
    const data = await c.getPaginated<{ id: string; name: string; campaign_id: string; daily_budget: string; effective_status: string; targeting?: any }>(
      `/${target}/adsets`,
      { fields: 'id,name,campaign_id,daily_budget,effective_status,targeting' },
    )
    const filtered = data.filter(aset => {
      if (status && status !== 'ANY' && aset.effective_status !== status) return false
      return true
    })
    return { adsets: filtered, count: filtered.length }
  },
}

export const meta_list_ads = {
  name: 'meta_list_ads',
  description: 'List ads for a Meta ad set or campaign. Returns id, name, adset_id, creative_id, effective_status.',
  inputSchema: z.object({
    brand: BrandSchema,
    adset_id: z.string().optional().describe('Filter to a specific ad set'),
    campaign_id: z.string().optional().describe('Filter to a specific campaign (falls back to adset_id)'),
    status: z.enum(['ACTIVE', 'PAUSED', 'ANY']).optional().default('ANY'),
  }),
  async handler({ brand, adset_id, campaign_id, status }: { brand: Brand; adset_id?: string; campaign_id?: string; status?: 'ACTIVE' | 'PAUSED' | 'ANY' }) {
    const c = clientFor(brand)
    const target = adset_id ?? campaign_id ?? c.accountId
    const data = await c.getPaginated<{ id: string; name: string; adset_id: string; creative?: { id: string }; effective_status: string }>(
      `/${target}/ads`,
      { fields: 'id,name,adset_id,creative{id},effective_status' },
    )
    const filtered = data.filter(ad => {
      if (status && status !== 'ANY' && ad.effective_status !== status) return false
      return true
    })
    return { ads: filtered.map(a => ({ ...a, creative_id: a.creative?.id })), count: filtered.length }
  },
}

export const meta_get_ad_account = {
  name: 'meta_get_ad_account',
  description: 'Get detailed info for a Meta ad account — name, account_status, currency, timezone, balance, spend_cap, business_name.',
  inputSchema: z.object({
    brand: BrandSchema,
  }),
  async handler({ brand }: { brand: Brand }) {
    const c = clientFor(brand)
    return c.get(`/${c.accountId}`, {
      fields: 'id,name,account_status,currency,timezone,balance,spend_cap,business_name',
    })
  },
}

export const meta_get_pages = {
  name: 'meta_get_pages',
  description: 'Get Facebook Pages accessible to the current user token. Returns page id, name, category.',
  inputSchema: z.object({
    brand: BrandSchema,
  }),
  async handler({ brand }: { brand: Brand }) {
    const c = clientFor(brand)
    // /me/accounts returns Pages the token has access to
    const data = await c.getPaginated<{ id: string; name: string; category?: string }>(`/me/accounts`, {
      fields: 'id,name,category',
      limit: 50,
    })
    return { pages: data, count: data.length }
  },
}

// ---------------------------------------------------------------------------
// Write tools (campaign management)
// ---------------------------------------------------------------------------

export const meta_create_campaign = {
  name: 'meta_create_campaign',
  description: '[MUTATION] Create a new Meta campaign. Returns the new campaign ID. Always set status to PAUSED for review before activating.',
  inputSchema: z.object({
    brand: BrandSchema,
    name: z.string(),
    objective: z.string().default('OUTCOME_LEADS').describe('e.g. OUTCOME_LEADS, OUTCOME_SALES, OUTCOME_AWARENESS, OUTCOME_TRAFFIC'),
    status: z.enum(['ACTIVE', 'PAUSED']).default('PAUSED'),
    daily_budget: z.number().optional().describe('In major currency units (INR or SGD). e.g. 5000 = ₹5000 or S$5000'),
    lifetime_budget: z.number().optional().describe('Alternative to daily_budget'),
    special_ad_categories: z.array(z.string()).optional().describe('e.g. ["HOUSING"], ["EMPLOYMENT"], ["CREDIT"] — required for regulated categories'),
  }),
  async handler(args: { brand: Brand; name: string; objective: string; status: 'ACTIVE' | 'PAUSED'; daily_budget?: number; lifetime_budget?: number; special_ad_categories?: string[] }) {
    const c = clientFor(args.brand)
    const body: Record<string, any> = {
      name: args.name,
      objective: args.objective,
      status: args.status,
    }
    if (args.daily_budget) body.daily_budget = budgetToMicro(args.daily_budget, c.currency)
    if (args.lifetime_budget) body.lifetime_budget = budgetToMicro(args.lifetime_budget, c.currency)
    if (args.special_ad_categories) body.special_ad_categories = JSON.stringify(args.special_ad_categories)
    const res = await c.post<{ id: string }>(`/${c.accountId}/campaigns`, body)
    return { campaign_id: res.id, success: true, note: `Created in ${args.status} state. Review before activating.` }
  },
}

export const meta_update_campaign = {
  name: 'meta_update_campaign',
  description: '[MUTATION] Update an existing Meta campaign — pause, activate, rename, or change budget. Provide only the fields you want to change.',
  inputSchema: z.object({
    brand: BrandSchema,
    campaign_id: z.string(),
    name: z.string().optional(),
    status: z.enum(['ACTIVE', 'PAUSED']).optional(),
    daily_budget: z.number().optional().describe('In major currency units'),
    lifetime_budget: z.number().optional().describe('In major currency units'),
  }),
  async handler(args: { brand: Brand; campaign_id: string; name?: string; status?: 'ACTIVE' | 'PAUSED'; daily_budget?: number; lifetime_budget?: number }) {
    const c = clientFor(args.brand)
    const body: Record<string, any> = {}
    if (args.name) body.name = args.name
    if (args.status) body.status = args.status
    if (args.daily_budget) body.daily_budget = budgetToMicro(args.daily_budget, c.currency)
    if (args.lifetime_budget) body.lifetime_budget = budgetToMicro(args.lifetime_budget, c.currency)
    if (Object.keys(body).length === 0) throw new Error('No fields provided to update')
    await c.post(`/${args.campaign_id}`, body)
    return { campaign_id: args.campaign_id, success: true, changed_fields: Object.keys(body) }
  },
}

export const meta_create_adset = {
  name: 'meta_create_adset',
  description: '[MUTATION] Create a new Meta ad set under a campaign. Returns the new ad set ID. Always set status to PAUSED for review.',
  inputSchema: z.object({
    brand: BrandSchema,
    campaign_id: z.string(),
    name: z.string(),
    daily_budget: z.number().optional().describe('In major currency units'),
    billing_event: z.string().default('IMPRESSIONS').describe('e.g. IMPRESSIONS, LINK_CLICKS, APP_INSTALLS'),
    optimization_goal: z.string().default('LEAD_GENERATION').describe('e.g. LEAD_GENERATION, REACH, LINK_CLICKS, CONVERSATIONS'),
    targeting: z.record(z.any()).optional().describe('JSON targeting object. e.g. {"geo_locations":{"countries":["IN"]},"age_min":25}'),
    status: z.enum(['ACTIVE', 'PAUSED']).default('PAUSED'),
  }),
  async handler(args: { brand: Brand; campaign_id: string; name: string; daily_budget?: number; billing_event: string; optimization_goal: string; targeting?: Record<string, any>; status: 'ACTIVE' | 'PAUSED' }) {
    const c = clientFor(args.brand)
    const body: Record<string, any> = {
      name: args.name,
      campaign_id: args.campaign_id,
      billing_event: args.billing_event,
      optimization_goal: args.optimization_goal,
      status: args.status,
    }
    if (args.daily_budget) body.daily_budget = budgetToMicro(args.daily_budget, c.currency)
    if (args.targeting) body.targeting = JSON.stringify(args.targeting)
    const res = await c.post<{ id: string }>(`/${c.accountId}/adsets`, body)
    return { adset_id: res.id, success: true, note: `Created in ${args.status} state. Review before activating.` }
  },
}

export const meta_update_adset = {
  name: 'meta_update_adset',
  description: '[MUTATION] Update an existing Meta ad set — pause, activate, rename, budget, targeting. Provide only fields to change.',
  inputSchema: z.object({
    brand: BrandSchema,
    adset_id: z.string(),
    name: z.string().optional(),
    status: z.enum(['ACTIVE', 'PAUSED']).optional(),
    daily_budget: z.number().optional().describe('In major currency units'),
    targeting: z.record(z.any()).optional().describe('JSON targeting object'),
  }),
  async handler(args: { brand: Brand; adset_id: string; name?: string; status?: 'ACTIVE' | 'PAUSED'; daily_budget?: number; targeting?: Record<string, any> }) {
    const c = clientFor(args.brand)
    const body: Record<string, any> = {}
    if (args.name) body.name = args.name
    if (args.status) body.status = args.status
    if (args.daily_budget) body.daily_budget = budgetToMicro(args.daily_budget, c.currency)
    if (args.targeting) body.targeting = JSON.stringify(args.targeting)
    if (Object.keys(body).length === 0) throw new Error('No fields provided to update')
    await c.post(`/${args.adset_id}`, body)
    return { adset_id: args.adset_id, success: true, changed_fields: Object.keys(body) }
  },
}

export const meta_create_ad = {
  name: 'meta_create_ad',
  description: '[MUTATION] Create a new Meta ad under an ad set. Returns the new ad ID. Always set status to PAUSED for review.',
  inputSchema: z.object({
    brand: BrandSchema,
    adset_id: z.string(),
    name: z.string(),
    creative: z.record(z.any()).describe('JSON creative object. Minimum: {object_story_spec:{page_id:"...",link_data:{message:"...",link:"...",image_hash:"..."}}}'),
    status: z.enum(['ACTIVE', 'PAUSED']).default('PAUSED'),
  }),
  async handler(args: { brand: Brand; adset_id: string; name: string; creative: Record<string, any>; status: 'ACTIVE' | 'PAUSED' }) {
    const c = clientFor(args.brand)
    const body = {
      name: args.name,
      adset_id: args.adset_id,
      creative: JSON.stringify(args.creative),
      status: args.status,
    }
    const res = await c.post<{ id: string }>(`/${c.accountId}/ads`, body)
    return { ad_id: res.id, success: true, note: `Created in ${args.status} state. Review before activating.` }
  },
}

export const meta_update_ad = {
  name: 'meta_update_ad',
  description: '[MUTATION] Update an existing Meta ad — pause, activate, rename, or replace creative. Provide only fields to change.',
  inputSchema: z.object({
    brand: BrandSchema,
    ad_id: z.string(),
    name: z.string().optional(),
    status: z.enum(['ACTIVE', 'PAUSED']).optional(),
    creative: z.record(z.any()).optional().describe('JSON creative object'),
  }),
  async handler(args: { brand: Brand; ad_id: string; name?: string; status?: 'ACTIVE' | 'PAUSED'; creative?: Record<string, any> }) {
    const c = clientFor(args.brand)
    const body: Record<string, any> = {}
    if (args.name) body.name = args.name
    if (args.status) body.status = args.status
    if (args.creative) body.creative = JSON.stringify(args.creative)
    if (Object.keys(body).length === 0) throw new Error('No fields provided to update')
    await c.post(`/${args.ad_id}`, body)
    return { ad_id: args.ad_id, success: true, changed_fields: Object.keys(body) }
  },
}

export const META_TOOLS = [
  meta_list_accounts,
  meta_list_campaigns,
  meta_list_adsets,
  meta_list_ads,
  meta_insights,
  meta_get_creative,
  meta_download_creatives,
  meta_get_ad_account,
  meta_get_pages,
  meta_create_campaign,
  meta_update_campaign,
  meta_create_adset,
  meta_update_adset,
  meta_create_ad,
  meta_update_ad,
] as const
