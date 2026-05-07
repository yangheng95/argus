/**
 * Dependency-based tiered grouping for parallel codegen.
 * Ported from mirror/src/infra/utils/tier-graph.ts.
 *
 * Uses `contracts.imports` as the single source of dependency truth. Plans
 * without explicit import contracts are rejected instead of being inferred from
 * filenames.
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

const RESOLVABLE_IMPORT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"] as const

/** Resolve an import path to a concrete `PlanFile.file_path` entry. */
function normalizeImportPath(importPath: string, allPaths: readonly string[]): string | undefined {
  const cleaned = importPath.replace(/^\.\//, "")

  if (allPaths.includes(cleaned)) return cleaned

  for (const ext of RESOLVABLE_IMPORT_EXTENSIONS) {
    const withExt = cleaned + ext
    if (allPaths.includes(withExt)) return withExt
  }

  for (const ext of RESOLVABLE_IMPORT_EXTENSIONS) {
    const indexPath = cleaned + "/index" + ext
    if (allPaths.includes(indexPath)) return indexPath
  }

  for (const p of allPaths) {
    if (p.endsWith("/" + cleaned) || p.endsWith("\\" + cleaned)) return p
    for (const ext of RESOLVABLE_IMPORT_EXTENSIONS) {
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
      const remaining = plan.filter((f) => !assigned.has(f.file_path)).map((f) => f.file_path)
      throw new Error(`Cannot build mirror tiers: circular or unsatisfied imports among ${remaining.join(", ")}`)
    }

    for (const f of tier) assigned.add(f.file_path)
    tiers.push(tier)
  }

  return tiers
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

  const missingContracts = plan.filter((f) => !f.contracts?.imports).map((f) => f.file_path)
  if (missingContracts.length > 0) {
    throw new Error(
      `Cannot build mirror tiers without explicit contracts.imports for: ${missingContracts.join(", ")}`,
    )
  }

  return buildContractTiers(plan)
}
