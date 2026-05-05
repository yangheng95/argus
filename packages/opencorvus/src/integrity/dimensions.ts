/**
 * Integrity Check — extensible dimension registry.
 *
 * `integrity` is the post-architect / pre-build gate that verifies four
 * orthogonal properties of the architect's output:
 *
 *   1. goal_fidelity         — coverage of the user's literal request
 *   2. technical_feasibility — viability of the proposed contracts
 *   3. hallucination         — fabrication-free upstream reasoning
 *   4. solution_quality      — soundness of the decomposition itself
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
 *   correctionScopes — what the dimension is allowed to PROPOSE corrections to.
 *                 goal_fidelity / solution_quality may rewrite goals; the other
 *                 two are diagnostic and surface concerns without editing goals
 *                 (the orchestrator decides whether to restart/refine the
 *                 upstream stage). This stops "hallucination" from
 *                 silently mutating goal contracts when the real fix is to
 *                 restart requirements.
 */

export type IntegrityIssueType =
  // goal_fidelity
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
  id: "goal_fidelity" | "technical_feasibility" | "hallucination" | "solution_quality"
  /** Human-readable title (en). */
  title: string
  /** Single-sentence definition for the system prompt. */
  summary: string
  /** Concrete checks the LLM walks through under this dimension. */
  checklist: readonly string[]
  /** Issue types this dimension may flag. */
  issueTypes: readonly IntegrityIssueType[]
  /** Whether this dimension is allowed to propose goal-mutating corrections.
   *  Diagnostic-only dimensions surface concerns; goal mutations belong to
   *  dimensions whose findings can be RESOLVED at the goal-set layer. */
  canProposeCorrections: boolean
}

export const INTEGRITY_DIMENSIONS: readonly IntegrityDimension[] = [
  {
    id: "goal_fidelity",
    title: "Goal Fidelity",
    summary:
      "The goal set must cover the user's ORIGINAL request faithfully — every distinct " +
      "ask is addressed, no ask is silently merged or distorted, and no goal injects " +
      "scope the user did not request.",
    checklist: [
      "Read the User Request verbatim. List every concrete deliverable the user named. " +
        "Walk through each goal contract and assign which user deliverable it satisfies. " +
        "An unmatched user deliverable = `uncovered` issue. A goal with no user-deliverable mapping = `out_of_scope` (handled by the hallucination dimension; if it overlaps a user deliverable but adds requirements the user did not specify, that's `distorted` here).",
      "When the user names two clearly separate concerns and one goal claims both, " +
        "that's `merged_incorrectly` — split-correction or a missing-goal proposal.",
      "When a goal addresses a user deliverable but at strictly less depth than the " +
        "user described, that's `partial`.",
    ],
    issueTypes: ["uncovered", "partial", "distorted", "merged_incorrectly"],
    canProposeCorrections: true,
  },
  {
    id: "technical_feasibility",
    title: "Technical Feasibility",
    summary:
      "The chosen stack + goal contracts must be coherent and physically achievable. " +
      "An imported symbol must be exported by some ancestor goal; owned paths must " +
      "support the implementation; the dependency graph must be acyclic.",
    checklist: [
      "Walk every goal's `imports[]`. Every entry must appear in some ancestor (`depends_on`) " +
        "goal's `exports[]`. A dangling import = `missing_capability` (the importer needs " +
        "something nobody is producing).",
      "Walk the `depends_on` graph. A cycle = `dependency_cycle`. Surface the cycle's " +
        "shortest path in `evidence` so the orchestrator can pick which edge to break.",
      "Look at the foundational `Decisions` block (runtime, framework, package_manager, " +
        "test_framework). If the decisions are mutually inconsistent (e.g. runtime=python " +
        "but test_framework=vitest), or the chosen framework cannot deliver a goal's " +
        "stated objective (e.g. backend goal targeting a framework with no DB integration " +
        "but the goal needs persistence), that's `infeasible_stack`.",
      "Compare every pair of goals' `owned_paths[]`. Two goals owning the same path = " +
        "`contract_collision` — a hard build-time conflict.",
      "Merged-tree completeness. The union of all goals' `owned_paths` must materialise " +
        "every prerequisite the user's deliverable needs to be exercised end-to-end. " +
        "For visual / browser deliverables that includes the runnable entrypoint (root " +
        "`index.html` or framework equivalent that delivery's renderer can load); for " +
        "any goal whose acceptance command invokes project-wide tooling (`npm test`, " +
        "`bun test`, `pnpm test`, root `package.json` scripts, framework binaries via " +
        "root devDependencies), it includes the root config that makes those commands " +
        "runnable (`package.json` scripts/devDependencies, `tsconfig.json`, test-runner " +
        "config). When a deliverable prerequisite is unowned by every goal, that's " +
        "`missing_capability` against an implicit infra goal — propose a corrected goal " +
        "(or a new infra goal) that owns the missing path.",
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
        "scope-creep partner of goal_fidelity's `distorted`: distorted reshapes a user " +
        "ask, out_of_scope adds a non-user ask.",
    ],
    issueTypes: ["invented_artifact", "out_of_scope", "unsupported_claim"],
    // Diagnostic-only: hallucinations usually demand re-running upstream
    // (requirements / design_analysis), not editing the goal set. Surface
    // concerns; let the orchestrator decide.
    canProposeCorrections: false,
  },
  {
    id: "solution_quality",
    title: "Solution Quality",
    summary:
      "Independent of correctness, is the decomposition itself sound? Granularity, " +
      "acceptance-spec strength, ownership clarity, and ordering smell all live here.",
    checklist: [
      "Granularity. A single mega-goal that absorbs unrelated REQs = `granularity_off` " +
        "(propose a split). 30 atomic goals where the user asked for one feature = same " +
        "issue, opposite direction (propose merges).",
      "Acceptance-spec strength. A `severity: 'essential'` spec backed only by a `test -f` " +
        "or a `grep` of self-written content is `weak_acceptance` — the spec passes by " +
        "construction. A goal with zero `essential` specs is also `weak_acceptance`. " +
        "Acceptance command external dependencies. If a scorer's shell command depends on " +
        "tooling, scripts, or configuration the goal does NOT own (e.g. an `npm test` " +
        "command on a goal whose `owned_paths` include no `package.json`, or a `bunx tsc` " +
        "command on a goal that owns no `tsconfig.json`), and no ancestor goal in " +
        "`depends_on` owns it either, that's also `weak_acceptance`: the command passes " +
        "or fails based on state outside this plan's control. Either widen the goal's " +
        "`owned_paths` (or its dependency's) to cover the prerequisite, or scope the " +
        "command to files the goal actually owns (e.g. `bun test src/<goal-dir>/`).",
      "Ownership overlap. Goals can share imports/exports, but two goals editing the same " +
        "file (even if one is a directory and the other is a glob) = `ownership_overlap`. " +
        "Distinct from technical_feasibility's `contract_collision` — collision is a hard " +
        "edit conflict; overlap is fuzzy mutual rewriting that turns merge into roulette.",
      "Ordering smell. A `verification` goal scheduled before its target `feature` goal, " +
        "or a `bootstrap` goal that depends on `feature` outputs, is `ordering_smell`.",
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
    "`needs_correction`). The aggregate verdict is the worst per-dimension verdict; " +
    "the orchestrator routes recovery based on which dimensions failed (corrections " +
    "land at the goal layer, hallucinations re-run upstream, etc.).",
  )
  for (const d of INTEGRITY_DIMENSIONS) {
    const correctionsNote = d.canProposeCorrections
      ? "Goal-mutating corrections + missing_goals allowed under this dimension."
      : "Diagnostic only — surface concerns, do NOT propose goal mutations under " +
        "this dimension. The orchestrator re-runs upstream when it sees these issues."
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
