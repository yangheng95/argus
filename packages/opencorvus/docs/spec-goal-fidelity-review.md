# Spec-Goal Fidelity Review Design

## Summary

After the goal compiler produces a deterministic goal graph from spec requirements, an LLM-based fidelity reviewer validates that goals faithfully and completely cover the spec. The reviewer can add missing goals, split overly broad goals, and flag coverage gaps — ensuring no requirement is lost or distorted between spec and execution.

## Motivation

The goal compiler uses category-based clustering and heuristic dependency ordering. This is fast and deterministic but can:
- Merge unrelated requirements into one goal (over-clustering)
- Miss implicit requirements not explicitly stated as spec items
- Generate goals with vague done_definitions that don't match the original acceptance criteria
- Lose nuance from the spec content that isn't captured in structured spec items

An LLM review closes these gaps by reasoning about intent, not just structure.

## Design

### Where in the pipeline

```
Spec Agent → ensureRequirements → Goal Compiler → **Goal Fidelity Review** → Planner
```

The review happens after `GoalService.initial()` returns a `GoalDraft` and before the draft is passed to the planner.

### What the LLM receives

1. **Original request** — the user's task description
2. **Spec content** — the full spec markdown (scope, requirements, constraints, acceptance criteria)
3. **Spec requirements** — the structured requirement list (id, title, description, acceptance)
4. **Goal draft** — the compiled goals (id, title, objective, requirement_ids, done_definition, owned_paths, depends_on)

### What the LLM outputs

A structured JSON review:

```typescript
type GoalFidelityReview = {
  verdict: "approved" | "needs_correction"
  coverage_issues: Array<{
    requirement_id: string
    issue: "uncovered" | "partial" | "distorted" | "merged_incorrectly"
    explanation: string
  }>
  goal_corrections: Array<{
    goal_id: string
    action: "modify" | "split" | "remove"
    reason: string
    // For "modify": updated fields
    updated_objective?: string
    updated_done_definition?: string
    updated_owned_paths?: string[]
    // For "split": new sub-goals
    split_into?: Array<{
      title: string
      objective: string
      requirement_ids: string[]
      done_definition: string
      owned_paths: string[]
    }>
  }>
  missing_goals: Array<{
    title: string
    objective: string
    requirement_ids: string[]
    done_definition: string
    owned_paths: string[]
    depends_on_goal_ids: string[]
    reason: string
  }>
}
```

### How corrections are applied

1. If `verdict === "approved"` → pass goals to planner unchanged
2. If `verdict === "needs_correction"`:
   - Apply `goal_corrections` (modify/split/remove goals in the draft)
   - Add `missing_goals` to the draft
   - Re-validate the goal graph (cycle detection, requirement coverage)
   - Do NOT re-run the LLM review (single pass, no loops)

### Key principles

1. **LLM reasons about intent, compiler handles structure** — the compiler is deterministic and fast, the LLM catches what heuristics miss
2. **Single correction pass** — no iterative LLM loops. One review, one set of corrections, done
3. **Corrections must be grounded** — every correction must cite a specific requirement_id and explain why
4. **No wholesale replacement** — the LLM corrects the existing goal graph, not replaces it. The compiler's dependency ordering and clustering are preserved where correct
5. **Transparent** — all corrections are logged with reasons, visible in the task board

### Integration point in persist.ts

```typescript
// In compileTransition(), after goal compilation:
goalDraft = await GoalService.initial({ ... })

// NEW: LLM fidelity review
if (goalDraft.goals.length > 0) {
  const review = await GoalFidelityReview.run({
    request: input.request,
    spec: specDraft,
    requirements: specDraft.requirements,
    goalDraft,
    sessionID: input.sessionID,
    metadata: input.metadata,
  })
  if (review.verdict === "needs_correction") {
    goalDraft = applyGoalCorrections(goalDraft, review)
    validateGoalGraph(goalDraft, specDraft)
  }
}

// Then pass to planner
planDraft = await PlannerService.initial({ goals: goalInputsFromDraft(goalDraft), ... })
```

### Evaluator integration

At evaluation time, the evaluator already receives goals and check results. Extend it to also verify requirement-level coverage:

- For each spec requirement, check if the associated goal passed
- If a requirement's goal failed, the evaluator should cite the specific requirement in its replan guidance
- This closes the loop: spec → goals → execution → evaluation → requirement-level feedback

### What this does NOT do

- Does not replace the deterministic goal compiler (it augments it)
- Does not add iterative LLM loops (single pass review)
- Does not bypass the evaluator (delivery still needs to pass all checks)
- Does not generate goals from scratch (only corrects/supplements the compiler's output)
