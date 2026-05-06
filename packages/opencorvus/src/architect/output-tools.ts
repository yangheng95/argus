/**
 * Zod-validated tool calls for the Architect Agent.
 *
 * The Architect is the authoritative goal decomposer: it registers goals,
 * traceability, fidelity coverage, assembly ownership, and cross-goal contracts.
 * Every registration path writes into a single collector; the
 * orchestrator tool reads the finalized collector after the agent session
 * ends and performs DB upsert + event emission in one place.
 *
 * Small tool calls (~500 bytes each) avoid the streaming buffering that a
 * monolithic submit tool would trigger for TypeScript source inside `spec`
 * or long acceptance criteria.
 */
import { tool } from "ai"
import z from "zod"
import path from "path"
import fs from "fs"
import { Instance } from "@/project/instance"
import {
  GoalContractFieldsSchema,
  GoalContractUpdateSchema,
  normalizeGoalContractFields,
  normalizeGoalContractUpdate,
} from "@/pipeline/goal-contract.schema"
import type { AcceptanceSpec } from "@/acceptance/types"
import type { VisualSpec } from "@/design-analyst/types"
import type {
  ArchitectContract,
  ArchitectDecisionKey,
  TraceabilityEntry,
} from "./types"
import {
  architectFidelityIssues,
  AssemblyOwnerEntrySchema,
  SourceCoverageEntrySchema,
  ReferenceCoverageEntrySchema,
} from "./fidelity"

// ---------------------------------------------------------------------------
// Collector — single buffer for the full Architect output
// ---------------------------------------------------------------------------

export interface RegisteredGoal {
  id: string
  title: string
  objective: string
  acceptance_specs: AcceptanceSpec[]
  owned_paths: string[]
  depends_on: string[]
  exports: string[]
  imports: string[]
  priority: "blocking" | "advisory"
  kind: "bootstrap" | "feature" | "verification" | "integration" | "system"
  requirement_ids: string[]
}

export interface RegisteredContract {
  category: ArchitectDecisionKey
  title: string
  spec: string
  goalIDs: string[]
}

export interface ArchitectCollector {
  goals: RegisteredGoal[]
  traceability: TraceabilityEntry[]
  source_coverage: Array<z.infer<typeof SourceCoverageEntrySchema>>
  reference_coverage: Array<z.infer<typeof ReferenceCoverageEntrySchema>>
  assembly_owners: Array<z.infer<typeof AssemblyOwnerEntrySchema>>
  contracts: RegisteredContract[]
  /** Goal IDs the agent has explicitly removed during a re-run session. */
  removed_goal_ids: string[]
  summary: string
  finalized: boolean
}

const VALID_CONTRACT_CATEGORIES: ArchitectDecisionKey[] = [
  "directory_blueprint",
  "interface_contract",
  "export_manifest",
  "shared_type",
  "naming_convention",
  "dependency_order",
]

function toRegisteredGoal(input: unknown): RegisteredGoal {
  const parsed = normalizeGoalContractFields(
    input as Parameters<typeof normalizeGoalContractFields>[0],
  )
  return {
    ...parsed,
    kind: parsed.kind,
  }
}

function emptyCollector(): ArchitectCollector {
  return {
    goals: [],
    traceability: [],
    source_coverage: [],
    reference_coverage: [],
    assembly_owners: [],
    contracts: [],
    removed_goal_ids: [],
    summary: "",
    finalized: false,
  }
}

export function architectValidationIssues(
  collector: ArchitectCollector,
  input?: { workDir?: string; designSpecs?: VisualSpec[]; requireReferenceCoverage?: boolean },
): string[] {
  const issues: string[] = []

  if (collector.goals.length === 0) {
    issues.push("No goals registered - Architect must produce at least one goal")
  }
  const knownGoalIDs = new Set(collector.goals.map((g) => g.id))
  const requiredTraceability = new Map<string, Set<string>>()
  const bootstrapGoals = collector.goals.filter((g) => g.kind === "bootstrap")
  if (bootstrapGoals.length > 1) {
    issues.push(
      `Exactly one bootstrap goal is allowed in an active goal graph; found ${bootstrapGoals.length}`,
    )
  } else if (bootstrapGoals.length === 1) {
    const bootstrapGoal = bootstrapGoals[0]
    const missingBootstrapDeps = collector.goals
      .filter((g) => g.id !== bootstrapGoal.id)
      .filter((g) => !g.depends_on.includes(bootstrapGoal.id))
      .map((g) => g.id)
    if (missingBootstrapDeps.length > 0) {
      issues.push(
        `Bootstrap goal ${bootstrapGoal.id}: every non-bootstrap goal must list it in depends_on; missing ${missingBootstrapDeps.join(", ")}`,
      )
    }
  }

  for (const g of collector.goals) {
    if (
      g.kind !== "verification" &&
      g.kind !== "system" &&
      g.exports.length === 0
    ) {
      issues.push(`Goal ${g.id}: ${g.kind} goal must declare at least one export`)
    }
    const nonBootstrapDeps = g.depends_on.filter(
      (depID) => !bootstrapGoals.some((bootstrap) => bootstrap.id === depID),
    )
    if (nonBootstrapDeps.length > 0 && g.imports.length === 0) {
      issues.push(`Goal ${g.id}: depends_on is set but imports is empty`)
    }
    for (const spec of g.acceptance_specs) {
      if (spec.goal_id !== g.id) {
        issues.push(`Goal ${g.id}: acceptance spec ${spec.id} has mismatched goal_id "${spec.goal_id}"`)
      }
    }
    for (const requirementID of g.requirement_ids) {
      if (!requiredTraceability.has(requirementID)) {
        requiredTraceability.set(requirementID, new Set())
      }
      requiredTraceability.get(requirementID)!.add(g.id)
    }
    if (
      g.exports.length === 0 &&
      g.kind !== "verification" &&
      g.kind !== "system"
    ) {
      const hasConsumers = collector.goals.some((other) =>
        other.depends_on.includes(g.id),
      )
      if (hasConsumers) {
        issues.push(
          `Goal ${g.id}: has dependents but no exports - dependents can't code against its interfaces`,
        )
      }
    }
    for (const dep of g.depends_on) {
      if (!collector.goals.some((gl) => gl.id === dep)) {
        issues.push(`Goal ${g.id}: depends_on "${dep}" not registered`)
      }
    }

  }

  const verificationGoals = collector.goals.filter((g) => g.kind === "verification")
  if (verificationGoals.length === 0) {
    issues.push("Missing dedicated verification goal - register exactly one kind=\"verification\" test goal")
  } else if (verificationGoals.length > 1) {
    issues.push(`Exactly one dedicated verification goal is required; found ${verificationGoals.length}`)
  } else {
    const verificationGoal = verificationGoals[0]
    const missingFeatureDeps = collector.goals
      .filter((g) => g.kind === "feature")
      .map((g) => g.id)
      .filter((id) => !verificationGoal.depends_on.includes(id))
    if (missingFeatureDeps.length > 0) {
      issues.push(
        `Verification goal ${verificationGoal.id}: missing depends_on feature goals ${missingFeatureDeps.join(", ")}`,
      )
    }
    const invalidOwnedPaths = verificationGoal.owned_paths.filter(
      (p) => !/^tests[\\/](integration|e2e|regression)[\\/]/.test(p),
    )
    if (invalidOwnedPaths.length > 0) {
      issues.push(
        `Verification goal ${verificationGoal.id}: owned_paths must stay under tests/integration, tests/e2e, or tests/regression: ${invalidOwnedPaths.join(", ")}`,
      )
    }
  }

  for (const contract of collector.contracts) {
    const unknownGoalIDs = contract.goalIDs.filter((goalID) => !knownGoalIDs.has(goalID))
    if (unknownGoalIDs.length > 0) {
      issues.push(`Contract "${contract.title}": references unknown goals ${unknownGoalIDs.join(", ")}`)
    }
  }

  const traceabilityByRequirement = new Map<string, Set<string>>()
  for (const row of collector.traceability) {
    const mappedGoalIDs = traceabilityByRequirement.get(row.requirementID) ?? new Set<string>()
    for (const goalID of row.goalIDs) {
      if (!knownGoalIDs.has(goalID)) {
        issues.push(`Traceability ${row.requirementID}: references unknown goal "${goalID}"`)
      }
      mappedGoalIDs.add(goalID)
    }
    traceabilityByRequirement.set(row.requirementID, mappedGoalIDs)
  }
  for (const [requirementID, goalIDs] of requiredTraceability) {
    const mappedGoalIDs = traceabilityByRequirement.get(requirementID)
    if (!mappedGoalIDs) {
      issues.push(
        `Missing traceability for ${requirementID}: call register_traceability with goals ${[...goalIDs].join(", ")}`,
      )
      continue
    }
    const missingGoalIDs = [...goalIDs].filter((goalID) => !mappedGoalIDs.has(goalID))
    if (missingGoalIDs.length > 0) {
      issues.push(
        `Traceability ${requirementID}: missing goal mappings ${missingGoalIDs.join(", ")}`,
      )
    }
  }

  const categories = new Set(collector.contracts.map((c) => c.category))
  if (collector.goals.length >= 2) {
    if (
      !categories.has("interface_contract") &&
      !categories.has("shared_type")
    ) {
      issues.push(
        "No interface_contract or shared_type contract - cross-goal types will be undefined",
      )
    }
  }

  issues.push(
    ...architectFidelityIssues({
      goals: collector.goals.map((goal) => ({ id: goal.id, owned_paths: goal.owned_paths })),
      fidelity: {
        sourceCoverage: collector.source_coverage,
        referenceCoverage: collector.reference_coverage,
        assemblyOwners: collector.assembly_owners,
      },
      designSpecs: input?.designSpecs,
      workDir: input?.workDir,
      requireReferenceCoverage: input?.requireReferenceCoverage,
    }),
  )

  return issues
}

export function isArchitectReadyToFinalize(
  collector: ArchitectCollector,
  input?: { workDir?: string; designSpecs?: VisualSpec[]; requireReferenceCoverage?: boolean },
): boolean {
  return architectValidationIssues(collector, input).length === 0
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createArchitectOutputTools(input: {
  /**
   * Goals already persisted from prior runs. During a re-run the Architect
   * may modify or remove these; a fresh run receives an empty list.
   */
  existingGoals?: RegisteredGoal[]
  workDir?: string
  designSpecs?: VisualSpec[]
  requireReferenceCoverage?: boolean
}) {
  let collector = emptyCollector()
  const dir = input.workDir ?? Instance.directory

  // Seed the collector with existing goals so modify_goal / remove_goal work
  // without the LLM having to re-register them first. register_goal still
  // wins if the LLM chooses to overwrite an existing id.
  if (input.existingGoals?.length) {
    for (const g of input.existingGoals) collector.goals.push(toRegisteredGoal(g))
  }

  const tools = {
    register_goal: tool({
      description:
        "Register a new goal contract, or overwrite a prior registration with " +
        "the same id. Each goal will execute in an isolated worktree — the " +
        "objective MUST be self-contained (executor sees only this goal). All " +
        "fields are schema-validated. On re-runs, use an existing id only for " +
        "the same logical goal; use a new id only for a genuinely new goal. " +
        "Persistence preserves existing G numbers and assigns new goals the " +
        "next unused G number.",
      inputSchema: GoalContractFieldsSchema,
      execute: async (input) => {
        const goal = toRegisteredGoal(input)
        const warnings: string[] = []
        for (const p of goal.owned_paths) {
          try {
            const abs = path.resolve(dir, p)
            if (!fs.existsSync(abs) && !fs.existsSync(path.dirname(abs))) {
              warnings.push(p)
            }
          } catch { /* cross-platform path issues — skip */ }
        }

        const existingIdx = collector.goals.findIndex((g) => g.id === goal.id)
        let msg: string
        if (existingIdx >= 0) {
          collector.goals[existingIdx] = goal
          msg = `OK: goal "${goal.id}" updated in-place (${collector.goals.length} total)`
        } else {
          collector.goals.push(goal)
          msg = `OK: goal "${goal.id}" registered (${collector.goals.length} total)`
        }
        // A newly registered/updated id cannot also be in the removal list.
        collector.removed_goal_ids = collector.removed_goal_ids.filter(
          (id) => id !== goal.id,
        )
        if (warnings.length > 0) {
          msg += `\nWarning: paths without an existing parent directory: ${warnings.join(", ")}. Verify these are intentional.`
        }
        return msg
      },
    }),

    modify_goal: tool({
      description:
        "Refine fields on an already-registered goal (including those seeded " +
        "from a prior run). Supply only the fields you want to change. Unknown " +
        "ids are rejected — use register_goal if you intend a brand-new goal. " +
        "A modified goal keeps its stable G number; the next implementation " +
        "attempt increments V.",
      inputSchema: z.object({
        id: z.string().min(1).describe("Existing goal id to modify"),
        updates: GoalContractUpdateSchema.describe(
          "Subset of contract fields to overwrite (id is not modifiable).",
        ),
      }),
      execute: async ({ id, updates }) => {
        const idx = collector.goals.findIndex((g) => g.id === id)
        if (idx < 0) {
          return `Error: goal "${id}" not registered. Use register_goal to add new goals.`
        }
        const prior = collector.goals[idx]
        const normalizedUpdates = normalizeGoalContractUpdate(
          updates as Parameters<typeof normalizeGoalContractUpdate>[0],
        )
        collector.goals[idx] = toRegisteredGoal({ ...prior, ...normalizedUpdates })
        return `OK: goal "${id}" fields updated (${Object.keys(normalizedUpdates).length} change(s))`
      },
    }),

    remove_goal: tool({
      description:
        "Remove a previously-registered goal (typically during a re-run when " +
        "delivery feedback showed the goal was redundant or wrong). The goal " +
        "id is recorded so the orchestrator can delete the DB row on finalize. " +
        "Cascades to every dependent registration: traceability rows referencing " +
        "it, fidelity coverage, assembly ownership, and cross-goal contracts " +
        "that mention it. Goal is the single source of " +
        "truth for these dependents — there is no orphan recovery path.",
      inputSchema: z.object({
        id: z.string().min(1).describe("Goal id to remove"),
        reason: z
          .string()
          .min(5)
          .describe("Why this goal is being removed (recorded for audit)"),
      }),
      execute: async ({ id, reason }) => {
        const idx = collector.goals.findIndex((g) => g.id === id)
        if (idx < 0) {
          return `Error: goal "${id}" not in collector — nothing to remove.`
        }
        collector.goals.splice(idx, 1)
        if (!collector.removed_goal_ids.includes(id)) {
          collector.removed_goal_ids.push(id)
        }

        const cascade = {
          traceability_rows: 0,
          traceability_refs: 0,
          source_coverage_rows: 0,
          source_coverage_refs: 0,
          reference_coverage_rows: 0,
          reference_coverage_refs: 0,
          assembly_owners: 0,
          contracts: 0,
          contract_refs: 0,
        }

        const traceNext: TraceabilityEntry[] = []
        for (const t of collector.traceability) {
          if (!t.goalIDs.includes(id)) {
            traceNext.push(t)
            continue
          }
          const filtered = t.goalIDs.filter((g) => g !== id)
          cascade.traceability_refs++
          if (filtered.length === 0) {
            cascade.traceability_rows++
            continue
          }
          traceNext.push({ ...t, goalIDs: filtered })
        }
        collector.traceability = traceNext

        const sourceCoverageNext: ArchitectCollector["source_coverage"] = []
        for (const row of collector.source_coverage) {
          if (!row.goal_ids.includes(id)) {
            sourceCoverageNext.push(row)
            continue
          }
          const filtered = row.goal_ids.filter((goalID) => goalID !== id)
          cascade.source_coverage_refs++
          if (filtered.length === 0) {
            cascade.source_coverage_rows++
            continue
          }
          sourceCoverageNext.push({ ...row, goal_ids: filtered })
        }
        collector.source_coverage = sourceCoverageNext

        const referenceCoverageNext: ArchitectCollector["reference_coverage"] = []
        for (const row of collector.reference_coverage) {
          if (!row.goal_ids.includes(id)) {
            referenceCoverageNext.push(row)
            continue
          }
          const filtered = row.goal_ids.filter((goalID) => goalID !== id)
          cascade.reference_coverage_refs++
          if (filtered.length === 0) {
            cascade.reference_coverage_rows++
            continue
          }
          referenceCoverageNext.push({ ...row, goal_ids: filtered })
        }
        collector.reference_coverage = referenceCoverageNext

        const beforeAssemblyOwners = collector.assembly_owners.length
        collector.assembly_owners = collector.assembly_owners.filter((row) => row.goal_id !== id)
        cascade.assembly_owners = beforeAssemblyOwners - collector.assembly_owners.length

        const contractNext: RegisteredContract[] = []
        for (const c of collector.contracts) {
          if (!c.goalIDs.includes(id)) {
            contractNext.push(c)
            continue
          }
          const filtered = c.goalIDs.filter((g) => g !== id)
          cascade.contract_refs++
          if (filtered.length === 0) {
            cascade.contracts++
            continue
          }
          contractNext.push({ ...c, goalIDs: filtered })
        }
        collector.contracts = contractNext

        const cascadeBits: string[] = []
        if (cascade.traceability_rows || cascade.traceability_refs) {
          cascadeBits.push(
            `${cascade.traceability_refs} traceability ref(s) (${cascade.traceability_rows} row(s) dropped)`,
          )
        }
        if (cascade.source_coverage_rows || cascade.source_coverage_refs) {
          cascadeBits.push(
            `${cascade.source_coverage_refs} source coverage ref(s) (${cascade.source_coverage_rows} row(s) dropped)`,
          )
        }
        if (cascade.reference_coverage_rows || cascade.reference_coverage_refs) {
          cascadeBits.push(
            `${cascade.reference_coverage_refs} reference coverage ref(s) (${cascade.reference_coverage_rows} row(s) dropped)`,
          )
        }
        if (cascade.assembly_owners) cascadeBits.push(`${cascade.assembly_owners} assembly owner row(s)`)
        if (cascade.contracts || cascade.contract_refs) {
          cascadeBits.push(
            `${cascade.contract_refs} contract ref(s) (${cascade.contracts} contract(s) dropped)`,
          )
        }
        const cascadeMsg = cascadeBits.length > 0 ? ` Cascaded: ${cascadeBits.join(", ")}.` : ""
        return `OK: goal "${id}" removed. Reason: ${reason}. (${collector.goals.length} remaining)${cascadeMsg}`
      },
    }),

    register_traceability: tool({
      description:
        "Map a requirement to the goals that cover it. Call once per " +
        "requirement you intend to trace.",
      inputSchema: z.object({
        requirement_id: z.string().describe("REQ-N format"),
        goal_ids: z
          .array(z.string().min(1))
          .min(1)
          .describe("Goal IDs that implement this requirement"),
      }),
      execute: async ({ requirement_id, goal_ids }) => {
        const warnings: string[] = []
        const missing = goal_ids.filter(
          (g) => !collector.goals.some((gl) => gl.id === g),
        )
        if (missing.length > 0) warnings.push(`goals not registered: ${missing.join(", ")}`)
        collector.traceability.push({ requirementID: requirement_id, goalIDs: goal_ids })
        let msg = `OK: ${requirement_id} → ${goal_ids.join(", ")}`
        if (warnings.length > 0) msg += `\nWarning: ${warnings.join("; ")}`
        return msg
      },
    }),

    register_source_coverage: tool({
      description:
        "Register which existing source files or modules are intentionally reused, modified, preserved, or replaced, and which goals own that work.",
      inputSchema: SourceCoverageEntrySchema,
      execute: async (input) => {
        const parsed = SourceCoverageEntrySchema.parse(input)
        const existingIdx = collector.source_coverage.findIndex((row) => row.id === parsed.id)
        if (existingIdx >= 0) {
          collector.source_coverage[existingIdx] = parsed
          return `OK: source coverage "${parsed.id}" overwritten (${collector.source_coverage.length} total)`
        }
        collector.source_coverage.push(parsed)
        return `OK: source coverage "${parsed.id}" registered (${collector.source_coverage.length} total)`
      },
    }),

    register_reference_coverage: tool({
      description:
        "Register which authoritative reference surface or visual spec ids each goal must restore. Required for reference-driven work.",
      inputSchema: ReferenceCoverageEntrySchema,
      execute: async (input) => {
        const parsed = ReferenceCoverageEntrySchema.parse(input)
        const existingIdx = collector.reference_coverage.findIndex((row) => row.id === parsed.id)
        if (existingIdx >= 0) {
          collector.reference_coverage[existingIdx] = parsed
          return `OK: reference coverage "${parsed.id}" overwritten (${collector.reference_coverage.length} total)`
        }
        collector.reference_coverage.push(parsed)
        return `OK: reference coverage "${parsed.id}" registered (${collector.reference_coverage.length} total)`
      },
    }),

    register_assembly_owner: tool({
      description:
        "Register the single goal that owns final stitching for a shared user-visible or integration surface.",
      inputSchema: AssemblyOwnerEntrySchema,
      execute: async (input) => {
        const parsed = AssemblyOwnerEntrySchema.parse(input)
        const existingIdx = collector.assembly_owners.findIndex((row) => row.surface === parsed.surface)
        if (existingIdx >= 0) {
          collector.assembly_owners[existingIdx] = parsed
          return `OK: assembly owner "${parsed.surface}" overwritten (${collector.assembly_owners.length} total)`
        }
        collector.assembly_owners.push(parsed)
        return `OK: assembly owner "${parsed.surface}" registered (${collector.assembly_owners.length} total)`
      },
    }),

    register_contract: tool({
      description:
        "Register a cross-goal consensus contract. Each contract is written to " +
        "the Decision Log and becomes BINDING for all Planners and Executors. " +
        "For interface_contract and shared_type categories, spec MUST be actual " +
        "source code in the project's language, wrapped in a fenced code block.",
      inputSchema: z.object({
        category: z
          .enum([
            "directory_blueprint",
            "interface_contract",
            "export_manifest",
            "shared_type",
            "naming_convention",
            "dependency_order",
          ] as const)
          .describe("Contract category — determines how it's used downstream"),
        title: z.string().min(1).describe("Short title for this contract"),
        spec: z
          .string()
          .min(10)
          .describe(
            "The contract specification. Rendered as Markdown downstream — wrap " +
              "source code in a fenced block tagged with the project's actual " +
              "language (```ts, ```py, ```go, ```rs, ```java, ```sql, ...) and " +
              "directory trees / ASCII layouts in ```text. For interface_contract " +
              "and shared_type, this MUST be actual source code (not English " +
              "description). For directory_blueprint, use path → description " +
              "format inside a ```text fence.",
          ),
        goal_ids: z
          .array(z.string().min(1))
          .min(1)
          .describe("Goal IDs this contract relates to (producer + consumers)"),
      }),
      execute: async ({ category, title, spec, goal_ids }) => {
        const knownGoals = new Set(collector.goals.map((g) => g.id))
        const unknown = goal_ids.filter((g) => !knownGoals.has(g))
        if (unknown.length > 0) {
          return `Error: goal IDs not found: ${unknown.join(", ")}. Register the goals first.`
        }
        if (
          (category === "interface_contract" || category === "shared_type") &&
          !spec.includes("```")
        ) {
          return `Warning: ${category} spec must contain a fenced code block (\`\`\`<lang> ... \`\`\`) with actual source code, not an English description.`
        }
        collector.contracts.push({ category, title, spec, goalIDs: goal_ids })
        return `OK: ${category} "${title}" registered (${collector.contracts.length} contracts total)`
      },
    }),

    submit_architect: tool({
      description:
        "Validate the full Architect output (goals + traceability + fidelity coverage + contracts) and finalize. Call AFTER every register/modify tool. Returns a list of issues if any — fix them and call again.",
      inputSchema: z.object({
        summary: z
          .string()
          .min(5)
          .describe("One-line summary of what was decomposed and coordinated"),
      }),
      execute: async ({ summary }) => {
        collector.summary = summary
        const issues = architectValidationIssues(collector, {
          workDir: dir,
          designSpecs: input.designSpecs,
          requireReferenceCoverage: input.requireReferenceCoverage,
        })
        const categories = new Set(collector.contracts.map((c) => c.category))

        if (issues.length === 0) {
          collector.finalized = true
          return [
            "PASS: Architect output finalized.",
            `  ${collector.goals.length} goals (${collector.removed_goal_ids.length} removed),`,
            `  ${collector.traceability.length} traceability mappings,`,
            `  ${collector.source_coverage.length} source coverage rows, ${collector.reference_coverage.length} reference coverage rows, ${collector.assembly_owners.length} assembly owners,`,
            `  ${collector.contracts.length} cross-goal contracts across ${categories.size} categories.`,
          ].join("\n")
        }

        return `ISSUES (${issues.length}):\n${issues.map((i, n) => `${n + 1}. ${i}`).join("\n")}\n\nFix and call submit_architect again.`
      },
    }),
  }

  return {
    tools,
    /** Reset the collector between retry attempts. */
    reset() {
      collector = emptyCollector()
      if (input.existingGoals?.length) {
        for (const g of input.existingGoals) collector.goals.push(toRegisteredGoal(g))
      }
      return collector
    },
    getCollector() {
      return collector
    },
  }
}
