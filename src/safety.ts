/**
 * Safety gating for marketing-ops-mcp mutations.
 *
 * Simplified model (aligned with gads-mcp):
 *   1. dry_run defaults to true (per-call opt-in)
 *   2. High-impact threshold guard for large budget changes
 *
 * No server-wide env var gate. Reads are never gated.
 */

export interface ExecuteGate {
  execute: boolean
  reason?: string
}

export function shouldExecute(toolName: string): ExecuteGate
export function shouldExecute(opts: {
  toolName: string
  costImpactAbsolute?: number
  confirmHighImpact?: boolean
}): ExecuteGate
export function shouldExecute(
  arg: string | { toolName: string; costImpactAbsolute?: number; confirmHighImpact?: boolean }
): ExecuteGate {
  if (typeof arg === 'string') {
    return { execute: true }
  }
  const threshold = Number(process.env.MARKETING_OPS_MCP_HIGH_IMPACT_THRESHOLD || '5000')
  if (
    threshold > 0 &&
    typeof arg.costImpactAbsolute === 'number' &&
    arg.costImpactAbsolute > threshold &&
    !arg.confirmHighImpact
  ) {
    return {
      execute: false,
      reason: `High-impact change blocked: cost impact ${arg.costImpactAbsolute} exceeds threshold ${threshold}. Pass confirm_high_impact: true to override.`,
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
    reason: 'dry_run is true (default). Pass dry_run: false to apply.',
  }
}
