# Orchestrator Descendant Tool Activity Ownership Repair

Date: 2026-07-23

Status: Implemented and verified

## Recall

### User requirement

Determine why Task `tsk_f8a970abb001eDUEwNJjE7TgVK` remains active after all four Goals passed and repair the systemic scheduler stall rather than clearing this one row.

### Acceptance criteria

- A synchronous task-scoped projected worker may run a silent foreground tool for its declared tool timeout without the parent Orchestrator being falsely classified inactive.
- The Orchestrator inactivity timer still terminates a genuinely inactive parent/descendant tree when no descendant owns a paused tool execution.
- Tool ownership comes from the existing LLM activity `pause()` / `resume()` boundary; no error-string match, status-name inference, workflow gate, second watchdog, or persisted state machine is added.
- When the tool resumes or finishes, ordinary byte/activity-based inactivity accounting resumes.
- The repair covers the production-shaped descendant-session path and the shared stream-activity primitive.

### Hard constraints

- Do not weaken closed/closing Instance lease assertions or hide the resulting error.
- Do not change the configured Orchestrator inactivity timeout or Bash timeout.
- Do not mark a merely persisted `running` tool part as live; ownership must remain process-local and tied to the active prompt's registered activity monitor.
- Do not stop, restart, refresh, cancel, or mutate the user's running OpenCorvus Task/process.
- Preserve the unrelated dirty edit in `2026-07-22-mirror-prism-full-workflow-distillation.md`.
- Commit with the `dsw-33987` prefix and push the current `v0.0.16beta` branch to `legacy-remote` after verification.

### Sources read

- Runtime database `/Users/yangheng/.local/share/opencorvus/opencorvus.db` in read-only mode.
- Runtime log `/Users/yangheng/.local/share/opencorvus/log/2026-07-22T173259-53924-1.log`.
- `packages/opencorvus/src/orchestrator/{agent,build-tool}.ts`
- `packages/opencorvus/src/session/{status,processor}.ts`
- `packages/opencorvus/src/llm/activity.ts`
- `packages/opencorvus/src/util/stream-activity.ts`
- `packages/opencorvus/src/project/{instance,independent-project-owner}.ts`
- `packages/opencorvus/test/orchestrator/session-abort-funnel.test.ts`
- `packages/opencorvus/test/util/stream-activity.test.ts`
- `specs/records/2026-07/2026-07-15-session-background-execution-ownership.md`

### Whole-repository search evidence

| Search | Finding and disposition |
| --- | --- |
| `OrchestratorPromptInactiveError`, `produced no activity` | `runOrchestratorPromptWithInactivity` is the single parent inactivity owner. It already scans the complete descendant session tree but projects only status, prompt timestamps, and stream `last_activity_at`. Extend this projection rather than add another timer. |
| `SessionStatus.getActivity`, `registerActivityMonitor` | The process-local SessionStatus registry is the single projection from active LLM stream monitors. Add the monitor's explicit paused ownership there; do not query stale persisted tool parts. |
| `StreamActivityMonitor`, `pause()`, `resume()` | `withStreamActivity` already pauses its idle timer exactly across the processor's tool-call to tool-result boundary. Expose that existing fact as `paused()` and retain nested pause semantics. |
| `publishSessionStatus`, `runWithIndependentProjectIdentity`, `provideProjectIdentity` | Direct terminal publication was previously chosen to avoid same-project deadlock. The observed closed-lease error occurred only after the parent inactivity owner closed its lease; it is downstream evidence and is not the primary patch target. |
| Runtime artifacts and sessions | Both failed outcomes have no Goal ID and belong to task-level projected builds. The second child ran from 00:28 to 01:05; its explicit one-hour `verify:b3.3` Bash call ran silently from 00:46:45 to 01:00:50. The parent was blocked at 00:56:46 by the ten-minute inactivity timer, then the child failed terminal publication at 01:05:53 through the closed parent lease. |

### Independent agent feedback

No sub-agent was requested or used. The primary agent owns implementation and secondary review.

## Causal chain

All four Goal-scoped attempts completed and passed. The Orchestrator then dispatched a task-level build to repair final audit evidence, which is intentionally synchronous so its report returns to the same scheduling turn. That worker executed a foreground Bash command with an explicit one-hour timeout and redirected all output to a file. The LLM activity monitor correctly entered its explicit tool-call pause, but the parent Orchestrator inactivity projection discarded the paused fact and saw no changing byte timestamp for ten minutes. It therefore blocked the run and cancelled the parent prompt while the real child tool still owned execution. The child later completed, but its terminal path inherited the now-closed parent Instance lease and produced the visible build failure. Task terminalization had neither a live parent scheduler nor a successful child report, leaving `time_completed` null and the UI active.

## Implementation plan

1. Add a read-only `paused()` observation to the shared StreamActivityMonitor and cover nested pause/resume/dispose behavior.
2. Project that fact through `SessionStatus.getActivity` without changing lifecycle status.
3. Update the sole Orchestrator inactivity owner to keep its deadline live while any active descendant monitor is explicitly paused for a tool call.
4. Extend the descendant inactivity regression: remain alive beyond the parent timeout while paused, then time out normally after resume when no activity follows.
5. Run focused utility/orchestrator tests, typecheck, route/docs checks, document health, diff review, commit, and push.

## Implementation result

- `StreamActivityMonitor.paused()` exposes the existing nested pause-depth ownership without adding lifecycle state or persistence.
- `SessionStatus.getActivity()` projects that process-local ownership alongside the existing activity timestamp.
- `runOrchestratorPromptWithInactivity()` refreshes the parent idle deadline while any session in the real parent/descendant tree has an explicitly paused monitor. Once the tool resumes, ordinary signature and byte activity accounting takes over again.
- `OrchestratorTestHooks.runPromptWithInactivity` exposes the production wrapper only for focused regression coverage; runtime behavior still has one implementation.
- The Orchestrator abort-funnel fixture now supplies the mandatory user creator metadata. Its prior null metadata caused all cases to exit before reaching the prompt and was repaired at the shared fixture boundary.

## Verification

- `bun test packages/opencorvus/test/llm/activity.test.ts packages/opencorvus/test/util/stream-activity.test.ts packages/opencorvus/test/orchestrator/session-abort-funnel.test.ts --timeout 30000` — 44 passed, 0 failed.
- `bunx tsc -p packages/opencorvus/tsconfig.json --noEmit` — passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 30000` — 21 passed, 0 failed.
- `bun run api:routes-check` — passed across 31 route files.
- `bun run docs:check` — passed for 287 operations in 23 groups.
- `git diff --check` — passed.

The running application and Task were not restarted, cancelled, or mutated. The source repair applies after the updated runtime is built and started through the operator-controlled lifecycle.
