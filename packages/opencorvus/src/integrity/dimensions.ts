/**
 * Integrity Check — extensible dimension registry.
 *
 * `integrity` is the late-stage requirements-mining + system-integrity dimension
 * registry. Goal builds and task-end review turn non-pass findings from these four
 * orthogonal properties of the original request, extracted requirements, and
 * architect output into targeted rework feedback:
 *
 *   1. requirement_fidelity  — original request mining + REQ-N completion at the
 *                              system level (each user-visible requirement is
 *                              captured, covered, and, when a post-build status
 *                              snapshot is present, actually done end-to-end)
 *   2. technical_feasibility — viability of the proposed contracts
 *   3. hallucination         — fabrication-free upstream reasoning
 *   4. solution_quality      — decomposition defects that threaten task
 *                              semantic integrity, not a general Architect
 *                              style review
 *
 * Adding a 5th dimension is a one-liner here: append a new `IntegrityDimension`
 * to `INTEGRITY_DIMENSIONS`. The agent prompt, Zod submission schema, verdict
 * aggregator, and overlay verdict card all derive from this list — no parallel
 * tables to keep in lockstep (rule 22 single source, rule 24 abstract-on-the-
 * variation-axis).
 *
 * What lives in a dimension entry:
 *
 *   id          — snake_case id, used as the suffix on the per-dimension
 *                 `submit_<id>_verdict` tool name and as a stable key for
 *                 downstream consumers (overlay rendering, prosecutor
 *                 categorisation).
 *   title       — human-readable title (en).
 *   summary     — single-sentence description that appears in the agent's
 *                 system prompt header, defining the dimension to the LLM.
 *   checklist   — bullet list the LLM works through. Keep concrete + observable;
 *                 if you cannot describe a check in terms of "look at field X
 *                 vs source Y", it does not belong here.
 *   issueTypes  — the closed enum of issue.type values this dimension may emit.
 *                 The per-dimension `submit_<id>_verdict` schema scopes its
 *                 issue-type enum to this list, so the LLM cannot stuff issues
 *                 from one dimension into another (structural enforcement).
 *   canProposeCorrections — whether the dimension can PROPOSE goal-layer
 *                 corrections. Integrity never mutates goals by itself; it
 *                 emits executable repair proposals for the orchestrator to
 *                 route or apply.
 */

export type IntegrityIssueType =
  // requirement_fidelity
  | "uncovered"
  | "partial"
  | "distorted"
  | "merged_incorrectly"
  // technical_feasibility
  | "infeasible_stack"
  | "missing_capability"
  | "contract_collision"
  | "dependency_cycle"
  // hallucination
  | "invented_artifact"
  | "out_of_scope"
  | "unsupported_claim"
  // solution_quality
  | "granularity_off"
  | "weak_acceptance"
  | "ownership_overlap"
  | "ordering_smell"

export interface IntegrityDimension {
  /** Snake_case id used on the wire and in storage. */
  id: "requirement_fidelity" | "technical_feasibility" | "hallucination" | "solution_quality"
  /** Human-readable title (en). */
  title: string
  /** Single-sentence definition for the system prompt. */
  summary: string
  /** Concrete checks the LLM walks through under this dimension. */
  checklist: readonly string[]
  /** Issue types this dimension may flag. */
  issueTypes: readonly IntegrityIssueType[]
  /** Whether this dimension is allowed to propose goal-layer corrections. */
  canProposeCorrections: boolean
}

export const INTEGRITY_DIMENSIONS: readonly IntegrityDimension[] = [
  {
    id: "requirement_fidelity",
    title: "Requirement Fidelity",
    summary:
      "Audit source is the original user request. Generated REQ rows are evidence, not the " +
      "audit universe. Every user-visible capability in the original request must be mined " +
      "into a REQ at the right acceptance granularity, then covered by at least one goal that " +
      "claims it via `requirement_ids`; related acceptance specs (those whose " +
      "`source_requirement_id` matches the REQ) must be strong enough to constitute real " +
      "coverage. When a `Requirement Status Snapshot` block is present in the prompt, also " +
      "judge real end-to-end completion from the raw run + spec outcomes; the host does not " +
      "pre-compute aggregates — you decide.",
    checklist: [
      "Start from the original user request, phrase by phrase / capability by capability. " +
        "For each user-visible ask, confirm there is a matching REQ-N row. If no REQ row " +
        "captures it, file `uncovered` or `partial`, leave `requirement_ids` empty, and cite " +
        "the exact user phrase in `evidence`; propose a missing_goal only when a goal-layer " +
        "repair is enough, otherwise make clear that requirements extraction must be rerun.",
      "For each captured REQ, walk REQ-N row by row, NOT goal by goal. Which goal(s) claim it " +
        "via `requirement_ids`? If none claim it = `uncovered` (cite the REQ id in " +
        "`requirement_ids` on the issue). If exactly one goal claims a REQ that names two " +
        "clearly separate concerns the user described (e.g. 'frontend page AND a separate " +
        "auth flow'), that's `merged_incorrectly` — propose a split via missing_goal or " +
        "modify-correction.",
      "For each REQ that IS claimed, walk the claiming goals' acceptance_specs filtered by " +
        "`source_requirement_id == REQ-id`. If those specs only cover a strict subset of what " +
        "the REQ describes (depth shortfall), that's `partial`. If a claiming goal's contract " +
        "reshapes the REQ — adding constraints the user did not state in the REQ row — that's " +
        "`distorted` (NOT `out_of_scope`; that one is hallucination's territory and triggers when " +
        "the REQ row itself drifts beyond the user's words).",
      "When a `# Requirement Status Snapshot` section is present (post-build), walk it row by " +
        "row. Each snapshot row gives REQ-N, claiming goals with their `runStatus`, and per-spec " +
        "`severity` + `passed?` outcomes. Decide REQ completion yourself from this raw evidence: " +
        "essential specs all `passed=true` is done; mixed pass/fail on essential specs is `partial` " +
        "(cite the failing `spec_ids`); essential specs all failed or no spec evidence with a " +
        "non-running goal is the strong form of `partial`. Pre-build (snapshot absent) skip this " +
        "bullet — fidelity is structural-only.",
    ],
    issueTypes: ["uncovered", "partial", "distorted", "merged_incorrectly"],
    canProposeCorrections: true,
  },
  {
    id: "technical_feasibility",
    title: "Technical Feasibility",
    summary:
      "The chosen stack + goal contracts must be coherent and physically achievable. " +
      "Graph contracts must be produced by dependency ancestors; owned paths must " +
      "support the implementation; the dependency graph must be acyclic.",
    checklist: [
      "Walk the Architect Contract Graph. Every contract consumer must depend on its producer " +
        "through `depends_on`, and every dependency reason must match the edge. A dangling " +
        "contract = `missing_capability`. If the fix is a graph/dependency mismatch, propose " +
        "a correction that rewrites `depends_on` and explicitly describes the needed graph change.",
      "Walk the `depends_on` graph. A cycle = `dependency_cycle`. Surface the cycle's " +
        "shortest path in `evidence` so the orchestrator can pick which edge to break.",
      "Look at the foundational `Decisions` block (runtime, framework, package_manager, " +
        "test_framework). If the decisions are mutually inconsistent (e.g. runtime=python " +
        "but test_framework=vitest), or the chosen framework cannot deliver a goal's " +
        "stated objective (e.g. backend goal targeting a framework with no DB integration " +
        "but the goal needs persistence), that's `infeasible_stack`.",
      "Do not treat `owned_paths[]` overlap as a technical-feasibility failure. " +
        "`owned_paths` are responsibility hints, not a file sandbox. A true " +
        "`contract_collision` is an incompatible dependency/graph/runtime contract " +
        "(for example two goals declare conflicting public APIs for the same module, " +
        "or a consumer claims a capability whose producer contract explicitly forbids it).",
      "Merged-tree completeness. The union of all goals' `owned_paths` must materialise " +
        "every prerequisite the user's deliverable needs to be exercised end-to-end. " +
        "For visual / browser deliverables that includes the runnable entrypoint (root " +
        "`index.html` or framework equivalent that the acceptance renderer can load); for " +
        "any goal whose acceptance command invokes project-wide tooling (`npm test`, " +
        "`bun test`, `pnpm test`, root `package.json` scripts, framework binaries via " +
        "root devDependencies), it includes the root config that makes those commands " +
        "runnable (`package.json` scripts/devDependencies, `tsconfig.json`, test-runner " +
        "config). When a deliverable prerequisite is unowned by every goal, that's " +
        "`missing_capability` against an implicit infra goal — propose a corrected goal " +
        "(or a new infra goal) that owns the missing path.",
      "User-deliverable tier walk (system completion). For each user-visible REQ, derive its " +
        "implementation tier: a frontend page implies a backend API REQ + a data source; a CLI " +
        "tool implies a runtime entrypoint + storage; a webhook implies external reachability " +
        "infra. For each implied tier, check the merged tree for a goal whose graph contracts / " +
        "`owned_paths` actually produce that capability. A frontend page with no backing API goal, " +
        "an API goal with no data-store goal, a CLI tool with no runtime entrypoint goal — each " +
        "is `missing_capability` against an implicit infra goal. Cite the user phrase that " +
        "implies the missing tier in `evidence`. Propose a `missing_goals` entry that owns the " +
        "implied tier; if an existing goal is the natural owner, use a `modify` correction that " +
        "widens its `owned_paths` or graph ownership instead.",
    ],
    issueTypes: ["infeasible_stack", "missing_capability", "contract_collision", "dependency_cycle"],
    canProposeCorrections: true,
  },
  {
    id: "hallucination",
    title: "Hallucination",
    summary:
      "Upstream agents (intent-analysis / design-analyst / requirements / architect) " +
      "must ground their output in the user request, attached references, or the " +
      "codebase. Specs that fabricate entities the user never named, claims the " +
      "design-analyst could not have read off the reference, or REQ rows justified " +
      "by training-data prior knowledge are integrity violations even when they look " +
      "internally consistent.",
    checklist: [
      "For each REQ, design spec, contract, and acceptance spec, ask: where does this " +
        "ground? An ungrounded spec = `unsupported_claim`. Cite the spec id in evidence.",
      "When a goal references a file path or external service the user never mentioned " +
        "and the codebase does not contain, that's `invented_artifact`.",
      "When a spec drifts BEYOND the user's stated scope (e.g. user asked for X, REQ " +
        "rows demand X + Y, where Y is invented), flag `out_of_scope`. This is the " +
        "scope-creep partner of requirement_fidelity's `distorted`: distorted reshapes " +
        "a user ask within an existing REQ row, out_of_scope is when the REQ row itself " +
        "adds a non-user ask.",
    ],
    issueTypes: ["invented_artifact", "out_of_scope", "unsupported_claim"],
    canProposeCorrections: true,
  },
  {
    id: "solution_quality",
    title: "Solution Quality",
    summary:
      "Only flag decomposition or acceptance-quality defects when they threaten the task's " +
      "semantic integrity. This dimension is not a second full Architect review; advisory " +
      "style preferences, harmless granularity taste, and ordinary refactor opinions do not " +
      "belong here.",
    checklist: [
      "Granularity. Flag `granularity_off` only when goal shape hides or loses task scope: " +
        "one mega-goal absorbs unrelated REQs so acceptance cannot isolate failures, or many " +
        "atomic goals fragment one user capability so no goal owns the end-to-end behavior. " +
        "Do not flag harmless preference-level graph shape.",
      "Acceptance-spec strength. Flag `weak_acceptance` when an essential spec cannot prove " +
        "the REQ it claims: file-existence / self-grep checks that pass by construction, zero " +
        "essential specs on a blocking goal, or commands depending on tooling/config outside " +
        "the goal's owned paths and ancestors. The issue must name the affected REQ or spec.",
      "Shared responsibility clarity. `owned_paths` overlap is allowed when goals need to " +
        "coordinate on a shared surface. Flag `ownership_overlap` only when the overlap makes " +
        "the task outcome ambiguous because no dependency, import/export, assembly-owner, or " +
        "`files_changed[]` evidence explains who completes the shared surface. It must not " +
        "turn `owned_paths` into a hard editable-file lock.",
      "Ordering smell. Flag `ordering_smell` only when dependency order can make a required " +
        "REQ untestable or impossible to integrate, such as verification scheduled before its " +
        "feature or bootstrap depending on feature outputs. Propose a concrete `depends_on` " +
        "correction when ordering is the actual repair.",
    ],
    issueTypes: ["granularity_off", "weak_acceptance", "ownership_overlap", "ordering_smell"],
    canProposeCorrections: true,
  },
] as const

/** Render the dimension catalogue as a markdown system-prompt section. The
 *  agent's prompt assembles by concatenating this with the procedural framing
 *  in `integrity-core.txt`, so adding a dimension flows into the prompt with
 *  no further wiring. */
export function renderDimensionCatalogue(): string {
  const sections: string[] = []
  sections.push("## Integrity Dimensions")
  sections.push("")
  sections.push(
    "Every check below produces a per-dimension verdict (`pass` / `concerns` / " +
      "`needs_correction`). The aggregate gate passes only when final acceptance is " +
      "accepted and every non-pass signal is advisory-only: no dimension is " +
      "`needs_correction`, and no dimension carries `corrections`, " +
      "`graph_corrections`, or `missing_goals`. Advisory `concerns` remain visible " +
      "evidence without blocking completion.",
  )
  for (const d of INTEGRITY_DIMENSIONS) {
    const correctionsNote = d.canProposeCorrections
      ? "Goal-mutating corrections + missing_goals allowed under this dimension."
      : "Diagnostic only — surface concerns; no goal-layer corrections are accepted."
    sections.push("")
    sections.push(`### ${d.id} — ${d.title}`)
    sections.push("")
    sections.push(d.summary)
    sections.push("")
    sections.push("**Checks**:")
    for (const item of d.checklist) {
      sections.push(`- ${item}`)
    }
    sections.push("")
    sections.push(`**Allowed issue types**: \`${d.issueTypes.join("`, `")}\``)
    sections.push("")
    sections.push(`**Corrections**: ${correctionsNote}`)
  }
  return sections.join("\n")
}
