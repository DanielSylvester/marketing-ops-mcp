/**
 * Turso (libSQL) client for shared audit logging.
 *
 * marketing-ops-mcp writes to the same Turso DB as adpilot so that
 * a single query can reconstruct the full timeline:
 *   agent decisions → MCP tool calls → outcomes
 *
 * Env vars (optional — audit is best-effort):
 *   TURSO_DATABASE_URL   e.g. libsql://adpilot-xxx.turso.io
 *   TURSO_AUTH_TOKEN     read-write token
 */

import { createClient, type Client } from '@libsql/client'

let _client: Client | null = null

export function getTursoClient(): Client | null {
  if (_client) return _client

  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN

  if (!url || !authToken) {
    return null
  }

  _client = createClient({ url, authToken })
  return _client
}

export function isTursoConfigured(): boolean {
  return !!(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN)
}
