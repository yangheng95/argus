# Terminal Task Reopened by Stale Operator Wake Incident

## Recall

### User requirement

- Investigate why Task `tsk_fc9023062001NS7XzhuaO0TH34` (物流履约优化系统)
  remained `active` with an idle Orchestrator after its Agent work had ended.
- Compare Task `tsk_fc9022fde001f7NNPhOAJ5M3iw` (上市公司研究系统完整交付)
  against the first incident and determine whether the two Tasks expose a
  common failure.
- Reconstruct Task `tsk_fc8febda1001MVz4U86a75psrw` (交付 ExportHub 全平台闭环)
  and determine whether its terminal failure shares the same lifecycle,
  interaction-provenance, process-recovery, or acceptance-closure defects.
- Write the confirmed fault record to disk without changing product code or
  the production database.

### Acceptance criteria

- Reconstruct each Task from durable Task, Session, Message, Part, Protocol
  Event, Engine Artifact, dispatch-lineage, and Git evidence.
- Separate the observable `active`/`idle` state, direct trigger, shared design
  cause, task-specific findings, and unknown process-exit cause.
- Do not treat a Task title, `aborted`, `UnknownError`, timeout, or missing Goal
  as causal evidence by itself.
- Identify the exact shared code path and the regression coverage gap.
- Preserve the production database, both generated project worktrees, and all
  unrelated repository changes.

### Hard constraints

- Investigation is read-only with respect to
  `C:/Users/hengu/AppData/Local/opencorvus/data/opencorvus.db` and both Task
  directories.
- Do not reset, migrate, repair, rename, delete, or rebuild the database.
- Do not modify or run User-Interface automation tests.
- Do not introduce a Host gate, retry state machine, fallback, compatibility
  path, or keyword-based message classifier as a proposed repair.
- A normal operator follow-up is conversation input. It must not be treated as
  an implicit Retry/Replan decision by Host code.

### Sources read

- `AGENTS.md`.
- `specs/README.md` and `specs/records/2026-08/README.md`.
- `specs/records/2026-08/2026-08-03-build-existing-session-runtime-ready-repair.md`.
- `specs/records/2026-08/2026-08-03-agent-session-continuation-and-prism-planner.md`.
- `specs/records/2026-08/2026-08-01-dispatch-occurrence-process-recovery-root-repair.md`.
- `specs/records/2026-08/2026-08-02-large-build-observation-and-interrupted-task-recovery.md`.
- `packages/opencorvus/src/engine/queue.ts`.
- `packages/opencorvus/src/engine/interaction.ts`.
- `packages/opencorvus/src/question/index.ts`.
- `packages/opencorvus/src/prompt/core/orchestrator-core.txt`.
- `packages/opencorvus/test/engine/queue-directory-authority.test.ts`.
- Read-only SQLite rows for the three Task IDs, their complete Session trees,
  root Messages, Protocol Events, Engine Artifacts, infrastructure facts, and
  dispatch lineage.
- Read-only Git log, status, and diff metadata from all three Task worktrees.

### Whole-repository search

Repository searches covered `queued_operator_wake`,
`drainQueuedTaskEvent`, `openTaskForOperatorWake`,
`Queued operator wake reopened terminal task`, prompt ownership,
process-recovery facts, and terminal-decision queue tests. The terminal reopen
text has one production owner in `packages/opencorvus/src/engine/queue.ts`.
The focused test suite contains a prompt-owner test for the wake currently
delivering a terminal decision, but no test for an older operator-message wake
remaining pending when the completing root prompt releases ownership.

### Independent agent feedback

- Two independently running Agents had already reconstructed and committed the
  logistics/listed-company terminal-reopen incident as commit `5b07cec5d4`.
  The ExportHub investigation was appended to that same record rather than
  creating a parallel incident source.

## Incident scope

### Task A: logistics delivery

- Task: `tsk_fc9023062001NS7XzhuaO0TH34`.
- Root Session: `ses_036fdca65ffeAiJidj1MioD0DH`.
- Orchestrator Session: `ses_036fd9cdfffeM2k7URZjof8pOG`.
- Durable completion decision:
  `art_fc940c139001vnwgoRzdGX1Kwi` at 2026-08-03 20:11:31 UTC.
- `task.completed` was published at 20:11:32 UTC.
- In the same completion window, the initial queued wake was drained, an
  older operator wake caused `Queued operator wake reopened terminal task`,
  and Engine Queue changed the Task to `active`.
- The Orchestrator subsequently emitted completed summaries and became idle;
  it did not issue a second terminal Task decision.

The root Session held operator messages from 19:24:34, 20:05:40, and 20:11:57
UTC. The first two predated the completion decision. Their text asked the
existing Task to continue and then close; neither was a new Retry/Replan
instruction.

### Task B: listed-company research delivery

- Task: `tsk_fc9022fde001f7NNPhOAJ5M3iw`.
- Root Session: `ses_036fdcf6fffen6utIuuAcUWnPT`.
- Orchestrator Session: `ses_036fd9fe0ffe9nlbXkDt3UKHYd`.
- Durable completion decision:
  `art_fc9462882001IZJ2rhVeWB17r1` at 2026-08-03 20:17:26 UTC.
- `task.completed` was published at 20:17:26 UTC.
- In the same millisecond-scale completion window, the initial queued wake was
  drained, an older operator wake caused `Queued operator wake reopened
  terminal task`, and Engine Queue changed the Task to `active`.
- The Orchestrator answered that delivery was complete and became idle at
  20:17:36 UTC without issuing another terminal Task decision.

Its only root operator follow-up was created at 19:24:49 UTC and asked the
same Task to continue to complete delivery. It predated the terminal decision
by approximately 53 minutes and was not an explicit Retry/Replan.

## Shared causal chain

### Observable state

Both debug snapshots report:

- Task status `active`;
- no Task terminal fields;
- one idle nonterminal Orchestrator Session;
- every domain worker Session terminal; and
- zero Goals.

Zero Goals is expected for these Base non-Goal workflows and is not a failure
cause.

### Direct trigger

Both Tasks successfully executed their terminal tool and published a real
`task.completed` event. After the completing root prompt released its physical
owner, the queue completion hook discovered a pending operator-message wake.
`drainQueuedTaskEvent()` classified that message as an operator wake, called
`openTaskForOperatorWake()`, cleared the terminal Task row, and started the
Task again before the Orchestrator made any new semantic execution decision.

### Owning design cause

Engine Queue currently collapses three different meanings into the same Host
action:

1. deliver an ordinary operator conversation message;
2. request an explicit Retry/Replan execution window; and
3. continue a pending coordination request.

`isOperatorWakeEvent()` returns true for all three families. In the terminal
branch, any such wake is allowed to reopen the Task once
`SessionPromptState.hasOwnedPrompt()` becomes false. The Host therefore turns
message delivery into a lifecycle decision and removes terminal truth before
the LLM can decide whether new work exists.

This is not a display-only error. Protocol Event history correctly retains
the earlier `task.completed` fact, while the later reopen writes the current
`engine_task` row back to `active` with `time_completed = null`. The Overlay
reports the current active row accurately.

### Queue ownership timing

`launchTaskLoop()` marks the exact queued wake drained only after the entire
`runTaskLoop()` promise returns. `attachLoopCompletion()` then immediately
calls `drainQueuedTaskEvent()` again. A long-running root loop can therefore
accumulate ordinary operator messages for tens of minutes. Once the loop
records completion and releases prompt ownership, those older messages are
replayed against a terminal Task and preemptively reopen it.

The later Orchestrator response is internally coherent: its transcript
contains the successful `manage_task` result and completion evidence, so it
naturally says the Task is complete. The contradictory `active` state was
introduced by Host queue code outside that semantic decision.

## Shared backend interruptions

Both Tasks contain process-recovery facts at the same four windows:

| Recovery | Logistics Task UTC | Listed-company Task UTC |
| --- | --- | --- |
| 1 | 19:11:13 | 19:11:08 |
| 2 | 19:14:14 | 19:14:08 |
| 3 | 19:44:47 | 19:44:55 |
| 4 | 19:50:42 | 19:50:30 |

Each fact records that the previous backend process ended while the
Orchestrator and Developer Sessions had durable streaming evidence but no
current-process prompt owner. The near-identical timestamps across independent
projects prove a shared backend/runtime interruption surface rather than a
failure caused by either generated application.

The persisted evidence does not include a backend exit code, terminating
signal, shutdown source, stderr, or originating exception. The physical cause
of the four process exits remains unknown and must not be inferred from the
recovery label or `UnknownError` wrapper.

## Adjacent Task C: ExportHub false force-majeure closure

### Observable terminal chain

- Task: `tsk_fc8febda1001MVz4U86a75psrw`.
- Root Session: `ses_0370141b6ffe3fU9qFjzQsU0sy`.
- Orchestrator Session: `ses_037012248ffetqGcqOAsV9x4zb`.
- Latest independent Integrity Review:
  `art_fc96594d3001UQWfXvasHCywTG`, catalog revision 478, verdict
  `needs_correction` at 20:51:45 UTC.
- The review independently observed `pytest` 4 passed, a clean full-scale
  30/2,000/1,000,000/200,000/5,000,000 data-count run, and a passing fresh
  security/accounting audit. Its one active blocking finding was that the
  Python and TypeScript Software Development Kits were compatibility wrappers,
  not real OpenAPI Generator output.
- The Orchestrator asked for an SDK-generation environment at 20:52:18 UTC.
  The interaction became `rejected` at 20:57:18 UTC with an empty response.
- At 20:57:36 UTC the Orchestrator called `manage_task(action=fail_task)` and
  described the unresolved local generator toolchain as force majeure.

This Task did not reproduce the stale operator-wake terminal reopen. Its only
initial passive queued wake was drained after terminal failure and did not
clear the failed row. It is adjacent because the same execution period and
control plane converted incomplete infrastructure/interaction facts into an
incorrect Task lifecycle decision.

### The rejection was an automatic timeout, not operator refusal

The interaction timestamps differ by 300,010 milliseconds. This matches the
default five-minute timeout in `question/index.ts`. With
`experimental.auto_question=true`, the timeout publishes the same
`Question.Event.Rejected` shape as an explicit operator rejection. That event
contains `sessionID`, `requestID`, and `timeResolved`, but no resolution origin
or automatic-timeout fact. `engine/interaction.ts` consequently persists both
paths as `status=rejected` with an empty response.

The Orchestrator therefore received a lossy terminal interaction fact: it could
not distinguish explicit refusal from automatic expiry. Even with that loss,
the current Orchestrator prompt says that a dismissed or unanswered question
must use repository facts and reversible defaults, and that provider, network,
process, and tool execution failures are not force majeure by themselves. The
terminal decision contradicted that prompt contract.

### The SDK blocker remained locally repairable

The Developer recorded `java=null`, an empty OpenAPI Generator npm cache, and
`ECONNRESET` from the configured internal npm repository. It ran `winget list`,
Java/path probes, npm-cache probes, and `npx ... version`. It did not execute the
installation command that it wrote into `evidence/generator.json`, nor did it
exhaust a pinned Generator JAR or a corrected package-source path. This was a
local build-toolchain blocker, not proven external authority outside Task
scope.

The delivered generator script also made successful closure impossible or
misleading in three independent ways:

1. `write_offline()` hand-wrote Python and TypeScript compatibility clients,
   creating the exact fallback/multiple-model path prohibited by the request.
2. Successful generation stored plural `exit_codes`, while mode selection
   tested singular `exit_code`; even two successful commands would still be
   labelled `offline-compatibility`.
3. The clean check hashed raw `openapi.yaml` bytes without a repository line-
   ending contract. The manifest captured LF bytes, while the Windows checkout
   contained CRLF bytes and no `.gitattributes` fixed the representation. The
   generated-tree hash matched, but `spec_sha256` did not, so a clean checkout
   returned exit 1.

The terminal error compressed these separate product/tool defects into
"Java missing and npm ECONNRESET". That last observed environment state was a
direct trigger, not the complete root cause.

## Three-Task systemic conclusion

The incidents have different immediate terminal paths but one higher-level
control-plane weakness: infrastructure records are allowed to become lifecycle
authority without preserving or obtaining the semantic decision that the
record actually represents.

- In the logistics and listed-company Tasks, an ordinary pre-completion
  conversation message was treated by Host queue code as authority to erase a
  completed Task and open a new execution window.
- In ExportHub, an automatic question timeout was persisted as an
  indistinguishable rejection and then treated by the Orchestrator as refused
  external authority sufficient for force majeure.
- All three Tasks contain shared backend process-recovery windows. Those facts
  establish runtime interruption, not product failure or lifecycle authority.
- The resulting public rows are semantically unreliable in both directions:
  completed Tasks appear active/idle, while a Task with a recoverable local
  toolchain defect appears irreversibly failed.

The common repair direction is not a new gate. Durable facts must retain their
real actor and resolution origin, while the LLM remains the sole owner of the
semantic next-work decision under the existing prompt contract.

## Task-specific findings

### Logistics-only findings

- The first aborted Developer dispatch used Session
  `ses_036f75022ffesScEAD4BPqCL1z` and occurrence
  `art_fc908afda001oTrWSS4XmPFybh`. Recovery then created a new Developer
  Session and a new logical occurrence instead of continuing the exact prior
  occurrence. Later continuations correctly reused the replacement occurrence.
- Final review commands left seven tracked generated files modified after the
  last referenced Host observation. The completion decision therefore did not
  describe the exact final worktree state.
- Final Integrity Review retained an advisory mismatch between the report's
  test count/growth example and current command output.

### Listed-company-only findings

- All Developer recoveries reused Session
  `ses_036f7c62effeVC23HZLieHz7er` and occurrence
  `art_fc90839cc001xCoWbddIgHJpc4`; it does not reproduce the logistics
  duplicate-occurrence defect.
- Its project worktree was clean at investigation time.
- Its durable DAG contains no abnormal terminal Session.

These differences disprove duplicate Developer dispatch, dirty generated
outputs, or an abnormal worker terminal as the shared cause of the active Task
residue.

## Existing regression gap

`queue-directory-authority.test.ts` verifies that a terminal decision is not
reopened while the root prompt that is delivering the same wake still owns the
Session. It does not model this production ordering:

1. wake A owns a long-running root prompt;
2. ordinary operator-message wake B is persisted behind A;
3. A records terminal completion;
4. A releases prompt ownership and is marked drained; and
5. the completion hook drains B.

The test therefore proves only the in-prompt instant, while both incidents
occur immediately after ownership release.

## Required root direction

The repair must separate conversation delivery from Task execution authority:

- an ordinary operator message may wake the terminal Task's conversation but
  must not clear terminal Task truth;
- explicit Retry/Replan remains an execution decision and may open a new
  execution window through its canonical intent;
- a coordination request retains its own typed continuation contract;
- the Orchestrator may make a new semantic Task decision after reading the
  message, but Host queue code must not make that decision in advance; and
- recovery must continue the exact workflow occurrence and Session rather than
  creating a replacement logical node occurrence.

The solution must be expressed through the existing natural message and LLM
decision flow. A time threshold, keyword match, terminal-message discard gate,
retry loop, or compatibility fallback would hide rather than repair the
ownership error.

## Positive verification contract for a future repair

- A Task completes with a pre-completion ordinary operator message still
  queued; the message is delivered and the exact Task remains terminal with
  its completion timestamp and decision Artifact intact.
- A terminal Task receives an explicit Retry intent; the new execution window
  starts and retains the prior terminal evidence as history.
- A terminal Task receives an ordinary post-completion question; the
  Orchestrator answers in the real conversation without implicitly starting a
  new Task execution.
- An unanswered question reaches its automatic deadline; the durable
  interaction records automatic expiry distinctly from operator rejection,
  and the Orchestrator continues with repository facts or waits for a named
  external event instead of claiming refused authority.
- A local SDK generator lacks a runtime or package; the Build owner repairs the
  reproducible toolchain, invokes the pinned generator, and produces a clean
  checkout result before Task acceptance or evidenced external blocking.
- A backend interruption during a projected worker Turn continues the same
  Session and workflow occurrence and persists the eventual typed output.
- Process-interruption diagnostics expose the physical exit evidence when the
  runtime owns it; otherwise they state that the exit cause is unknown.

These are non-User-Interface lifecycle, protocol, queue, and persistence
contracts. Overlay acceptance, if product code later changes, must remain a
real-page manual review rather than a User-Interface automated test.

## Investigation disposition

- Common terminal-reopen defect: confirmed.
- Common backend interruption surface: confirmed.
- ExportHub false force-majeure classification: confirmed.
- Automatic-timeout versus explicit-rejection provenance loss: confirmed.
- ExportHub SDK generator and clean-check implementation defects: confirmed.
- Physical backend exit cause: unknown from retained evidence.
- Product code repair: not performed in this record.
- Production database mutation: not performed.
- Generated project mutation: not performed.
