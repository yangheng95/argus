# Orchestrator missing-model fast-fail — 2026-05-06

## Evidence

- Engine log `2026-05-06T134755.log` shows the same active task repeatedly entering `orchestrator-loop`, failing model resolution with `MissingModelConfigError`, exiting, and then being revived by `reviveZombieTasks`.
- `packages/opencorvus/src/orchestrator/agent.ts` catches `resolveAgentModel("orchestrator")`, logs the error, returns `undefined`, and then `return`s without changing task facts.
- `updateTask(..., { status: "failed", error })` is the existing single writer that stamps `time_completed`, writes progress, emits `task.updated`, and prevents active-task zombie revive.

## Grep Coverage

| Target | Call sites / siblings | Decision |
| --- | --- | --- |
| `resolveAgentModel(` | `src/orchestrator/agent.ts`, `src/agent/runner.ts`, `src/orchestrator/tools.ts`, `src/task-api/index.ts`, `src/delivery/agent.ts`, tests | Change only the orchestrator top-level wake path. Worker runner already throws `AgentRunError`; tool/task-api/delivery paths have caller-specific handling. |
| `MissingModelConfigError` | `src/agent/model.ts`, `src/provider/provider.ts`, `test/agent/model.test.ts` | Reuse existing strict config error; do not add another error class and do not add a default-model fallback. |
| `updateTask` terminal failure | `src/engine/state.ts`, `src/orchestrator/tools.ts` fail paths | Use the existing state writer so DB facts, progress snapshots, live-run finalization, and `task.updated` emission remain single-source. |
| `reviveZombieTasks` | `src/engine/runtime.ts`, `test/engine/zombie-task-revive.test.ts` | No separate retry cap in this change: missing-model becomes terminal in the first wake, so zombie revive naturally skips it via `isTaskActive`. |
| `secret-scan` pre-push tool | `script/secret-scan.ts`, `packages/vscode-extension/test/secret-scan.test.ts` | Repair the hook tool after Bun/Node child-process `git ls-files` failed with `EPERM` in this environment. Read the Git index directly as the single tracked-file source and honor `GIT_INDEX_FILE`. |

## Implementation

- Let `resolveAgentModel("orchestrator")` throw instead of converting the error to `undefined`.
- At the orchestrator model-resolution boundary, update the task to `{ status: "failed", error: "Orchestrator error: ..." }` so the task gets `time_completed` and UI receives `task.updated`.
- Add a test for a single missing-model wake: task becomes `failed`, `time_completed` is set, `SessionPrompt.prompt` is not called, and a `task.updated` event with `status=failed` is emitted.
- Fix `secret-scan.ts` so pre-push no longer depends on spawning `git`; the scanner parses v2/v3 Git index entries and fails loudly on unsupported index formats.

## Acceptance

- A task created with no `agent.orchestrator.model` and no top-level `model` fails in one orchestrator wake.
- The task no longer remains `active`, so `reviveZombieTasks` has nothing to restart.
- No fallback model selection is introduced.
