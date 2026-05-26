# Contributing

Thanks for your interest in contributing!

## Development Setup

```bash
npm install
npm run build
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Run with `tsx` (no compile step) |
| `npm run build` | Compile TypeScript |
| `npm run typecheck` | Type-check without emitting |
| `npm run lint` | Type-check + ESLint |
| `npm run format` | Prettier format |
| `npm test` | Unit tests (node:test + tsx) |
| `npm run test:stress` | Dry-run stress test (no API credentials needed) |

## Adding a New Channel

1. Create `src/<channel>/client.ts` with an API client following the retry/rate-limit patterns.
2. Create `src/<channel>/tools.ts` with flat-exported tool objects using Zod schemas.
3. Export `YOUR_CHANNEL_TOOLS` array from `tools.ts`.
4. Register the array in `src/index.ts` via `ALL_TOOLS`.
5. Add channel-specific config to `src/config.ts` (or a new `src/<channel>/config.ts`).
6. Add tests in `tests/<channel>-client.test.ts` using mocked `fetch`.
7. Update `scripts/stress-test.js` to test the new channel.

## Tool Patterns

- **Read tools**: Call the client, transform data, return plain objects.
- **Mutation tools**: Add `dry_run: z.boolean().optional().default(true)` to the schema. Check `args.dry_run` in the handler and return a preview when true.
- **Standard metrics**: Use `calculateStandardMetrics(map<Channel>Record(record))` for performance/demographics tools.

## Pull Request Process

1. Fork and create a feature branch.
2. Ensure `npm run lint` and `npm test` pass.
3. Open a PR against `main` with a clear description.
