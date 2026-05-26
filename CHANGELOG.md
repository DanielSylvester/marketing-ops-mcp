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
