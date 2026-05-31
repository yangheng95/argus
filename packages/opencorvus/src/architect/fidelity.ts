import fs from "fs"
import path from "path"
import { z } from "zod"
import type { VisualSpec } from "@/frontend-design/types"

export const SourceCoverageActionSchema = z.enum(["reuse", "modify", "preserve", "replace"])
export type SourceCoverageAction = z.infer<typeof SourceCoverageActionSchema>

export const SourceCoverageEntrySchema = z.object({
  id: z.string().min(1).describe("Stable source coverage id, e.g. src-router-shell"),
  paths: z.array(z.string().min(1)).min(1).describe("Existing source paths this row covers"),
  goal_ids: z.array(z.string().min(1)).min(1).describe("Goals responsible for these paths"),
  action: SourceCoverageActionSchema.describe("How the owned source surface is treated"),
  rationale: z.string().min(5).describe("Why this source surface belongs to those goals"),
})
export type SourceCoverageEntry = z.infer<typeof SourceCoverageEntrySchema>

export const ReferenceCoverageEntrySchema = z.object({
  id: z.string().min(1).describe("Stable reference coverage id, e.g. ref-hero-shell"),
  surface: z.string().min(1).describe("Reference surface or interaction area"),
  goal_ids: z.array(z.string().min(1)).min(1).describe("Goals responsible for this reference surface"),
  visual_spec_ids: z.array(z.string().min(1)).default([]).describe("Visual spec ids covered by this row"),
  expectation: z.string().min(5).describe("What must be preserved or restored from the reference"),
})
export type ReferenceCoverageEntry = z.infer<typeof ReferenceCoverageEntrySchema>

export const AssemblyOwnerEntrySchema = z.object({
  surface: z.string().min(1).describe("Shared assembly surface, e.g. app-shell, root-routing, final-deliverable"),
  goal_id: z.string().min(1).describe("Single owning goal id for the assembly surface"),
  rationale: z.string().min(5).describe("Why this goal owns final stitching for the surface"),
})
export type AssemblyOwnerEntry = z.infer<typeof AssemblyOwnerEntrySchema>

export interface ArchitectFidelityState {
  sourceCoverage: SourceCoverageEntry[]
  referenceCoverage: ReferenceCoverageEntry[]
  assemblyOwners: AssemblyOwnerEntry[]
}

export interface GoalCoverageShape {
  id: string
  owned_paths: string[]
}

export function emptyArchitectFidelityState(): ArchitectFidelityState {
  return {
    sourceCoverage: [],
    referenceCoverage: [],
    assemblyOwners: [],
  }
}

/**
 * Single source for path equality across architect fidelity checks and the
 * coverage checks. Architect inputs may arrive with mixed separators
 * (`src/foo` vs `src\foo`), trailing slashes, or `./` prefixes. Normalise
 * once so prefix containment and set membership agree.
 */
export function normalizeCoveragePath(input: string): string {
  const stripped = input.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/g, "")
  return stripped === "." ? "" : stripped
}

/**
 * Coverage row paths are container-level (e.g. `src`, `tests`); a goal's
 * owned_paths are leaf files (e.g. `src/main.tsx`). A coverage root must
 * match the leaf exactly OR be a directory ancestor. Empty root (".") is
 * the project root and covers everything.
 */
export function coverageContains(root: string, leaf: string): boolean {
  if (root === "") return true
  if (leaf === root) return true
  return leaf.startsWith(root + "/")
}

export function architectFidelityIssues(input: {
  goals: GoalCoverageShape[]
  fidelity: ArchitectFidelityState
  designSpecs?: VisualSpec[]
  workDir?: string
  requireSourceCoverage?: boolean
  requireReferenceCoverage?: boolean
}): string[] {
  const issues: string[] = []
  const goalIDs = new Set(input.goals.map((goal) => goal.id))
  const knownSpecIDs = new Set((input.designSpecs ?? []).map((spec) => spec.id))

  for (const row of input.fidelity.sourceCoverage) {
    const unknownGoals = row.goal_ids.filter((goalID) => !goalIDs.has(goalID))
    if (unknownGoals.length > 0) {
      issues.push(`Source coverage ${row.id}: references unknown goals ${unknownGoals.join(", ")}`)
    }
  }

  for (const row of input.fidelity.referenceCoverage) {
    const unknownGoals = row.goal_ids.filter((goalID) => !goalIDs.has(goalID))
    if (unknownGoals.length > 0) {
      issues.push(`Reference coverage ${row.id}: references unknown goals ${unknownGoals.join(", ")}`)
    }
    const unknownSpecIDs = row.visual_spec_ids.filter((specID) => !knownSpecIDs.has(specID))
    if (unknownSpecIDs.length > 0) {
      issues.push(`Reference coverage ${row.id}: references unknown visual specs ${unknownSpecIDs.join(", ")}`)
    }
  }

  const assemblySurfaceOwners = new Map<string, string>()
  for (const row of input.fidelity.assemblyOwners) {
    if (!goalIDs.has(row.goal_id)) {
      issues.push(`Assembly owner ${row.surface}: references unknown goal ${row.goal_id}`)
    }
    const existing = assemblySurfaceOwners.get(row.surface)
    if (existing && existing !== row.goal_id) {
      issues.push(`Assembly surface ${row.surface}: multiple owners registered (${existing}, ${row.goal_id})`)
      continue
    }
    assemblySurfaceOwners.set(row.surface, row.goal_id)
  }

  const shouldRequireSourceCoverage = input.requireSourceCoverage !== false
  const existingOwnedPaths = shouldRequireSourceCoverage ? input.goals.flatMap((goal) =>
    goal.owned_paths.filter((ownedPath) => {
      if (!input.workDir) return false
      try {
        return fs.existsSync(path.resolve(input.workDir, ownedPath))
      } catch {
        return false
      }
    }),
  ) : []

  if (existingOwnedPaths.length > 0) {
    if (input.fidelity.sourceCoverage.length === 0) {
      issues.push(
        `Missing source coverage for existing owned paths: ${existingOwnedPaths.join(", ")}`,
      )
    } else {
      const coverageRoots = input.fidelity.sourceCoverage.flatMap((row) =>
        row.paths.map(normalizeCoveragePath),
      )
      const uncoveredPaths = existingOwnedPaths.filter((ownedPath) => {
        const norm = normalizeCoveragePath(ownedPath)
        return !coverageRoots.some((root) => coverageContains(root, norm))
      })
      if (uncoveredPaths.length > 0) {
        issues.push(
          `Missing source coverage for existing owned paths: ${uncoveredPaths.join(", ")}`,
        )
      }
    }
  }

  const shouldRequireReferenceCoverage =
    Boolean(input.requireReferenceCoverage) || (input.designSpecs?.length ?? 0) > 0
  if (shouldRequireReferenceCoverage) {
    if (input.fidelity.referenceCoverage.length === 0) {
      const specIDs = (input.designSpecs ?? []).map((spec) => spec.id)
      if (specIDs.length > 0) {
        issues.push(`Missing reference coverage for visual specs: ${specIDs.join(", ")}`)
      } else {
        issues.push("Missing reference coverage: reference-driven tasks must register authoritative reference ownership")
      }
    } else if ((input.designSpecs?.length ?? 0) > 0) {
      const uncoveredSpecIDs = (input.designSpecs ?? [])
        .map((spec) => spec.id)
        .filter((specID) =>
          !input.fidelity.referenceCoverage.some((row) => row.visual_spec_ids.includes(specID)),
        )
      if (uncoveredSpecIDs.length > 0) {
        issues.push(`Missing reference coverage for visual specs: ${uncoveredSpecIDs.join(", ")}`)
      }
    }
  }

  if (input.goals.length >= 2 && input.fidelity.assemblyOwners.length === 0) {
    issues.push("Missing assembly ownership: multi-goal tasks must register at least one assembly owner")
  }

  return issues
}

export function filterGoalFidelityState(input: {
  goalID: string
  fidelity: ArchitectFidelityState
}) {
  return {
    sourceCoverage: input.fidelity.sourceCoverage.filter((row) => row.goal_ids.includes(input.goalID)),
    referenceCoverage: input.fidelity.referenceCoverage.filter((row) => row.goal_ids.includes(input.goalID)),
    assemblyOwners: input.fidelity.assemblyOwners,
  }
}
