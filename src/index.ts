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
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { META_TOOLS } from './meta/tools.js'
import { GOOGLE_ADS_TOOLS } from './google/tools.js'
import { isGoogleAdsConfigured, listConfiguredMetaBrands } from './config.js'

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

const server = new Server(
  { name: 'marketing-ops-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } },
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

  try {
    const args = tool.inputSchema.parse(req.params.arguments ?? {})
    const result = await tool.handler(args)
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true }
  }
})

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // Stderr only — stdout is reserved for MCP protocol.
  const meta = listConfiguredMetaBrands()
  const gads = isGoogleAdsConfigured() ? 'configured' : 'not configured'
  console.error(`[marketing-ops-mcp] up. Meta brands: ${meta.join(', ') || 'none'}. Google Ads: ${gads}.`)
}

main().catch(err => {
  console.error('[marketing-ops-mcp] fatal:', err)
  process.exit(1)
})
