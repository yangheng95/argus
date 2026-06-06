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
import { limitSummary, markdownList, requireReportString } from "@/agent/report"
import {
  GoalContractFieldsSchema,
  GoalContractUpdateSchema,
  normalizeGoalContractFields,
} from "@/pipeline/goal-contract.schema"
import type { AcceptanceSpec } from "@/acceptance/types"
import type { VisualSpec } from "@/frontend-design/types"
import type { TraceabilityEntry } from "./types"
import {
  architectFidelityIssues,
  AssemblyOwnerEntrySchema,
  SourceCoverageEntrySchema,
  ReferenceCoverageEntrySchema,
} from "./fidelity"
import {
  ArchitectContractRefSchema,
  GoalDependencyContractSchema,
  contractSurfaceKey,
  emptyArchitectContractGraph,
  validateArchitectContractGraph,
  type ArchitectContractRef,
  type ArchitectContractGraph,
  type ArchitectValidationFinding,
} from "./contract-graph"
import { ContractIRSchema } from "./contract-ir"
import { FactCheckItemListSchema, type FactCheckItem } from "@/fact-check/schema"

const RegisterContractToolInputSchema = ArchitectContractRefSchema.omit({
  ir: true,
  route: true,
  component: true,
}).extend({
  ir_json: z.string().min(2)
    .describe(
      "For kind=type/function/enum only: JSON.stringify of the ContractIR object. Example: {\"kind\":\"type\",\"name\":\"WidgetProps\",\"fields\":[...]}",
    )
    .optional(),
  route_json: z.string().min(2)
    .describe("For kind=route only: JSON.stringify of {method,path,request?,response?}.")
    .optional(),
  component_json: z.string().min(2)
    .describe(
      "For kind=component only: JSON.stringify of {props?: string, events?: string[], slots?: string[]}. props is a comma-separated string, not an array.",
    )
    .optional(),
})

function parseRegisterContractInput(input: unknown): ArchitectContractRef {
  const parsed = RegisterContractToolInputSchema.parse(input)
  const typed = parsed.kind === "type" || parsed.kind === "function" || parsed.kind === "enum"
  const base = { ...parsed }
  delete (base as { ir_json?: string }).ir_json
  delete (base as { route_json?: string }).route_json
  delete (base as { component_json?: string }).component_json
  const route = parsed.route_json ? parseJSONToolField(parsed.route_json, "route_json") : undefined
  const component = parsed.component_json ? parseJSONToolField(parsed.component_json, "component_json") : undefined
  if (!typed) return ArchitectContractRefSchema.parse({ ...base, route, component })
  if (!parsed.ir_json) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["ir_json"],
        message: `${parsed.kind} contract requires ir_json containing a JSON ContractIR object`,
      },
    ])
  }
  const rawIR = parseJSONToolField(parsed.ir_json, "ir_json")
  const ir = ContractIRSchema.parse(rawIR)
  return ArchitectContractRefSchema.parse({ ...base, ir, route, component })
}

function parseJSONToolField(value: string, field: string): unknown {
  try {
    return JSON.parse(value)
  } catch (error) {
    throw new z.ZodError([
      {
        code: "custom",
        path: [field],
        message: `${field} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      },
    ])
  }
}

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
  priority: "blocking" | "advisory"
  kind: "bootstrap" | "feature" | "verification" | "integration" | "system"
  requirement_ids: string[]
}

export interface ArchitectCollector {
  goals: RegisteredGoal[]
  traceability: TraceabilityEntry[]
  source_coverage: Array<z.infer<typeof SourceCoverageEntrySchema>>
  reference_coverage: Array<z.infer<typeof ReferenceCoverageEntrySchema>>
  assembly_owners: Array<z.infer<typeof AssemblyOwnerEntrySchema>>
  contract_graph: ArchitectContractGraph
  validation_findings: ArchitectValidationFinding[]
  /** Goal IDs the agent has explicitly removed during a re-run session. */
  removed_goal_ids: string[]
  summary: string
  decomposition_analysis: string
  fact_check_items: FactCheckItem[]
  finalized: boolean
}

type ArchitectValidationInput = {
  workDir?: string
  designSpecs?: VisualSpec[]
  requireReferenceCoverage?: boolean
  referenceCoverageReasons?: string[]
  knownRequirementIDs?: string[]
  knownResearchEvidenceIDs?: string[]
}

function toRegisteredGoal(input: unknown): RegisteredGoal {
  const parsed = normalizeGoalContractFields(input as Parameters<typeof normalizeGoalContractFields>[0])
  return {
    ...parsed,
    kind: parsed.kind,
  }
}

function normalizeSourceBaselineOwnedPaths(goal: RegisteredGoal): {
  goal: RegisteredGoal
  changes: Array<{ from: string; to: string }>
} {
  const changes: Array<{ from: string; to: string }> = []
  const seen = new Set<string>()
  const owned_paths: string[] = []

  for (const ownedPath of goal.owned_paths) {
    const normalized = ownedPath
      .trim()
      .replaceAll("\\", "/")
      .replace(/^\.\//, "")
      .replace(/\/+/g, "/")
    let next = ownedPath
    if (normalized === "frontend-design-skeleton") {
      next = "."
    } else if (normalized.startsWith("frontend-design-skeleton/")) {
      next = normalized.slice("frontend-design-skeleton/".length) || "."
    }
    if (next !== ownedPath) changes.push({ from: ownedPath, to: next })
    if (!seen.has(next)) {
      seen.add(next)
      owned_paths.push(next)
    }
  }

  if (changes.length === 0 && owned_paths.length === goal.owned_paths.length) {
    return { goal, changes }
  }
  return { goal: { ...goal, owned_paths }, changes }
}

function formatOwnedPathNormalizationNotice(changes: Array<{ from: string; to: string }>): string {
  if (changes.length === 0) return ""
  const pairs = changes.map((change) => `${change.from} -> ${change.to}`).join(", ")
  return (
    "\nNotice: normalized source-baseline owned_paths to acceptance-root paths: " +
    `${pairs}. frontend-design-skeleton remains a source input, not an implementation target.`
  )
}

const MIN_ARCHITECT_GOAL_COUNT = 2

function emptyCollector(): ArchitectCollector {
  return {
    goals: [],
    traceability: [],
    source_coverage: [],
    reference_coverage: [],
    assembly_owners: [],
    contract_graph: emptyArchitectContractGraph(),
    validation_findings: [],
    removed_goal_ids: [],
    summary: "",
    decomposition_analysis: "",
    fact_check_items: [],
    finalized: false,
  }
}

function collectorGoalByID(collector: ArchitectCollector): Map<string, RegisteredGoal> {
  return new Map(collector.goals.map((goal) => [goal.id, goal]))
}

function hasCollectorDependencyPath(
  collector: ArchitectCollector,
  fromGoalID: string,
  ancestorGoalID: string,
): boolean {
  const byID = collectorGoalByID(collector)
  const seen = new Set<string>()
  const stack = [...(byID.get(fromGoalID)?.depends_on ?? [])]
  while (stack.length > 0) {
    const next = stack.pop()!
    if (next === ancestorGoalID) return true
    if (seen.has(next)) continue
    seen.add(next)
    stack.push(...(byID.get(next)?.depends_on ?? []))
  }
  return false
}

function normalizeOwnedPathForOverlap(ownedPath: string): string {
  return ownedPath
    .trim()
    .replaceAll("\\", "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/g, "")
    .toLowerCase()
}

function ownedPathsOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
}

function dependencyDirectionGuidance(fromGoalID: string, toGoalID: string): string {
  return `Dependency contract direction is producer/prerequisite -> consumer/dependent. If ${toGoalID}.depends_on includes ${fromGoalID}, call register_dependency_contract({ from_goal_id: "${fromGoalID}", to_goal_id: "${toGoalID}", ... }).`
}

function registeredContractIDs(collector: ArchitectCollector): Set<string> {
  return new Set(collector.contract_graph.contracts.map((contract) => contract.id))
}

function duplicateContractSurface(
  collector: ArchitectCollector,
  contract: ArchitectContractRef,
): ArchitectContractRef | undefined {
  const key = contractSurfaceKey(contract)
  return collector.contract_graph.contracts.find(
    (existing) => existing.id !== contract.id && contractSurfaceKey(existing) === key,
  )
}

function contractConsumerRepairHint(contract: ArchitectContractRef, toGoalID: string): string {
  return (
    `Re-register contract id "${contract.id}" with consumer_goal_ids including "${toGoalID}" ` +
    `if this edge should consume that surface; do not create a new id for the same surface.`
  )
}

function unknownContractAuditContractIDs(collector: ArchitectCollector, specs: readonly AcceptanceSpec[]): string[] {
  const contractIDs = registeredContractIDs(collector)
  const unknownIDs: string[] = []
  for (const spec of specs) {
    for (const scorer of spec.scorers) {
      if (scorer.type !== "contract_audit") continue
      for (const contractID of scorer.spec.contract_ids) {
        if (!contractIDs.has(contractID)) unknownIDs.push(contractID)
      }
    }
  }
  return [...new Set(unknownIDs)]
}

export function architectValidationFindings(
  collector: ArchitectCollector,
  input?: ArchitectValidationInput,
): ArchitectValidationFinding[] {
  const findings: ArchitectValidationFinding[] = []
  const blocker = (
    code: string,
    message: string,
    scope: ArchitectValidationFinding["scope"] = {},
    repairTools: string[] = [],
  ) => findings.push({ code, severity: "blocker", scope, message, repair_tools: repairTools })
  const concern = (
    code: string,
    message: string,
    scope: ArchitectValidationFinding["scope"] = {},
    repairTools: string[] = [],
  ) => findings.push({ code, severity: "concern", scope, message, repair_tools: repairTools })

  if (collector.goals.length === 0) {
    blocker("no_goals", `No goals registered - Architect must produce at least ${MIN_ARCHITECT_GOAL_COUNT} goals`, {}, [
      "register_goal",
    ])
  } else if (collector.goals.length < MIN_ARCHITECT_GOAL_COUNT) {
    blocker(
      "insufficient_goal_decomposition",
      `Only ${collector.goals.length} goal registered - Architect must split the task into at least ${MIN_ARCHITECT_GOAL_COUNT} independently executable goals; a single large goal is forbidden.`,
      { goal_ids: collector.goals.map((goal) => goal.id) },
      ["register_goal", "modify_goal"],
    )
  } else if (collector.contract_graph.contracts.length === 0) {
    concern(
      "missing_contract_graph_contract",
      `Multi-goal architecture registered ${collector.goals.length} goals but no graph contracts. Register at least one explicit handoff contract when a produced type, component, route, static data, render surface, behavior inventory, or verification surface is known.`,
      { goal_ids: collector.goals.map((goal) => goal.id) },
      ["register_contract", "register_dependency_contract", "modify_goal"],
    )
  }
  const knownGoalIDs = new Set(collector.goals.map((g) => g.id))
  const knownRequirementIDs = new Set(input?.knownRequirementIDs ?? [])
  const requiredTraceability = new Map<string, Set<string>>()
  const executableGoals = collector.goals.filter((goal) => goal.kind !== "verification")
  for (let leftIndex = 0; leftIndex < executableGoals.length; leftIndex++) {
    const leftGoal = executableGoals[leftIndex]
    const leftPaths = leftGoal.owned_paths.map(normalizeOwnedPathForOverlap).filter(Boolean)
    for (const rightGoal of executableGoals.slice(leftIndex + 1)) {
      if (
        hasCollectorDependencyPath(collector, leftGoal.id, rightGoal.id) ||
        hasCollectorDependencyPath(collector, rightGoal.id, leftGoal.id)
      ) {
        continue
      }
      const rightPaths = rightGoal.owned_paths.map(normalizeOwnedPathForOverlap).filter(Boolean)
      const examples = leftPaths
        .flatMap((leftPath) =>
          rightPaths
            .filter((rightPath) => ownedPathsOverlap(leftPath, rightPath))
            .map((rightPath) => `${leftGoal.id}:${leftPath} <-> ${rightGoal.id}:${rightPath}`),
        )
        .slice(0, 5)
      if (examples.length > 0) {
        blocker(
          "owned_paths_overlap_without_dependency",
          `Goals ${leftGoal.id} and ${rightGoal.id}: owned_paths overlap without dependency reachability. Add a depends_on edge between the dependent and prerequisite goals, or split ownership so independent goals do not claim the same paths. Examples: ${examples.join(", ")}`,
          { goal_ids: [leftGoal.id, rightGoal.id] },
          ["modify_goal", "remove_goal"],
        )
      }
    }
  }
  const bootstrapGoals = collector.goals.filter((g) => g.kind === "bootstrap")
  if (bootstrapGoals.length > 1) {
    concern(
      "multiple_bootstrap_goals",
      `Exactly one bootstrap goal is allowed in an active goal graph; found ${bootstrapGoals.length}`,
      { goal_ids: bootstrapGoals.map((goal) => goal.id) },
      ["modify_goal", "remove_goal"],
    )
  } else if (bootstrapGoals.length === 1) {
    const bootstrapGoal = bootstrapGoals[0]
    const missingBootstrapDeps = collector.goals
      .filter((g) => g.id !== bootstrapGoal.id)
      .filter((g) => !g.depends_on.includes(bootstrapGoal.id))
      .map((g) => g.id)
    if (missingBootstrapDeps.length > 0) {
      concern(
        "bootstrap_not_listed_as_dependency",
        `Bootstrap goal ${bootstrapGoal.id}: every non-bootstrap goal must list it in depends_on; missing ${missingBootstrapDeps.join(", ")}`,
        { goal_ids: [bootstrapGoal.id, ...missingBootstrapDeps] },
        ["register_goal", "modify_goal"],
      )
    }
  }

  for (const g of collector.goals) {
    if (g.kind === "verification") {
      const featureSourcePaths = g.owned_paths.filter((ownedPath) => !isVerificationOwnedPath(ownedPath))
      if (featureSourcePaths.length > 0) {
        concern(
          "verification_owns_feature_paths",
          `Goal ${g.id}: verification owned_paths may only cover tests, integration, benchmark, or spec evidence paths; move feature source ownership to a feature goal: ${featureSourcePaths.join(", ")}`,
          { goal_ids: [g.id] },
          ["register_goal", "modify_goal"],
        )
      }
    }
    for (const spec of g.acceptance_specs) {
      if (spec.goal_id !== g.id) {
        blocker(
          "acceptance_goal_mismatch",
          `Goal ${g.id}: acceptance spec ${spec.id} has mismatched goal_id "${spec.goal_id}"`,
          { goal_ids: [g.id, spec.goal_id] },
          ["register_goal", "modify_goal"],
        )
      }
      if (knownRequirementIDs.size > 0 && !knownRequirementIDs.has(spec.source_requirement_id)) {
        blocker(
          "acceptance_unknown_requirement",
          `Goal ${g.id}: acceptance spec ${spec.id} uses unknown source_requirement_id "${spec.source_requirement_id}"`,
          { goal_ids: [g.id] },
          ["register_goal", "modify_goal"],
        )
      }
      if (knownRequirementIDs.size > 0 && !g.requirement_ids.includes(spec.source_requirement_id)) {
        blocker(
          "acceptance_requirement_not_claimed",
          `Goal ${g.id}: acceptance spec ${spec.id} source_requirement_id "${spec.source_requirement_id}" is not listed in goal.requirement_ids`,
          { goal_ids: [g.id] },
          ["register_goal", "modify_goal"],
        )
      }
    }
    for (const requirementID of g.requirement_ids) {
      if (knownRequirementIDs.size > 0 && !knownRequirementIDs.has(requirementID)) {
        blocker(
          "goal_unknown_requirement",
          `Goal ${g.id}: requirement_ids contains unknown requirement "${requirementID}"`,
          { goal_ids: [g.id] },
          ["register_goal", "modify_goal"],
        )
      }
      if (!requiredTraceability.has(requirementID)) {
        requiredTraceability.set(requirementID, new Set())
      }
      requiredTraceability.get(requirementID)!.add(g.id)
    }
    for (const dep of g.depends_on) {
      if (!collector.goals.some((gl) => gl.id === dep)) {
        blocker(
          "unknown_dependency_goal",
          `Goal ${g.id}: depends_on "${dep}" not registered`,
          { goal_ids: [g.id, dep] },
          ["register_goal", "modify_goal"],
        )
      }
    }
  }

  const traceabilityByRequirement = new Map<string, Set<string>>()
  for (const row of collector.traceability) {
    const mappedGoalIDs = traceabilityByRequirement.get(row.requirementID) ?? new Set<string>()
    for (const goalID of row.goalIDs) {
      if (!knownGoalIDs.has(goalID)) {
        concern(
          "traceability_unknown_goal",
          `Traceability ${row.requirementID}: references unknown goal "${goalID}"`,
          { goal_ids: [goalID] },
          ["register_traceability"],
        )
      }
      mappedGoalIDs.add(goalID)
    }
    traceabilityByRequirement.set(row.requirementID, mappedGoalIDs)
  }
  for (const [requirementID, goalIDs] of requiredTraceability) {
    const mappedGoalIDs = traceabilityByRequirement.get(requirementID)
    if (!mappedGoalIDs) {
      concern(
        "missing_traceability",
        `Missing traceability for ${requirementID}: call register_traceability with goals ${[...goalIDs].join(", ")}`,
        { goal_ids: [...goalIDs] },
        ["register_traceability"],
      )
      continue
    }
    const missingGoalIDs = [...goalIDs].filter((goalID) => !mappedGoalIDs.has(goalID))
    if (missingGoalIDs.length > 0) {
      concern(
        "traceability_missing_goal_mapping",
        `Traceability ${requirementID}: missing goal mappings ${missingGoalIDs.join(", ")}`,
        { goal_ids: missingGoalIDs },
        ["register_traceability"],
      )
    }
  }

  findings.push(
    ...validateArchitectContractGraph({
      goals: collector.goals.map((goal) => ({
        id: goal.id,
        depends_on: goal.depends_on,
        acceptance_specs: goal.acceptance_specs,
      })),
      graph: collector.contract_graph,
    }),
  )

  if (input?.knownResearchEvidenceIDs) {
    const knownEvidenceIDs = new Set(input.knownResearchEvidenceIDs)
    for (const contract of collector.contract_graph.contracts) {
      const unknownEvidenceRefs = contract.evidence_refs.filter((id) => !knownEvidenceIDs.has(id))
      if (unknownEvidenceRefs.length > 0) {
        blocker(
          "contract_unknown_research_evidence",
          `Contract ${contract.id} evidence_refs reference unknown or stale research evidence id(s): ${[...new Set(unknownEvidenceRefs)].join(", ")}.`,
          { contract_ids: [contract.id] },
          ["register_contract"],
        )
      }
    }
  }

  findings.push(
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
    }).map((message) => ({
      code: "fidelity_validation",
      severity: "concern" as const,
      scope: {},
      message,
      repair_tools: ["register_source_coverage", "register_reference_coverage", "register_assembly_owner"],
    })),
  )

  if (input?.requireReferenceCoverage) {
    const visualAcceptanceOwners = collector.goals.filter(
      (goal) =>
        goal.priority === "blocking" &&
        (goal.kind === "verification" || goal.kind === "integration") &&
        goal.acceptance_specs.some(isEssentialAcceptanceJudgeSpec),
    )
    if (visualAcceptanceOwners.length === 0) {
      concern(
        "missing_final_visual_acceptance",
        [
          "Missing essential integrity visual acceptance: reference-driven tasks must include a blocking verification/integration goal with an essential on_integrity llm_judge acceptance spec for final rendered-vs-reference fidelity.",
          `Reference coverage requirement: ${formatReferenceCoverageReason(input)}`,
          "Required shape: priority=blocking kind=verification|integration acceptance_specs includes severity=essential trigger=on_integrity scorer=llm_judge.",
          `Goal candidates: ${formatGoalCandidateList(collector.goals)}`,
        ].join(" "),
        { goal_ids: collector.goals.map((goal) => goal.id) },
        ["register_goal", "modify_goal"],
      )
    }
  }

  collector.validation_findings = findings
  return findings
}

export function architectValidationIssues(collector: ArchitectCollector, input?: ArchitectValidationInput): string[] {
  return architectValidationFindings(collector, input)
    .filter((finding) => finding.severity === "blocker")
    .map((finding) => finding.message)
}

function formatReferenceCoverageReason(input?: ArchitectValidationInput): string {
  const reasons = input?.referenceCoverageReasons?.filter((reason) => reason.trim().length > 0) ?? []
  if (reasons.length > 0) return `requireReferenceCoverage=true because ${reasons.join(", ")}.`
  if ((input?.designSpecs?.length ?? 0) > 0) return "requireReferenceCoverage=true because designSpecs are present."
  return "requireReferenceCoverage=true because frontendDesign handoff or caller flag is present."
}

function formatGoalCandidateList(goals: RegisteredGoal[]): string {
  if (goals.length === 0) return "(none)"
  return goals.map(formatGoalSnapshot).join(" | ")
}

function formatGoalSnapshot(goal: RegisteredGoal): string {
  const specs =
    goal.acceptance_specs.length > 0 ? goal.acceptance_specs.map(formatAcceptanceSpecSnapshot).join(", ") : "(none)"
  const deps = goal.depends_on.length > 0 ? goal.depends_on.join(",") : "(none)"
  const finalReferenceAcceptance =
    goal.priority === "blocking" &&
    (goal.kind === "verification" || goal.kind === "integration") &&
    goal.acceptance_specs.some(isEssentialAcceptanceJudgeSpec)
      ? "yes"
      : "no"
  return `${goal.id} kind=${goal.kind} priority=${goal.priority} depends_on=[${deps}] acceptance_specs=[${specs}] final_reference_acceptance=${finalReferenceAcceptance}`
}

function formatAcceptanceSpecSnapshot(spec: AcceptanceSpec): string {
  const scorerTypes = spec.scorers.map((scorer) => scorer.type).join("+")
  return `${spec.id}:${spec.severity}:${spec.trigger ?? "default"}:${scorerTypes}`
}

function isEssentialAcceptanceJudgeSpec(spec: AcceptanceSpec): boolean {
  return (
    spec.severity === "essential" &&
    (spec.trigger === "on_integrity" || spec.trigger === "on_acceptance") &&
    spec.scorers.some((scorer) => scorer.type === "llm_judge")
  )
}

function isVerificationOwnedPath(ownedPath: string): boolean {
  const normalized = ownedPath.replaceAll("\\", "/").replace(/^\.\//, "")
  return (
    /(^|\/)(__tests__|test|tests|e2e|integration|benchmark|benchmarks|playwright)(\/|$)/.test(normalized) ||
    /\.(test|spec|e2e)\.(ts|tsx|js|jsx)$/.test(normalized) ||
    /^specs\//.test(normalized) ||
    /^docs\//.test(normalized) ||
    /^analysis\//.test(normalized) ||
    /^reports\//.test(normalized)
  )
}

export function isArchitectReadyToFinalize(collector: ArchitectCollector, input?: ArchitectValidationInput): boolean {
  return architectValidationIssues(collector, input).length === 0
}

export function buildArchitectReport(collector: ArchitectCollector) {
  const summary = requireReportString(collector.summary, "architect summary")
  const decompositionAnalysis = requireReportString(
    collector.decomposition_analysis,
    "architect decomposition analysis",
  )
  const goalLines = collector.goals.map((goal) => {
    const owned = goal.owned_paths.length > 0 ? goal.owned_paths.join(", ") : "no owned paths"
    return `${goal.title} [${goal.kind}] - owned_paths: ${owned}`
  })
  return {
    summary: limitSummary(summary),
    detail: [
      `## Summary\n${summary}`,
      `## Decomposition Analysis\n${decompositionAnalysis}`,
      `## Goals\n${goalLines.length ? markdownList(goalLines) : "- no goals submitted"}`,
    ].join("\n\n"),
  }
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
  referenceCoverageReasons?: string[]
  knownRequirementIDs?: string[]
  knownResearchEvidenceIDs?: string[]
}) {
  let collector = emptyCollector()
  const dir = input.workDir ?? Instance.directory
  const knownResearchEvidenceIDs =
    input.knownResearchEvidenceIDs !== undefined ? new Set(input.knownResearchEvidenceIDs) : undefined

  // Single source of truth for "is the architect output complete?". Both the
  // terminal-tool-scoping predicate (`isReadyToFinalize` below) and the
  // `submit_architect` tool's own validation MUST go through this closure —
  // otherwise the predicate may say "done, expose only submit_architect" while
  // the tool still sees fidelity issues that depend on workDir, trapping the
  // model in a tight retry loop (rule 8: single source).
  const validate = () =>
    architectValidationIssues(collector, {
      workDir: dir,
      designSpecs: input.designSpecs,
      requireReferenceCoverage: input.requireReferenceCoverage,
      referenceCoverageReasons: input.referenceCoverageReasons,
      knownRequirementIDs: input.knownRequirementIDs,
      knownResearchEvidenceIDs: input.knownResearchEvidenceIDs,
    })

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
        "For webpage replicas, prefer phase outcome goals over component-sized goals. " +
        "Persistence preserves existing G numbers and assigns new goals the " +
        "next unused G number.",
      inputSchema: GoalContractFieldsSchema,
      execute: async (goal) => {
        const normalized = normalizeSourceBaselineOwnedPaths(toRegisteredGoal(goal))
        const parsedGoal = normalized.goal
        const unknownContractIDs = unknownContractAuditContractIDs(collector, parsedGoal.acceptance_specs)
        if (unknownContractIDs.length > 0) {
          return `Error: goal "${parsedGoal.id}" contract_audit references unknown contract id(s): ${unknownContractIDs.join(", ")}. Use contract ids returned by register_contract; collector unchanged.`
        }
        const warnings: string[] = []
        for (const p of parsedGoal.owned_paths) {
          try {
            const abs = path.resolve(dir, p)
            if (!fs.existsSync(abs) && !fs.existsSync(path.dirname(abs))) {
              warnings.push(p)
            }
          } catch {
            /* cross-platform path issues — skip */
          }
        }

        const existingIdx = collector.goals.findIndex((g) => g.id === parsedGoal.id)
        let msg: string
        if (existingIdx >= 0) {
          collector.goals[existingIdx] = parsedGoal
          msg = `OK: goal "${parsedGoal.id}" updated in-place (${collector.goals.length} total)`
        } else {
          collector.goals.push(parsedGoal)
          msg = `OK: goal "${parsedGoal.id}" registered (${collector.goals.length} total)`
        }
        // A newly registered/updated id cannot also be in the removal list.
        collector.removed_goal_ids = collector.removed_goal_ids.filter((id) => id !== parsedGoal.id)
        if (warnings.length > 0) {
          msg += `\nWarning: paths without an existing parent directory: ${warnings.join(", ")}. Verify these are intentional.`
        }
        msg += formatOwnedPathNormalizationNotice(normalized.changes)
        return `${msg}\nCurrent: ${formatGoalSnapshot(parsedGoal)}`
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
        id: z.string().min(1).describe("Existing goal id to modify."),
        updates: GoalContractUpdateSchema,
      }),
      execute: async ({ id, updates }) => {
        const idx = collector.goals.findIndex((g) => g.id === id)
        if (idx < 0) {
          return `Error: goal "${id}" not registered. Use register_goal to add new goals.`
        }
        const prior = collector.goals[idx]
        const normalizedUpdates = Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined))
        const parsedNext = GoalContractFieldsSchema.safeParse({ ...prior, ...normalizedUpdates })
        if (!parsedNext.success) {
          const issueLines = parsedNext.error.issues.slice(0, 8).map((issue) => {
            const pathLabel = issue.path.length > 0 ? issue.path.join(".") : "(root)"
            return `- ${pathLabel}: ${issue.message}`
          })
          return [`Error: modify_goal produced an invalid goal after merge; collector unchanged.`, ...issueLines].join(
            "\n",
          )
        }
        const normalized = normalizeSourceBaselineOwnedPaths(parsedNext.data)
        const next = normalized.goal
        if (updates.acceptance_specs !== undefined) {
          const unknownContractIDs = unknownContractAuditContractIDs(collector, next.acceptance_specs)
          if (unknownContractIDs.length > 0) {
            return `Error: goal "${id}" contract_audit references unknown contract id(s): ${unknownContractIDs.join(", ")}. Use contract ids returned by register_contract; collector unchanged.`
          }
        }
        collector.goals[idx] = next
        return `OK: goal "${id}" fields updated (${Object.keys(normalizedUpdates).length} change(s))${formatOwnedPathNormalizationNotice(normalized.changes)}\nCurrent: ${formatGoalSnapshot(next)}`
      },
    }),

    remove_goal: tool({
      description:
        "Remove a previously-registered goal (typically during a re-run when " +
        "acceptance feedback showed the goal was redundant or wrong). The goal " +
        "id is recorded so the orchestrator can delete the DB row on finalize. " +
        "Cascades to every dependent registration: traceability rows referencing " +
        "it, fidelity coverage, assembly ownership, and cross-goal contracts " +
        "that mention it. Goal is the single source of " +
        "truth for these dependents — there is no orphan recovery path.",
      inputSchema: z.object({
        id: z.string().min(1).describe("Goal id to remove"),
        reason: z.string().min(5).describe("Why this goal is being removed (recorded for audit)"),
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
          goal_depends_on_refs: 0,
          contracts: 0,
          dependency_contracts: 0,
        }

        for (const goal of collector.goals) {
          const before = goal.depends_on.length
          goal.depends_on = goal.depends_on.filter((depID) => depID !== id)
          cascade.goal_depends_on_refs += before - goal.depends_on.length
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

        const beforeContracts = collector.contract_graph.contracts.length
        collector.contract_graph.contracts = collector.contract_graph.contracts
          .map((contract) => ({
            ...contract,
            consumer_goal_ids: contract.consumer_goal_ids.filter((goalID) => goalID !== id),
          }))
          .filter((contract) => contract.producer_goal_id !== id)
        cascade.contracts = beforeContracts - collector.contract_graph.contracts.length
        const beforeEdges = collector.contract_graph.dependency_contracts.length
        collector.contract_graph.dependency_contracts = collector.contract_graph.dependency_contracts.filter(
          (edge) => edge.from_goal_id !== id && edge.to_goal_id !== id,
        )
        cascade.dependency_contracts = beforeEdges - collector.contract_graph.dependency_contracts.length

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
        if (cascade.goal_depends_on_refs) cascadeBits.push(`${cascade.goal_depends_on_refs} goal depends_on ref(s)`)
        if (cascade.contracts) cascadeBits.push(`${cascade.contracts} contract(s) dropped`)
        if (cascade.dependency_contracts)
          cascadeBits.push(`${cascade.dependency_contracts} dependency contract edge(s) dropped`)
        const cascadeMsg = cascadeBits.length > 0 ? ` Cascaded: ${cascadeBits.join(", ")}.` : ""
        return `OK: goal "${id}" removed. Reason: ${reason}. (${collector.goals.length} remaining)${cascadeMsg}`
      },
    }),

    register_traceability: tool({
      description: "Map a requirement to the goals that cover it. Call once per " + "requirement you intend to trace.",
      inputSchema: z.object({
        requirement_id: z.string().describe("REQ-N format"),
        goal_ids: z.array(z.string().min(1)).min(1).describe("Goal IDs that implement this requirement"),
      }),
      execute: async ({ requirement_id, goal_ids }) => {
        const warnings: string[] = []
        const missing = goal_ids.filter((g) => !collector.goals.some((gl) => gl.id === g))
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
        "Register which authoritative reference surface or visual spec ids each goal must restore when this evidence is already clear.",
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
        "Register one Architect Contract Graph contract. producer_goal_id is the goal that creates the surface; every consumer_goal_id must depend on that producer. Use type/function/enum with ir_json for typed contracts; use route/component/static_data/render_surface/behavior_inventory for non-IR surfaces.",
      inputSchema: RegisterContractToolInputSchema,
      execute: async (input) => {
        const contract = parseRegisterContractInput(input)
        const byID = collectorGoalByID(collector)
        const unknownGoals = [contract.producer_goal_id, ...contract.consumer_goal_ids].filter(
          (goalID) => !byID.has(goalID),
        )
        if (unknownGoals.length > 0) {
          return `Error: contract "${contract.id}" references unknown goal id(s): ${[...new Set(unknownGoals)].join(", ")}. Register the goals first; collector unchanged.`
        }
        if (knownResearchEvidenceIDs && contract.evidence_refs.length > 0) {
          const unknownEvidenceRefs = contract.evidence_refs.filter((id) => !knownResearchEvidenceIDs.has(id))
          if (unknownEvidenceRefs.length > 0) {
            return `Error: contract "${contract.id}" evidence_refs contain unknown or stale research evidence id(s): ${[...new Set(unknownEvidenceRefs)].join(", ")}; collector unchanged.`
          }
        }
        const existingIdx = collector.contract_graph.contracts.findIndex((row) => row.id === contract.id)
        if (existingIdx < 0) {
          const duplicate = duplicateContractSurface(collector, contract)
          if (duplicate) {
            return (
              `Error: contract "${contract.id}" duplicates existing contract surface "${duplicate.id}" ` +
              `(${duplicate.kind}:${duplicate.name} produced by ${duplicate.producer_goal_id}); ` +
              `collector unchanged. Re-register contract id "${duplicate.id}" to overwrite its ` +
              `consumer_goal_ids, summary, or metadata. Do not create a new id for the same surface.`
            )
          }
        }
        for (const consumerID of contract.consumer_goal_ids) {
          if (!hasCollectorDependencyPath(collector, consumerID, contract.producer_goal_id)) {
            return `Error: contract "${contract.id}" producer ${contract.producer_goal_id} is not in dependency ancestry for consumer ${consumerID}. The consumer goal must list the producer in depends_on before this contract is valid; collector unchanged.`
          }
        }
        if (existingIdx >= 0) {
          collector.contract_graph.contracts[existingIdx] = contract
          return `OK: contract "${contract.id}" overwritten (${collector.contract_graph.contracts.length} contracts total)\nRegistered contract ids: ${[...registeredContractIDs(collector)].join(", ")}`
        }
        collector.contract_graph.contracts.push(contract)
        return `OK: contract "${contract.id}" registered (${collector.contract_graph.contracts.length} contracts total)\nRegistered contract ids: ${[...registeredContractIDs(collector)].join(", ")}`
      },
    }),

    register_dependency_contract: tool({
      description:
        "Register why a depends_on edge exists. Direction is producer/prerequisite -> consumer/dependent: if goal B depends_on goal A, use from_goal_id=A and to_goal_id=B. reason=contract must name contract_ids; bootstrap_scaffold/integration_order may have no contract_ids but require summary.",
      inputSchema: GoalDependencyContractSchema,
      execute: async (input) => {
        const edge = GoalDependencyContractSchema.parse(input)
        const byID = collectorGoalByID(collector)
        const fromGoal = byID.get(edge.from_goal_id)
        const toGoal = byID.get(edge.to_goal_id)
        if (!fromGoal || !toGoal) {
          const missing = [!fromGoal ? edge.from_goal_id : "", !toGoal ? edge.to_goal_id : ""].filter(Boolean)
          return `Error: dependency contract references unknown goal id(s): ${missing.join(", ")}. Register the goals first; collector unchanged.`
        }
        if (!toGoal.depends_on.includes(edge.from_goal_id)) {
          const reversed = fromGoal.depends_on.includes(edge.to_goal_id)
          return `Error: dependency contract ${edge.from_goal_id} -> ${edge.to_goal_id} has no matching depends_on edge; collector unchanged. ${reversed ? "This edge is reversed. " : ""}${dependencyDirectionGuidance(edge.to_goal_id, edge.from_goal_id)}`
        }
        if (!hasCollectorDependencyPath(collector, edge.to_goal_id, edge.from_goal_id)) {
          return `Error: dependency contract producer ${edge.from_goal_id} is not in dependency ancestry for ${edge.to_goal_id}; collector unchanged. ${dependencyDirectionGuidance(edge.from_goal_id, edge.to_goal_id)}`
        }
        if (edge.reason === "contract" && edge.contract_ids.length === 0) {
          return `Error: dependency contract ${edge.from_goal_id} -> ${edge.to_goal_id} has reason=contract but no contract_ids; collector unchanged.`
        }
        if (edge.reason !== "contract" && !edge.summary?.trim()) {
          return `Error: dependency contract ${edge.from_goal_id} -> ${edge.to_goal_id} has reason=${edge.reason} and must include summary; collector unchanged.`
        }
        for (const contractID of edge.contract_ids) {
          const contract = collector.contract_graph.contracts.find((row) => row.id === contractID)
          if (!contract) {
            return `Error: dependency contract ${edge.from_goal_id} -> ${edge.to_goal_id} references unknown contract "${contractID}"; collector unchanged.`
          }
          if (
            contract.producer_goal_id !== edge.from_goal_id ||
            !contract.consumer_goal_ids.includes(edge.to_goal_id)
          ) {
            const guidance =
              contract.producer_goal_id === edge.from_goal_id
                ? contractConsumerRepairHint(contract, edge.to_goal_id)
                : dependencyDirectionGuidance(
                    contract.producer_goal_id,
                    contract.consumer_goal_ids[0] ?? edge.to_goal_id,
                  )
            return (
              `Error: contract "${contractID}" belongs to ${contract.producer_goal_id} -> ` +
              `[${contract.consumer_goal_ids.join(", ")}], not ${edge.from_goal_id} -> ${edge.to_goal_id}; ` +
              `collector unchanged. ${guidance}`
            )
          }
        }
        const existingIdx = collector.contract_graph.dependency_contracts.findIndex(
          (row) => row.from_goal_id === edge.from_goal_id && row.to_goal_id === edge.to_goal_id,
        )
        if (existingIdx >= 0) {
          collector.contract_graph.dependency_contracts[existingIdx] = edge
          return `OK: dependency contract ${edge.from_goal_id} -> ${edge.to_goal_id} overwritten`
        }
        collector.contract_graph.dependency_contracts.push(edge)
        return `OK: dependency contract ${edge.from_goal_id} -> ${edge.to_goal_id} registered`
      },
    }),

    submit_architect: tool({
      description:
        "Finalize the executable Architect goal graph. Requires a decomposition analysis and at least two goals. Blocks only invalid execution graph structure; reports traceability, fidelity, and contract concerns without requiring a retry.",
      inputSchema: z.object({
        summary: z.string().min(5).describe("One-line summary of what was decomposed and coordinated"),
        decomposition_analysis: z
          .string()
          .min(80)
          .describe(
            "Required analysis explaining goal boundaries, why no goal is too large, final verification ownership, and dependency necessity.",
          ),
        // Optional fact-check registration: missing means no items registered.
        fact_check_items: FactCheckItemListSchema.default([]).describe(
          "Every factual claim (API behaviour, library version, third-party protocol, number, path, history) you have NOT verified via tool calls in this session. Empty when only opinions, design choices, or in-session-verified statements.",
        ),
      }),
      execute: async ({ summary, decomposition_analysis, fact_check_items }) => {
        const items = fact_check_items ?? []
        collector.summary = summary
        collector.decomposition_analysis =
          typeof decomposition_analysis === "string" ? decomposition_analysis.trim() : ""
        collector.fact_check_items = items
        const findings = architectValidationFindings(collector, {
          workDir: dir,
          designSpecs: input.designSpecs,
          requireReferenceCoverage: input.requireReferenceCoverage,
          referenceCoverageReasons: input.referenceCoverageReasons,
        })
        if (collector.decomposition_analysis.length < 80) {
          findings.unshift({
            code: "missing_decomposition_analysis",
            severity: "blocker",
            scope: {},
            message:
              "submit_architect requires decomposition_analysis explaining safe goal boundaries, anti-large-goal reasoning, final verification ownership, and dependency necessity.",
            repair_tools: ["submit_architect"],
          })
          collector.validation_findings = findings
        }
        const blockers = findings.filter((finding) => finding.severity === "blocker")
        const concerns = findings.filter((finding) => finding.severity === "concern")

        if (blockers.length === 0) {
          collector.finalized = true
          return [
            "PASS: Architect output finalized.",
            `  ${collector.goals.length} goals (${collector.removed_goal_ids.length} removed),`,
            `  ${collector.traceability.length} traceability mappings,`,
            `  ${collector.source_coverage.length} source coverage rows, ${collector.reference_coverage.length} reference coverage rows, ${collector.assembly_owners.length} assembly owners,`,
            `  ${collector.contract_graph.contracts.length} graph contracts, ${collector.contract_graph.dependency_contracts.length} dependency reasons.`,
            concerns.length > 0
              ? `  Concerns: ${concerns.map((finding) => `${finding.code}: ${finding.message}`).join(" | ")}`
              : "",
          ].join("\n")
        }

        const blockerText = blockers.map((finding, n) => `${n + 1}. [${finding.code}] ${finding.message}`).join("\n")
        const concernText =
          concerns.length > 0
            ? `\n\nCONCERNS (${concerns.length}):\n${concerns.map((finding, n) => `${n + 1}. [${finding.code}] ${finding.message}`).join("\n")}`
            : ""
        return `BLOCKERS (${blockers.length}):\n${blockerText}${concernText}\n\nFix only these blockers and call submit_architect again. Do not loop on concerns.`
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
    buildReport() {
      return buildArchitectReport(collector)
    },
    /** Same predicate `submit_architect` uses to decide PASS — pass this to
     *  `terminalTool.shouldExposeOnlyTerminalTool` so scoping never gets
     *  ahead of the tool's own validation. */
    isReadyToFinalize() {
      return validate().length === 0
    },
  }
}
