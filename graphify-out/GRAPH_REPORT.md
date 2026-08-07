# Graph Report - /Users/danielsylvesterantony/Github/marketing-ops-mcp  (2026-08-07)

## Corpus Check
- 32 files · ~0 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 339 nodes · 497 edges · 16 communities (15 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `0b06f199`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Package
- Package 2
- Src Config
- Scripts Stress Test
- Src Index
- Src Google Client
- Src Google Tools
- Src Linkedin Client 2
- Src Meta Tools
- Src Linkedin Tools
- Src Linkedin Client
- Tests Meta Client Test
- Tests Gads Mutations Test
- Tsconfig

## God Nodes (most connected - your core abstractions)
1. `LinkedInClient` - 45 edges
2. `MetaClient` - 18 edges
3. `compilerOptions` - 16 edges
4. `getMetaAccount()` - 15 edges
5. `GoogleAdsClient` - 12 edges
6. `scripts` - 10 edges
7. `queryAudit()` - 7 edges
8. `runTests()` - 6 edges
9. `listConfiguredMetaBrands()` - 6 edges
10. `setCampaignStatus()` - 6 edges

## Surprising Connections (you probably didn't know these)
- `test()` --calls--> `getMetaAccount()`  [EXTRACTED]
  scripts/dry-run-final.ts → src/config.ts
- `test()` --calls--> `getMetaAccount()`  [EXTRACTED]
  scripts/dry-run-meta-2.ts → src/config.ts
- `dryRun()` --calls--> `getMetaAccount()`  [EXTRACTED]
  scripts/dry-run-meta.ts → src/config.ts
- `safeTest()` --calls--> `getMetaAccount()`  [EXTRACTED]
  scripts/live-safe-test.ts → src/config.ts
- `verify()` --calls--> `getMetaAccount()`  [EXTRACTED]
  scripts/verify.ts → src/config.ts

## Import Cycles
- None detected.

## Communities (16 total, 1 thin omitted)

### Community 4 - "Package"
Cohesion: 0.07
Nodes (27): name, version, description, type, bin, marketing-ops-mcp, scripts, build (+19 more)

### Community 9 - "Package 2"
Cohesion: 0.12
Nodes (17): devDependencies, @eslint/js, @eslint/js, @types/node, @types/node, eslint, eslint, eslint-config-prettier (+9 more)

### Community 2 - "Src Config"
Cohesion: 0.12
Nodes (19): test(), test(), dryRun(), safeTest(), verify(), Brand, CURRENCY_SYMBOLS, MetaAccountConfig (+11 more)

### Community 11 - "Scripts Stress Test"
Cohesion: 0.24
Nodes (11): __dirname, SERVER_PATH, COLORS, errors, pass(), fail(), info(), pendingRequests (+3 more)

### Community 5 - "Src Index"
Cohesion: 0.12
Nodes (22): AuditRecord, logAudit(), AuditQuery, queryAudit(), safeJson(), GOOGLE_ADS_TOOLS, ToolDef, ALL_TOOLS (+14 more)

### Community 7 - "Src Google Client"
Cohesion: 0.15
Nodes (6): GoogleAdsConfig, GoogleAdsClientError, GoogleAdsClient, TEST_CONFIG, fetchCalls, fetchResponseQueue

### Community 3 - "Src Google Tools"
Cohesion: 0.08
Nodes (27): envOrThrow(), getGoogleAdsConfig(), client(), getClient(), DateRange, gads_gaql_search, gads_list_ad_groups, gads_list_keywords (+19 more)

### Community 10 - "Src Linkedin Client 2"
Cohesion: 0.17
Nodes (9): LinkedInApiError, McpToolError, DEFAULT_PERFORMANCE_METRICS, DEFAULT_CREATIVE_METRICS, VIDEO_METRICS, LEAD_GEN_METRICS, REACH_METRICS, RequestOptions (+1 more)

### Community 6 - "Src Meta Tools"
Cohesion: 0.10
Nodes (22): setCampaignStatus(), BrandSchema, clientFor(), meta_list_accounts, meta_list_campaigns, meta_insights, meta_get_creative, meta_download_creatives (+14 more)

### Community 0 - "Src Linkedin Tools"
Cohesion: 0.05
Nodes (43): mapLinkedInRecord(), extractMetaSpend(), extractMetaConversions(), mapMetaRecord(), mapGoogleAdsRecord(), StandardMetrics, NormalizedRecord, calculateStandardMetrics() (+35 more)

### Community 12 - "Tests Meta Client Test"
Cohesion: 0.25
Nodes (4): MetaClientError, TEST_ACCOUNT, fetchCalls, fetchResponseQueue

### Community 13 - "Tests Gads Mutations Test"
Cohesion: 0.32
Nodes (4): MockClient, fmtAmount(), canonical(), confirmPhrase()

### Community 8 - "Tsconfig"
Cohesion: 0.11
Nodes (18): compilerOptions, target, module, moduleResolution, outDir, rootDir, strict, esModuleInterop (+10 more)

## Knowledge Gaps
- **141 isolated node(s):** `name`, `version`, `description`, `type`, `marketing-ops-mcp` (+136 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `LinkedInClient` connect `Src Linkedin Client` to `Src Linkedin Tools`, `Src Linkedin Client 2`?**
  _High betweenness centrality (0.172) - this node is a cross-community bridge._
- **Why does `MetaClient` connect `Src Config` to `Tests Meta Client Test`, `Src Meta Tools`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **Why does `GoogleAdsClient` connect `Src Google Client` to `Src Google Tools`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _141 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Package` be split into smaller, more focused modules?**
  _Cohesion score 0.07142857142857142 - nodes in this community are weakly interconnected._
- **Should `Package 2` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._
- **Should `Src Config` be split into smaller, more focused modules?**
  _Cohesion score 0.12012012012012012 - nodes in this community are weakly interconnected._