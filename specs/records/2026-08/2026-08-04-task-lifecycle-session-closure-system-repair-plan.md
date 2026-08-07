# Task Lifecycle, Session Continuation, and Closure System Repair Plan

Status: Accepted; independent on-disk lifecycle and Session/runtime review complete
Date: 2026-08-04
Owner: Codex

## Recall

### User requirement

The operator requested a systemic repair plan for the three incident reports,
with clear responsibility boundaries, a complete architecture, and independent
Agent review.

The three report surfaces are:

1. completed Tasks reopened by stale ordinary operator-message wakes;
2. ExportHub automatic question expiry persisted as operator rejection and then
   misclassified as force majeure; and
3. FieldFlow/Industrial Internet-of-Things continuation growth, masked context
   overflow, shared backend interruption, and active-idle closure residue.

### Acceptance criteria

- Define one end-to-end architecture from physical fact production through
  typed provenance, Orchestrator semantic decision, and Task lifecycle write.
- Assign one owner to ingress, lifecycle mutation, interaction resolution,
  Provider error normalization, Tool cleanup, compaction, continuation input,
  Artifact handoff, process recovery, and process-exit diagnostics.
- Identify exact current call sites to replace or delete; do not preserve the
  broken path as compatibility behavior.
- Distinguish incident-common architecture defects from incident-specific
  triggers and unknown physical causes.
- Provide dependency-ordered atomic implementation batches and positive
  non-User-Interface verification contracts.
- Obtain independent lifecycle and Session/runtime architecture reviews, then
  obtain independent review of this exact on-disk plan before declaring the
  plan accepted.

### Hard constraints

- Orchestrator remains the sole semantic Task scheduler and business-lifecycle
  decision owner.
- Host code may validate typed data integrity and execute an explicit intent;
  it must not infer Retry, completion, failure, or next work.
- Do not add a Host gate, workflow state machine, idle detector, mechanical
  retry, keyword classifier, timeout heuristic, fallback, compatibility reader,
  hidden message, synthetic message, or second lifecycle source.
- Preserve the same Task, fixed Expert Squad, immutable workflow occurrence,
  and exact worker Session for recoverable continuation.
- Keep every natural message visible. Compaction may create a visible natural
  summary but may not become an Artifact store or hidden memory channel.
- No database migration or implicit schema repair. Existing current schema is
  sufficient for the proposed interaction status and Artifact-based facts.
- Do not add, modify, update, or run User-Interface automation tests.
- Preserve unrelated dirty worktree changes.

### Sources read

- `specs/current/architecture/03-control.md`
- `specs/current/architecture/06-provider.md`
- `specs/current/architecture/15-agent-facts-and-turns.md`
- `specs/current/architecture/18-scheduled-automations.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-08/2026-08-01-dispatch-occurrence-process-recovery-root-repair.md`
- `specs/records/2026-08/2026-08-02-task-acceptance-compaction-and-large-artifact-repair.md`
- `specs/records/2026-08/2026-08-02-large-build-observation-and-interrupted-task-recovery.md`
- `specs/records/2026-08/2026-08-03-agent-session-continuation-and-prism-planner.md`
- `specs/records/2026-08/2026-08-03-task-closure-residual-escape-removal.md`
- `specs/records/2026-08/2026-08-04-terminal-task-stale-operator-wake-reopen-incident.md`
- `specs/records/2026-08/2026-08-04-fieldflow-iot-task-closure-incidents.md`

### Whole-repository search

The investigation covered:

- `openTaskForOperatorWake`, `isOperatorWakeEvent`, `source_kind`, queued wake
  persistence/drain, completion hooks, task intents, terminal Task admission,
  and prompt ownership;
- `Question.Event.Rejected`, `RejectedError`, automatic timeout,
  `EngineInteractionStatus`, `expired`, and interaction protocol summaries;
- `Message.fromError`, `ContextOverflowError`, `toolFailureCauseFromUnknown`,
  open Tool-part cleanup, predictive/reactive compaction, and Provider model
  limits;
- `existingSessionID`, `continuation_dispatch_id`, `buildUserPrompt`, repeated
  `task.request` projection, WorkerTurnDescriptor, dispatch lineage, and
  Artifact selection;
- Orchestrator decision-epoch prompt language, Task management tools, scheduled
  wait, terminal assistant messages, and active-idle residue;
- backend sidecar spawn/wait, exit handling, captured standard-output/standard-
  error log paths, process recovery, and bootstrap reconciliation; and
- focused queue, question, interaction, processor, compaction, continuation,
  process-recovery, and Orchestrator prompt tests.

### Independent Agent feedback before drafting

Two one-level, read-only Agents reviewed separate responsibility surfaces and
did not delegate further.

- The lifecycle reviewer concluded that Queue already persists distinct source
  identities but later destroys them through a boolean classifier. It required
  a strict queued-ingress union, a terminal conversation-only pass, operator-
  owned Retry/Replan, distinct expired/rejected interaction outcomes, and real
  Orchestrator closure actions without a Host idle gate.
- The Session/runtime reviewer concluded that `Message.fromError` must be the
  only raw Provider-error normalization boundary; Tool cleanup must consume a
  canonical error; SessionLoop must remain the only compaction owner;
  continuation must be incremental; Artifact Catalog must remain the only
  cross-Turn semantic evidence source; and process-exit facts must come from the
  process supervisor rather than Queue inference.
- Both reviewers required complete replacement rather than compatibility
  branches and supplied positive non-User-Interface verification matrices.

### Independent Batch 2B implementation feedback

Three one-level read-only reviewers rejected the first Batch 2B candidate.
Their evidence identified: continuation compaction incorrectly equating the
initial descriptor with the latest descriptor; descriptor-missing fallback;
logical lineage publication before descriptor authority; shallow nested
adapter-input freezing; incomplete package revision and workflow-node checks;
unvalidated cross-Task evidence locators; incomplete initial text-Part set
authority; and drifted coordination fixtures. The implementation batches below
retain these findings as required acceptance inputs. No reviewer delegated
further.

## Architectural diagnosis

The incidents are different direct defects but share one broken abstraction:

```text
PhysicalFact -> TypedProvenance -> OrchestratorDecision -> TaskLifecycle
```

The current system sometimes skips the middle layers:

- an ordinary message delivery becomes a Host-authored lifecycle reopen;
- an automatic deadline becomes a false operator rejection;
- a raw Provider object becomes a cleanup exception that replaces the canonical
  context-overflow error;
- a worker Turn result is treated as if it were Task acceptance, or truthful
  incomplete prose ends without a next decision; and
- a process-recovery observation is asked to explain an exit it did not own.

The repair restores a one-way fact flow. It does not create a universal
aggregate, second inbox, workflow state, or Host policy engine.

## Non-negotiable invariants

1. A physical delivery fact never changes business lifecycle.
2. Only the canonical Task terminal writer and explicit operator Retry/Replan
   transaction write Task lifecycle.
3. An ordinary terminal Task message is delivered and answered without clearing
   the terminal row.
4. An explicit operator Retry/Replan retires old delivery notices, preserves
   their source facts, appends one current typed intent, and opens one execution
   epoch.
5. Automatic question expiry and explicit operator rejection are different
   durable outcomes.
6. Raw Provider errors are normalized once. Every later consumer uses the same
   canonical error identity.
7. Tool cleanup converges physical Turn state; it cannot replace the primary
   error, decide compaction, or decide Task lifecycle.
8. SessionLoop is the only predictive/reactive compaction owner.
9. Exact Session and logical occurrence continuity does not imply repeated full
   Task-request projection.
10. The immutable Task row plus its exact initial visible user message are the
    Task request/acceptance control authority. Artifact Catalog is the only
    cross-Turn/Agent domain-evidence authority. Transcript and compaction
    summaries carry visible narrative and stable refs but never replace either
    authority.
11. A normal worker Turn end, terminal worker result, review verdict, Task
    acceptance, and Task lifecycle are different facts.
12. Queue recovery reports what the replacement process observes. Only the
    spawning supervisor reports an exit code, signal, shutdown source, or
    standard-error locator.

## Target architecture

### Layer 1: physical fact producers

Physical producers write only facts they directly own:

| Producer | Owned fact | Not owned |
| --- | --- | --- |
| Task message ingress | visible root message and exact message identity | Retry/Replan intent |
| Operator control API | typed Retry or Replan intent | semantic inference from message text |
| Coordination service | request identity, producer Session, request payload | Task reopen |
| Question service | answer, explicit rejection, or automatic deadline expiry | force-majeure classification |
| Provider adapter | raw streaming/API failure and route/model identity | Tool cleanup or Task failure |
| Session processor | current Turn parts and canonical physical error projection | scheduling or acceptance |
| Session loop | prompt budget and compaction action | Task lifecycle |
| Worker adapter | visible initial or continuation input | canonical Artifact bodies |
| Process supervisor | process occurrence, exit status, shutdown source, log locator | Task recovery decision |
| Queue/bootstrap | ownerless durable execution observation and delivery attempt | physical exit cause |

### Layer 2: typed provenance

#### Queued Task ingress

Replace the loose queued wake payload plus later event reclassification with one
strict Zod discriminated union. The persisted discriminant remains
`source_kind`; each variant permits only its own identity and event shape:

```text
operator_message      -> message_id + rootMessage(kind=operator)
orchestrator_message  -> message_id + rootMessage(kind=orchestrator)
operator_intent       -> taskIntent(actor=operator, kind=retry|replan)
                         + ordered superseded_operator_message_ids
coordination_request  -> request_id + coordinationRequest
infrastructure_recovery -> recovery_fact_id + processRecovery
task_wait_activity    -> exact wait activity identity
orchestrator_event    -> exact internal event identity
```

Write and read paths both parse this union. Payload contradictions fail as typed
data-integrity errors. Consumers do not re-derive meaning from optional event
booleans.

The operator-intent parser validates every superseded message against the same
Task/root Session, requires unique IDs in original queued order, and requires
each referenced notice to be the exact unconsumed operator-message notice
retired by the same intent transaction.

The current `orchestrator_intent` variant is deleted with the retired
Orchestrator-authored Retry/Replan authority. It is not retained as an alias or
compatibility reader.

#### Question resolution

Use the already-declared `EngineInteractionStatus` values as the single durable
contract:

```text
answered -> Question.Replied
rejected -> Question.Rejected(origin=operator)
expired  -> Question.Expired(origin=deadline, timeExpires, timeResolved)
```

`ExpiredError` is distinct from `RejectedError`. LLM-visible Tool output says
that an automatic deadline elapsed and no operator decision was made. It never
says “User dismissed”.

#### Canonical Session error

`Message.fromError(raw, { providerID })` remains the only Provider-private raw
error parser. Add one strict canonical `Message.Error -> ToolFailureCause`
projection. It uses the canonical discriminant, canonical message, redacted
response metadata, origin site, classification, and Session identity. The raw
Provider object is not reparsed by Tool cleanup.

Every failure occurrence is anchored by the existing exact Turn identity:

```text
session_id + assistant_message_id + canonical error discriminant
```

The assistant error, every affected ToolFailureCause `data.failure_occurrence`,
and `Session.Event.Error` reference that same anchor. No error-text hash,
parallel raw payload ID, or second error record is introduced.

#### Dispatch Turn input

Use the existing exact lineage facts to project a strict input union:

```text
InitialTurn:
  exact Task request + immutable workflow/Session subjects

ContinuationTurn:
  source dispatch/Session/occurrence anchors
  + current visible repair guidance
  + exact Artifact locators/search constraints
```

`openLineage` is the only continuation-anchor resolver. It projects this exact
schema into `DispatchAdapterExecutionContext`:

```text
current_dispatch_id
source_dispatch_id
child_session_id
workflow_binding
workflow_node_id
workflow_occurrence_id
delivery_slice_revision_ids
evidence_locators
task_authority:
  task_id
  task_request_digest
  initial_user_message_id
  initial_control_text_parts: [{ part_id, text_sha256 }]
```

The initial WorkerTurnDescriptor records the Task-request digest, exact initial
visible user-message identity, and the exact text Part IDs that project Task
control authority. A continuation validates the current Task request and those
text Parts against that digest and reuses the same identities. File/image/media
Parts are evidence inputs, not Task-control text. The current continuation
dispatch ID never substitutes for the source dispatch ID.

`existingSessionID` and source dispatch lineage determine the variant. This is
an input data contract, not a persisted workflow state machine.

#### Process occurrence evidence

The managed Tauri sidecar supervisor already owns backend spawn/wait and the
per-launch log path. It owns one filesystem protocol under the canonical
user-private OpenCorvus data directory:

```text
process-occurrences/<occurrence_id>.json
process-occurrences/current.json
```

Before spawn, the supervisor allocates the occurrence ID, atomically writes the
running envelope through temporary-file rename, atomically points `current.json`
to it, and passes both the current occurrence ID and exact predecessor-envelope
locator to the child environment. The envelope contains:

- occurrence identity and process identifier;
- executable/build stamp and start time;
- observed exit code or operating-system signal when available;
- explicit shutdown source for graceful/forced supervisor actions;
- standard-output/standard-error log locator; and
- observation time and supervisor identity; and
- `status=running|exited`, with exit fields present only after observation.

The same supervisor is the only envelope writer. Its child wait owner
atomically replaces the envelope after an observed exit. The backend never
writes its own process envelope and Tauri never writes the runtime database.
If the supervisor dies before observing the child, the prior running envelope
remains truthful and the replacement process receives it as an exact
predecessor with unknown exit cause.

Replacement bootstrap accepts the predecessor locator only from the supervisor
environment, validates that the path resolves under the canonical occurrence
directory, parses one strict schema, and makes that locator available to Queue
recovery. Unmanaged command-line/API starts omit both environment values and
therefore have explicit absent supervisor evidence.

The occurrence directory inherits the user-private data-directory access
control. Envelopes contain no credentials or copied logs and are not collected
by ordinary log retention. They are small durable physical-evidence resources.
The log owner skips every file referenced by a retained process envelope. Only
an explicit supervisor-evidence maintenance operation may atomically change the
same envelope to `log_status=expired_by_maintenance` with its maintenance
occurrence/time and then remove that exact log. Thus a plain retention sweep
cannot create a dangling locator, while neither the log nor envelope is copied
into the runtime database.

Queue recovery writes only this exact locator into its existing Task-scoped
infrastructure Artifact. It does not copy or infer the envelope contents.
Unmanaged command-line/API processes without supervisor evidence keep
`cause=unknown` while still producing valid ownerless-execution recovery facts.

### Layer 3: Orchestrator semantic decisions

#### Conversation pass versus execution pass

This distinction is transient call authority, not a second Task status.

- An ordinary message for a terminal Task runs a root Session conversation-only
  Orchestrator pass. It reads the exact message and terminal evidence, emits a
  visible answer, keeps the Task terminal, does not claim the directory
  execution queue, and does not dispatch product work.
- A status, diagnosis, explanation, or evidence request ends with the visible
  answer. It is not an execution decision epoch and does not require a fake
  lifecycle Tool call.
- New execution is authorized only by the operator's explicit typed Retry or
  Replan control action. Natural-language keywords are never converted into an
  intent by Host code.
- The explicit intent opens the Task in its canonical transaction and launches
  an execution pass. That pass must finish each scheduling epoch with a real
  `dispatch_agent`, `respond_agent_coordination`, `manage_task`, `question`, or
  named `wait` action.

This deliberately does not restore an Orchestrator-authored `retry_task` action.
The newer 2026-08-02 execution contract and current implementation reserve the
fresh execution window for explicit operator control. The stale statement in
`15-agent-facts-and-turns.md` that an Orchestrator lifecycle Tool writes Retry/
Replan intent must be removed during implementation.

#### Terminal-ingress runner

One `TerminalTaskConversationRunner` is used by immediate ingress and bootstrap
drain. It is not a second Task loop:

1. Queue reads and validates the exact pending queued-ingress record.
2. The runner verifies the same Task is terminal and serializes the pass through
   the existing root `SessionPromptState.enqueueRootWake` owner.
3. `Orchestrator.processTerminalConversation()` receives the exact typed
   ingress, terminal Task/decision facts, and normal visible conversation tools.
   It does not claim/start the Task, acquire the directory execution queue, or
   dispatch product work.
4. An `operator_message` is read by exact message ID and receives a visible
   answer. If it requests new product work, the answer gives the explicit
   operator Retry/Replan control needed to authorize execution while preserving
   the current terminal decision.
5. A terminal `coordination_request` is closed through a new visible
   `respond_agent_coordination decision=acknowledge_terminal` response. That
   response references the exact current terminal lifecycle occurrence and,
   when present, its completion-decision Artifact. It explains that no
   continuation was authorized; it does not reopen, redispatch, or write a
   second Task terminal decision.
6. A terminal `orchestrator_message` is a passive visible notification. Queue
   records its exact delivery outcome without invoking a model pass. This is an
   explicit union branch, not a “message-like” boolean classifier.
7. Recovery, wait-activity, and internal-event variants each have their own
   exact terminal delivery outcome; none falls through to conversation or
   lifecycle inference.
8. Only after the conversation/response/passive-delivery result is durable does
   Queue mark that exact notice drained. Process loss before that boundary
   leaves the notice pending for replacement bootstrap to enqueue on the same
   root Session.
9. Completion drains the next terminal ingress through this same runner. It
   never calls `advanceQueue()` as if the terminal Task owned directory
   execution capacity.

The runner constructs one exact invocation authority from validated durable
facts:

```text
TerminalConversationAuthority
  task_id
  ingress_id
  ingress_kind
  terminal_lifecycle_reference
    terminal_event_id
    terminal_status                 // completed | failed | cancelled
    terminal_reason?                // interrupted when the failed writer declares it
    time_completed
    terminal_error?                 // exact failed/interrupted error when present
  completion_decision_artifact_id?  // completed Task only, when present
  coordination_request_id?  // present only for coordination_request ingress
```

`terminalTask` remains the single terminal transaction writer. In that same
transaction, its specialized `task.completed`, `task.failed`, or
`task.cancelled` protocol event must carry the terminal status,
`time_completed`, exact error where applicable, and the interrupted reason when
applicable. One strict resolver takes the latest specialized terminal event in
the Task's ordered protocol lineage after its latest nonterminal `task.updated`
event, then validates its Task ID, terminal status, terminal time, error, and
reason against the current row. Missing, conflicting, or non-current lineage is
a typed data-integrity error. A completion-decision Artifact is resolved only
for a completed row and remains optional supplemental evidence.
Failed force-majeure, interrupted infrastructure, startup failure, and cancelled
Tasks therefore have the same canonical authority without inventing an
Artifact.

`orchestrator/tools.ts::withDecisionEffectMetadata` must consume this authority
instead of applying its current blanket terminal-Task scheduler-Tool rejection.
Only the real
`respond_agent_coordination(decision=acknowledge_terminal)` call is admitted,
and only when its Task, pending coordination request, queued ingress, and current
terminal lifecycle reference exactly equal the authority. Its optional
completion-decision Artifact must also match when supplied. Its decision effect
is conversation delivery, not Task lifecycle. Every dispatch, wait, question,
Task-management, product-work, or mismatched coordination call retains the
existing typed terminal conflict. That conflict result directs recoverable
follow-up to the explicit same-Task operator Retry/Replan control; only evidence
of genuinely separate scope directs creation of a separate Task. This is exact
input/provenance validation at the Tool boundary, not a Host scheduler rule or
a second lifecycle policy.

Every real terminal-conversation assistant message is created with durable
provenance naming the exact queued-ingress ID before streaming begins. A
completed real assistant message, coordination response, or passive-delivery
result therefore has one exact `TerminalIngressResult` identity. Notice
settlement resolves that result and marks the notice drained in one transaction.
If the process dies after the real result is durable but before settlement,
bootstrap first resolves the result by ingress identity and drains it without
another model call. This provenance belongs to the real message/result; it is
not a synthetic assistant or copied response.

Process loss before any durable result leaves the notice pending for replacement
delivery. A completed attempt that returns a typed delivery failure settles the
notice as `delivery_failed`, exposes the exact failure, and is not replayed by
bootstrap. A later delivery requires a new explicit ingress or coordination
decision. Thus restart reconstruction closes an interrupted physical attempt
but does not create a mechanical retry policy.

#### Active Task closure

The Orchestrator prompt must express concrete closure ownership:

- `PARTIAL` or `needs_correction` plus Task-owned repair work -> continue the
  exact prior implementation lineage;
- only a long-duration or external event remains -> create one named wait;
- only an operator-owned external fact/authority remains -> ask one exact
  question; automatic expiry means no answer, not refusal;
- current evidence accepts the original scope -> complete the Task;
- exact evidence proves an external condition that cannot be repaired or waited
  through under Task authority -> fail for force majeure.

No Host watcher interprets `active + idle`, message text, worker cardinality, or
elapsed time. Normal prose cannot substitute for an execution-pass decision.

### Layer 4: lifecycle writers

There are only two write families:

1. the existing terminal decision transaction for complete/fail/cancel; and
2. the operator Retry/Replan intent transaction for terminal-to-running.

The intent transaction performs all of the following atomically:

- verifies the current terminal Task and fixed Task/Session/project lineage;
- preserves the prior terminal decision and protocol history;
- retires every prior pending *delivery notice* for the Task and captures the
  ordered exact message IDs of every still-unconsumed operator-message notice;
- preserves the messages, coordination requests, recovery facts, waits, and
  Artifacts behind those notices;
- appends one current typed operator intent ingress whose provenance contains
  those ordered `superseded_operator_message_ids`; and
- opens the same Task execution epoch.

If a still-valid coordination request needs delivery after Retry/Replan, its
canonical request reconciliation recreates one delivery notice by request
identity. Old delivery rows never race ahead of the fresh control intent.
The execution-pass Wake Provenance exposes every superseded message ID and
requires `read_task_message` on each exact ID before scheduling. Message bodies
remain only in their original visible messages; the intent stores refs, not a
second inbox or copied content.

`orchestrator/event.ts` owns the canonical operator-intent ref schema.
`orchestrator/agent.ts` renders the ordered refs and passes them into Tool
construction. `createOrchestratorTools` derives one allowed ordered message-ID
set from either the validated current rootMessage or validated intent refs, and
`orchestrator/interaction-tools.ts::read_task_message` reads only IDs in that
set. It never receives broad root-Session history authority.

## Responsibility-bound component design

### A. Message ingress and Queue

#### Replace

- `task-api/index.ts::appendAndWakeTaskOperatorMessage()` stops calling
  `openTaskForOperatorWake()`.
- `engine/queue.ts::isOperatorWakeEvent()` and
  `isOperatorMessageWakeEvent()` are deleted.
- `drainQueuedTaskEvent()` and `dispatchTaskLoop()` stop reopening terminal
  Tasks.
- pending-wake readers return the fully parsed queued-ingress union, including
  `source_kind`, rather than only a loose `OrchestratorEvent`.
- `task-message-open.ts` is narrowed/renamed to the explicit Task-intent
  transaction writer and is imported only by Retry/Replan control code.
- terminal ordinary-message delivery enters the conversation-only root Session
  path; it is not fed into the directory execution queue.

#### Preserve

- exact root message persistence;
- root Session prompt serialization;
- request/intent identity and restart-safe delivery;
- immutable terminal decision history; and
- queue delivery-attempt facts.

### B. Question and Engine interaction

#### Replace

- automatic timeout publishes `Question.Event.Expired` and throws
  `ExpiredError`;
- explicit `Question.reject()` alone publishes `Rejected(origin=operator)`;
- `askAndFormat()` renders distinct visible expiry/rejection text;
- `engine/interaction.ts` persists `expired` and `rejected` separately; and
- `interaction-request.ts`, protocol summaries, Panel, route descriptions, and
  SDK contracts render the actual status rather than mapping all non-answered
  results to “rejected”.
- `session/processor.ts` treats `ExpiredError` as a resolved interaction Tool
  outcome with canonical expiry semantics rather than a rejected/cancelled Tool;
- `orchestrator/tools.ts` coordination `ask_user` completes the action with
  `interaction_status=expired` and returns control to the current scheduling
  epoch instead of recording user rejection;
- `protocol/session-mirror.ts` mirrors `question.expired` as its own event; and
- `config.ts`, configuration docs, routes, and generated descriptions call
  `auto_question` behavior automatic expiry, never auto-rejection.

#### Delete

- timeout-as-Rejected event production;
- timeout-as-RejectedError behavior; and
- tests that make automatic expiry and explicit rejection the same contract.

No schema migration is required because `expired` already exists in the current
DDL and public model.

### C. Provider error, Tool cleanup, and compaction

#### Canonical order

```text
raw Provider error
-> Message.fromError once
-> canonical Message error
-> strict ToolFailureCause projection
-> converge open Tool parts
-> ContextOverflow: return compact
-> other errors: publish canonical Session error and settle Turn
```

`failOpenToolParts()` receives an already valid cause. Cleanup cannot throw a
new unknown-conversion exception that masks the primary error. The primary
canonical error and occurrence anchor are fixed before persistence begins.

If every open Part is durably converged, ContextOverflow returns the existing
`compact` result to SessionLoop. If Tool-part persistence itself fails,
Processor emits a typed `ProcessorConvergenceError`/infrastructure observation
that references the primary failure occurrence and exact unconverged Part IDs.
That Turn settles as a physical convergence failure and does not claim
compaction success or start another Turn with inconsistent Tool history. Both
primary and convergence evidence remain visible; the latter never replaces or
reparses the primary error. Processor does not create a retry or compaction
state machine.

#### Budget authority

- The final resolved Provider route/model record is the single predictive
  budget input. It binds Provider ID, requested model ID, API model ID, endpoint
  identity, catalog revision, and the exact `context/input/output` limits used
  by the actual streaming request. The pre-transform catalog model and final
  request route cannot diverge into two budget records.
- Limit semantics are explicit token counts:
  - `context` is the maximum combined prompt plus generated-output window;
  - `input` is an optional independent hard prompt maximum;
  - `output` is the provider-declared generated-output maximum; and
  - `effective_output` is `ProviderTransform.maxOutputTokens()` for this exact
    request and may only narrow `output`.
- The context-derived prompt budget is `context - reserved_output`, where
  `reserved_output` is the explicit configured reservation when supplied and
  otherwise the exact effective output allowance. When an independent `input`
  maximum and context maximum both exist, usable prompt budget is
  `min(input, context-derived budget)`; output reservation is not subtracted a
  second time from the independent input maximum. With authoritative input only,
  usable budget is input. With authoritative context only, it is the context-
  derived budget. With neither, predictive authority is unknown.
- Provider catalog refresh/bootstrap must project that route's authoritative
  context/input/output limits into the same model record used by SessionLoop.
- Predictive and reactive compaction continue to share `ContextBudget`.
- The estimator accounts for system blocks, visible model messages, Tool
  schemas, attachments/media estimates, and effective output reservation in
  the same units as the final route record.
- Do not invent a conservative threshold, dynamically learn a second limit, or
  switch models automatically.
- A Provider rejection without a reported maximum proves disagreement or
  estimation error but does not justify guessing the true boundary.
- When authoritative context/input metadata is unavailable, predictive budget
  status is typed unknown and no accuracy claim is made. The canonical reactive
  overflow path remains available; zero or stale catalog values cannot silently
  stand in for authority.

### D. Continuation input and Artifact handoff

The initial worker Turn contains one complete request. A continuation in the
same physical Session contains only:

- current visible implementation/repair guidance;
- source dispatch ID, child Session ID, workflow node, and logical occurrence;
- immutable Delivery Slice subjects when applicable; and
- exact Artifact locators or Catalog discovery constraints.

Every dispatch adapter that accepts `existingSessionID` must use the shared
initial/continuation projection contract. The first implementation priority is
Build because both measured incidents use that path. The complete current
production call-point inventory to converge is:

- `analyze-intent-tool.ts`;
- `architect-stage.ts`;
- `build-tool.ts`;
- `deep-research-stage.ts`;
- `delegated-worker-tool.ts`;
- `explore-tool.ts`;
- `fact-check-tool.ts`;
- `frontend-design-tool.ts`;
- `frontend-research-stage.ts`;
- `integrity-review-stage.ts`;
- `requirements-stage.ts`;
- `visual-qa-stage.ts`;
- `workload-analysis-tool.ts`; and
- their shared `dispatch-agent-tool.ts`,
  `dispatch-adapter-execution-context.ts`, and `tools.ts` construction paths.

Implementation repeats the repository search and treats any additional
production `existingSessionID` adapter as part of the same cutover; it cannot
remain on a second full-request continuation path.

The immutable Task row is the Task request/acceptance control authority. Its
exact initial visible text projection is named by
`task_authority.initial_user_message_id + initial_control_text_parts[{part_id,text_sha256}]`; it is
not a second authority. Compaction preserves original durable messages and
creates a temporary visible summary. In every compacted provider-visible epoch,
input selection projects those exact original Task-authority text Parts once,
then adds the natural progress/ref summary and recent visible tail while folding
old Tool chatter. Original file/image/media bytes are not re-injected; canonical
Attachment/Artifact locators remain visible and are read through their owners.
The summary does not restate or replace the Task contract and does not copy
Artifact bodies.

Workers obtain evidence through:

```text
artifact_search -> complete artifact_read -> artifact_select
```

The selected immutable revision, not a transcript copy or Task-latest selector,
is the semantic source for the next output.

### E. Orchestrator closure

Update the core prompt and Task-context projection together:

- explicitly label conversation-only terminal-message wakes;
- distinguish automatic expiry from operator rejection;
- render the newest terminal worker result and exact Artifact locators as a new
  execution decision epoch;
- give concrete `PARTIAL`, long-duration wait, operator-authority, accepted, and
  force-majeure examples; and
- state that incomplete narrative without a real next action is not an
  execution-pass closure.

Static prompt-string tests are insufficient. Acceptance requires an isolated
real Orchestrator stream with visible Tool results and durable protocol facts.
The ExportHub replacement flow is mandatory: a locally repairable blocker plus
an expired question produces a concrete continuation/repair dispatch; when the
missing fact is genuinely external, it produces one named wait. The durable
action result remains in the same Task and an expiry alone never justifies
force majeure.

### F. Process recovery and diagnostics

- The Tauri sidecar supervisor owns managed backend process-occurrence evidence
  because it spawns, waits, captures exit status, chooses shutdown actions, and
  owns the log path.
- Startup/bootstrap imports or references the exact supervisor evidence for the
  process occurrence it is replacing.
- Queue writes one recovery fact per Task and exact interruption occurrence. Its
  payload contains every ownerless affected Session/dispatch/workflow-occurrence
  identity and one optional exact supervisor-evidence locator. A different
  interruption occurrence creates a new fact; affected Sessions do not split
  one occurrence into duplicate facts.
- Queue never calls a TLS error, crash, signal, or user shutdown unless the
  supervisor record says so.
- Unmanaged processes explicitly retain unknown exit cause.

This observability batch explains future exits. It cannot retroactively explain
the historical backend interruptions in the three reports.

## Call-point disposition

| Surface | Disposition |
| --- | --- |
| `engine/queue.ts` queued payload/read/drain/dispatch | Parse strict ingress union; transport only; delete boolean semantic collapse and terminal reopen |
| `engine/task-message-open.ts` | Rename/narrow to explicit Task-intent transaction writer |
| `task-api/index.ts` ordinary message path | Persist/deliver without reopen |
| `task-api/index.ts` Retry/Replan | Become the only terminal-to-running writer; retire all old delivery notices atomically |
| `engine/terminal-task-conversation-runner.ts` (new bounded runner), `engine/queue.ts` | Run exact terminal ingress through root Session serialization, durable delivery completion, and restart drain without directory execution claim |
| `orchestrator/loop.ts`, `orchestrator/agent.ts` | Expose terminal conversation-only invocation authority and typed ingress rendering |
| `engine/state.ts`, terminal protocol event schemas, `engine/terminal-lifecycle-reference.ts` (new resolver) | Persist and resolve one canonical current terminal occurrence for completed, failed, interrupted, and cancelled Tasks; completion Artifact remains optional completed-only evidence |
| `respond_agent_coordination` | Add non-lifecycle `acknowledge_terminal` with exact terminal lifecycle reference and optional completion-decision Artifact |
| `orchestrator/tools.ts::withDecisionEffectMetadata`, `terminalTaskToolRefusal` | Validate exact terminal-conversation authority; admit only the matching non-lifecycle `acknowledge_terminal` call, preserve typed terminal conflicts for lifecycle/product actions, and direct recoverable work to same-Task explicit Retry/Replan |
| `prompt/core/orchestrator-core.txt` | Separate conversation reply from execution decision epoch; strengthen truthful closure semantics |
| `question/index.ts` | Add typed expiry; keep explicit rejection separate |
| `engine/interaction.ts`, `interaction-request.ts` | Persist/render answered, rejected, and expired exactly |
| `session/processor.ts`, coordination `ask_user`, `protocol/session-mirror.ts`, `config.ts` | Consume/project expiry as an ordinary typed resolution rather than rejection |
| protocol, routes, OpenAPI, generated Software Development Kits | Project the same interaction resolution contract |
| `session/message.ts`, `provider/error.ts` | Keep one raw Provider normalization authority |
| `session/tool-failure-cause.ts` | Add strict canonical Message-error projection; do not accept arbitrary raw objects |
| `session/processor.ts` | Normalize once, clean with canonical cause, then branch to compact/terminal |
| `session/loop.ts`, `context-budget.ts`, `compaction.ts` | Remain the sole predictive/reactive compaction control surface |
| Provider catalog/refresh projection | Make exact route model limits authoritative for SessionLoop |
| `orchestrator/tools.ts::openLineage`, `dispatch-adapter-execution-context.ts` | Derive and expose exact source/current dispatch, Session, workflow node/occurrence, Slice, and Task-authority anchors |
| `orchestrator/build-tool.ts`, `build/agent.ts` | Replace unconditional full-request rendering with the shared Turn projection |
| all other adapters with `existingSessionID` | Converge on the same incremental continuation contract |
| immutable Task row + initial visible user message | Remain the Task request/acceptance control authority and exact model-facing projection |
| Artifact Catalog tools | Remain the exact cross-Turn domain-evidence source |
| `packages/overlay/src-tauri/src/main.rs`, canonical `process-occurrences/` resources | Own managed backend occurrence allocation, atomic running/exited envelope, predecessor handoff, shutdown source, and log locator evidence |
| bootstrap/recovery fact production | Reference supervisor evidence when exact; otherwise preserve unknown cause |
| current architecture chapters 03, 06, 15, and 18 | Update after implementation; remove stale Orchestrator Retry/Replan writer claim |

## Atomic implementation plan

### Implementation execution audit (2026-08-04)

Batch 0 re-ran the production search before executable changes. The current
replacement owners and positive-test homes are:

| Batch | Production owners | Positive non-User-Interface test homes |
| --- | --- | --- |
| 1A | `engine/queue.ts`, `engine/task-message-open.ts`, `task-api/index.ts`, terminal protocol/state, Orchestrator event/agent/tools/interaction tools | `engine/queue.test.ts`, `engine/retry-wake-dispatch.test.ts`, `server/task-message-{routes,protocol-bridge}.test.ts`, `server/replan-routes.test.ts`, `orchestrator/operator-message.test.ts`, coordination lifecycle tests |
| 1B | `question/index.ts`, `engine/interaction.ts`, `interaction-request.ts`, Processor, coordination `ask_user`, Session mirror, config/routes/protocol | `question/question.test.ts`, `tool/question.test.ts`, `engine/interaction-{permission,request}.test.ts`, `engine/model-interaction.test.ts`, protocol/route tests |
| 2A | `session/message.ts`, `provider/error.ts`, `session/tool-failure-cause.ts`, `session/processor.ts`, `session/loop.ts` | `session/processor-duplicate-tool-call.test.ts`, `session/compaction*.test.ts`, focused Message error tests |
| 2B | `orchestrator/tools.ts::openLineage`, dispatch execution context, Build and every production adapter accepting `existingSessionID` | dispatch execution-context/tool tests, `orchestrator/session-reuse.test.ts`, adapter-specific continuation tests |
| 3 | Provider catalog/refresh/final request projection, `session/context-budget.ts`, compaction input projection | Provider model/refresh/budget tests, predictive/continuation/attachment compaction tests |
| 4 | Orchestrator core prompt, Task fact projection, real streamed decision path | natural-stop, acceptance, wait, operator-message, interaction and streamed fact-flow tests |
| 5/6 | Tauri sidecar supervisor, bootstrap predecessor import, Queue recovery | supervisor harness plus `engine/process-recovery.test.ts`, `session/dispatch-process-recovery.test.ts`, isolated replacement-backend harness |

The search also reconfirmed every production `existingSessionID` adapter listed
in the target design, plus the underlying Agent runners. Any additional adapter
found while changing that shared contract joins Batch 2B in the same cutover.
No knowingly failing fixture is added in Batch 0; each executable contract lands
with its owning behavior batch.

### Batch 0 — contract baselines and architecture convergence

1. Update current architecture chapters with the accepted boundaries.
2. Record the current executable call-point/test audit and assign each positive
   replacement contract to its behavior-owning batch.
3. Do not add unused fixtures or knowingly failing executable tests before their
   behavior lands. Each later behavior batch adds/updates its own positive tests
   atomically and passes them before commit.

Exit: current docs and the complete call-point/test audit express one target
contract; no executable schema or behavior is claimed repaired yet.

### Batch 1A — ingress provenance and lifecycle authority

1. Introduce the strict queued-ingress union at the existing persistence
   boundary.
2. Replace all readers with the same parser.
3. Remove ordinary message and coordination terminal reopen calls.
4. Narrow the Task-open writer to explicit Retry/Replan.
5. Make Retry/Replan retire every older pending delivery notice before writing
   the fresh intent, binding ordered unconsumed operator-message refs.
6. Implement the durable terminal-ingress runner through root Session
   serialization, including `acknowledge_terminal` coordination closure.
7. Bind every real terminal assistant/result to its ingress identity, make
   bootstrap settle an already-durable result without model replay, and settle a
   durable typed delivery failure as `delivery_failed`.
8. Carry the exact terminal-conversation authority through real Tool
   construction and narrow `withDecisionEffectMetadata` so the matching
   `acknowledge_terminal` call completes while lifecycle/product calls retain
   typed terminal conflict results.
9. Make every terminal writer emit and resolve the canonical current terminal
   lifecycle reference; keep completion-decision Artifact resolution optional
   and completed-only. Replace the stale terminal Tool refusal instruction with
   same-Task explicit operator Retry/Replan guidance for recoverable work.

Exit: completed Tasks remain terminal after old/new ordinary messages are
answered; explicit operator Retry/Replan alone starts execution.

### Batch 1B — interaction provenance

1. Introduce `Expired`/`ExpiredError` using the existing `expired` status.
2. Replace timeout-as-rejection production and every downstream projection.
3. Converge Processor, coordination `ask_user`, Session mirror, and config/docs
   consumers on the same expiry resolution.
4. Regenerate API and Software Development Kit contracts from the canonical
   source if public schemas change.

Batch 1A and 1B are independent and may be implemented in parallel.

Exit: automatic expiry and explicit rejection are distinct from Question Tool
result through durable EngineInteraction and protocol projection.

### Batch 2A — canonical error and reactive compaction

1. Add the strict canonical Message-error to ToolFailureCause projection.
2. Add the exact failure-occurrence anchor across assistant, Tool cause, and
   protocol event.
3. Reorder Processor catch convergence around that one error identity and add
   the typed Tool-persistence convergence-failure result.
4. Verify raw nested context overflow with an open Tool part reaches
   SessionLoop reactive compaction and continues the same Session.

### Batch 2B — incremental continuation input

1. Extend the lineage resolver/execution context with the exact source/current
   dispatch, Session, occurrence, Slice, and Task-authority schema.
2. Add the shared initial/continuation Turn projection.
3. Convert Build initial and continuation prompts.
4. Convert every enumerated adapter that accepts `existingSessionID`.
5. Verify the exact visible transcript equals the initial Task-authority message
   followed by ordered incremental guidance/locator Turns.

Implementation checkpoint on 2026-08-04 (implemented and independently
accepted in the Batch 2B record below): `openLineage` now resolves one
strict initial/continuation `DispatchTurn` containing current/source dispatch,
child Session, workflow node/occurrence, immutable Delivery Slice revisions,
and Task-authority anchors. Dispatch lineage persists the source adapter input;
same-occurrence continuation changes only explicit guidance fields and retains
the remaining adapter-specific evidence authority. All thirteen production
adapters and the in-process coordination continuation use the shared renderer.
The runner uses the canonical SessionPrompt materializer through file, Model
Context Protocol, AttachmentStore, and Plugin processing, records the final
message/control-text Part identities in `WorkerTurnDescriptor`, and accepts only
one incremental text Part for a continuation. Compaction projects those exact
control-text Parts and leaves original media bytes behind stable locators.

Checkpoint verification includes the shared projection/context contracts `2/2`,
the complete dispatch-agent contract `19/19`, the real Orchestrator lineage
continuation with exact Task authority and frozen adapter evidence, the real
runner initial/continuation visible-input sequence, the descriptor-bound
compaction authority projection, repository typecheck, the orchestrator tool
suite (`64/64`), runner suite (`11/11`), and compaction authority suite
(`15/15`). The final diff review below records the three independent reviewers'
acceptance after the later atomic-persistence and recovery-reservation
tightening.

Batch 2A and 2B are independent root repairs and may be implemented in
parallel. Both must land before closure benchmarks.

### Batch 3 — Provider budget authority and compaction projection

1. Verify the exact configured route/model identity through Provider catalog,
   refresh, Session model, and `ContextBudget`.
2. Correct the canonical limit projection where live authoritative metadata is
   available; do not infer missing limits.
3. Verify input-only, context-derived, Tool-schema/media-heavy, and
   lower-than-predicted rejection contracts against the final resolved route.
4. Verify predictive and reactive compaction use the same model record and that
   compacted provider input pins the exact initial Task-authority message once,
   followed by the progress/ref summary and recent tail.

Exit: the preflight uses truthful known limits, and reactive compaction remains
the reliable path when a Provider rejects below the declared prediction. When
authoritative metadata is unavailable, diagnostics explicitly report unknown
predictive authority while reactive canonical overflow still converges.

### Batch 4 — Orchestrator closure semantics

1. Update terminal conversation and active execution prompt contracts.
2. Project exact latest worker/Artifact/interaction facts without copied domain
   aggregates.
3. Run real non-User-Interface Orchestrator flows for expired local repair,
   named external wait,
   question expiry, completion, and force majeure.

Exit: every active execution pass produces a visible real next action or
truthful terminal decision; terminal diagnostic conversation answers without
reopening execution.

### Batch 5 — process occurrence observability

1. Define the supervisor-owned process-occurrence resource.
2. Record managed sidecar spawn, observed exit, shutdown source, and log locator.
3. Reference exact evidence from replacement-process recovery facts.
4. Preserve explicit unknown cause for unmanaged or unobserved exits.

Exit: future managed backend interruptions have attributable physical evidence;
Queue remains a recovery observer rather than a cause classifier.

### Batch 6 — integrated current-source benchmark and second review

1. Run a non-User-Interface supervisor harness with a controlled fake backend
   to verify occurrence allocation, atomic running/exited envelopes, exit code/
   signal/shutdown source, log locator, and predecessor handoff.
2. Run a separate replacement-backend recovery harness with a disposable
   database/project to consume the exact predecessor locator and bind it to the
   Task recovery fact.
3. Run an isolated current-source backend with a disposable database/project
   and a configured streaming Provider.
4. Exercise queued terminal conversation, explicit Retry/Replan, automatic
   question expiry, same-Session continuation, context compaction, process
   interruption, named wait, repair closure, and Task acceptance.
5. Inspect real protocol/session/artifact rows and visible messages.
6. Obtain independent diff and runtime-evidence review before final merge/push.

## Positive verification matrix

| Contract | Positive result |
| --- | --- |
| Wake A completes while ordinary message B is queued | B is delivered exactly once and answered; original completion timestamp and decision Artifact remain the terminal projection |
| Ordinary message arrives after completion | Root conversation emits a visible answer and Task remains terminal |
| Ordinary terminal message requests new product work | Root conversation emits visible explicit Retry/Replan control guidance and preserves the exact current terminal decision |
| Message arrives for completed, force-majeure failed, interrupted infrastructure-failed, or cancelled Task | Each root conversation resolves the exact current terminal lifecycle event, emits one visible status-correct answer, and preserves that terminal row; only the completed case additionally projects its matching completion-decision Artifact |
| Process exits after terminal assistant completion but before notice drain | Replacement bootstrap resolves the assistant's exact ingress-bound `TerminalIngressResult`, drains that notice, and the visible conversation contains one completed answer identity |
| Terminal delivery returns a durable typed failure | The notice settles as `delivery_failed`, the exact failure remains visible, and bootstrap projects that settled result as the one delivery outcome |
| Explicit operator Retry/Replan | One fresh typed intent is current, old delivery notices are retired, old source facts remain readable, and the same Task becomes running |
| Explicit Retry supersedes queued message B | Fresh intent provenance exposes B's exact message ID, the execution pass reads B through `read_task_message`, and its scheduling decision acts on that visible content |
| Active coordination request | Exact request ID is delivered and receives one durable response; restart reconstructs delivery from the same request |
| Coordination races with each terminal kind | For completed, force-majeure failed, interrupted infrastructure-failed, and cancelled fixtures, the real constructed Tool path admits exactly the ingress-authorized `acknowledge_terminal`, writes its conversation-delivery effect referencing the exact current terminal lifecycle event plus optional completed-only decision Artifact, and closes the same request |
| Terminal product Tool conflict reports recoverable work | The typed result identifies the current terminal lifecycle occurrence and directs the operator to explicit same-Task Retry/Replan; separate-Task guidance is reserved for evidence-proven separate scope |
| Automatic Question deadline | Waiting Tool receives typed expiry; EngineInteraction is `expired` with deadline/resolution times; model sees no operator decision |
| Explicit operator rejection | EngineInteraction is `rejected` with operator origin |
| Agent-to-Agent `ask_user` deadline | Coordination action durably resolves with `interaction_status=expired`, and the mirrored stream carries the exact `question.expired` occurrence |
| Nested Provider context error plus open Tool part | Tool part receives the canonical ContextOverflow failure; Processor returns compact; same Session continues after visible compaction |
| Ordinary non-overflow Provider error plus open Tool part | Tool part, assistant message, and protocol event preserve one canonical error identity |
| Tool cleanup persistence failure | Typed convergence evidence references the primary failure occurrence and exact unconverged Part IDs; the Turn settles with that complete causal result |
| Predictive budget overflow | Provider call is skipped; visible compaction completes; same Session continues |
| Final resolved Provider budget | Authoritative input-only, context-derived, Tool-schema/media-heavy, and lower-than-predicted Provider rejection fixtures each produce the expected typed budget/compaction result |
| Initial worker dispatch | One complete original request is visible in that worker Session |
| Multiple same-Session continuations | The complete visible transcript equals one initial request Turn followed by the ordered incremental guidance/locator Turns, all bound to the same Session/occurrence |
| Post-compaction Task authority | Provider-visible input contains the exact original durable user message ID once, plus progress/ref summary and recent tail, before incremental continuation |
| Large initial attachment followed by compaction | Provider-visible input contains the exact control-text Parts once and stable Attachment/Artifact locators, while original media bytes are not re-injected and the measured input budget decreases |
| Artifact handoff across compaction | In an initial -> continuation -> compaction -> continuation sequence, the worker completely reads/selects the same exact immutable revision and the next Artifact cites that source revision |
| `PARTIAL` with Task-owned repair | Real Orchestrator stream calls continuation `dispatch_agent` for the exact lineage |
| Repairable blocker after Question expiry | Real Orchestrator stream produces a durable same-Task repair dispatch; a genuinely external fact instead produces one named wait |
| Long-duration verification only | Real Orchestrator stream creates one named wait; wake resumes the same Task |
| Accepted evidence | Typed completion decision references exact current evidence |
| Proven irreducible external condition | Typed force-majeure terminal event carries exact blocker evidence |
| Managed backend exit | Supervisor record contains observed exit/shutdown/log facts and recovery references it |
| Unmanaged interruption | Recovery succeeds with explicit unknown physical cause and unchanged Task business authority |

These tests assert current positive output/state/event contracts. They must not
be written as absence-only assertions. Any touched existing negative test must
be deleted or rewritten to assert the positive replacement contract. UI
acceptance, if a visible surface changes, remains real-page interaction and
manual screenshot review only.

## Deletion and cutover rules

- Delete generic terminal operator-wake reopen imports and helpers after the
  explicit intent writer is in place.
- Delete timeout-as-rejection production and tests in the same batch that adds
  typed expiry.
- Delete unconditional full-request continuation rendering when the shared
  Turn projection lands; do not retain a feature flag or compatibility mode.
- Delete raw Provider-object parsing from Tool cleanup consumers.
- Delete stale architecture/prompt wording that grants Retry/Replan to an
  ordinary message or Orchestrator terminal conversation.
- Do not retain dual queued-wake readers, dual interaction outcomes, dual model
  limit sources, or dual continuation prompts.
- No existing database is rewritten. If a later implementation genuinely
  changes DDL, it must update the single current DDL and require an explicitly
  authorized fresh database under the repository's current schema policy.

## Risks and explicit unknowns

- The exact historical backend exit cause is unknown. Process observability can
  repair future attribution only.
- The exact historical TLS certificate-verification cause is unknown and is not
  part of Task lifecycle semantics.
- The Provider's real context maximum in the FieldFlow failure is unknown. The
  response proved catalog/runtime disagreement or estimator undercount but did
  not disclose the true limit.
- Long context is a confirmed shared risk and a FieldFlow direct cause. It is
  not proven to be the sole reason the IoT Orchestrator ignored its closure
  prompt.
- A terminal conversation-only pass is required to avoid swallowing messages
  after terminal reopen is removed. It must reuse root Session serialization
  without claiming execution-queue ownership or persisting a second Task state.
- Process evidence for managed Tauri sidecars cannot be generalized to
  unmanaged CLI/API processes by inference; those remain explicitly unknown.

## Rejected designs

- `active + idle + all workers terminal -> auto retry/fail/complete` Host rule;
- discarding or indefinitely parking terminal Task messages;
- reopening every terminal Task that receives any operator/coordination wake;
- message keyword or age classification for Retry/Replan;
- preserving both event inference and `source_kind` readers;
- wrapping automatic timeout as Rejected plus optional metadata;
- accepting arbitrary nested error objects in ToolFailureCause conversion;
- Processor-owned retry/compaction state machines;
- guessed safety context limits or automatic model fallback;
- full-request and incremental continuation prompt feature flags;
- copying Artifact bodies into continuation prompts or compaction memory;
- Queue inference of crash/TLS/shutdown cause; and
- database migration/compatibility code for an already-declared `expired`
  status.

## Plan acceptance conditions

The plan is accepted only when:

1. both independent reviewers have reviewed this exact file, not only the
   incidents or their own proposals;
2. all blocking boundary conflicts are incorporated or explicitly rejected with
   evidence;
3. documentation indexes and health checks pass;
4. only plan/index files are committed; and
5. the commit is pushed to the git-cc `myhexin` remote with the required
   `dsw-33987` subject prefix.

## Independent review of the on-disk plan

### Review round 1

The lifecycle reviewer reported two blocking, two high, and two medium findings:

- terminal conversation had semantics but no concrete restart-safe runner or
  terminal-coordination response;
- Retry/Replan retired delivery notices without binding unconsumed operator-
  message identities into the fresh intent;
- expiry consumers in Processor, coordination, Session mirror, and config were
  incomplete;
- the ExportHub replacement test stopped before proving a real next action;
- terminal `orchestrator_message` disposition was unspecified; and
- the positive matrix omitted a natural-language new-work request on a terminal
  Task.

The Session/runtime reviewer reported two blocking, five high, and three medium
findings:

- compaction could have made a lossy natural summary the original Task contract
  authority;
- supervisor process evidence lacked a complete allocation/store/finalization/
  predecessor protocol;
- canonical errors lacked a durable failure-occurrence anchor;
- Tool cleanup persistence failure had no complete outcome;
- the continuation context lacked exact source-lineage fields and an exhaustive
  adapter inventory;
- Provider budget semantics did not define the final resolved route or the
  context/input/output relationship;
- Batch 0 proposed pre-implementation executable fixtures;
- supervisor and backend recovery needed separate harnesses;
- Artifact selection needed post-compaction revision provenance; and
- unknown Provider limits needed an explicit typed outcome.

### Revisions after round 1

The plan now:

- defines one durable `TerminalTaskConversationRunner`, exact notice settlement,
  replacement-process drain, terminal coordination `acknowledge_terminal`, and
  explicit terminal union dispositions;
- binds ordered unconsumed message IDs into the fresh operator intent;
- enumerates every known expiry consumer and requires a real post-expiry repair/
  wait action;
- separates immutable Task control authority from Artifact domain-evidence
  authority and pins the exact initial visible user message in each compacted
  provider epoch;
- defines the exact lineage/Task-authority execution-context schema and complete
  current adapter inventory;
- anchors assistant, Tool, and protocol errors to one Session/assistant-message
  failure occurrence and defines Tool-persistence convergence failure;
- defines final resolved-route limit semantics and typed unknown predictive
  authority;
- defines the supervisor-owned atomic occurrence-envelope protocol, access,
  predecessor handoff, and retention without Tauri database writes;
- moves executable positive tests into their behavior-owning atomic batches;
- splits supervisor and replacement-backend harnesses; and
- expands the positive matrix for post-compaction authority/evidence,
  superseded-message reads, expiry repair, cleanup failure, and natural-language
  new-work guidance.

### Review round 2

The lifecycle reviewer confirmed the round-one high/medium findings were closed,
then reported three blocking and two high findings:

- an assistant result durable before notice drain had no ingress-bound identity,
  so bootstrap could replay the model;
- superseded operator-message IDs were not carried into the real
  `read_task_message` authorization surface;
- the current terminal scheduler-Tool guard would reject
  `acknowledge_terminal` before the Tool could execute;
- the strict operator-intent schema omitted the superseded-message field; and
- durable delivery failure was incorrectly left pending for mechanical replay.

The Session/runtime reviewer confirmed every round-one finding was closed, then
reported one high and two medium findings:

- re-injecting the complete initial user message after compaction could restore
  large attachment/media bytes and defeat compaction;
- process-log cleanup could leave a dangling occurrence locator; and
- recovery facts needed one fact per Task and interruption occurrence, not one
  duplicate fact per affected Session.

### Revisions after round 2

The plan now:

- binds every real assistant/coordination/passive terminal result to the exact
  ingress identity before delivery, settles it transactionally, and makes
  bootstrap converge an already-durable result without another model call;
- distinguishes an interrupted attempt with no durable result from a settled
  typed `delivery_failed` result that is not mechanically replayed;
- adds ordered superseded-message identities to the strict operator-intent
  schema and carries their exact authorization set through event rendering,
  Agent Tool construction, and `read_task_message`;
- defines exact `TerminalConversationAuthority` and narrows the real
  `withDecisionEffectMetadata` path solely for the matching non-lifecycle
  `acknowledge_terminal` call;
- names the initial control-text Part IDs separately from attachment/media
  content, keeps media behind stable locators after compaction, and adds a
  measured large-attachment budget contract;
- ties process-log retention to every referencing occurrence envelope and makes
  explicit maintenance record `expired_by_maintenance` before removal; and
- emits one recovery fact per Task and exact interruption occurrence containing
  the complete affected Session/dispatch set.

### Review round 3

The Session/runtime reviewer accepted the exact round-three file with no open
finding. The lifecycle reviewer confirmed all round-two findings were closed,
then reported one new blocker and one medium finding:

- terminal conversation authority incorrectly required a completion-decision
  Artifact although failed, interrupted, startup-failed, and cancelled Task
  terminal writers do not create that Artifact; and
- the current terminal Tool refusal directs every follow-up to a new Task,
  contradicting explicit same-Task operator Retry/Replan for recoverable work.

### Revisions after round 3

The plan now uses one canonical terminal lifecycle event reference emitted by
the terminal transaction and strictly matched to the current Task row for every
terminal kind. A completion-decision Artifact is optional completed-only
evidence. Terminal conversation, coordination acknowledgement, Tool admission,
and positive tests cover completed, force-majeure failed, interrupted
infrastructure-failed, and cancelled occurrences. The Tool conflict result now
directs recoverable work to explicit same-Task Retry/Replan and reserves a new
Task for evidence-proven separate scope.

### Review round 4

Both independent reviewers accepted the exact revised technical plan:

- the lifecycle reviewer confirmed the round-three blocker and medium finding
  were closed and reported no blocker, high, medium, or low finding; and
- the Session/runtime reviewer confirmed the terminal-authority revision did
  not disturb the previously accepted error, compaction, continuation, Provider
  budget, Artifact, or process-evidence boundaries and reported no blocker,
  high, medium, or low finding.

The accepted disposition is one implementation architecture with no retained
review exception.

## Implementation execution

### Batch 0 — architecture baseline (complete)

- Converged the control, Provider, Agent fact/Turn, and automation architecture
  documents on the accepted ownership boundaries.
- Validated historical links, document health, product-doc single source, and
  `docs:check`.
- Committed and pushed the baseline plus the concurrent review-record merge to
  git-cc.

### Batch 1A — typed ingress and terminal conversation (complete)

- Replaced the loose queued-wake payload with one strict discriminated ingress
  union and one strict Orchestrator event schema.
- Removed ordinary message, goal mutation, and internal wake Task reopening.
  Only explicit operator Retry/Replan now reopens a terminal Task.
- Made Retry/Replan atomically retire all older pending ingress, carry ordered
  superseded operator-message IDs, and authorize exact `read_task_message`
  reads for those IDs.
- Added exact completed, failed/interrupted, and cancelled terminal lifecycle
  event references matched to the current Task row.
- Added the durable terminal conversation runner, ingress-bound assistant
  provenance, typed delivery settlement, replacement-process convergence, and
  terminal coordination `acknowledge_terminal` action.
- Preserved terminal lifecycle for ordinary message/inject requests, including
  when another same-directory Task is active.
- Positive validation completed so far: queue authority `10/10`, task-message
  routes `24/24`, retry/replan routes `6/6`, exact terminal lifecycle `1/1`,
  terminal acknowledgement `1/1`, terminal protocol projections `3/3`, and
  focused message/intent/Tool projection tests. Package typecheck passes.

#### Independent implementation review

The Session/runtime and lifecycle reviewers performed three full read-only
review rounds plus one final narrow lifecycle audit. Their first implementation
review rejected premature delivery settlement, missing durable assistant
recovery, optional occurrence matching, cancellation replay, and insufficient
real-path tests. The implementation was revised to:

- resolve the ingress result, completed terminal acknowledgement action, and
  completed assistant through one candidate collector with typed conflict
  detection;
- require a real Task-child Orchestrator Session, exact persisted assistant,
  and matching `taskIngress` before an acknowledgement action can prove
  delivery;
- map a completed error assistant to typed `delivery_failed` and recover a
  completed action without another model invocation;
- require every settlement to compare-and-set the exact pending notice while
  matching the exact current terminal lifecycle occurrence;
- preserve the Retry/Replan `discarded` winner and serialize concurrent Retry
  and Replan controls to one accepted execution occurrence;
- rethrow canonical cancellation before any delivery-failure write, preserve
  the pending notice, and stop the completion hook from immediately replaying
  it; and
- keep old terminal-conversation authority restrictive after a concurrent
  operator Retry opens the Task.

The final Session/runtime review reported no blocker, high, or medium finding.
The final lifecycle review reported no blocker, high, or medium finding and
specifically verified the running `cancelRootWakeQueue` window before and after
Task-loop execution.

Final Batch 1A verification includes:

- focused lifecycle, queue, runner, Retry/Replan, route, message, Session reuse,
  and Tool contracts: `64/64` before the final review fixes, followed by
  `23/23` focused lifecycle/runner/concurrent-route contracts and the exact
  terminal Tool/recovery contract `1/1`;
- real action-completed crash recovery with no second model invocation,
  completed assistant error settlement, multi-candidate integrity failure,
  Retry/discard settlement ownership, running root-wake cancellation, and
  concurrent Retry/Replan unique-winner contracts;
- repository typecheck, package typecheck, `api:routes-check`, and generated
  OpenAPI agreement; and
- historical links, document health, product-document single source, and
  `docs:check` (`70/70` focused documentation tests).

### Batch 1B — interaction provenance (complete)

- Split unanswered automatic deadline expiry from explicit operator rejection:
  `expired(origin=deadline)` and `rejected(origin=operator)` now remain distinct
  through Question, EngineInteraction, IntentAnalysis, Tool metadata, Session
  projection, OpenAPI, and the generated Software Development Kit.
- Persisted the exact Question creation time and deadline contract so Agent to
  Agent `ask_user` recovery reuses the same occurrence instead of resetting an
  in-memory timeout.
- Bound recovered Agent to Agent questions to the exact action, deterministic
  question ID, interaction ID, Task, Session, Question payload, Tool call, and
  expiry. A half-recorded question/interaction binding now fails as an explicit
  integrity error.
- Made terminal interaction writes compare-and-set the exact ID, external ID,
  Session, request type, and pending status. Question answer, rejection, expiry,
  and infrastructure abandonment share the same Question/Session/type authority
  check; abandonment removes only the exact pending projection.
- Made local Bus publication a three-boundary occurrence: exact-type subscribers
  complete first, wildcard projections run only after exact persistence succeeds,
  and GlobalBus emits only after both local phases succeed. Question waiters are
  settled only after that durable local publication succeeds.
- Added real Mission Session-bridge evidence for a wrong-Session terminal event,
  the canonical answered winner, and a later expiry compare-and-set loser. The
  complete database, Task protocol, Session ephemeral stream, and GlobalBus
  projection contain only the canonical asked/answered occurrence.

#### Independent implementation review

The lifecycle and Session/runtime reviewers performed four read-only review
rounds. Earlier rounds rejected incomplete Agent to Agent provenance, restart-
reset deadlines, non-atomic pending resolution, fire-and-forget terminal Bus
publication, false abandonment projection, and concurrent exact/wildcard Bus
delivery. Each finding was repaired at its owning data or publication boundary;
no SessionMirror query gate or compatibility path was added.

Both final independent reviews report `ACCEPT` with no blocker, high, or medium
finding. They independently verified the exact-to-wildcard-to-global Bus order,
Question waiter settlement after persistence, complete terminal ownership,
strict half-binding rejection, and the real Mission Session projection test.

Final Batch 1B verification includes:

- Question contracts `24/24`; interaction writer `2/2`; interaction provenance
  and real Bus race `2/2`; Agent to Agent `ask_user` live, expiry, abandonment,
  pending recovery, settled recovery, and integrity contracts `6/6`;
- Session mirror `17/17`, Question Tool `3/3`, IntentAnalysis follow-up `2/2`,
  Panel projection `3/3`, and Mission surface continuity `2/2`;
- package and repository typecheck, `api:routes-check`, generated OpenAPI and
  Software Development Kit agreement, and `docs:check`; and
- historical links `2/2`, product-document single source `8/8`, and document
  health `60/60` (the two Windows-loaded cases were rerun with an explicit test
  runner timeout and passed).

### Batch 2A — canonical Provider failure and reactive compaction (complete)

- Made `Message.fromError` the sole raw Provider-error parser. Processor caches
  that canonical result at the activity classification boundary and projects
  Tool failure causes from it without reparsing the raw Provider object.
- Added one strict failure occurrence
  (`session_id + assistant_message_id + error_name`) shared by the Assistant,
  affected Tool failures, `session.error`, protocol projection, OpenAPI, and
  the generated Software Development Kit.
- Made open Tool convergence all-attempt and database-readback based. Physical
  unconverged IDs, terminal-write/publication errors, and inspection failure
  are distinct typed evidence; a successful write call that silently retains a
  different terminal occurrence is still reported as physically unconverged.
- Preserved the primary Provider failure when Snapshot patch observation fails,
  and stored that secondary failure as typed observation evidence.
- Retained failed Assistant and Tool rows through reactive compaction, projected
  their canonical failure evidence into the compaction transcript, and selected
  the complete post-authority failed Turn for overflow compaction even when it
  is the only recent Turn.
- Preserved the Processor occurrence when the reduced compaction Provider call
  itself overflows. A later same-source overflow keeps its second canonical
  occurrence and appends a visible stop decision instead of overwriting it.
- Deleted the unreachable Session-kind automatic-compaction policy/gate and its
  negative source tests. Every schema-valid persisted Session now uses one
  compaction control path.

#### Independent implementation review

Two Session/runtime reviewers independently audited the implementation. The
first rounds rejected secondary Snapshot masking, pre-binding Tool inspection
failure, compaction error overwrite, ambiguous post-commit Tool writes,
optional cross-field occurrence drift, missing protocol projection evidence,
an unsafe refined-Zod `.extend()`, incomplete overflow transcript assertions,
and a silent terminal-drift hole. Each issue was repaired at the owning schema,
persistence, or compaction boundary. The final protocol schemas use cross-field
refinement and `safeExtend`; Tool convergence always performs physical DB
readback after every attempted terminal write.

The final persistence/protocol reviewer reports `ACCEPT` with no blocker, high,
or medium finding. The final compaction/continuation reviewer reports `ACCEPT`
with no blocker, high, or medium finding.

Final Batch 2A verification includes:

- canonical Provider/convergence/secondary-overflow contracts `7/7`;
- real Provider overflow -> visible compaction -> same-Session second Turn ->
  second already-compacted overflow, with exact authority/transcript/Tool/event
  occurrence assertions `1/1`;
- Processor duplicate Tool contracts `16/16` before the final physical-readback
  tightening; the one Windows timing-sensitive abort contract was rerun alone
  and completed with the expected `stop` and canonical abort cause;
- compaction contracts `10/10` and compaction-control/descriptor contracts
  `17/17`;
- focused Message error `7/7`, protocol Session mirror `1/1`, and protocol
  message bridge `1/1`;
- generated OpenAPI/Software Development Kit agreement, package and repository
  typecheck, `api:routes-check`, and `docs:check`.

### Batch 2B — incremental continuation input (implemented and accepted)

- Deleted direct coordination `continue` / `continue_worker`; every worker
  continuation is now a `redispatch_worker` action followed by one explicit
  `dispatch_agent` successor.
- Split initial adapter schemas from the common continuation envelope. The
  source adapter input is restored as one canonical deeply frozen value;
  continuation adds only current guidance and exact typed evidence locators.
- Added strict `DispatchTurn` authority for dispatch, Session, complete package
  and workflow binding, occurrence, Delivery Slice revisions, same-Task
  evidence, durable Task digest, and hashed initial control-text Parts.
- Split physical Session observation from logical dispatch commit. Canonical
  SessionPrompt materialization retains file/MCP/AttachmentStore/Plugin
  semantics; its final message, every Part, the Turn descriptor, lineage, and
  coordination successor now commit in one database transaction. Runtime
  installation occurs only after that transaction. A pre-commit process exit
  cannot leave an orphan logical occurrence, unbound descriptor, or descriptor
  whose Task anchor names a missing initial message.
- Made continuation visible input exactly one incremental text Part and made
  every descriptor bind its current post-Plugin message/text-Part hashes while
  compaction preserves the separate initial hashed control-text authority
  across newer continuation descriptors. Missing descriptor authority fails
  closed.
- Recovery now includes ownerless Agent Sessions whose durable lifecycle has
  not yet reached its first status event. Both Session-created/pre-authority and
  authority-committed/pre-streaming crash cuts are terminalized before the root
  Task wake is delivered. Reused Sessions additionally bind each descriptor to
  the exact prior lifecycle event, so a continuation committed after an old
  `idle`/`terminal` fact but before its first current-Turn status is recovered
  as the distinct `prepared` occurrence. The isolated recovery contract passes
  `3/3` with an explicit Windows-safe 20-second per-case budget.
- Closed the third-review provenance and concurrency findings: materialized
  messages are runtime-branded, recursively frozen, and one-use; their only
  descriptor augmentation consumes the canonical payload and mints a new
  frozen authority-bound payload. Post-Plugin Part IDs and authority Part IDs
  must be unique. Runtime replacement plus the new message-write claim is one
  synchronous handoff; that claim remains held across `onRuntimeReady` and is
  consumed by the canonical SessionPrompt continuation. Ordinary SessionPrompt
  uses the same uninterrupted claim from materialization through the real loop.
- The lifecycle anchor read and message/descriptor write now share one outer
  SQLite transaction. This removes both same-process and cross-process event
  publication gaps between the prior-event identity and durable Turn authority.
  The transaction path uses a synchronous row/commit primitive; post-commit
  message hydration and opaque receipt creation are separate, so callback
  errors synchronously roll back the complete authority bundle. The prepared
  prompt is also consumed and re-minted with the final descriptor-bound input
  fingerprint before runtime installation.
- Incompatible-descriptor recovery now rechecks the current Task and prompt
  owners before any write, requires the entire Task to have no prompt owner,
  reserves the Task root against concurrent wakes, waits for the cancelled root
  queue to become idle, reserves prompt start for every existing Task Session,
  and rechecks complete evidence before terminalization. Ordinary recovery also
  holds an all-Task prompt-start reservation across its final owner/evidence
  read, fact commit, and Session terminalization, releasing it before root wake
  delivery.
  Recovery reason text names all durable
  interruption evidence instead of falsely claiming every case has a
  `streaming`/`retry` event.
- Independent implementation review rejected earlier candidates for direct
  Session append, partial adapter-input merge, initial/latest descriptor
  identity conflation, shallow input freezing, incomplete package/node checks,
  cross-Task evidence locators, extra initial text Parts, and pre-descriptor
  lineage publication. Each finding was repaired at its owning boundary.
- Three one-level, read-only reviewers independently re-audited the final
  implementation. The lifecycle/dispatch reviewer, Session/runtime reviewer,
  and deep atomicity/recovery reviewer all returned `ACCEPT`, with no blocker,
  high, or medium finding. The deep review specifically verified synchronous
  rollback of the complete message/Parts/descriptor/lineage bundle, post-commit
  hydration only, uninterrupted opaque runtime-claim ownership, exact evidence
  reread under the all-Task Session-start reservation, and reservation release
  before root-wake delivery.
- Final verification passed repository typecheck across all ten packages
  (`8/8` typecheck tasks), `api:routes-check`, `docs:check`, historical document
  links (`2/2`), runner atomicity/continuation (`12/12`), isolated process
  recovery (`3/3`), and the focused dispatch-lineage, compaction-anchor,
  wake-ownership, and root-reservation contracts.
