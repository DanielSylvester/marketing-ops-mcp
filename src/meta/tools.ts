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

export const META_TOOLS = [
  meta_list_accounts,
  meta_list_campaigns,
  meta_insights,
  meta_get_creative,
  meta_download_creatives,
] as const
