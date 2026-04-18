/**
 * Dependency-based tiered grouping for parallel codegen.
 * Ported from mirror/src/infra/utils/tier-graph.ts.
 *
 * Two strategies:
 *   1. Contract-based (when `contracts.imports` is available):
 *      Kahn-style topological sort on the import dependency graph.
 *   2. Heuristic fallback (no contracts):
 *      - Tier 0: foundation files (constants, types, config, CSS, utils)
 *      - Tier 1..N: remaining files chunked by plan order (~4 per tier)
 *
 * Both ensure earlier tiers' code is visible to later tiers while files
 * within a tier can be generated in parallel.
 *
 * This module is generic over any object with `file_path` and an optional
 * `contracts.imports` map, so it stays decoupled from the Zod `PlanFile`
 * schema that lives under `mirror/ir/scaffold.ts`.
 */

/**
 * Minimal shape required for tiering. Any object with `file_path` plus an
 * optional `contracts.imports` map can be tiered — including the full Zod
 * `PlanFile` defined in `mirror/ir/scaffold.ts` (added in Phase B).
 */
export interface TierPlanFile {
  file_path: string
  contracts?: {
    imports?: Record<string, unknown>
  }
}

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"] as const

/** Resolve an import path to a concrete `PlanFile.file_path` entry. */
function normalizeImportPath(importPath: string, allPaths: readonly string[]): string | undefined {
  const cleaned = importPath.replace(/^\.\//, "")

  if (allPaths.includes(cleaned)) return cleaned

  for (const ext of EXTENSIONS) {
    const withExt = cleaned + ext
    if (allPaths.includes(withExt)) return withExt
  }

  for (const ext of EXTENSIONS) {
    const indexPath = cleaned + "/index" + ext
    if (allPaths.includes(indexPath)) return indexPath
  }

  for (const p of allPaths) {
    if (p.endsWith("/" + cleaned) || p.endsWith("\\" + cleaned)) return p
    for (const ext of EXTENSIONS) {
      if (p.endsWith("/" + cleaned + ext) || p.endsWith("\\" + cleaned + ext)) return p
    }
  }

  return undefined
}

/** Adjacency list: `file_path → set of file_paths it imports`. */
export function buildDependencyGraph<T extends TierPlanFile>(plan: readonly T[]): Map<string, Set<string>> {
  const allPaths = plan.map((f) => f.file_path)
  const deps = new Map<string, Set<string>>()

  for (const file of plan) {
    deps.set(file.file_path, new Set())
  }

  for (const file of plan) {
    const imports = file.contracts?.imports
    if (!imports) continue

    for (const importPath of Object.keys(imports)) {
      const resolved = normalizeImportPath(importPath, allPaths)
      if (resolved && resolved !== file.file_path) {
        deps.get(file.file_path)!.add(resolved)
      }
    }
  }

  return deps
}

function buildContractTiers<T extends TierPlanFile>(plan: readonly T[]): T[][] {
  const deps = buildDependencyGraph(plan)
  const assigned = new Set<string>()
  const tiers: T[][] = []

  let maxIterations = plan.length + 1
  while (assigned.size < plan.length && maxIterations-- > 0) {
    const tier: T[] = []

    for (const file of plan) {
      if (assigned.has(file.file_path)) continue

      const fileDeps = deps.get(file.file_path) ?? new Set<string>()
      const allDepsAssigned = [...fileDeps].every((d) => assigned.has(d))
      if (allDepsAssigned) tier.push(file)
    }

    if (tier.length === 0) {
      // Circular dependencies — dump the remainder into a single tier.
      const remaining = plan.filter((f) => !assigned.has(f.file_path))
      tiers.push(remaining)
      break
    }

    for (const f of tier) assigned.add(f.file_path)
    tiers.push(tier)
  }

  return tiers
}

/** Foundation filename patterns (constants, types, config, CSS, utils). */
const FOUNDATION_PATTERNS: readonly RegExp[] = [
  /constant/i,
  /config/i,
  /types?\./i,
  /theme/i,
  /data\./i,
  /mock/i,
  /utils?\./i,
  /helpers?\./i,
  /\.css$/i,
  /\.scss$/i,
  /styles?\./i,
  /tokens?\./i,
  /enum/i,
  /context\./i,
  /store\./i,
  /api\./i,
  /service\./i,
]

function isFoundationFile(filePath: string): boolean {
  const name = filePath.split("/").pop() ?? filePath
  return FOUNDATION_PATTERNS.some((p) => p.test(name))
}

function buildHeuristicTiers<T extends TierPlanFile>(plan: readonly T[]): T[][] {
  if (plan.length <= 2) return [plan.slice()]

  const foundation: T[] = []
  const rest: T[] = []

  for (const file of plan) {
    if (isFoundationFile(file.file_path)) foundation.push(file)
    else rest.push(file)
  }

  const tiers: T[][] = []

  if (foundation.length > 0) tiers.push(foundation)

  if (rest.length > 0) {
    const TARGET_TIER_SIZE = 4
    const numTiers = Math.max(1, Math.ceil(rest.length / TARGET_TIER_SIZE))
    const tierSize = Math.ceil(rest.length / numTiers)
    for (let i = 0; i < rest.length; i += tierSize) {
      tiers.push(rest.slice(i, i + tierSize))
    }
  }

  return tiers.length > 0 ? tiers : [plan.slice()]
}

/**
 * Heuristic dependency graph (contracts absent): foundation files have no
 * deps; non-foundation files depend on every foundation file plus a chained
 * edge back `TARGET_GROUP` positions to preserve plan order while allowing
 * parallelism within each group.
 */
export function buildHeuristicDependencyGraph<T extends TierPlanFile>(plan: readonly T[]): Map<string, Set<string>> {
  const deps = new Map<string, Set<string>>()
  for (const file of plan) deps.set(file.file_path, new Set())

  if (plan.length <= 2) return deps

  const foundationPaths: string[] = []
  const restPaths: string[] = []

  for (const file of plan) {
    if (isFoundationFile(file.file_path)) foundationPaths.push(file.file_path)
    else restPaths.push(file.file_path)
  }

  for (const r of restPaths) {
    for (const f of foundationPaths) {
      deps.get(r)!.add(f)
    }
  }

  const GROUP = 4
  for (let i = GROUP; i < restPaths.length; i++) {
    deps.get(restPaths[i])!.add(restPaths[i - GROUP])
  }

  return deps
}

/**
 * Partition a plan into tiers for parallel codegen.
 *
 * Guarantees:
 *   - ≥ 1 tier returned when plan is non-empty
 *   - Files in earlier tiers have no dependencies on later tiers
 *   - Files within a tier are safe to process in parallel
 */
export function buildTiers<T extends TierPlanFile>(plan: readonly T[]): T[][] {
  if (plan.length === 0) return []

  const hasContracts = plan.some((f) => f.contracts?.imports)
  if (hasContracts) return buildContractTiers(plan)

  return buildHeuristicTiers(plan)
}
