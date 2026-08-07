# FieldFlow and Industrial IoT Task Closure Incidents

## Recall

### User requirement

- Investigate how Task `tsk_fc9027cf9001wZvhV0ryPE8AaU` (`FieldFlow 完整系统交付`)
  failed.
- Compare Task `tsk_fc900b9bb001K2NNu0fBpWuCah` (`工业 IoT 边云平台与技改交付`)
  and determine whether both expose common faults.
- Persist the confirmed incident without changing product code, either
  generated project, or the production database.

### Acceptance criteria and hard constraints

- Reconstruct observable state, direct triggers, deeper design causes, and why
  previous execution paths did not close the original acceptance contracts.
- Separate common runtime faults from Task-specific product findings. Do not
  infer causality from titles, `aborted`, `UnknownError`, retry, idle, or zero
  Goals.
- Keep `C:/Users/hengu/AppData/Local/opencorvus/data/opencorvus.db` and both
  generated project directories read-only. Do not run User-Interface tests.
- Do not propose a Host gate, state machine, fallback, compatibility path, or
  keyword classifier.

### Sources read and repository search

- `AGENTS.md`, `specs/README.md`, and `specs/records/2026-08/README.md`.
- `2026-08-04-terminal-task-stale-operator-wake-reopen-incident.md`,
  `2026-08-02-large-build-observation-and-interrupted-task-recovery.md`,
  `2026-08-02-task-acceptance-compaction-and-large-artifact-repair.md`, and
  `2026-08-03-build-existing-session-runtime-ready-repair.md`.
- `packages/opencorvus/src/session/processor.ts`,
  `packages/opencorvus/src/session/tool-failure-cause.ts`,
  `packages/opencorvus/src/engine/queue.ts`, and
  `packages/opencorvus/src/provider/models-bootstrap.json`.
- Read-only SQLite Task, Session, Message, Part, Protocol Event, Engine
  Artifact, and control-plane rows for both Tasks.
- Runtime log
  `C:/Users/hengu/AppData/Local/opencorvus/log/2026-08-03T195016-11992-1.log`.
- Whole-repository searches covered `ContextOverflowError`,
  `session.processor.catch`, `Tool failure cause`, prompt-owner recovery,
  `unknown certificate verification error`, model context limits, queued
  wakes, Task terminalization, and the two Task and Session identifiers.

### Independent agent feedback

- Two read-only independent audits were dispatched for runtime evidence and
  code responsibility. The operator interrupted that turn and requested direct
  persistence. Both audits ended before returning findings, so no conclusion
  below is attributed to independent Agent feedback.

## Incident identities and final observed states

### FieldFlow

- Task: `tsk_fc9027cf9001wZvhV0ryPE8AaU`.
- Root Session: `ses_036fd75d5ffeqx446zsjM6kUSw`.
- Orchestrator: `ses_036fd3f36ffe8CmTdmsI0sGE2x`.
- Long-lived Developer: `ses_036f3ad36ffeKYKLcIY9uhUhgs`.
- The 02:02:31 UTC clipboard snapshot showed active/retry. Later durable
  events published `task.failed` at 02:03:12 UTC with an Orchestrator
  certificate-verification error.

### Industrial Internet of Things

- Task: `tsk_fc900b9bb001K2NNu0fBpWuCah`.
- Root Session: `ses_036ff4538ffeebRGj1ulhFMcze`.
- Orchestrator: `ses_036ff0ef8ffedcTKlVbrutSBAz`.
- Long-lived Developer: `ses_036f3a45cffeT0CXov6d1WL3AN`.
- The Task remains active with no completion time or error. The Orchestrator
  became idle at 20:29:57 UTC, all domain workers were terminal, and no Event
  Job or Session Control Record remained to wake it.

## Confirmed shared backend interruptions

Both independent project Tasks recorded process-recovery failures in the same
backend lifetime windows:

| Recovery | FieldFlow UTC | Industrial IoT UTC |
| --- | --- | --- |
| 1 | 19:10:58 | 19:11:02 |
| 2 | 19:13:59 | 19:14:03 |
| 3 | approximately 19:44 | approximately 19:44 |
| 4 | approximately 19:50 | 19:50:24 |

Each fact says the previous backend process ended while durable streaming or
retry evidence remained and the new process had no current prompt owner. The
near-identical times prove a shared backend/runtime interruption surface, not
a failure caused by either generated application.

The retained evidence has no backend exit code, signal, shutdown owner,
stderr, or originating exception. The physical exit cause remains unknown.
Zero Goals is expected for these Base non-Goal workflows and is not causal.

## Shared closure pattern

Both Tasks followed the same evidence-backed sequence:

1. Research and planning completed.
2. Early Developer Sessions were interrupted by backend process loss.
3. A recovered or replacement Developer Session published an initial
   development report.
4. Tester, Visual Review, or Integrity Review found material unmet original
   requirements.
5. The Orchestrator repeatedly continued the same physical Developer Session
   and workflow occurrence.
6. Continuations retained growing raw Message, Tool, Artifact-read, image, and
   full original Task-request inputs.
7. Local worker terminal results did not converge into one truthful overall
   Task acceptance terminal.

This is a data-flow and semantic-closure problem. It does not justify a Host
workflow gate or state machine.

## FieldFlow causal chain

### Product acceptance remained open

Final Visual Review Artifact `art_fc96f0267001kqy89PK7Z6e0Bi` recorded
`accepted=false` and found:

- approximately 93,459 characters of raw work-order JavaScript Object Notation
  (JSON) rendered directly into a management page about 62,340 pixels high;
- missing engineer-load, Service Level Agreement (SLA), first-time-fix,
  spare-parts, and report-entry modules; and
- no direct visual interaction evidence for desktop login, offline restart,
  conflict resolution, or synchronization history.

The review also added unauthorized 1024- and 390-pixel responsive acceptance.
That scope expansion violates desktop-only delivery, but it is not needed to
prove failure: the desktop raw JSON and missing required modules are valid
independent blockers.

The latest Integrity Review passed a narrow lifecycle/regression surface while
leaving field-scale performance, resource use, document rendering, and
desktop internal interaction unverified. Several were explicit original
acceptance items, so local Integrity pass did not equal complete Task
acceptance.

### Output limit, context overflow, and masked compaction

At 21:09:43 UTC the Developer first failed with
`MessageOutputLengthError`: the response exceeded the effective 64,000-token
output cap. The Orchestrator shortened the latest repair text but continued the
same accumulated physical Session.

At 21:14:00 UTC diagnostics reported 416 Messages, 488 Tool calls,
approximately 1,468,366 message-payload characters, five images, and a local
estimate of approximately 410,473 tokens. Each continuation also received the
complete original request. The provider then repeatedly returned a structured
`context_length_exceeded` response.

Protocol Events correctly exposed `ContextOverflowError`, but the Developer's
terminal error became:

`Tool failure cause at session.processor.catch did not include an Error or message string`.

That text is a masking error, not the original cause. The catch path in
`session/processor.ts` converts a raw failure for open Tool parts before it
tests the normalized Message error for `ContextOverflowError`. The provider's
Server-Sent Events (SSE) payload is an object with its message nested under
`error.message`; it is neither a JavaScript `Error`, a string, nor a complete
`ToolFailureCause`. `toolFailureCauseFromUnknown()` therefore throws before
the processor reaches its compaction branch.

The proved chain is:

`oversized continued Session -> provider context_length_exceeded -> raw object enters processor catch -> strict Tool-failure conversion throws -> compaction is bypassed -> Build adapter reports the misleading processor-contract error`.

The OpenAI model bootstrap advertised a 1,050,000-token context and
922,000-token input limit, while the provider rejected this smaller locally
estimated request. The evidence proves metadata/runtime disagreement or local
underestimation, but not the provider's precise true boundary.

### Final Transport Layer Security terminal

The Orchestrator scheduled a nonblocking wake after Build recovery failed.
When it ran, requests to
`https://chatgpt.com/backend-api/codex/responses` failed six times with
`UNKNOWN_CERTIFICATE_VERIFICATION_ERROR`. The Mission Session failed against
the same endpoint in the same interval, proving this was not a FieldFlow
application error.

At 02:03:12 UTC the Task published `task.failed`. Transport Layer Security
(TLS) failure was the final terminal trigger, not the cause of the earlier
product or context failures. The retained evidence cannot distinguish local
trust-store, network interception, endpoint-chain, or Bun transport causes.

## Industrial IoT causal chain

### Product acceptance remained open

The latest closure evidence and final Orchestrator messages retained:

- only `12,214 / 730,000` expected events received for the 2,000-device
  one-year replay;
- no real wall-clock 24-hour offline run;
- incomplete restart, disk-high-watermark recovery, and cross-factory
  isolation evidence;
- insufficient independent long-lived storage/Web process evidence; and
- an Integrity Review still at `needs_correction`.

The Orchestrator correctly refused to call this delivery complete.

### Same accumulation, no recorded overflow

The IoT Developer Session followed the same growth pattern. Its final
diagnostic reported approximately 360 Messages, 506 Tool calls, 1,068,505
message-payload characters, three images, and a local estimate of approximately
307,308 tokens.

No `ContextOverflowError` was recorded for this Task. Context overflow is a
shared demonstrated risk and data-flow pattern, not the direct cause of the
IoT residue.

### Active-idle no-future-action residue

The final two Orchestrator messages truthfully said the Task was incomplete,
then the Session became idle. A normal assistant message does not change Task
lifecycle. No subsequent dispatch, scheduled wake, interaction request,
completion decision, or failure decision followed. The durable state is:

`Task active -> Orchestrator idle -> all workers terminal -> no future wake`.

This differs from the separately recorded stale operator-wake incident: there
is no proved earlier `task.completed` event that was reopened. The direct fault
is missing semantic closure after the Orchestrator identified unresolved
blockers.

## Common design findings

### Unbounded continuation input

Exact logical responsibility should continue, but raw execution history need
not be the only evidence carrier. Both Tasks already had canonical research,
plan, development, review, and closure Artifacts. Repeatedly rematerializing
all Tool history and the full original request makes the physical Session the
dominant input and can prevent the model from performing the repair.

### Worker terminal is not acceptance

Developer `terminal_success`, development-report publication, and a local
review pass are distinct from overall Task acceptance. Both incidents show
those local facts coexisting with unmet original requirements.

### Acceptance scope drift

FieldFlow added unrequested mobile/tablet checks and demoted explicit evidence
requirements to advisory. IoT correctly retained throughput, endurance, and
recovery shortfalls as blockers. Review and Orchestrator prompts must preserve
the exact original scope and acceptance semantics.

### Missing truthful closure action

FieldFlow eventually reached failure only because TLS forced an external
terminal. IoT stopped with accurate prose but no future action or Task
terminal. Host code must not infer lifecycle from message keywords. The
Orchestrator's natural decision path must nevertheless continue responsible
work, schedule a real wake, request necessary authority, or publish a truthful
terminal result with the unresolved evidence.

## Why previous paths did not close the incidents

- Process recovery restored availability but not the prior process's prompt
  owner, and repeated recovery enlarged the continuation surface.
- Shortening the latest repair instruction did not reduce accumulated Session
  history or repeated full-request input.
- FieldFlow's strict raw Tool-failure conversion threw before recognized
  context overflow could activate compaction.
- Physical Developer Turn success did not prove the overall acceptance matrix.
- IoT's final prose described blockers but created neither a future action nor
  a terminal Task event.
- FieldFlow created a future wake, but the TLS outage prevented the next
  semantic decision.

## Confirmed and unknown conclusions

### Confirmed common faults

- Shared backend interruption windows across independent Tasks.
- Large physical Developer Session continuation with repeated full inputs.
- Initial local completion followed by material review findings.
- Failure to converge local worker/review facts into clean overall Task
  closure.

### FieldFlow-only

- Output-limit failure, provider context overflow, and compaction masking.
- Final TLS certificate-verification terminal.
- Valid desktop management blockers plus invalid responsive scope expansion.

### Industrial IoT-only

- Major replay, endurance, recovery, and long-lived-process evidence gaps.
- Active Task with idle Orchestrator and no future action.

### Unknown

- Physical cause of shared backend exits.
- Physical cause of TLS certificate verification failure.
- Exact provider context boundary and exact rejected token count.
- Whether continued IoT execution would have reached the same context error.

## Root direction for later repair

No product repair is part of this record. A future root repair should:

- preserve structured provider error identity through Tool cleanup so existing
  context compaction can run;
- continue responsibility through canonical Artifacts and compacted visible
  conversation rather than repeated raw Tool history;
- keep original Task scope and acceptance authoritative through every review;
- prompt the Orchestrator to choose a real next action or truthful terminal
  decision after identifying blockers, without a Host lifecycle gate; and
- retain real backend exit code, signal, shutdown source, and stderr when the
  runtime owns them, otherwise explicitly keep the physical cause unknown.

## Investigation disposition

- Common backend interruption surface: confirmed.
- Common continuation accumulation and closure-convergence defect: confirmed.
- FieldFlow context-compaction masking: confirmed.
- FieldFlow final TLS terminal trigger: confirmed.
- Industrial IoT active-idle no-future-action residue: confirmed.
- Physical backend exit cause: unknown.
- Product code repair: not performed.
- Production database mutation: not performed.
- Generated project mutation: not performed.
