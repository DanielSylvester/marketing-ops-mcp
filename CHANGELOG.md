# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-05-25

### Added
- **LinkedIn Ads channel** — 31 tools covering accounts, campaigns, creatives, audiences, conversions, and analytics.
- **Shared metrics library** (`src/lib/metrics.ts`) — Standard KPI calculator (CTR, CPC, CPM, conversion rate, etc.) used across all channels.
- **Channel mappers** (`src/lib/mappers.ts`) — Normalize raw API records from Meta, Google Ads, and LinkedIn into a common shape.
- **Enhanced API clients** — Retry logic, exponential backoff, rate-limit handling for Meta and Google Ads clients.
- **Dry-run stress test** (`scripts/stress-test.js`) — Validates the unified server without real API credentials.
- **ESLint + Prettier** — Code quality and formatting.
- **GitHub Actions CI** — Build, lint, unit tests, and stress test on Node 20/22.

### Changed
- Meta and Google Ads clients now use `MetaClientError` / `GoogleAdsClientError` with status codes and retry-after support.

## [0.1.0] - 2026-05-04

### Added
- Initial MCP server for Meta Ads + Google Ads.
- Zod-based input validation with auto JSON Schema generation.
- Mutation safety gates (`dry_run` default-true, `MARKETING_OPS_MCP_EXECUTE=1`).
- Turso audit logging for all tool calls.
- MCP Resource endpoints (`audit://recent`, `audit://mutations`).
## 2026-08-07 16:30:14 — 7ba4a589a72d58e4e45a4656c5a806cc01c99593

**Message:** graphify: add per-repo knowledge graph and OpenCode plugin

**Files:** .gitignore,.opencode/opencode.json .opencode/plugins/graphify.js,AGENTS.md graphify-out/.graphify_analysis.json,graphify-out/.graphify_labels.json graphify-out/.graphify_root,graphify-out/GRAPH_REPORT.md graphify-out/graph.json,graphify-out/manifest.json

## 2026-08-07 16:36:07 — aa845d9c250ae28e8fb9ed44a151ae2a0a12d7b6

**Message:** graphify: improve heuristic community labels

**Files:** graphify-out/.graphify_labels.json,graphify-out/GRAPH_REPORT.md graphify-out/graph.json

## 2026-09-05 18:33:43 — 7ef58148db2ba5ab62e0af609a114ca31b0ccbba

**Message:** chore: ignore graft cache, keep graft greppable via .ignore

**Files:** .gitignore,.ignore

