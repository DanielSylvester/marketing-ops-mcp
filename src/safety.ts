/**
 * Safety gating for marketing-ops-mcp mutations.
 *
 * Two gates (simplified from gads-mcp — no typed confirmation string):
 *   1. dry_run defaults to true (per-call opt-in)
 *   2. MARKETING_OPS_MCP_EXECUTE=1 env gate
 *
 * Reads are never gated. Audit logging is best-effort and happens regardless.
 */

export interface ExecuteGate {
  execute: boolean
  reason?: string
}

export function shouldExecute(toolName: string): ExecuteGate {
  const enabled = process.env.MARKETING_OPS_MCP_EXECUTE === '1'
  if (!enabled) {
    return {
      execute: false,
      reason: `MARKETING_OPS_MCP_EXECUTE is not set to 1. Pass dry_run: false AND set MARKETING_OPS_MCP_EXECUTE=1 to apply ${toolName}.`,
    }
  }
  return { execute: true }
}

export function isDryRun(args: { dry_run?: boolean }): boolean {
  // Default to true (safe) unless explicitly set to false
  return args.dry_run !== false
}

export interface DryRunResult {
  applied: false
  dry_run: true
  preview: unknown
  reason: string
}

export function dryRunResult(preview: unknown): DryRunResult {
  return {
    applied: false,
    dry_run: true,
    preview,
    reason: 'dry_run is true (default). Pass dry_run: false AND set MARKETING_OPS_MCP_EXECUTE=1 to apply.',
  }
}
