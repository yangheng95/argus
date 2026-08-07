# Task Queue Descendant Activity Heartbeat Repair

Status: implemented and verified

## Recall

### User request

- Monitor the ten temporary E01–E10 right-sidebar Chats and every Mission,
  Task, Goal, Agent session, tool execution, preview target, and artifact that
  they causally create.
- Repair confirmed product failures without micromanaging normal execution.
- Fix the current failure in source and tests now; package and restart the
  application together later.

### Acceptance criteria

1. Real message-part activity from any session in the queued root session's
   durable descendant tree refreshes the queue task's inactivity deadline.
2. Activity from an unrelated session or project does not refresh that queue
   task.
3. Descendants that already exist when execution begins and descendants
   created while the queued prompt is running are both recognized.
4. A genuinely inactive session tree still reaches the existing timeout,
   prompt cancellation, and failed queue settlement.
5. The configured `assistant.activity.task_queue_run_timeout_ms` remains the
   single inactivity window; the repair does not increase it or restore an
   unconditional timer heartbeat.
6. Focused queue tests, typecheck, and specification health checks pass.
7. No running OpenCorvus or Overlay process is stopped, refreshed, rebuilt, or
   restarted in this repair phase.

### Hard constraints

- No fallback, gate, state-machine bypass, synthetic message, timeout increase,
  or second session-tree source.
- Use durable session parent relationships, not titles, Agent names, or naming
  patterns, as causality evidence.
- Preserve unrelated tracked and untracked workspace changes.
- Add regression coverage for the repaired behavior and the unrelated-session
  negative boundary.
- Commit with the `dsw-33987` prefix and push the current `v0.0.19beta`
  delivery branch to the git-cc remote after verification.

### Sources read before implementation

- `AGENTS.md`
- `specs/artifacts/长程编排测试.md`
- `specs/records/2026-06/2026-06-28-session-prompt-owner-inactivity-root-repair.md`
- `specs/records/2026-07/2026-07-15-session-background-execution-ownership.md`
- `specs/records/2026-07/2026-07-21-read-lsp-inactivity-dispatch-settlement.md`
- `packages/opencorvus/src/engine/config.ts`
- `packages/opencorvus/src/scheduler/task-queue-service.ts`
- `packages/opencorvus/src/session/index.ts`
- `packages/opencorvus/src/engine/task-session-lineage.ts`
- `packages/opencorvus/src/orchestrator/task-event.ts`
- `packages/opencorvus/src/bus/index.ts`
- `packages/opencorvus/src/bus/global.ts`
- `packages/opencorvus/test/scheduler/task-queue-service.test.ts`
- `packages/opencorvus/test/session/session-tree.test.ts`

### Runtime evidence and causal chain

The affected queue rows are:

| Chat | Root session | Queue task |
| --- | --- | --- |
| E01 | `ses_05dee259fffeiebC52YjcqSGNw` | `tsk_fa211db17001XnDAqaBcUowyDO` |
| E03 | `ses_05dee13a8ffeTq5ZjWyN3yqRIU` | `tsk_fa211eca8001Dd8KWnUHD9jyRZ` |
| E05 | `ses_05dedfae8ffewsyz8z8TgF2Bou` | `tsk_fa2120550001G4yHegdLGlVXQm` |
| E06 | `ses_05dedefe8ffeYpLpW2NWbJ77OC` | `tsk_fa21210e0001vMP7vNvhCnCmkg` |
| E09 | `ses_05dedcf07ffeP3FqzDPSIjwwRa` | `tsk_fa212312b001MznDNFRvhH8eIv` |

Each root ran for approximately the configured 600,000-millisecond inactivity
window, delegated work to a child session, then logged repeated
`session.prompt cancel`, `AbortError: external abort signal fired`, and a
failed async queue task. The bounded runtime log contains no matching HTTP
abort, archive, or delete request.

The direct trigger is the Task Queue `GlobalBus` handler: it extracts the
message-part session ID and returns unless that ID exactly equals
`task.session_id`. Therefore real child-session stream activity cannot call
`touch(task.id)`. `recover()` later sees the unchanged root queue
`time_updated`, cancels the root prompt, and marks the queue row failed.

The deeper design error is that queue inactivity is scoped to one session ID
while prompt execution can own an entire durable session tree. The existing
Orchestrator inactivity boundary already treats descendant activity as prompt
activity, so the queue's narrower ownership definition contradicts the same
execution lifecycle.

### Whole-repository search and call-point inventory

| Surface | Call points and disposition |
| --- | --- |
| Queue producers | `executor/opencorvus.ts`, `engine/service.ts`, and `server/routes/session.ts` enqueue prompt, wake, or compaction work. They remain unchanged because every producer converges on `TaskQueueService.execute`. |
| Queue progress | `TaskQueueService.execute` is the only GlobalBus message-part heartbeat subscriber for a running queue row. Replace its exact-root filter with one task-local durable-tree membership set. |
| Queue timestamp | Private `touch` is called only by the progress subscriber and continues to update only a `running` row before rescheduling the existing recovery timer. |
| Queue recovery | `recover`, `scheduleRunningRecoveryTimer`, `scheduleRunningRecoveryTimers`, and `scheduleRunningRecoveryRetry` retain the existing activity-based timeout and cancellation settlement. |
| Session tree | `Session.tree` and `Session.treeInProject` are the canonical root-first descendant traversal. Initialize membership through `Session.treeInProject`; do not add another recursive query or lineage cache. |
| Dynamic descendants | `Session.Event.Created` is the authoritative durable creation event and contains `info.projectID` plus `info.parentID`. While the queued prompt owns its listener, add a created session only when its project matches and its parent is already in the task-local set. |
| Existing lineage checks | `Session.assertLineageInProject` and its queue wrapper validate execution scope but return the requested session rather than tree membership. They remain unchanged. |
| Engine lineage utilities | `task-session-lineage.ts` maps sessions to Engine Tasks and caches parent facts for protocol lookup. It is not reused because right-sidebar Chat queue work need not have an Engine Task. |
| Orchestrator tree SQL | `orchestrator/task-event.ts`, `engine/store.ts`, and `engine/describe.ts` project task transcripts and ledgers. They do not own queue activity and remain unchanged. |
| Tests | Existing queue tests prove exact-root heartbeat extension and genuine inactivity recovery. Extend the heartbeat regression to a dynamically created descendant and add an unrelated-session negative assertion. |
| Queue test initialization | The full focused file exposed two existing `session_wake` tests that opened an uninitialized instance, then observed queue state concurrently while the nested wake path temporarily released its lease to run first-time `InstanceBootstrap`. Calibrate only those fixtures to production-shaped initialized instances; do not weaken the lease assertion or change runtime ownership. |
| Virtua API | A later pre-push review proved the temporary `overscan` conversion was invalid: installed `virtua@0.49.3` exposes pixel-valued `bufferSize` for Solid `Virtualizer` and `VList`, while `overscan` is absent from both runtime and type declarations. Preserve `bufferSize` at all five call points and keep one enumerated source-contract regression. |

### Independent agent feedback

No sub-agent was created because the user did not request delegation and the
active collaboration instruction forbids implicit spawning.

## Implementation decision

At queue execution start, read `Session.treeInProject` once and hold the
returned identifiers in a task-local `Set`. The same GlobalBus listener then:

1. observes `Session.Event.Created`;
2. adds the created session only when its project is the queue project and its
   parent is already a known member; and
3. treats `Message.Event.PartDelta` and `Message.Event.PartUpdated` as progress
   only when their session ID belongs to that set.

This preserves the canonical durable tree as the initial source and extends it
only from authoritative ordered creation facts emitted by the same persistence
path. It avoids a database tree scan for every streamed token and does not
allow an unrelated session to refresh the task.

## Verification plan

- Add and first run the focused descendant/unrelated-session regression against
  the old exact-root implementation to prove the failure.
- Re-run the two `awaitSessionPromptsIdle` wake tests with
  production-shaped `InstanceBootstrap` initialization after the full file
  exposes their invalid uninitialized fixture.
- Run
  `bun test packages/opencorvus/test/scheduler/task-queue-service.test.ts --timeout 20000`.
- Run `bun run --cwd packages/opencorvus typecheck`.
- Run
  `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts --timeout 20000`.
- Inspect the final diff and rerun the focused queue regression.
- Fetch and merge the latest git-cc `v0.0.19beta`, then push without bypassing
  hooks.

## Implementation and verification log

- `TaskQueueService.execute` now initializes one task-local membership set from
  `Session.treeInProject`, extends it only from matching-project
  `session.created` facts whose parent is already a member, and accepts message
  part activity only from that set.
- The existing exact-root heartbeat test now proves a pre-existing descendant
  refreshes the queue deadline while an unrelated root does not.
- A second regression proves a descendant created after the queue row reaches
  `running` joins the heartbeat scope through the durable creation event.
- The two existing `session_wake` inactivity-observer tests now open their
  fixture with `InstanceBootstrap`, matching production ownership and avoiding
  first-time initialization lease release during the observation itself.
- The initial two descendant regressions timed out against the old exact-root
  implementation, establishing the red baseline.
- Focused repaired regressions: 2 passed.
- Existing `awaitSessionPromptsIdle` initialized-fixture regressions: 2 passed.
- Final full
  `bun test packages/opencorvus/test/scheduler/task-queue-service.test.ts --timeout 20000`:
  38 passed, 0 failed.
- `bun run --cwd packages/opencorvus typecheck`: passed before the final
  remote fast-forward; it is rerun after the final diff below.
- Focused document index/link checks: 3 passed, 0 failed.
- The combined document-health command also proved 80 checks passed but cannot
  be a clean whole-worktree signal in the current user workspace: one
  untracked Overlay browser test contains a retired fixture surface, old
  `.scratch/benchmark-runs` snapshots intentionally contain deleted pre-June
  trees, and Windows-quoted Unicode `git ls-files` output makes two existing
  record scans attempt quoted octal paths. None of those user-owned files were
  changed or deleted. After this record was staged, its own monthly index and
  historical-link checks passed.
- A single full-suite attempt hit the Windows process supervisor before the
  heartbeat test body while initializing Git. The same test passed when rerun
  alone, and the subsequent complete 38-test run passed without the toolchain
  failure.
- The latest git-cc `v0.0.19beta` commit
  `9874b93741` was fast-forwarded before final verification; its Artifact files
  did not overlap this repair.
- Codex review correction: the first pre-push interpretation inverted the
  installed library contract. `virtua@0.49.3` Solid `VirtualizerProps` declares
  `bufferSize` as extra pixels rendered before and after the viewport, and
  `VListProps` explicitly picks that field; neither type nor runtime accepts
  `overscan`. Commit `348dff89f3` therefore made all five call points invalid.
- The follow-up repair restores the exact pixel buffers at all five surfaces
  and changes the enumerated regression to reject `overscan`.
- Overlay Virtua API regressions and the full pre-push typecheck pass with the
  corrected installed-library contract.
