# Board.tsx Unified Data-Driven Layout — Design

**Base**: `candidate-clean` at `a87f298ca`
**Target file**: `packages/overlay/src/components/Board.tsx`
**Design reference**: `specs/new-arch.svg` (data-driven UI matching Task Agent adaptive pipeline)

## Current Problems (Verified)

1. **Dual layout branching** — `<Show when={hasWorkflow()}>` (line 1275) and `<Show when={!hasWorkflow()}>` (line 1400) render ~250 lines of divergent, largely-duplicated JSX.

2. **Missing sections per mode**:
   - Workflow mode: **no Plan, no Executor** (sections absent entirely)
   - Legacy mode: **no Architect, no Requirements** (sections absent entirely)

3. **Real bug**: Delivery section `bodyId="evalBody"` (lines 1364 **and** 1496) — copy-paste from Eval section. Breaks DOM uniqueness.

4. **Code duplication**: Evaluation badge computed inline as identical 6-line IIFE in both branches (lines 1343–1350, 1475–1482).

5. **Dead code**:
   - `ExecutorPanel` (line 967) — defined, never referenced
   - `CriteriaBadge` (line 1519) — defined, never referenced

6. **Not data-driven**: Section visibility is gated by `hasWorkflow()` mode flag, not by whether the section actually has data.

## Design Principle

**UI mirrors Task Agent's adaptive pipeline (per `new-arch.svg`):**

> "没有固定 pipeline. Task Agent 推理下一步: 调谁? 重试? 加 goal? 交付?"

Sections appear and disappear based on **data availability**, not a predetermined mode. A simple task may have only Goals + Delivery. A complex task may have Requirements → Architect → per-Goal Plan/Execute/Eval → Delivery. The UI must reflect the actual shape of data the Task Agent produced.

## Unified Section Schema

Single layout, one SectionFrame per concern, each gated by its own data signal:

| Section | Visibility signal | Primary component | Fallback component |
|---------|------------------|-------------------|-------------------|
| WorkflowProgressBar | `workflow()` exists | `WorkflowProgressBar` | — |
| **Requirements** | `requirements()` \| `spec()` \| `isRequirementsGenerating()` \| `requirementsMessages().length > 0` | `RequirementsPanel` (if `requirements()`) | `SpecPanel` (if only `spec()`) |
| **Architect** | `architect()` \| `isArchitectGenerating()` | `ArchitectPanel` | — |
| **Goals** | `goalWorkflows().length > 0` \| `goalsCards().length > 0` | `GoalWorkflowList` (if `goalWorkflows().length > 0`) | `GoalsPanel` (if only `goalsCards()`) |
| **Plan** (task-level) | `plan()` \| `planPreview` \| (legacy mode only: `runningGoalIDs().size > 0`) | `PlanPanel` | — |
| **Executor** (aggregated) | `executorCards().length > 0` AND `goalWorkflows().length === 0` | `ExecutorSummaryPanel` | — |
| **Evaluation** | `criteriaSpecs(task, evaluation).length > 0` \| `evaluation()` | `CriteriaPanel` + `EvaluationPanel` | — |
| **Delivery** | `delivery()` | `DeliveryPanel` | — |
| **Interactions** | `interactions().some(i => i.status === "pending")` | `InteractionsList` | — |

### Duplication avoidance rules

**Goals**:
- If `goalWorkflows().length > 0` → use `GoalWorkflowList` (which nests plan/execute/eval per goal)
- Else if `goalsCards().length > 0` → use `GoalsPanel` (flat list, legacy)
- Never show both

**Plan (task-level)**:
- Shown when `goalWorkflows().length === 0` (otherwise per-goal plans render inside `GoalWorkflowList`)
- Prevents redundant plan display

**Executor (aggregated summary)**:
- Shown when `goalWorkflows().length === 0` (otherwise executor activity renders inside `GoalWorkflowList` as per-goal execute step)
- `ExecutorSummaryPanel` is the aggregated view; not used when per-goal view exists

## Bug Fixes

1. **Delivery bodyId**: `"evalBody"` → `"deliveryBody"` (unified layout has only one Delivery SectionFrame, so one fix)

2. **Evaluation badge extraction**: Replace the 6-line inline IIFE with a `evaluationBadge` memo:
   ```ts
   const evaluationBadge = createMemo(() => {
     const specs = criteriaSpecs(task(), evaluation());
     if (specs.length === 0) return { text: "", tone: "" };
     const enabled = specs.filter((item) => item.enabled).length;
     if (enabled === 0) return { text: t("checks.zero_enabled"), tone: "" };
     const passed = specs.filter((item) =>
       item.enabled && aggregateCheckStatus(evaluation()?.checks, item.name) === "passed"
     ).length;
     return { text: `${passed}/${enabled}`, tone: passed === enabled ? "good" : "" };
   });
   ```

## Dead Code (requires user approval per project principle 11)

- `ExecutorPanel` (line 967–1008, ~42 lines) — defined but never referenced in overlay
- `CriteriaBadge` (line 1519–1563, ~45 lines) — defined but never referenced

**Action**: REPORT to user, await explicit approval before deletion.

## Memo Updates (remove hasWorkflow dependency)

These currently gate on `hasWorkflow()`, need to gate on actual data shape:

1. `requirementsMessages` (line 1194) — currently returns `[]` if no workflow. Change to collect spec/goal agent card messages regardless, so RequirementsPanel receives streaming messages in both modes.

2. `goalStepMessages` (line 1220) — currently returns `{}` if no workflow. Change to build the map whenever there are planner/executor/evaluator agent cards with goalID.

3. `goalEvalChecks` (line 1245) — currently returns `{}` if no workflow. Keep dependency on `goalWorkflows()` since it iterates them to build the per-goal check map; no change needed (it's already data-driven).

4. **Delete** `hasWorkflow` memo (line 1177) — no longer needed.

## Implementation Order

1. Add `evaluationBadge` memo (no behavior change yet)
2. Update `requirementsMessages` + `goalStepMessages` to drop `hasWorkflow()` gates
3. Replace lines 1263–1515 with unified single-pass layout
4. Delete `hasWorkflow` memo
5. Fix `bodyId="evalBody"` → `"deliveryBody"`
6. ASK user about dead code (`ExecutorPanel`, `CriteriaBadge`)
7. Rebuild overlay
8. Visual verification across scenarios:
   - Simple task (goals only, no workflow)
   - Workflow task (requirements → architect → goalWorkflows)
   - Running task (streaming messages in sections)
   - Completed task (delivery + evaluation visible)

## Line Count Target

Current: 1563 lines. After unification: approx **1280 lines** (~280 lines removed from deduplication).
After dead code removal (if approved): ~1195 lines (~370 lines removed total).

## Verification Scenarios

### Scenario 1 — Simple task (no workflow)
Expected visible: Goals (GoalsPanel), Evaluation, Delivery
Not visible: WorkflowProgressBar, Requirements, Architect, Plan (if no plan), Executor (if using GoalWorkflowList — false here, so shown)

### Scenario 2 — Workflow task with running goals
Expected visible: WorkflowProgressBar, Requirements, Architect, Goals (GoalWorkflowList), Evaluation, Delivery, Interactions (if pending)
Not visible: task-level Plan section, task-level Executor section

### Scenario 3 — Mid-stream (requirements generating)
Expected visible: WorkflowProgressBar, Requirements (with streaming messages), no sections for stages not yet reached

### Scenario 4 — Completed task
Expected visible: All sections that have data. Delivery shows final artifact.

## Risks & Mitigations

- **Risk**: Removing `hasWorkflow()` gates may cause spec/goal stage messages to flow into RequirementsPanel in legacy tasks that don't have workflow steps. **Mitigation**: RequirementsPanel must gracefully handle empty `requirements` by rendering `specContent` (already does per current signature).

- **Risk**: Per-goal plan/execute/eval sections may be expected as separate task-level sections in workflow mode. **Mitigation**: Confirmed by spec — `GoalWorkflowList` already nests these per goal. No task-level Plan/Executor needed when per-goal data exists.

- **Risk**: Visual regression on the overlay in specific states. **Mitigation**: Manual verification across 4 scenarios above.
