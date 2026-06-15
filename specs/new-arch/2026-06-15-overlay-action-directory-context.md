# Overlay action directory context

## Problem

Some project-scoped overlay actions build task or interaction API paths without a directory query when the global API directory context is empty. The API client then raises `ProjectDirectoryRequiredError` before the request reaches the backend. This affects child-agent reply/cancel/build-steer controls and question/interaction replies.

## Call sites

| Surface | Current state | Decision |
| --- | --- | --- |
| `services/task.ts` `taskPath` | Uses `taskByID(taskID)?.task.directory` only | Resolve directory from task row, active board task, then settings directory |
| `services/interaction-reply.ts` | Calls `question/*` and `interaction/*` without directory | Route through a shared project-scoped path helper |
| `services/workspace.ts` `activeDirectory` | Already exposes board task directory then settings directory | Reuse the same helper so callers do not drift |
| `test/agent-session-controls.test.ts` | Expected no directory on child-agent routes | Assert board-derived directory query |
| `test/interaction-reply-route.test.ts` | Expected no directory on interaction routes | Assert settings-derived directory query |

## Validation

- `bun test --cwd packages/overlay test/agent-session-controls.test.ts test/interaction-reply-route.test.ts test/api-directory-injection.test.ts`
- Overlay typecheck and root routes/docs/i18n checks before push.
