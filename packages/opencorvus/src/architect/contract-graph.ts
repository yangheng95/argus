import z from "zod"
import { ContractIRSchema, renderContractIR, type ContractIR } from "./contract-ir"

export const ArchitectContractKindSchema = z.enum([
  "type",
  "function",
  "enum",
  "component",
  "route",
  "static_data",
  "render_surface",
  "behavior_inventory",
])
export type ArchitectContractKind = z.infer<typeof ArchitectContractKindSchema>

export const RouteContractSchema = z.object({
  method: z.string().min(1),
  path: z.string().min(1),
  request: z.string().min(1).optional(),
  response: z.string().min(1).optional(),
})
export type RouteContract = z.infer<typeof RouteContractSchema>

export const ComponentContractSchema = z.object({
  props: z
    .string()
    .min(1)
    .describe("Comma-separated public prop names or prop signatures, for example: title, items, onSelect.")
    .optional(),
  events: z.array(z.string().min(1)).describe("Event names emitted by the component.").default([]),
  slots: z.array(z.string().min(1)).describe("Named content slots exposed by the component.").default([]),
})
export type ComponentContract = z.infer<typeof ComponentContractSchema>

export const ArchitectContractRefSchema = z
  .object({
    id: z.string().min(1),
    kind: ArchitectContractKindSchema,
    name: z.string().min(1),
    producer_goal_id: z.string().min(1),
    consumer_goal_ids: z.array(z.string().min(1)).default([]),
    summary: z.string().min(1),
    ir: ContractIRSchema.optional(),
    route: RouteContractSchema.optional(),
    component: ComponentContractSchema.optional(),
    artifact_paths: z.array(z.string().min(1)).default([]),
    evidence_refs: z.array(z.string().min(1)).default([]),
  })
  .superRefine((value, ctx) => {
    const typed = value.kind === "type" || value.kind === "function" || value.kind === "enum"
    if (typed && !value.ir) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ir"],
        message: `${value.kind} contract requires ir`,
      })
    }
    if (!typed && value.ir) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ir"],
        message: `${value.kind} contract must not carry ContractIR`,
      })
    }
    if (value.ir && value.ir.kind !== value.kind) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ir", "kind"],
        message: `ContractIR kind ${value.ir.kind} must match graph kind ${value.kind}`,
      })
    }
  })
export type ArchitectContractRef = z.infer<typeof ArchitectContractRefSchema>

export const GoalDependencyReasonSchema = z.enum(["contract", "bootstrap_scaffold", "integration_order"])
export type GoalDependencyReason = z.infer<typeof GoalDependencyReasonSchema>

export const GoalDependencyContractSchema = z.object({
  from_goal_id: z.string().min(1),
  to_goal_id: z.string().min(1),
  reason: GoalDependencyReasonSchema,
  contract_ids: z.array(z.string().min(1)).default([]),
  summary: z.string().min(1).optional(),
})
export type GoalDependencyContract = z.infer<typeof GoalDependencyContractSchema>

export const ArchitectContractGraphSchema = z.object({
  version: z.literal(1).default(1),
  contracts: z.array(ArchitectContractRefSchema).default([]),
  dependency_contracts: z.array(GoalDependencyContractSchema).default([]),
})
export type ArchitectContractGraph = z.infer<typeof ArchitectContractGraphSchema>

export const ArchitectValidationFindingSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(["blocker", "concern"]),
  scope: z
    .object({
      goal_ids: z.array(z.string()).optional(),
      contract_ids: z.array(z.string()).optional(),
    })
    .default({}),
  message: z.string().min(1),
  repair_tools: z.array(z.string().min(1)).default([]),
})
export type ArchitectValidationFinding = z.infer<typeof ArchitectValidationFindingSchema>

export type GraphValidationGoal = {
  id: string
  depends_on: string[]
  acceptance_specs: Array<{
    scorers: Array<{ type: string; spec?: unknown }>
    severity?: string
  }>
}

export function emptyArchitectContractGraph(): ArchitectContractGraph {
  return { version: 1, contracts: [], dependency_contracts: [] }
}

export function parseArchitectContractGraph(input: unknown): ArchitectContractGraph {
  return ArchitectContractGraphSchema.parse(input ?? emptyArchitectContractGraph())
}

export function contractGraphIRIndex(graph: ArchitectContractGraph): Map<string, ContractIR> {
  return new Map(
    graph.contracts
      .filter((contract): contract is ArchitectContractRef & { ir: ContractIR } => !!contract.ir)
      .flatMap((contract) => [[contract.id, contract.ir] as const, [contract.name, contract.ir] as const]),
  )
}

export function contractSurfaceKey(contract: ArchitectContractRef): string {
  return stableJSONStringify({
    producer_goal_id: contract.producer_goal_id,
    kind: contract.kind,
    name: contract.name,
    ir: contract.ir ?? null,
    route: contract.route ?? null,
    component: contract.component ?? null,
    artifact_paths: [...contract.artifact_paths].sort(),
  })
}

function stableJSONStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJSONStringify).join(",")}]`
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJSONStringify(entry)}`).join(",")}}`
  }
  return JSON.stringify(value)
}

export function validateArchitectContractGraph(input: {
  goals: readonly GraphValidationGoal[]
  graph: ArchitectContractGraph
}): ArchitectValidationFinding[] {
  const findings: ArchitectValidationFinding[] = []
  const goalIDs = new Set(input.goals.map((goal) => goal.id))
  const contractIDs = new Set<string>()
  const contractsByID = new Map<string, ArchitectContractRef>()
  const contractsBySurface = new Map<string, ArchitectContractRef>()
  const dependencyPairs = new Set<string>()

  for (const goal of input.goals) {
    for (const dep of goal.depends_on) dependencyPairs.add(edgeKey(dep, goal.id))
  }
  const registeredDependencyPairs = new Set(
    input.graph.dependency_contracts.map((edge) => edgeKey(edge.from_goal_id, edge.to_goal_id)),
  )
  for (const goal of input.goals) {
    for (const dep of goal.depends_on) {
      if (!registeredDependencyPairs.has(edgeKey(dep, goal.id))) {
        findings.push(
          blocker(
            "dependency_edge_missing_reason",
            `Goal dependency ${dep} -> ${goal.id} has no registered dependency contract reason.`,
            { goal_ids: [dep, goal.id] },
            ["register_dependency_contract"],
          ),
        )
      }
    }
  }

  for (const cycle of dependencyCycles(input.goals)) {
    findings.push(
      blocker("dependency_cycle", `Goal dependency cycle detected: ${cycle.join(" -> ")}.`, { goal_ids: cycle }, [
        "register_goal",
        "modify_goal",
      ]),
    )
  }

  for (const contract of input.graph.contracts) {
    if (contractIDs.has(contract.id)) {
      findings.push(
        blocker(
          "duplicate_contract_id",
          `Contract id "${contract.id}" is registered more than once.`,
          { contract_ids: [contract.id] },
          ["register_contract"],
        ),
      )
    }
    contractIDs.add(contract.id)
    contractsByID.set(contract.id, contract)
    const surfaceKey = contractSurfaceKey(contract)
    const duplicateSurface = contractsBySurface.get(surfaceKey)
    if (duplicateSurface && duplicateSurface.id !== contract.id) {
      findings.push(
        blocker(
          "duplicate_contract_surface",
          `Contract ${contract.id} duplicates existing contract surface ${duplicateSurface.id}; ` +
            `re-register the existing id to update consumers or metadata instead of creating a new id.`,
          { contract_ids: [duplicateSurface.id, contract.id], goal_ids: [contract.producer_goal_id] },
          ["register_contract"],
        ),
      )
    } else {
      contractsBySurface.set(surfaceKey, contract)
    }

    const unknownGoals = [contract.producer_goal_id, ...contract.consumer_goal_ids].filter(
      (goalID) => !goalIDs.has(goalID),
    )
    if (unknownGoals.length > 0) {
      findings.push(
        blocker(
          "contract_unknown_goal",
          `Contract ${contract.id} references unknown goal ids: ${unique(unknownGoals).join(", ")}.`,
          { contract_ids: [contract.id], goal_ids: unique(unknownGoals) },
          ["register_contract"],
        ),
      )
    }

    for (const consumerID of contract.consumer_goal_ids) {
      if (!hasDependencyPath(input.goals, consumerID, contract.producer_goal_id)) {
        findings.push(
          blocker(
            "contract_producer_not_ancestor",
            `Contract ${contract.id} producer ${contract.producer_goal_id} is not in dependency ancestry for consumer ${consumerID}.`,
            { contract_ids: [contract.id], goal_ids: [contract.producer_goal_id, consumerID] },
            ["register_goal", "register_dependency_contract"],
          ),
        )
      }
    }

    if (contract.summary.trim().length < 12) {
      findings.push(
        concern(
          "weak_contract_summary",
          `Contract ${contract.id} summary is too weak to guide downstream build work.`,
          { contract_ids: [contract.id] },
          ["register_contract"],
        ),
      )
    }

    if (contract.kind === "render_surface" && contract.consumer_goal_ids.length > 1) {
      findings.push(
        concern(
          "broad_render_surface_coupling",
          `Contract ${contract.id} exposes a broad rendered surface to multiple consumers; verify the boundary is not coupling goals through UI internals.`,
          { contract_ids: [contract.id], goal_ids: contract.consumer_goal_ids },
          ["register_contract"],
        ),
      )
    }
  }

  for (const edge of input.graph.dependency_contracts) {
    const edgeGoals = [edge.from_goal_id, edge.to_goal_id]
    const unknownGoals = edgeGoals.filter((goalID) => !goalIDs.has(goalID))
    if (unknownGoals.length > 0) {
      findings.push(
        blocker(
          "dependency_contract_unknown_goal",
          `Dependency contract ${edge.from_goal_id} -> ${edge.to_goal_id} references unknown goal ids: ${unknownGoals.join(", ")}.`,
          { goal_ids: unknownGoals },
          ["register_dependency_contract"],
        ),
      )
      continue
    }
    if (!dependencyPairs.has(edgeKey(edge.from_goal_id, edge.to_goal_id))) {
      findings.push(
        blocker(
          "dependency_contract_missing_depends_on",
          `Dependency contract ${edge.from_goal_id} -> ${edge.to_goal_id} has no matching depends_on edge.`,
          { goal_ids: edgeGoals },
          ["register_goal", "register_dependency_contract"],
        ),
      )
    }
    if (!hasDependencyPath(input.goals, edge.to_goal_id, edge.from_goal_id)) {
      findings.push(
        blocker(
          "dependency_contract_producer_not_ancestor",
          `Dependency contract producer ${edge.from_goal_id} is not in dependency ancestry for ${edge.to_goal_id}.`,
          { goal_ids: edgeGoals },
          ["register_goal", "register_dependency_contract"],
        ),
      )
    }

    if (edge.reason === "contract" && edge.contract_ids.length === 0) {
      findings.push(
        blocker(
          "contract_edge_empty_contract_ids",
          `Dependency contract ${edge.from_goal_id} -> ${edge.to_goal_id} has reason=contract but no contract_ids.`,
          { goal_ids: edgeGoals },
          ["register_dependency_contract"],
        ),
      )
    }
    if (edge.reason !== "contract" && !edge.summary?.trim()) {
      findings.push(
        blocker(
          "non_contract_edge_missing_summary",
          `Dependency contract ${edge.from_goal_id} -> ${edge.to_goal_id} has reason=${edge.reason} and must explain the ordering contract in summary.`,
          { goal_ids: edgeGoals },
          ["register_dependency_contract"],
        ),
      )
    }
    if (edge.reason !== "contract" && edge.contract_ids.length === 0) {
      findings.push(
        concern(
          "non_contract_edge_without_contract",
          `Dependency contract ${edge.from_goal_id} -> ${edge.to_goal_id} is ${edge.reason}; verify the ordering-only edge is intentional.`,
          { goal_ids: edgeGoals },
          ["register_dependency_contract"],
        ),
      )
    }

    for (const contractID of edge.contract_ids) {
      const contract = contractsByID.get(contractID)
      if (!contract) {
        findings.push(
          blocker(
            "dependency_contract_unknown_contract",
            `Dependency contract ${edge.from_goal_id} -> ${edge.to_goal_id} references unknown contract ${contractID}.`,
            { goal_ids: edgeGoals, contract_ids: [contractID] },
            ["register_contract", "register_dependency_contract"],
          ),
        )
        continue
      }
      if (contract.producer_goal_id !== edge.from_goal_id || !contract.consumer_goal_ids.includes(edge.to_goal_id)) {
        findings.push(
          blocker(
            "dependency_contract_edge_mismatch",
            `Contract ${contractID} belongs to ${contract.producer_goal_id} -> [${contract.consumer_goal_ids.join(", ")}], not ${edge.from_goal_id} -> ${edge.to_goal_id}.`,
            { goal_ids: edgeGoals, contract_ids: [contractID] },
            ["register_contract", "register_dependency_contract"],
          ),
        )
      }
    }
  }

  const allAuditReferences = essentialAcceptanceContractGraphIDsByGoal(input.goals, { essentialOnly: false })
  for (const [goalID, referencedContractIDs] of allAuditReferences) {
    for (const contractID of referencedContractIDs) {
      if (contractIDs.has(contractID)) continue
      findings.push(
        blocker(
          "contract_audit_unknown_contract",
          `Goal ${goalID} contract_audit references unknown graph contract ${contractID}. Use contract ids registered in the architect contract graph.`,
          { goal_ids: [goalID], contract_ids: [contractID] },
          ["register_goal", "modify_goal", "register_contract"],
        ),
      )
    }
  }

  const essentialAuditCoverage = essentialAcceptanceContractGraphIDsByGoal(input.goals)
  for (const contract of input.graph.contracts) {
    const relatedGoalIDs = unique([contract.producer_goal_id, ...contract.consumer_goal_ids])
    const covered = relatedGoalIDs.some((goalID) => essentialAuditCoverage.get(goalID)?.has(contract.id))
    if (!covered) {
      findings.push(
        concern(
          "contract_without_audit_coverage",
          `Contract ${contract.id} is not covered by any related goal's essential contract_audit scorer; add an essential contract_audit acceptance spec that references this contract_ids entry or revise the graph contract.`,
          { contract_ids: [contract.id], goal_ids: relatedGoalIDs },
          ["register_goal", "modify_goal", "register_contract"],
        ),
      )
    }
  }

  return findings
}

export function remapArchitectContractGraphGoalIDs(
  graph: ArchitectContractGraph,
  mapGoalID: (goalID: string) => string | undefined,
): ArchitectContractGraph {
  const remap = (goalID: string) => {
    const mapped = mapGoalID(goalID)
    if (!mapped) throw new Error(`Architect contract graph references unmapped goal id: ${goalID}`)
    return mapped
  }
  return {
    version: 1,
    contracts: graph.contracts.map((contract) => ({
      ...contract,
      producer_goal_id: remap(contract.producer_goal_id),
      consumer_goal_ids: contract.consumer_goal_ids.map(remap),
    })),
    dependency_contracts: graph.dependency_contracts.map((edge) => ({
      ...edge,
      from_goal_id: remap(edge.from_goal_id),
      to_goal_id: remap(edge.to_goal_id),
    })),
  }
}

export function renderContractGraphForPrompt(graph: ArchitectContractGraph, goalID?: string): string {
  const contracts = goalID
    ? graph.contracts.filter(
        (contract) => contract.producer_goal_id === goalID || contract.consumer_goal_ids.includes(goalID),
      )
    : graph.contracts
  const edges = goalID
    ? graph.dependency_contracts.filter((edge) => edge.from_goal_id === goalID || edge.to_goal_id === goalID)
    : graph.dependency_contracts

  const lines: string[] = []
  lines.push("## Contract Graph")
  if (contracts.length === 0) {
    lines.push("No graph contracts registered for this scope.")
  } else {
    for (const contract of contracts) {
      lines.push(
        `- ${contract.id} [${contract.kind}] ${contract.name}: producer=${contract.producer_goal_id}; consumers=${contract.consumer_goal_ids.join(", ") || "(none)"}; ${contract.summary}`,
      )
      if (contract.ir) lines.push(indent(renderContractIR(contract.ir), "  "))
      if (contract.route) lines.push(`  route ${contract.route.method} ${contract.route.path}`)
      if (contract.component) lines.push(`  component props=${contract.component.props ?? "(unspecified)"}`)
      if ((contract.artifact_paths ?? []).length > 0)
        lines.push(`  artifacts=${(contract.artifact_paths ?? []).join(", ")}`)
      if ((contract.evidence_refs ?? []).length > 0)
        lines.push(`  evidence_refs=${(contract.evidence_refs ?? []).join(", ")}`)
    }
  }
  lines.push("")
  lines.push("## Dependency Reasons")
  if (edges.length === 0) {
    lines.push("No dependency contract edges registered for this scope.")
  } else {
    for (const edge of edges) {
      lines.push(
        `- ${edge.from_goal_id} -> ${edge.to_goal_id}: reason=${edge.reason}; contracts=${edge.contract_ids.join(", ") || "(none)"}${edge.summary ? `; ${edge.summary}` : ""}`,
      )
    }
  }
  return lines.join("\n")
}

export function graphContractsForGoal(
  graph: ArchitectContractGraph,
  goalID: string,
): {
  produced: ArchitectContractRef[]
  consumed: ArchitectContractRef[]
  dependencyContracts: GoalDependencyContract[]
} {
  return {
    produced: graph.contracts.filter((contract) => contract.producer_goal_id === goalID),
    consumed: graph.contracts.filter((contract) => contract.consumer_goal_ids.includes(goalID)),
    dependencyContracts: graph.dependency_contracts.filter(
      (edge) => edge.from_goal_id === goalID || edge.to_goal_id === goalID,
    ),
  }
}

function essentialAcceptanceContractGraphIDsByGoal(
  goals: readonly GraphValidationGoal[],
  input?: { essentialOnly?: boolean },
): Map<string, Set<string>> {
  const idsByGoal = new Map<string, Set<string>>()
  const essentialOnly = input?.essentialOnly !== false
  for (const goal of goals) {
    for (const spec of goal.acceptance_specs) {
      if (essentialOnly && spec.severity !== "essential") continue
      for (const scorer of spec.scorers) {
        if (scorer.type !== "contract_audit") continue
        const scorerSpec = scorer.spec as { kind?: unknown; contract_ids?: unknown } | undefined
        if (scorerSpec?.kind !== "contract_graph" || !Array.isArray(scorerSpec.contract_ids)) continue
        const ids = idsByGoal.get(goal.id) ?? new Set<string>()
        for (const contractID of scorerSpec.contract_ids) {
          if (typeof contractID === "string") ids.add(contractID)
        }
        idsByGoal.set(goal.id, ids)
      }
    }
  }
  return idsByGoal
}

function hasDependencyPath(goals: readonly GraphValidationGoal[], fromGoalID: string, ancestorGoalID: string): boolean {
  const byID = new Map(goals.map((goal) => [goal.id, goal]))
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

function dependencyCycles(goals: readonly GraphValidationGoal[]): string[][] {
  const byID = new Map(goals.map((goal) => [goal.id, goal]))
  const cycles: string[][] = []
  const emitted = new Set<string>()
  for (const goal of goals) {
    visit(goal.id, [])
  }
  return cycles

  function visit(goalID: string, path: string[]) {
    const existingIndex = path.indexOf(goalID)
    if (existingIndex >= 0) {
      const cycle = [...path.slice(existingIndex), goalID]
      const key = canonicalCycleKey(cycle)
      if (!emitted.has(key)) {
        emitted.add(key)
        cycles.push(cycle)
      }
      return
    }
    const goal = byID.get(goalID)
    if (!goal) return
    for (const dep of goal.depends_on) {
      visit(dep, [...path, goalID])
    }
  }
}

function canonicalCycleKey(cycle: string[]): string {
  const body = cycle.slice(0, -1)
  if (body.length === 0) return cycle.join("->")
  const rotations = body.map((_, index) => [...body.slice(index), ...body.slice(0, index)].join("->"))
  return rotations.sort()[0]!
}

function edgeKey(from: string, to: string): string {
  return `${from}\u0000${to}`
}

function blocker(
  code: string,
  message: string,
  scope: ArchitectValidationFinding["scope"],
  repairTools: string[],
): ArchitectValidationFinding {
  return { code, severity: "blocker", scope, message, repair_tools: repairTools }
}

function concern(
  code: string,
  message: string,
  scope: ArchitectValidationFinding["scope"],
  repairTools: string[],
): ArchitectValidationFinding {
  return { code, severity: "concern", scope, message, repair_tools: repairTools }
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function indent(value: string, prefix: string): string {
  return value
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n")
}
