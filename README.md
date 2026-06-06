# marketing-ops-mcp

MCP server that gives Claude Code (or any MCP client) read + write access to your Meta Ads and Google Ads accounts.

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

Drop both into `.env`. The server reads `process.env`, so any way you populate that env
works (direnv, a `.env` file passed by the MCP client, etc).

### Wire it into Claude Code

Add to `~/.claude/settings.json`:

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
        "GOOGLE_ADS_CUSTOMER_ID": "..."
      }
    }
  }
}
```

Restart Claude Code. The tools will appear with `mcp__marketing-ops__*` prefixes.

You can also run it standalone for testing:

```bash
npm run dev   # tsx, hot reload
npm start     # node dist/index.js
```

## Mutation safety

All mutations are dry-run by default. Each tool returns a preview on the first call;
you must explicitly pass `dry_run: false` to apply. `gads_update_campaign_budget` also
requires a typed `confirm` string (echoed from the preview) and `confirm_high_impact`
for large deltas. This is the same safety model as `gads-mcp`.

If you want to disable mutations entirely (e.g. for a teammate still onboarding), comment
the mutation tools out of `src/google/tools.ts` and rebuild.

## Adding tools

Each tool is a `{ name, description, inputSchema, handler }` object. Add it to the array
exported at the bottom of `src/meta/tools.ts` or `src/google/tools.ts` — `index.ts` picks
it up automatically.

## Notes

- Meta Graph API version: `v25.0` (released Feb 2026). Bump via `META_API_VERSION` env
  var when a new version ships and old one is sunset.
- Google Ads API version: `v23` — change in `src/google/client.ts`. Check
  https://developers.google.com/google-ads/api/docs/sunset-dates yearly.
- All currencies returned in major units (₹, S$), not micros.
