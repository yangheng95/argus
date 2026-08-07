# Goal attempt shutdown and retry convergence

## Recall

### User request

The user supplied Task Debug Info for
`tsk_fa7baba1e001QcpDE5Mcupko7L`, asked which problems the failed Task
exposed, and then asked to fix them.

### Acceptance criteria

- A graceful backend process shutdown cannot leave an exact physically owned
  Goal attempt with neither a terminal `goal_attempt_result` nor a Build Host
  observation, including when the Task reaches a business terminal state
  before its still-owned Build prompt is cancelled.
- Process shutdown records only the physical attempt interruption. It does not
  claim that the Goal requirement is satisfied or that the product is
  defective.
- The interrupted attempt becomes the single failed/aborted tip, so the
  Orchestrator can dispatch one new immutable Goal attempt without weakening
  the unresolved-attempt or Host-observation integrity contracts.
- `retry_task` and `replan_task` create one fresh scheduling pass from current
  durable evidence. Older pending delivery triggers cannot run after that
  decision and reopen a later terminal Task.
- Retry/replan provenance distinguishes an operator-issued intent from an
  Orchestrator-issued recovery decision.
- Task Debug Info distinguishes completed, aborted, and error terminal Agent
  invocations and includes abnormal terminal rows instead of flattening every
  invocation to `terminal`.
- Focused process-shutdown, queue/retry, Orchestrator provenance, debug-info,
  typecheck, API/docs, document-health, and diff checks pass.
- No running OpenCorvus, Overlay, or sidecar process is restarted, refreshed,
  stopped, or otherwise manipulated.

### Hard constraints

- Preserve every existing Browser Preview, Overlay dialog, release record, and
  index modification in the shared dirty worktree. Do not reset, restore,
  stash, clean, broadly stage, or create another worktree.
- Keep `goal_attempt_result` as the single terminal attempt source. Do not
  create a second interruption status, synthetic Build Host observation,
  fallback acceptance path, host business verdict, workflow gate, or state
  machine.
- Keep exact Build Host observation requirements for Orchestrator completion
  and rejection decisions. The repair must close the physical execution before
  those business decisions, not bypass them.
- Persist the exact aborted attempt result in the same transaction as the
  process-shutdown infrastructure fact and durable recovery wake.
- Commit subjects use the required `dsw-33987` prefix and push the current
  `v0.0.23beta` delivery branch to `legacy-remote` without bypassing hooks.

### Sources read

- `AGENTS.md`
- `specs/current/architecture/15-agent-facts-and-turns.md`
- `specs/records/2026-07/2026-07-25-research-deliverable-case-benchmark.md`
- `specs/records/2026-07/2026-07-27-anonymous-task-project-and-followup-convergence.md`
- `specs/records/2026-07/2026-07-27-desktop-started-task-recovery-scope-repair.md`
- `packages/opencorvus/src/build/agent.ts`
- `packages/opencorvus/src/engine/{artifact,catalog,execution-abort,goal-status,persist,queue,state,store,writer}.ts`
- `packages/opencorvus/src/orchestrator/{agent,event,task-lifecycle-tools}.ts`
- `packages/opencorvus/src/task-api/index.ts`
- `packages/overlay/src/utils/debug-info.ts`
- The focused tests and complete call points in the table below.

### Whole-repository search evidence

| Surface | Complete call points and disposition |
| --- | --- |
| Process-shutdown writer | `cli/cmd/serve.ts` is the production caller of `terminateCurrentProcessOwnedExecution`; `engine/writer.ts` enumerates current-process prompt owners and calls `persistProcessShutdownRecoveryHandoffs`; `engine/queue.ts` writes the infrastructure fact and recovery wake. Extend that one transaction with exact physically owned unresolved attempts. |
| Goal attempt terminal source | `engine/execution-abort.ts` writes `goal_attempt_result(outcome="aborted")` only after exact prompt cancellation; `engine/persist.ts::{completeGoal,rejectGoalAttempt}` write completed/failed results; `engine/store.ts` derives attempt status only from `goal_attempt_result`. Extract and reuse one transactional aborted-result writer; do not add another status source. |
| Unresolved dispatch | `orchestrator/build-tool.ts` and `engine/persist.ts::beginBuildAttempt` reject a new Build while the latest attempt is unresolved. Preserve both contracts; an exact process-shutdown result makes the prior tip terminal before redispatch. |
| Retry/replan API | `task-api/index.ts::{wakeTaskForOperatorIntent,retryTask,replanTask}` is called by panel, HTTP routes, and the Orchestrator lifecycle tool. Replace `operatorIntent` with one actor-qualified `taskIntent`; the Orchestrator caller supplies `actor="orchestrator"`, operator surfaces retain `actor="operator"`. |
| Wake persistence/drain | `engine/queue.ts` is the only `queued_operator_wake` writer/reader/drainer. Fresh retry/replan retires pending delivery triggers before persisting its one new intent; ordinary messages, coordination, recovery, and terminal-child wakes keep their current behavior. |
| Wake prompt projection | `orchestrator/agent.ts` renders the current intent; `event.ts` owns the event type. Replace every production/test `operatorIntent` occurrence and reject residue. |
| Retry/replan tests | `orchestrator/tools.test.ts`, `session-reuse.test.ts`, `operator-message.test.ts`, `internal-wake-provenance.test.ts`, `server/replan-routes.test.ts`, and `tool/panel-replan.test.ts` cover admission and projection. Update them and add stale-wake replacement coverage. |
| Shutdown tests | `engine/writer.test.ts`, `queue-restart-recovery.test.ts`, `queue-directory-authority.test.ts`, `cli/serve-shutdown.test.ts`, and `engine/execution-abort.test.ts` cover shutdown ownership, handoff, and explicit abort. Extend the real writer path with an exact Goal attempt and prove a later attempt can start. |
| Task Debug Info | `overlay/src/utils/debug-info.ts` is the sole formatter; `overlay/test/task-debug-info.test.ts` is the sole behavior suite. Add terminal-reason counts and abnormal terminal detail from the existing DAG status fields. |
| Documentation | `specs/current/architecture/15-agent-facts-and-turns.md` owns the current Session/Turn/Runtime and Host-observation model. Update its shutdown contract; this record, `specs/README.md`, and `specs/records/2026-07/README.md` own dated traceability. |

### Independent agent feedback

No independent Agent was requested. Current collaboration policy prohibits
implicit delegation, so the primary Agent owns implementation and second
review.

## Causal chain

### Observable behavior

The Task ended `cancelled`; all 16 invocation rows were flattened to
`terminal`; Goal #4 remained pending with no Build observation while later
Goals were blocked. Before cancellation the event log showed
`failed -> queued -> active` in the same scheduling window.

### Direct triggers

1. A real `parent-watchdog` process shutdown interrupted Build Session
   `ses_0576f0be4ffe6636G7uVFM4I2x`, which owned Goal attempt `baa7650d`.
2. The shutdown handoff persisted a Task-level process-recovery fact and wake
   but no terminal result for the exact physically owned attempt.
3. `complete_goal` and `reject_goal_attempt` require the absent exact Build
   Host observation, while Goal-scoped Build dispatch refuses the unresolved
   attempt.
4. A Task-scoped Build repaired and committed the implementation, but its
   Task-level observation correctly had no Goal/attempt identity and therefore
   could not close `baa7650d`.
5. `retry_task` appended an `operatorIntent` behind older pending wakes. A
   later failure decision became terminal while the retry wake remained
   pending, so the queue reopened the Task.

### Deeper cause

The current shutdown contract preserves the Task decision opportunity but
does not close the exact physical Goal execution that the exiting process
owns. The immutable-attempt and evidence-integrity rules correctly reject
guessing around missing evidence, but they implicitly assumed every created
attempt eventually reaches the Build Host observation writer. The process
shutdown path violates that assumption.

Retry has a separate semantic mismatch: “fresh pass” is represented as one
more first-in, first-out delivery trigger and is always labeled
operator-issued, even when
the Orchestrator selected it. Delivery triggers are not domain facts; retaining
older triggers after an explicit fresh-pass decision replays stale causes
against current state.

### Why prior repairs did not root-correct it

The process-shutdown handoff intentionally refused to write Task or Goal
business outcomes, which was correct, but treated a physical Goal-attempt
result as if it were also a business verdict. Existing explicit cancellation
already proves the correct boundary: exact prompt cancellation records an
`aborted` producer result and leaves Goal satisfaction for later work.

Earlier retry work ensured the current wake parks only after fresh-pass
admission. It did not test a backlog of older durable wakes followed by a
terminal decision, so admission succeeded while delivery order contradicted
the “fresh” contract.

## Implementation plan

1. Extract one idempotent transaction-aware writer for an exact
   `goal_attempt_result(outcome="aborted")` and reuse it from explicit
   cancellation.
2. Bind current-process shutdown owners to exact Task Goal attempts regardless
   of the Task business-status projection, and write
   their aborted results, process-recovery fact, and wake in one transaction.
   Emit the existing Goal status projection after commit.
3. Replace `operatorIntent` with actor-qualified `taskIntent`; retire pending
   delivery triggers before one retry/replan fresh pass is admitted.
4. Add writer, retry backlog/provenance, and Debug Info regressions.
5. Update current architecture and dated indexes, run focused and repository
   health checks, inspect the exact task-owned diff, and perform a second
   review.
6. Commit only task-owned files with `dsw-33987`, fetch, recheck `HEAD` and
   staged paths, push `v0.0.23beta` to `legacy-remote`, and verify remote equality.

## Implementation

- Added one transaction-aware exact-attempt abort writer in
  `engine/persist.ts`. Both explicit execution cancellation and process
  shutdown now reuse the canonical `goal_attempt_result(outcome="aborted")`
  source after validating Task, Session, Goal, and immutable dispatch lineage.
- Extended the process-shutdown handoff transaction to persist exact aborted
  Goal-attempt results, the `process-recovery` infrastructure fact, and the
  durable recovery wake together. Goal status is projected only after the
  transaction commits.
- Replaced `operatorIntent` with actor-qualified `taskIntent`. Operator
  surfaces retain `actor="operator"` and `retry_task` records
  `actor="orchestrator"`.
- Retry/replan now discard older pending delivery triggers before dispatching
  one fresh intent. Durable messages, requests, artifacts, observations, and
  decisions are not deleted or rewritten.
- Task Debug Info now includes `task.error`, terminal-reason counts, and
  compact rows for aborted, error, or unspecified terminal Agent invocations.
  Successful terminal rows remain summarized instead of expanding the blob.
- Added and updated shutdown, retry backlog, Orchestrator provenance, Panel,
  Session-reuse, and Overlay Debug Info regressions.

## Verification

- Focused shutdown, retry/replan, provenance, Session reuse, Panel, and Debug
  Info group: 33 passed, 0 failed, 209 assertions.
- Extended Orchestrator, queue restart/directory, serve shutdown, and
  delete/retry race group: 136 passed, 0 failed, 1,036 assertions.
- Historical links, document health, and product documentation single source:
  93 passed, 0 failed, 1,448 assertions.
- Full repository typecheck: 8 package tasks passed.
- `bun run api:routes-check`: 6 rules and route inventory passed across 33
  route files.
- `bun run docs:check`: 307 operations in 24 groups passed.
- `git diff --cached --check`: passed.
- No OpenCorvus, Overlay, or sidecar process was restarted, refreshed, stopped,
  or otherwise manipulated.

## Second review

The first staged-diff review found that process recovery still skipped a Goal
attempt when its Task had reached a business terminal state before shutdown
cancelled the still-owned Build prompt. That race reproduced the same
unresolved-attempt class under a narrower ordering. The implementation was
corrected so exact physically owned attempts settle independently of Task
business status, and the writer regression now makes the Task terminal before
shutdown and proves both the aborted result and a later immutable attempt.

The final review confirmed:

- no Host-observation requirement, unresolved-attempt guard, or Goal
  satisfaction contract was weakened;
- no synthetic observation, fallback result source, workflow gate, or
  business-status state machine was added;
- process ownership and immutable dispatch lineage remain mandatory for the
  shutdown result;
- stale wakes are retired only as delivery triggers; their underlying durable
  facts remain authoritative;
- production and test source contain no `operatorIntent` or retired helper
  residue;
- the staged file list contains only this repair, its tests, and its canonical
  architecture/record indexes.
