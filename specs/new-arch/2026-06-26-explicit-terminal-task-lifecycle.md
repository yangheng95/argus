# 2026-06-26 Explicit Terminal Task Lifecycle

## Goal

Repair the task lifecycle authority split around terminal success/failure:

- `completed` and `failed` must be explicit Orchestrator scheduler lifecycle
  decisions based on the scheduler's judgment and agent audit evidence, not
  side effects from build, integrity, session, run abort, stream-error fuse, or
  any other host path.
- `cancelled` remains an explicit operator/user cancellation path, but it uses
  the same terminal writer.
- The engine still derives task lifecycle from facts
  `(time_started, time_completed, error, metadata.cancelled)`; do not restore a
  task `status` column.
- `task_report(done/failed)`, `SessionStatus.terminal.completed`, and engine
  task `completed` must stay semantically separate in prompts, API text, and
  tests.

## Input And Output Contract

Input:

- a workflow task with persisted build/integrity evidence;
- latest `engine_artifact kind="integrity_attempt"` rows;
- Orchestrator-visible lifecycle tools.

Accepted output:

- `integrity` records post-build pass/non-pass evidence only;
- the Orchestrator scheduler must call
  `complete_task({ integrity_attempt_id, summary })` to
  mark the task completed;
- the Orchestrator scheduler must call `fail_task({ error })` to mark the task
  failed; host failure detectors only record scheduler-visible error facts;
- `complete_task`, `fail_task`, and explicit task cancellation use one internal
  terminal writer that emits the same task events, finalizes active run state,
  writes the terminal decision-log bundle, and notifies task lineage;
- no hidden completion writer remains inside `integrity`;
- no hidden failed writer remains in stream-error fuse, run abort,
  shutdown/interruption, or missing-model startup paths;
- tests prove stale, pre-build, non-pass, wrong-task, and missing integrity
  attempts cannot complete the task.

## Recall

Reviewed before editing:

- `specs/new-arch/15-no-fsm.md`: earlier model had symmetric
  `complete_task` / `fail_task` lifecycle decisions.
- `specs/new-arch/2026-06-24-terminal-task-no-wake-tool-ownership.md`: task
  lifecycle tools are Orchestrator-owned; terminal tasks suppress passive
  self-wakes but explicit operator wakes may reopen through the queue.
- `specs/new-arch/2026-06-25-visual-evidence-no-hard-gate-root-repair.md`:
  host-side evidence gates are invalid; schema/data integrity checks remain
  valid.
- `packages/opencorvus/src/prompt/core/orchestrator-core.txt`: currently says
  Orchestrator owns lifecycle decisions while also saying workflow completion
  happens via integrity pass.
- Six independent read-only agent audits converged on the same root: storage
  is not multi-source; terminal decision authority is asymmetric.

## Callpoint Inventory

| Surface                                       | Current state                                            | Repair                                                                                      |
| --------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `engine/task-status.ts`                       | Lifecycle derives from facts.                            | Keep unchanged.                                                                             |
| `engine/state.ts::updateTask`                 | Accepts ordinary updates and terminal verbs.             | Reject terminal verbs; keep `updateTask` for ordinary/active/queued/error facts.            |
| `engine/state.ts::terminalTask`               | Missing.                                                 | Single terminal writer used by scheduler lifecycle tools and explicit cancellation.         |
| `orchestrator/tools.ts::integrity`            | Post-build pass directly writes task completed.          | Return evidence telling Orchestrator to call `complete_task`; do not mutate task lifecycle. |
| `orchestrator/tools.ts::complete_task`        | Missing.                                                 | Scheduler success decision; validate latest post-build pass audit artifact, then terminal.  |
| `orchestrator/tools.ts::fail_task`            | Explicit scheduler tool writes failed directly.          | Route through terminal writer; remains the only failed terminal path.                       |
| `orchestrator/tools.ts::cancel_task`          | Tool delegates to cancellation API.                      | Keep explicit cancellation behavior, but terminal write routes through terminal writer.     |
| `task-api/index.ts::cancelTask`               | Writes cancelled.                                        | Keep explicit cancellation terminal path after cleanup succeeds.                            |
| `task-api/index.ts::abortRun`                 | Writes failed for active run abort.                      | Record task error/run abort fact only; scheduler later decides repair or `fail_task`.       |
| `engine/writer.ts`                            | Shutdown/interruption writes failed.                     | Record task error + `metadata.interrupted`; do not write terminal failed.                   |
| `engine/persist.ts::stream-error fuse`        | Writes failed after repeated stream errors.              | Record task error from artifacts; do not write terminal failed.                             |
| `orchestrator/agent.ts` missing-model startup | Fast-fails task.                                         | Record task error only; no terminal failed without scheduler decision.                      |
| `agent/tool-pool-contract.ts`                 | Orchestrator exposes `fail_task`, not `complete_task`.   | Add `complete_task`.                                                                        |
| `task-report.ts`                              | Says `done` means task fully complete and "Task marked". | Reword as channel/session turn report; no engine lifecycle claim.                           |

## Terminal Writer Semantics

Internal API shape:

```ts
terminalTask({
  taskID,
  outcome: "completed" | "failed" | "cancelled",
  summary,
  error,
  actor,
  evidence,
  now,
  metadataPatch,
  projectDir,
})
```

Rules:

- `completed` clears `error` and stamps `time_completed`.
- `failed` requires non-empty `error` and stamps `time_completed`.
- `cancelled` stamps `time_completed`, stamps `metadata.cancelled=true`, and
  records the cancellation reason.
- Terminal transition events remain exactly one `task.updated` followed by the
  matching terminal event.
- The live active run is finalized using the same timestamp.
- A terminal decision-log bundle write remains best-effort loud, not a second
  completion gate.

`complete_task` rules:

- input must include `integrity_attempt_id`;
- the artifact must exist, belong to the same task, be kind
  `integrity_attempt`, have `payload.phase="post_build"`, and
  `payload.verdict="pass"`;
- the artifact must match the active spec snapshot's latest post-build
  integrity attempt;
- failure to satisfy these conditions returns a visible tool error and does not
  mutate task lifecycle.

These are data integrity checks for a model-cited artifact, not host acceptance
gates. The host does not decide to complete; it validates the explicit evidence
the model cites in `complete_task`.

`fail_task` rules:

- only the Orchestrator scheduler can call it;
- it requires a concrete error/reason derived from current task facts, audit
  evidence, external blocker evidence, or repeated visible failures;
- stream-error fuse, run abort, missing model startup, and shutdown recovery
  cannot call the terminal writer for failed; they record task-visible facts
  that the scheduler can later use to repair or explicitly fail.

## Benchmark / Verification Loop

Use targeted tests with real inactivity semantics: every repeated command is
considered failed only after no new output/progress for the configured timeout,
not after a fixed wall-clock budget from process start.

Required tests:

1. `complete_task` marks an active workflow task completed only when passed a
   latest same-task post-build pass integrity attempt.
2. `integrity` post-build pass does not mark the task completed; it returns
   evidence instructing the Orchestrator to call `complete_task`.
3. `complete_task` rejects missing, wrong-task, pre-build, non-pass, and stale
   integrity attempt ids without changing `time_completed`.
4. `fail_task` and `complete_task` both finalize the active run and emit the
   expected terminal task events through the same writer path.
5. Repeated stream-error fuse, run abort, missing-model startup, and
   shutdown/interruption do not set `time_completed`; they only record
   scheduler-visible error facts.
6. `cancel_task` still cancels live ownership/session state, but terminal task
   mutation goes through the same writer.
7. `task_report(done/failed)` does not imply engine task lifecycle mutation and
   no prompt/tool text says "Task marked" for that channel-level report.
8. Prompt tests no longer claim that an integrity pass automatically completes
   the task; they require explicit `complete_task`.
9. Tool pool tests expose `complete_task` only to the Orchestrator role.

Initial command set:

```bash
bun test packages/opencorvus/test/orchestrator/deliver-terminal-workflow.test.ts
bun test packages/opencorvus/test/orchestrator/tools.test.ts -t "complete_task|fail_task|integrity"
bun test packages/opencorvus/test/engine/protocol.test.ts
bun test packages/opencorvus/test/engine/task-terminal-run-finalization.test.ts
bun test packages/opencorvus/test/engine/orchestrator-stream-error-fuse.test.ts
bun test packages/opencorvus/test/agent/agent.test.ts packages/opencorvus/test/agent/core-prompt-hygiene.test.ts
```

If a test command itself fails before entering the relevant checker because of
local dependency, runner, or script problems, fix the toolchain first and rerun
the original command.

## Adversarial Review Checklist

- No fallback path: there must not be any alternate auto-completion path after
  `integrity` pass.
- No dual source: task completed/failed can be written only by terminal writer
  through scheduler lifecycle tools (`complete_task` / `fail_task`).
  Cancellation is the separate explicit user/operator stop path.
- No host gate: integrity evidence can be pass/non-pass; host must not rewrite
  the verdict or decide completion without the explicit tool call.
- No host fail side effect: host failures record facts only; they do not stamp
  `time_completed` or emit `task.failed`.
- No stale evidence: `complete_task` cannot complete from an old pass if a later
  post-build integrity attempt for the active spec is non-pass.
- No semantic leak: `task_report(done)` and session terminal reason
  `completed` cannot be rendered or described as engine task completion.
