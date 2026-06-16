# marketing-ops-mcp

MCP server that gives any MCP client read + write access to your Meta Ads, Google Ads, and LinkedIn Ads accounts.

Each user runs it locally with their own tokens. There is no hosted server.

## Tools

### Meta Ads
- `meta_list_accounts` — show configured Meta ad accounts with brand metadata
- `meta_list_campaigns` — list campaigns; filter by status or objective
- `meta_insights` — spend / impressions / clicks / leads at account, campaign, adset, or ad level
- `meta_get_creative` — full creative spec (image hashes, copy variants, CTAs, lead form ID)
- `meta_download_creatives` — download every image creative for a campaign to a local folder

### Google Ads
- `gads_list_campaigns` — filter by status / name prefix
- `gads_insights` — campaign or keyword performance for a date range
- `gads_search_terms` — what users actually typed; filter by spend
- `gads_list_negatives` — campaign-level negative keywords
- `gads_campaign_overlap` — keyword/negative overlap + search-term cannibalization between primary and _Secondary campaigns
- `gads_search_term_pattern_analysis` — clusters search terms by linguistic patterns, flags waste, suggests negatives with projected savings
- `gads_add_negative` — **MUTATION** — add a campaign-level negative keyword
- `gads_add_negative_keyword` — **MUTATION** — add an ad group-level negative keyword
- `gads_pause_campaign` — **MUTATION** — pause a campaign (dry-run by default)
- `gads_resume_campaign` — **MUTATION** — resume a paused campaign (dry-run by default)
- `gads_update_campaign_budget` — **MUTATION** — change daily budget with typed confirmation + high-impact gating (dry-run by default)

### LinkedIn Ads
- `linkedin_ads_list_accounts` — list accessible LinkedIn ad accounts
- `linkedin_ads_get_account` — detailed account info
- `linkedin_ads_list_campaign_groups` / `get_campaign_group` — campaign group CRUD
- `linkedin_ads_create_campaign_group` / `update_campaign_group` / `delete_campaign_group` — **MUTATION** — campaign group management (dry-run by default)
- `linkedin_ads_list_campaigns` / `get_campaign` — campaign listing and detail
- `linkedin_ads_create_campaign` / `update_campaign` / `delete_campaign` — **MUTATION** — campaign management (dry-run by default)
- `linkedin_ads_get_campaign_performance` / `get_campaign_stats` — performance analytics with standard metrics
- `linkedin_ads_list_creatives` / `get_creative` / `get_creative_performance` — creative listing and performance
- `linkedin_ads_create_creative` / `create_inline_ad` / `update_creative_status` — **MUTATION** — creative management (dry-run by default)
- `linkedin_ads_upload_image` — **MUTATION** — upload an image for use in creatives (dry-run by default)
- `linkedin_ads_get_analytics` — raw analytics with custom pivot and metrics
- `linkedin_ads_get_audience_demographics` / `get_audience_reach` / `list_saved_audiences` — audience insights
- `linkedin_ads_get_conversion_performance` / `list_conversions` / `get_lead_gen_performance` / `list_lead_forms` — conversion and lead-gen data
- `linkedin_ads_compare_performance` — compare two date ranges side-by-side
- `linkedin_ads_get_daily_trends` — daily time-series with weekday averages and peak/lowest day detection

## Setup

```bash
git clone https://github.com/DanielSylvester/marketing-ops-mcp.git
cd marketing-ops-mcp
npm install
npm run build
cp .env.example .env
# Fill in your own tokens — see below.
```

### Required tokens

**Meta Ads** — generate one System User token per ad account at
*business.facebook.com → Business Settings → System Users → Generate New Token*.
Required scopes: `ads_read`, `ads_management`, `leads_retrieval`.

**Google Ads** — you need a developer token (apply at the API Center) and a refresh token
generated via the OAuth playground for your own Google account. Each teammate runs through
this once to get their own refresh token; nobody shares.

Drop tokens into `.env`. The server reads `process.env`, so any way you populate that env
works (direnv, a `.env` file passed by the MCP client, etc).

**LinkedIn Ads** — set `LINKEDIN_ACCESS_TOKEN` (obtain via LinkedIn OAuth flow; see `linkedin-ads-mcp-ref` for the auth pattern). Optional: `LINKEDIN_API_VERSION` defaults to `202604`.

### Wire it into your MCP client

Add to your MCP client settings (client-specific path, e.g. `~/.claude/settings.json` or `~/.kimi-code/config.toml`):

```json
{
  "mcpServers": {
    "marketing-ops": {
      "command": "node",
      "args": ["/absolute/path/to/marketing-ops-mcp/dist/index.js"],
      "env": {
        "META_BRANDS": "brand-a,brand-b",
        "META_BRAND_A_TOKEN": "...",
        "META_BRAND_A_ACCOUNT_ID": "act_...",
        "META_BRAND_B_TOKEN": "...",
        "META_BRAND_B_ACCOUNT_ID": "act_...",
        "GOOGLE_ADS_CLIENT_ID": "...",
        "GOOGLE_ADS_CLIENT_SECRET": "...",
        "GOOGLE_ADS_REFRESH_TOKEN": "...",
        "GOOGLE_ADS_DEVELOPER_TOKEN": "...",
        "GOOGLE_ADS_LOGIN_CUSTOMER_ID": "...",
        "GOOGLE_ADS_CUSTOMER_ID": "...",
        "LINKEDIN_ACCESS_TOKEN": "...",
        "LINKEDIN_API_VERSION": "202604"
      }
    }
  }
}
```

Restart your MCP client. The tools will appear with `mcp__marketing-ops__*` prefixes.

You can also run it standalone for testing:

```bash
npm run dev   # tsx, hot reload
npm start     # node dist/index.js
```

## Mutation safety

All mutations are dry-run by default. Each tool returns a preview on the first call;
you must explicitly pass `dry_run: false` to apply.

- **Google Ads:** `gads_update_campaign_budget` additionally requires a typed `confirm`
  string (echoed from the preview) and `confirm_high_impact` for large deltas. Same
  layered gate model as `gads-mcp`.
- **LinkedIn Ads:** mutations use the dry-run gate plus an optional high-impact threshold
  (`MARKETING_OPS_MCP_HIGH_IMPACT_THRESHOLD`). No typed confirmation.
- **Meta Ads:** currently read-only; no mutation tools exposed.

If you want to disable mutations entirely (e.g. for a teammate still onboarding), comment
the mutation tools out of `src/google/tools.ts`, `src/linkedin/tools.ts`, etc., and rebuild.

## Adding tools

Each tool is a `{ name, description, inputSchema, handler }` object. Add it to the array
exported at the bottom of `src/meta/tools.ts`, `src/google/tools.ts`, or
`src/linkedin/tools.ts` — `index.ts` picks it up automatically.

## Notes

- Meta Graph API version: `v25.0` (released Feb 2026). Bump via `META_API_VERSION` env
  var when a new version ships and old one is sunset.
- Google Ads API version: `v23` — change in `src/google/client.ts`. Check
  https://developers.google.com/google-ads/api/docs/sunset-dates yearly.
- LinkedIn Marketing API version: `202604` (default). Bump via `LINKEDIN_API_VERSION`.
- All currencies returned in major units (₹, S$), not micros.
