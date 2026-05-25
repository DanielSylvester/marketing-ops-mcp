import { describe, it } from 'node:test'
import assert from 'node:assert'
import { logAudit, queryAudit } from '../src/audit.js'

describe('audit', () => {
  it('skips silently when Turso is not configured', async () => {
    delete process.env.TURSO_DATABASE_URL
    delete process.env.TURSO_AUTH_TOKEN

    // Should not throw
    await logAudit({
      tool: 'test',
      args: {},
      isMutation: false,
      isDryRun: false,
      durationMs: 10,
    })

    const rows = await queryAudit({ limit: 10 })
    assert.deepStrictEqual(rows, [])
  })
})
