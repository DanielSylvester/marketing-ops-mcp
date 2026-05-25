#!/usr/bin/env node
/**
 * marketing-ops-mcp — MCP server for Meta Ads + Google Ads.
 *
 * Transport: stdio (run by Claude Code).
 *
 * Each user supplies their own tokens via env vars or a .env file passed by the
 * client launching this server. See README and .env.example for what to set.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ListResourceTemplatesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { META_TOOLS } from './meta/tools.js'
import { GOOGLE_ADS_TOOLS } from './google/tools.js'
import { isGoogleAdsConfigured, listConfiguredMetaBrands } from './config.js'
import { logAudit, queryAudit } from './audit.js'

type ToolDef = {
  name: string
  description: string
  inputSchema: any
  handler: (args: any) => Promise<any>
}

const ALL_TOOLS: ToolDef[] = [
  ...META_TOOLS as unknown as ToolDef[],
  ...GOOGLE_ADS_TOOLS as unknown as ToolDef[],
]

const TOOL_BY_NAME = new Map(ALL_TOOLS.map(t => [t.name, t]))

/** Heuristic: tool names containing these substrings are mutations. */
const MUTATION_PATTERNS = ['create_', 'update_', 'add_', 'pause_', 'resume_', 'delete_', 'upload_']
function isMutationTool(name: string): boolean {
  return MUTATION_PATTERNS.some(p => name.includes(p))
}

const server = new Server(
  { name: 'marketing-ops-mcp', version: '0.2.0' },
  { capabilities: { tools: {}, resources: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: ALL_TOOLS.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema),
    })),
  }
})

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = TOOL_BY_NAME.get(req.params.name)
  if (!tool) {
    return { content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }], isError: true }
  }

  const start = Date.now()
  const isMutation = isMutationTool(tool.name)
  const args = tool.inputSchema.parse(req.params.arguments ?? {})
  const dryRun = isMutation && (args.dry_run === true || args.dry_run !== false)

  try {
    const result = await tool.handler(args)
    const duration = Date.now() - start

    // Best-effort audit log (never blocks the tool call)
    logAudit({
      tool: tool.name,
      brand: args.brand ?? null,
      customerId: args.customer_id ?? args.campaign_id?.toString().slice(0, 10) ?? null,
      args,
      result,
      isMutation,
      isDryRun: dryRun,
      durationMs: duration,
    }).catch(() => { /* silently ignore audit failures */ })

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  } catch (err) {
    const duration = Date.now() - start
    const msg = err instanceof Error ? err.message : String(err)

    logAudit({
      tool: tool.name,
      brand: args.brand ?? null,
      customerId: args.customer_id ?? args.campaign_id?.toString().slice(0, 10) ?? null,
      args,
      error: msg,
      isMutation,
      isDryRun: dryRun,
      durationMs: duration,
    }).catch(() => { /* silently ignore audit failures */ })

    return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true }
  }
})

// --- Audit log as MCP Resources ------------------------------------------------

const STATIC_RESOURCES = [
  {
    uri: 'audit://recent',
    name: 'Recent activity',
    description: 'The 50 most recent marketing-ops-mcp tool calls (reads and mutations).',
    mimeType: 'application/json',
  },
  {
    uri: 'audit://mutations',
    name: 'Recent mutations',
    description: 'The 50 most recent mutation attempts, including dry-runs.',
    mimeType: 'application/json',
  },
]

const RESOURCE_TEMPLATE = {
  uriTemplate: 'audit://log{?limit,tool,brand,mutations_only,errors_only,since}',
  name: 'Audit log query',
  description:
    'Query the audit log. Params: limit (1-500, default 50), tool, brand, ' +
    'mutations_only=true, errors_only=true, since=<ISO timestamp>. Newest first.',
  mimeType: 'application/json',
}

async function readAuditResource(uri: string): Promise<Record<string, unknown>[]> {
  const u = new URL(uri)
  if (u.protocol !== 'audit:') throw new Error(`Unknown resource: ${uri}`)
  const host = u.hostname
  if (host === 'recent') return queryAudit({ limit: 50 })
  if (host === 'mutations') return queryAudit({ mutationsOnly: true, limit: 50 })
  if (host === 'log') {
    const p = u.searchParams
    const n = p.get('limit')
    return queryAudit({
      limit: n ? Number(n) : 50,
      tool: p.get('tool') ?? undefined,
      brand: p.get('brand') ?? undefined,
      mutationsOnly: p.get('mutations_only') === 'true',
      errorsOnly: p.get('errors_only') === 'true',
      since: p.get('since') ?? undefined,
    })
  }
  throw new Error(`Unknown resource: ${uri}`)
}

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: STATIC_RESOURCES,
}))

server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
  resourceTemplates: [RESOURCE_TEMPLATE],
}))

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params
  const rows = await readAuditResource(uri)
  return {
    contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(rows, null, 2) }],
  }
})

// --- Main ----------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // Stderr only — stdout is reserved for MCP protocol.
  const meta = listConfiguredMetaBrands()
  const gads = isGoogleAdsConfigured() ? 'configured' : 'not configured'
  const turso = process.env.TURSO_DATABASE_URL ? 'connected' : 'not configured'
  console.error(`[marketing-ops-mcp] up. Meta: ${meta.join(', ') || 'none'}. GAds: ${gads}. Turso: ${turso}.`)
}

main().catch(err => {
  console.error('[marketing-ops-mcp] fatal:', err)
  process.exit(1)
})
