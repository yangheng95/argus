/**
 * Goal Workload Analyst — output types.
 *
 * The analyst is a read-only reviewer that runs after Architect and before
 * per-goal Build. It deeply reads the full frontend template + the architect goal graph
 * and, per goal, produces a workload brief.
 *
 * index/lens discipline (spec §2, rule 8): a brief ORIGINATES only the fields
 * that have no other source (why_not_smaller / traps / countable inventory /
 * verification inventory / decomposition_concern). Everything about *which*
 * surfaces, contracts, or workflows a goal touches is REFERENCED by id into the
 * existing single sources (architect contract / reference_coverage / goal /
 * acceptance_spec ids, frontend-design vis-* ids, frontend-template.md sections) and never
 * restated as new prose.
 */

export type WorkloadBrief = {
  /** Architect goal id (llmID), e.g. "goal_visual_shell". Must be a registered goal. */
  goal_id: string
  /**
   * Non-empty ONLY when this goal is too large or under-specified for one
   * autonomous build. The content is the *evidence* (why a single build should
   * not swallow it) — NOT a concrete split plan, which is Architect's job
   * (the analyst never decomposes; spec §1 boundary). Empty/undefined = the
   * current decomposition is adequately sized.
   */
  decomposition_concern?: string

  // ── ORIGINATED (no other source) ─────────────────────────────────────────
  /** Concrete reasons this goal is bigger than its title/objective implies. */
  why_not_smaller: string[]
  /** Specific "do not stop at X" warnings against premature minimization. */
  underestimation_traps: string[]
  /** Countable decomposition of the work surface — the anti-minimization checklist. */
  execution_inventory: {
    surfaces: number
    states: number
    data_contracts: number
    verification_points: number
  }
  /** Concrete, observable checks build must run before reporting pass. */
  verification_inventory: string[]

  // ── REFERENCED (pointers into existing single sources; never restated) ────
  references: {
    /** architect contract ids (render_surface / behavior_inventory / type / …). */
    contract_ids: string[]
    /** architect reference_coverage row ids this goal must restore. */
    reference_coverage_ids: string[]
    /** architect acceptance_spec ids this brief expands/cross-checks. */
    acceptance_spec_ids: string[]
    /** optional frontend-design vis-* ids (may be empty — do not depend on them). */
    visual_spec_ids: string[]
    /** frontend-template.md section headings build/architect must deep-read. */
    prd_sections: string[]
  }
}

export type GoalWorkloadResult = {
  briefs: WorkloadBrief[]
  /** Architect spec snapshot this analysis was computed against (staleness key). */
  spec_snapshot_id: string
  /** One-line summary: how many goals are sized OK vs flagged with a concern. */
  summary: string
}
