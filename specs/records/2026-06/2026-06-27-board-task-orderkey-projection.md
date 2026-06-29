# Board Task OrderKey Projection Root Repair

Date: 2026-06-27

## Problem

Opening a newly published task can crash the overlay with:

```text
task <taskID> missing orderKey
```

The crash is correct fail-fast behavior in the overlay: every visible timeline
card must sort by a backend-owned durable `orderKey`. The backend single-task
board payload was wrong because `compileBoard()` hand-built `board.task`
instead of using the canonical task projector.

## Recall

| Source                                                 | Constraint                                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `AGENTS.md`                                            | No fallback, no dual source, no blind patching; inspect disk plans before editing.                     |
| `2026-06-26-message-card-adjacent-segment-timeline.md` | `timeline/order.ts` owns backend `orderKey`; overlay must require backend `orderKey` and not infer it. |
| `2026-06-27-bug-hunt-residual-convergence.md`          | Strict `orderKey` ingestion already exposed fixture-only missing-orderKey failures.                    |
| `2026-06-26-enterprise-a2a-protocol-root-repair.md`    | A2A touches conversation/SSE projection, but this failure is the task board projection surface.        |

## Call Point Inventory

| Surface                                                       | Current finding                                                                           | Required repair                                                                        |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `engine/store.ts::viewTask`                                   | Canonical task projection already emits `orderKey` with `domain: "task"`.                 | Reuse it for the single-task board payload.                                            |
| `workbench/board.ts::compileBoard/buildBoard`                 | Hand-built `task: { ... }` omitted `orderKey` and other canonical task projection fields. | Replace the hand-built object with `viewTask(task, { directory })`.                    |
| `engine/model.ts::TaskBoard.task`                             | Schema requires `Task`, and `Task.orderKey` is required.                                  | Add regression coverage that `TaskBoard.parse(compileBoard(...))` passes.              |
| `overlay/src/services/tree-writer.ts::rebuildTaskContextCard` | Correctly requires `task.orderKey`.                                                       | Keep strict; no frontend fallback.                                                     |
| `overlay/test/board-projection-sync.test.ts`                  | Fixture lacked backend order keys for task/board rows.                                    | Make fixture explicitly carry order keys and test missing task orderKey fails visibly. |

## Acceptance

- `/task/:taskID/board` returns a task object with canonical `task.orderKey`.
- `compileBoard()` task projection stays aligned with `viewTask()` instead of maintaining a second task shape.
- Overlay board projection renders `ctx:user-request` from backend `task.orderKey`.
- A board payload missing `task.orderKey` still fails loudly; no frontend fallback is added.
- Focused backend, overlay, typecheck, and isolated browser publish/open tests pass.

## Regression: Board Interactions Must Use The Same Projector

### Finding

After the task-level board repair, `/task/:taskID/board` still hand-built
`interactions[]`. The task list path used `viewInteraction()` and emitted
canonical `interaction.orderKey`, but the single-task board path omitted it.
The overlay correctly failed at `interactionToCardSeeds()` with:

```text
interaction <interactionID> missing orderKey
```

That exception stops `rebuildBoardDerivedCards()`, so the inline interaction
card and `InteractionDialogHost` popup both disappear even though the backend
row exists.

### Additional Call Point Inventory

| Surface | Finding | Repair |
| --- | --- | --- |
| `engine/store.ts::viewInteraction` | Canonical interaction read model already emits durable `orderKey`. | Reuse it from board compilation. |
| `workbench/board.ts::buildBoard` | Board `interactions` had a second hand-written DTO missing `orderKey`. | Replace with `interactions.map(viewInteraction)`. |
| `engine/model.ts::Interaction` | Schema requires `orderKey`. | Keep strict and update tests to provide the field. |
| `overlay/utils/interaction.ts::interactionToCardSeeds` | Correctly throws when interaction orderKey is missing. | Keep strict; no UI fallback. |

### Additional Acceptance

- `/task/:taskID/board` returns `interactions[].orderKey` for pending and resolved interactions.
- `TaskBoard.parse(board)` catches future board interaction projection drift.
- Overlay board ingestion can project a resolved interaction card using the backend orderKey.
- `pending_interaction_items` and board `interactions` share the same `viewInteraction()` shape.

### Additional Verification

- `bun test packages/opencorvus/test/server/board-task-orderkey-e2e.test.ts packages/opencorvus/test/engine/model-interaction.test.ts packages/opencorvus/test/engine/active-sessions.test.ts --timeout 30000`
- `bun test packages/opencorvus/test/workbench/board.test.ts --timeout 30000`
