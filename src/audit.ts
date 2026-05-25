/**
 * Audit logging for marketing-ops-mcp.
 *
 * Writes every tool call to the shared Turso DB (mcp_audit_log table).
 * This is best-effort: if Turso is unavailable or unconfigured, the tool
 * call still proceeds and a warning is printed to stderr.
 *
 * The adpilot agent can query this table to reconstruct "what did the
 * MCP server do on my behalf?" without scraping stdout.
 */

import { getTursoClient, isTursoConfigured } from './turso.js'

export interface AuditRecord {
  tool: string
  brand?: string | null
  customerId?: string | null
  args: unknown
  result?: unknown
  isMutation: boolean
  isDryRun: boolean
  error?: string | null
  durationMs: number
}

export async function logAudit(record: AuditRecord): Promise<void> {
  if (!isTursoConfigured()) {
    // Turso not configured — skip silently in production, warn in dev
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[audit] Turso not configured — set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN to enable audit logging')
    }
    return
  }

  const db = getTursoClient()
  if (!db) return

  try {
    await db.execute({
      sql: `INSERT INTO mcp_audit_log
            (tool, brand, customer_id, args_json, result_json, is_mutation, is_dry_run, error, duration_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        record.tool,
        record.brand ?? null,
        record.customerId ?? null,
        JSON.stringify(record.args),
        record.result !== undefined ? JSON.stringify(record.result).slice(0, 65535) : null,
        record.isMutation ? 1 : 0,
        record.isDryRun ? 1 : 0,
        record.error ?? null,
        record.durationMs,
      ],
    })
  } catch (err) {
    // Best-effort: never fail the tool call because audit logging failed
    console.error('[audit] Failed to write audit record:', (err as Error).message)
  }
}
