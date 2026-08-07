# Stale Session Status Cancellation Settlement

Date: 2026-07-22
Status: Completed
Owner: Codex

## Recall

- **User request:** Session `ses_07ab4bdb9ffe3yohB5Y3k9rIj0`
  (`任务D：AInvest 期货工作台全程交付`) is displayed as terminal but cannot be
  archived, and its project `/Users/yangheng/Documents/OpenCorvus-Demos/crypto2`
  cannot be deleted.
- **Acceptance criteria:** Archive and project deletion must still stop and
  settle real execution before mutating records. A stale in-memory
  `streaming`/`retry` projection with no `SessionPromptState` owner and no
  activity monitor must converge to a visible aborted terminal status instead
  of permanently returning HTTP 409. A real prompt owner in another directory
  or a still-live prompt after terminal publication must continue to fail
  cancellation. Mission, Task, session-abort, and project-delete paths must
  remain on the shared cancellation implementation.
- **Hard constraints:** Do not restart or refresh the running
  Overlay/OpenCorvus process; do not delete records before stop settlement; no
  fallback, compatibility path, route bypass, workflow gate, hidden/synthetic
  message, keyword rule, or database migration; preserve unrelated dirty
  files; add regression tests; commit with `dsw-33987` and push the current
  release branch to `legacy-remote`. The plan checkpoint was created on
  `v0.0.13beta`; the repository's release process subsequently advanced the
  same commit ancestry to `v0.0.14beta`.
- **Persisted/runtime evidence:** Server log
  `2026-07-21T144630-45646-1.log` records repeated
  `PATCH /task/tsk_f85524735001bQQa99RjbisIPM/archive`,
  `PATCH /mission/chat-c1dce0547264/archive`, and `DELETE /project/current`
  failures with `TaskCancellationIncompleteError`, explicitly reporting an
  active status with no prompt state or activity monitor in the process. SQLite
  shows the
  Task started, has no completion timestamp, and was later marked
  `metadata.interrupted=true` with `error=Server shutdown: http.shutdown`; the
  Mission session itself is terminal. The task-session cancellation attempted
  every persisted Task session before refusing deletion.
- **Existing records read:**
  `specs/records/2026-07/2026-07-08-atomic-close-before-delete.md` and
  `specs/records/2026-07/2026-07-22-task-contract-repair-and-cancellation-convergence.md`.
  The former requires proof before deletion; the latter already added
  task-loop quiescence and does not cover stale `SessionStatus` without a
  current-process owner.
- **Whole-repository grep:** Searched every `cancelSessionPromptInScope()` call,
  every `TaskCancellationIncompleteError`, `SessionStatus.set()`, and
  `SessionPromptState` reference, plus the Mission archive/delete, Task
  archive/delete, Coding Assistant archive/delete, session abort, project
  delete, task queue recovery, execution abort, and agent/orchestrator signal
  cancellation routes and callers.
- **Independent feedback:** No sub-agent was used because the user did not
  request delegation. Runtime log, SQLite evidence, implementation call sites,
  and focused tests provide separate evidence layers.

## Causal chain

1. A worker/orchestrator prompt status remained `streaming` after its `SessionPromptState` and activity monitor had both disappeared.
2. `cancelSessionPromptInScope()` treated the UI lifecycle projection itself as proof that an execution handle might still be live.
3. Because the actual current-process ownership sources were absent, there was no handle left for repeated cancel attempts to abort or await.
4. Every retry therefore returned the same typed 409 forever. Task archive failed first; Mission archive and project delete then failed through the same Task cancellation dependency.
5. The close-before-delete contract correctly preserved records, but cancellation lacked a convergence write for this contradictory in-memory state.

## Call-site disposition

| Call site                                                                                                          | Disposition                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent/runner.ts` signal abort                                                                                     | Keep using the shared cancellation primitive; receives the same stale-status convergence.                                                                                                                                                                                          |
| `scheduler/task-queue-service.ts` stale queue recovery                                                             | Keep shared behavior; a real prompt owner still cancels and settles, while an ownerless stale projection becomes terminal evidence.                                                                                                                                                |
| `server/routes/coding.ts` Chat close/archive/delete                                                                | Keep route lifecycle unchanged.                                                                                                                                                                                                                                                    |
| `project/delete.ts` remaining project-session cancellation                                                         | Keep deletion ordering unchanged: cancel, await queue settlement, assert prompt settlement, then delete.                                                                                                                                                                           |
| `server/routes/session.ts` direct abort                                                                            | Change its stale-owner regression from permanent 409 to successful terminal convergence; retain 409 coverage for real unmatched ownership.                                                                                                                                         |
| `orchestrator/agent.ts`, `engine/task-agent-lifecycle.ts`, `engine/execution-abort.ts`, `server/routes/mission.ts` | Keep shared call path and preserve their existing task/run identifiers in typed errors when actual ownership remains live.                                                                                                                                                         |
| `engine/cancellation-scope.ts`                                                                                     | Make current-process owner facts authoritative. If prompt state or activity exists but cannot be cancelled in the requested scope, keep the typed conflict. If neither exists, publish `terminal/aborted` for stale `streaming`/`retry`, then return no live cancellation receipt. |

## Implementation and validation plan

1. Add the ownerless stale-status convergence to `cancelSessionPromptInScope()` using the existing `publishSessionStatus()` surface.
2. Replace the two regressions that currently encode permanent stale-status failure with assertions for terminal aborted publication and successful direct session abort.
3. Preserve and run the cross-directory live-owner and terminal-status-with-live-prompt rejection tests.
4. Add a Task archive/delete regression proving an active Task with an ownerless stale descendant status can settle and be removed without weakening the real-owner cases.
5. Run focused cancellation, session-route, Task deletion/archive, Mission, project-delete, typecheck, document-health, and diff checks. Review the final diff a second time before commit/push.

## Implementation result

- `cancelSessionPromptInScope()` now treats only `SessionPromptState` and the
  registered activity monitor as current-process execution ownership. When a
  live-looking status has neither, it publishes `terminal/aborted` with the
  requested cancellation reason and returns without inventing a prompt receipt.
- Cross-directory prompt ownership, a still-registered activity monitor, and a
  terminal projection whose prompt state has not finished continue to return
  `TaskCancellationIncompleteError`; archive/delete routes still preserve rows
  on those failures.
- Session abort, Chat abort, worker cancel, Task deletion, and stale queue
  recovery regressions now cover ownerless convergence. Chat archive/delete,
  Task archive/cancel, Mission delete, and project delete regressions retain
  real-owner settlement coverage.
- Two pre-existing record-level DELETE fixtures encountered during the full
  route run were repaired to use the host-valid temporary project directory
  and the current `{ actor: "user" }` Task metadata contract. This changes no
  production route behavior.

## Validation evidence

- The focused cancellation primitive, direct session abort, Chat abort,
  worker cancel, Task delete, Task archive, Mission archive/abort/delete,
  project delete, and queue recovery selections passed.
- Full `task-queue-service`, `delete-running-task-settle`, Chat route, and
  directory-required suites passed after the stale fixture updates. The
  Task-loop non-idle preservation regression still exercises its full
  inactivity timeout and passes.
- OpenCorvus TypeScript type checking passed.
- Documentation health, historical-link, and product-doc single-source checks
  passed (87 tests). Prettier and final diff checks passed before final review.
