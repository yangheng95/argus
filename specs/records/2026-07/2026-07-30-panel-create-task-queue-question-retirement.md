# Panel Create Task Queue Question Retirement

## Recall

### User requirement

- The reported problem is not the Scheduled Automation tool.
- When an Agent publishes a Task, `panel.create_task` must not ask the user whether the Task should start immediately or enter the directory queue.
- The backend must retain explicit queue capability.

### Acceptance criteria

- Omitting `queue` from `panel.create_task` produces an immediate Task with `queue: false`.
- Explicit `queue: true` and `queue: false` continue to reach the existing backend Task engine unchanged.
- Task publication no longer creates a `Question` asking for an immediate-versus-queued choice.
- The mistakenly hidden `schedule` tool is restored to its prior Agent-visible contract.

### Hard constraints

- Keep one source for the default: the `panel.create_task` request mapping.
- Do not add a gate, compatibility branch, synthetic message, or second queue mechanism.
- Preserve unrelated dirty-worktree changes.
- Verify non-UI behavior with positive contract assertions; do not add negative tests.

### Sources read

- `AGENTS.md`
- `specs/records/2026-07/2026-07-05-overlay-task-queue-dialog-retirement.md`
- `packages/opencorvus/src/tool/panel.ts`
- `packages/opencorvus/src/panel/capability.ts`
- `packages/opencorvus/test/tool/panel.test.ts`
- `packages/opencorvus/test/tool/panel-session-config-projection.test.ts`

### Exhaustive repository search

| Call point or contract | Current role | Required disposition |
| --- | --- | --- |
| `packages/opencorvus/src/tool/panel.ts:resolveCreateTaskQueueDecision` | Sole production owner of the interactive “start now / queue” question | Delete |
| `packages/opencorvus/src/tool/panel.ts:create_task` | Maps `params.queue` into `EngineService.createTask` | Replace the interactive branch with `params.queue ?? false` |
| `packages/opencorvus/src/panel/capability.ts:create_task.queue` | Public optional Boolean contract | Keep; document the immediate default |
| `packages/opencorvus/src/engine/service.ts:createTask` and server routes | Backend queue execution and HTTP transport | Keep unchanged |
| `packages/opencorvus/test/tool/panel*.test.ts` | Explicit true/false queue contracts and Panel Task creation coverage | Preserve and add a positive omitted-value mapping assertion |
| `packages/opencorvus/test/server/*` queue cases | Backend explicit queue coverage | Keep unchanged |
| Agent tool projections and `packages/opencorvus/src/tool/schedule.ts` | Mistakenly changed Scheduled Automation surfaces | Restore exact pre-change behavior |

Searches covered `resolveCreateTaskQueueDecision`, the Chinese queue-question copy, `create_task`, `EngineService.createTask`, and every `queue:` occurrence under `packages/opencorvus/src`, `packages/opencorvus/test`, and `specs`.

### Independent agent feedback

- No sub-agent was requested or used.

## Root cause

The Overlay-side queue dialog had already been retired, but the Panel tool retained a second queue-decision source. For Panel-surface Agent calls with an omitted `queue`, `resolveCreateTaskQueueDecision` invoked `Question.askAndFormat`, so publishing a Task interrupted the user with the same product decision. The backend queue engine is not the cause and remains the correct explicit capability.

## Implementation

1. Restore the Scheduled Automation tool projection and contracts changed by the mistaken diagnosis.
2. Delete `resolveCreateTaskQueueDecision`.
3. Map an omitted `panel.create_task.queue` to `false` at the single request boundary.
4. Keep the optional public Boolean schema unchanged and add a positive contract test asserting the exact backend payload.
5. Run focused Panel tests, typecheck, documentation health checks, and repository hooks before pushing.

## Verification

- `bun test packages/opencorvus/test/tool/panel.test.ts`: 28 passed.
- Focused omitted-queue regression: 1 passed; `EngineService.createTask` receives `queue: false`.
- `bun test packages/opencorvus/test/agent/role-contract.test.ts packages/opencorvus/test/session/prompt-final-input.test.ts`: 26 passed.
- `bun test packages/opencorvus/test/server/coding-routes.test.ts --test-name-pattern 'Chat routes'`: 25 passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: 22 passed.
- `bun run typecheck` from `packages/opencorvus`: passed.
- Repository search finds no remaining `resolveCreateTaskQueueDecision` or queue-question copy.
- `packages/opencorvus/test/tool/panel-session-config-projection.test.ts` remains red on two pre-existing fixture/config assertions: its first case does not persist the referenced caller message before attachment lookup, and its second case expects a prompt-profile overlay that is absent before this change. Neither failure enters the removed queue-decision path.
- The built-in tool schema snapshot remains broadly stale against existing Panel capability changes outside this task; this task leaves the public queue schema unchanged and does not rewrite that unrelated snapshot.
