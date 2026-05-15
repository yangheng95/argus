# Goal DAG Rail — Design

Date: 2026-05-16
Status: Approved by user (visual decisions) + codex adjudication (APPROVE WITH CHANGES, all folded in)

## Problem

The overlay renders task goals as a sticky "floating" strip at the top of the
conversation: a linear progress bar plus a flat wrap-row of goal pills
(`TaskProgressBar.tsx`, `.task-progress*` in `card.css` L1397–1531, mounted at
`Conversation.tsx:164`). Goals are inherently a DAG — `EngineGoalTable.depends_on`
(`text({mode:"json"}).$type<string[]>()`, `engine.sql.ts:370`) records each goal's
prerequisite goal IDs — but the UI flattens that structure into an order-sorted
pill row, hiding the dependency relationships. The user wants a design-quality DAG
visualization that is **low resource**.

DAG = directed acyclic graph (goals + `depends_on` edges; the architect guarantees
acyclicity).

## Locked decisions (user, via visual mockups)

1. **Visual: git-graph vertical rail** — goal nodes on a vertical lane with
   branch/merge connectors (chosen over layered left→right flow and metro line).
2. **Space: non-sticky / inline** — the rail renders once at the top of the
   conversation timeline and scrolls away with the conversation. The floating
   (`position: sticky`) behavior is removed entirely.

## Codex adjudication

Codex reviewed the draft against CLAUDE.md and returned **APPROVE WITH CHANGES**.
All six changes are folded into the design below and marked
**[codex review feedback]**. Verified codex's line references before adoption
(rule 35): `TaskBoardGoalWorkflow` at `model.ts:804`,
`board-goal-worktree-schema.test.ts` exists, docs ref at
`docs/product/zh-CN/overlay/overview.md:52` — all accurate.

## Design

### 1. Backend — surface the DAG edges

- `workbench/board.ts` `goalWorkflows` projection (~L926): add
  `dependsOn: goal.depends_on`. `goal.depends_on` is already a parsed `string[]`
  (drizzle json mode) — no DB migration, no parse.
- **[codex review feedback]** Also add `dependsOn: z.array(z.string()).default([])`
  to the `TaskBoardGoalWorkflow` Zod schema (`engine/model.ts:804`). The draft
  only touched `board.ts`; the schema is the contract and must move with it
  (rule 35 / rule 8 — single source). While touching `TaskBoardGoalWorkflow`,
  also sync the existing runtime projection fields already emitted by `board.ts`:
  `goalRunID: z.string().optional()` (`board.ts:928`) and
  `acceptanceSpecs: z.array(AcceptanceSpecSchema).optional()` (`board.ts:949`).
  These are consumed by `Board.tsx` / `tree-writer.ts` / `diff.ts` /
  `file-change-summary.ts` / `ChangesPanel`/`FileChangesView` and
  `GoalWorkflowGroup.tsx` respectively. Leaving them absent while regenerating
  OpenAPI preserves existing dual-source contract drift and violates rules 8/16.
- Producer chain to keep consistent: `board.ts:77-83` (goal ordering) →
  `board.ts:903-970` (projection) → `board.ts:980` (return).
- **[codex review feedback]** Rule 35 consumer inventory for `goalWorkflows`:
  `packages/overlay/src/components/TaskProgressBar.tsx` becomes `GoalDagRail.tsx`
  and consumes `dependsOn`; existing no-change consumers are `Board.tsx`,
  `GoalWorkflowGroup.tsx` via `Board.tsx`, `AgentFileChanges.tsx`, `Gateway.tsx`,
  `main.tsx`, `utils/section.ts`, `services/tree-writer.ts`, `services/diff.ts`,
  `utils/file-change-summary.ts`, and `packages/opencorvus/src/tool/panel.ts`.
  Generated API/SDK contract copies are `packages/sdk/openapi.json` and
  `packages/sdk/js/src/gen/types.gen.ts` because `TaskBoard` is exposed through
  `routes/orchestrator.ts` as `/task/:taskID/board` and nested under
  `TaskConversationHydration.board` at `/task/:taskID/conversation`.
  `GlobalTaskBoard` (`/global/tasks`) has no `board.goalWorkflows` surface and
  must not be referenced for this change.
- **[codex review feedback]** After changing `TaskBoardGoalWorkflow`, regenerate
  SDK/OpenAPI with the project generator, not by hand: update
  `packages/sdk/openapi.json` and `packages/sdk/js/src/gen/*`. Verify both
  generated `goalWorkflows` object copies for `/task/:taskID/board` and
  `/task/:taskID/conversation` contain `dependsOn` plus the already-projected
  `goalRunID` and `acceptanceSpecs` fields.

### 2. Component — `TaskProgressBar` → `GoalDagRail`

"ProgressBar" misnames a DAG once the bar/pill UI is deleted (rules 17/19), so the
rename is in-scope and required (codex confirmed: keeping the name creates stale
naming / dual-source drift). **[codex review feedback]** rename must be complete:

- `components/TaskProgressBar.tsx` → `components/GoalDagRail.tsx` (export
  `GoalDagRail`); a header comment defines "DAG = directed acyclic graph" (rule 19).
- `components/Conversation.tsx:4,164` import + usage.
- `styles/surfaces/card.css:1397-1531` `.task-progress*` → `.goal-dag*`.
- `i18n/en-US.json:783-789` + `i18n/zh-CN.json:783-789` `progress.*` →
  `goal_dag.*` (renamed, not duplicated — rule 8). Keys: heading, summary, and
  the `goal_dag.node.<state>` set used by the title/aria label.
- `utils/goal-state.ts:4` doc comment ("TaskProgressBar pills" → GoalDagRail nodes).
- `docs/product/zh-CN/overlay/overview.md:52` component-map row.
- **[codex review feedback]** `docs/product/en/overlay/overview.md` — its current
  `WorkflowProgressBar` row is stale and must be replaced with `GoalDagRail` in
  the same rename pass.
- **[codex review feedback]** `packages/web/src/content/docs/overlay/overview.mdx:55`
  — replace stale `WorkflowProgressBar` row with `GoalDagRail`.
- **[codex review feedback]** `packages/web/src/content/docs/zh-cn/overlay/overview.mdx:55`
  — replace stale `WorkflowProgressBar` row with `GoalDagRail`.
- **[codex review feedback]** `packages/opencorvus/test/server/overlay-contract.test.ts:126`
  — update stale comment `WorkflowProgressBar` → `GoalDagRail` in the same
  rename pass.
- `packages/overlay/test/redesign-visual.html:42-74` fixture.

Node model: `{ goalID, index, attempt, title, state, dependsOn }`, reusing
`goalState()` and `goalRevisionLabelFromIndexes()`. Header keeps the `Goals` label
+ `passed/total` summary. Row click → existing `findGoalCardID` + `scrollIntoView`
(unchanged behavior).

### 3. Geometry — edge-column interval routing  **[codex review feedback]**

The draft's "bow right by per-span offset" is too weak — in a diamond, same-span
edges overlap and the graph looks accidental. Codex's adopted algorithm: a pure
function `layoutDag(nodes)` placed in
`packages/overlay/src/utils/goal-dag-layout.ts` (no retained state / no timers /
no rAF / not a state machine — satisfies rules 5/6/13). **[codex review
feedback]** No DOM measurement, no `getBoundingClientRect`, no canvas; complexity
is `O(E * C)` where `C <= E`, acceptable for goal counts. Unknown dependency IDs
are skipped and covered by a unit test.

1. Sort nodes by `orderIndex`; row `i` at `y = i * ROW_H`.
2. Every node dot stays on the primary rail at `x0`.
3. Edges = for each node, for each `dep` in `dependsOn`: `dep → node`.
4. Adjacent edges (`|fromRow − toRow| === 1`) draw on/near the primary rail.
5. Non-adjacent edges get an **edge column** (not a node lane) via greedy
   interval-graph coloring:
   - each edge owns interval `[min(fromRow,toRow), max(fromRow,toRow)]`;
   - sort intervals by start then end;
   - greedily assign the first column whose previously-assigned interval ended
     before this one starts;
   - `edgeX = x0 + BRANCH_GAP + column * COLUMN_GAP`.
6. SVG path is deterministic from `(fromRow, toRow, column)`.
7. Isolated nodes (empty `dependsOn`, no dependents) render as stacked dots with
   no connector — the honest "parallel goals" semantic.
8. Defensive: a `dependsOn` id with no matching node → skip that edge (commented;
   cleanup-class, allowed under the fallback-classification rule).

### 4. Animation — CSS only, low resource

- Running node: gentle opacity pulse keyframe (~2s).
- "Hot" edges only (edge whose target is a running node): `stroke-dashoffset`
  flow keyframe. Typically 1–3; cold edges fully static.
- State color via CSS `transition`. **No** rAF, **no** canvas, **no** JS timers.
  Geometry recomputed only on board delta via a Solid memo, not per frame.
- **[codex review feedback]** Wrap pulse + flow keyframes in
  `@media (prefers-reduced-motion: reduce)` to disable them — accessibility and
  an extra low-resource path.

### 5. Non-sticky (locked decision 2)

Remove `position: sticky`, `top`, the sticky `z-index`, and `backdrop-filter`
from `.goal-dag`. It stays the first child of the conversation fragment, now
scrolling with the timeline. Keep the bordered card surface so it reads as a
header block.

### 6. No dual source (rules 7/8/16)

Delete the old `.task-progress__bar`, `__bar-fill`, `__bar-fail`, `__pills`
markup + CSS and the `task-progress-pulse` keyframe outright — not flagged, not
kept behind a toggle.

## Tests (rule 36)  — expanded per **[codex review feedback]**

1. **Backend projection** **[codex review feedback]**: extend
   `packages/opencorvus/test/workbench/board.test.ts` with a fixture that inserts
   goals with `depends_on` and asserts
   `compileBoard({ taskID }).goalWorkflows[].dependsOn` mirrors
   `EngineGoalTable.depends_on`.
2. **Schema**: extend `test/workbench/board-goal-worktree-schema.test.ts:12-39`
   to assert `dependsOn` is a `string[]` field on `TaskBoardGoalWorkflow`
   (defaulting to `[]`). **[codex review feedback]** Also assert `goalRunID` and
   `acceptanceSpecs` exist on `TaskBoardGoalWorkflow` and round-trip through
   parse; `dependsOn` must parse to `[]` when omitted.
3. **SDK/OpenAPI contract** **[codex review feedback]**: after regeneration,
   assert `packages/sdk/openapi.json` and `packages/sdk/js/src/gen/types.gen.ts`
   expose `dependsOn`, `goalRunID`, and `acceptanceSpecs` on both
   `TaskBoardResponses[200].goalWorkflows[]` (`/task/{taskID}/board`) and
   `TaskConversationResponses[200].board.goalWorkflows[]`
   (`/task/{taskID}/conversation`).
4. **`layoutDag` unit** **[codex review feedback]**: linear chain → no edge
   columns; diamond (G1→G2, G1→G3, G2→G4, G3→G4) → correct endpoints + distinct
   edge columns for the two overlapping spanning edges; isolated nodes → zero
   edges; unknown `dependsOn` ID → that edge skipped.
5. **Render**: running node carries `data-state="running"`; hot-edge class
   applied to the edge into a running node; row click resolves the scroll target.
6. **i18n** **[codex review feedback]**: assert old `progress.*` keys are gone
   from **both** locale JSON files, `goal_dag.*` keys exist in **both**, and the
   keys are referenced from the component.
7. **CSS / source guards** (mirror `agent-workflow-css-guards`)
   **[codex review feedback]**: `.goal-dag` has **no** `position: sticky`, **no**
   `top`, **no** sticky `z-index`, **no** `backdrop-filter`; `.task-progress`,
   the old bar/fill/fail/pills selectors, and `task-progress-pulse` no longer
   exist; `@media (prefers-reduced-motion: reduce)` disables the pulse/flow
   animations; and source guards reject `requestAnimationFrame`, `setInterval`,
   `setTimeout`, `<canvas`, and `getBoundingClientRect` in the Goal DAG rail
   implementation. **[codex review feedback]** Also reject stale
   `TaskProgressBar` and `WorkflowProgressBar` references in active rename
   surfaces: `packages/overlay/src/**`,
   `packages/overlay/test/redesign-visual.html`,
   `docs/product/**/overlay/overview.md`,
   `packages/web/src/content/docs/**/overlay/overview.mdx`, and
   `packages/opencorvus/test/server/overlay-contract.test.ts`. (Rule 36: removed
   behavior must be asserted gone, not just new behavior asserted present.)

## Edge cases

- Single goal → one node, no edges.
- Failed / blocked nodes: color only, no animation.
- `depends_on` referencing an unknown id → edge skipped (see Geometry §8).
