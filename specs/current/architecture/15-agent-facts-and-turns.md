# 15 — Agent Facts, Prompt Projection, Turns, And Handoff

Status: Current
Date: 2026-07-24
Owner: Codex

## Current Delivery Slice addendum (2026-08-01)

The user-facing Goal is now a versioned Delivery Slice contract. Task is the
sole business-lifecycle owner; Session/dispatch lineage owns physical
execution. Workflow nodes are instantiated once per Task. One fixed-Squad Task
is one Mission Phase. A physically interrupted mandatory node continues through
its exact bound lineage; Build never substitutes for that node's evidence. Once
every mandatory node and the package Build owner's initial occurrence succeed,
a downstream `blocking` product or final-deliverable finding may dispatch the
same Task's exact package-owned Build owner once as Phase closure. The
Orchestrator first inspects immutable lineage; an existing closure is continued
or judged rather than allocated again. The owner completes repair and affected
verification without restarting other nodes or publishing a parallel canonical
Build Artifact, while preserving
unrelated commits and making reversible evidence-backed assumptions. Mission
does not create correction, retest, or final-review phases. Advisory-only
Integrity concerns remain acceptable residual-risk evidence and dispatch no
repair. Task failure requires proven external authority, destructive approval,
different-Squad ownership, or an irreducible product decision. Slice revisions may
be evidence subjects but never own attempts, results, retries, workspaces,
terminal refill, or mutable status. Goal panel data is a read-only projection of the current Slice revision,
independent activity/evidence/review associations, and explicit acceptance from
the Task Completion Decision. These facets never combine into Goal lifecycle.
This addendum supersedes the older Goal-attempt and
terminal-refill descriptions retained below as design-history context.

## Current Task ingress, Session continuation, and closure addendum (2026-08-04)

Task ingress follows one strict `source_kind` union: `operator_message`,
`orchestrator_message`, operator `taskIntent`, `mission_acceptance_resume`, `coordination_request`,
`infrastructure_recovery`, `task_wait_activity`, or `orchestrator_event`.
Queue transports and drains these facts; it never collapses them into a boolean
“operator wake” or changes Task lifecycle. Ordinary terminal messages run one
serialized root-Session conversation Turn and keep the Task terminal. Explicit
operator Retry/Replan and evidence-backed Mission acceptance resume are the two
typed terminal-to-running authorities. The former carries ordered refs to any
superseded unconsumed operator messages. The latter carries the exact Mission,
Panel ToolPart, visible Task-root message, reviewed terminal occurrence, and
fully read Artifact locators; it preserves Task/root Session/profile/workflow
identity and historical terminal/Completion Decision facts. Cancelled Tasks do
not admit Mission resume.

The immutable Task row and its exact initial visible control-text Part identities and SHA-256
(Secure Hash Algorithm 256-bit) content digests are Task request authority. Artifact Catalog immutable revisions are cross-Turn and
cross-Agent domain-evidence authority. A natural compaction summary is visible
narrative only. Initial worker input contains the complete request once;
same-Session continuation contains current guidance, exact source/current
dispatch and workflow-occurrence anchors, Delivery Slice subjects, and Artifact
locators. It does not repeat the complete Task request or copy Artifact bodies.
Every persisted descriptor also binds the current visible user message ID and
the exact post-Plugin text Part IDs/SHA-256 digests. The initial descriptor
requires that current-message authority to equal the Task-authority anchor;
continuation descriptors preserve the initial anchor and bind their own single
incremental text Turn separately.
`openLineage` is the single resolver for that immutable Turn authority. The
source adapter input is retained unchanged in dispatch lineage. The model-visible
tool has one target-discriminated request per projected Agent and a nested
`turn.kind` discriminator: `initial` owns the workflow subject and exact adapter
input, while `continuation` owns one typed lineage authority, `guidance`, and
typed `evidence_locators`. A continuation cannot resubmit or selectively overwrite
adapter-specific authority. Every typed adapter projects the resulting strict
`DispatchTurn` through the same renderer. Coordination has no direct Session
append path: `redispatch` records the pending action, and `dispatch_agent` with
that exact action identity creates the successor lineage and Turn.
The canonical database DDL requires `dispatch_lineage.adapter_input` to be an
exact JSON (JavaScript Object Notation) object and makes the lineage row
immutable. Any future breaking lineage-payload change must change that DDL
constraint in the same commit together with an exact predecessor-fingerprint
migration so an older non-empty database is transformed transactionally before
Task, Board, Conversation, or continuation projection. Unknown drift fails as
`SCHEMA_MIGRATION_REQUIRED`; a compatibility reader or inferred adapter input
is never valid authority.

Physical Session observation and logical dispatch publication are separate
boundaries. `onSessionCreated` records only the physical child identity for
error attribution. The canonical SessionPrompt materializer first completes
file, Model Context Protocol resource, AttachmentStore, and `chat.message`
Plugin processing without writing a partial message. One SQLite transaction
then persists the final user message, every Part, its Turn descriptor, dispatch
lineage, and any coordination successor. `onRuntimeReady` observes later physical runtime
availability and owns no lineage write. A crash before that transaction
has no logical workflow occurrence and can safely dispatch again. A crash after
it has a message-backed descriptor and lineage closure that process recovery can continue.
Materialized message and prepared-runtime claims are process-opaque, one-use
objects. The materialized payload is recursively frozen; descriptor attachment
consumes it and mints one new frozen authority-bound payload, so structural
callers cannot swap fields after canonical Plugin materialization.
The runner synchronously replaces the empty runtime with the descriptor-bound
runtime and acquires the new message-write claim before yielding. It retains
that claim through `onRuntimeReady` and transfers it to SessionPrompt, so no
second prompt can enter between authority commit and prompt-owner creation.
Post-Plugin Parts must also have unique identities before persistence.
Process recovery treats a Task-tree Agent Session with no lifecycle event and
no current-process prompt owner as durable `created` interruption evidence, in
addition to `streaming` and `retry`. It terminalizes both the pre-authority and
post-authority/pre-stream crash cuts before delivering the root Task wake.
Every descriptor records the exact prior Session lifecycle event. If a
continuation descriptor is newer but the latest event still equals that prior
event, recovery classifies the exact unstarted continuation as `prepared` even
when the previous Turn ended `idle` or `terminal`. Any current-Turn lifecycle
publication advances the event identity and ends that recovery claim.
The prior-event read and the message/descriptor write share the same outer
SQLite transaction, so another process cannot publish a lifecycle event into
the authority gap. Transaction-owned message persistence is synchronous;
message hydration and receipt creation happen only after commit, so a Part,
descriptor, lineage, or coordination callback failure propagates into the
outer rollback instead of crossing an asynchronous Promise boundary.
The prepared prompt is consumed and re-minted with the final descriptor-bound
input fingerprint before runtime installation. Recovery writes no ownerless fact while any Session in the
Task owns a current-process prompt. Incompatible recovery cancels and awaits
the root wake queue, reserves prompt start for every existing Task Session,
then re-reads Task state, owners, and exact interruption evidence before its
first write. Ordinary recovery holds the same all-Task prompt-start reservation
from its final evidence read through Session terminalization, releases it, and
only then delivers the queued root wake.
The lineage origin owns a canonical deep clone of adapter input; nested caller
or executor mutation cannot rewrite it. Continuation locators are accepted only
after exact same-Task readability validation.

The worker runner preallocates the input identities, then derives the initial
Task-authority anchor from the final post-Plugin text Part set, stores it in
`WorkerTurnDescriptor`, and binds
the same descriptor reference to the visible user message. A continuation must
match the durable Task row, prior descriptor's hashed control-text authority,
source dispatch, child Session, complete workflow binding/node/occurrence, and
ordered Delivery Slice subjects before model contact. Its visible input is exactly one
incremental text Part; stage-specific full-request builders and attachment byte
materialization belong only to the initial Turn. After compaction, the durable
anchor projects only descriptor-named text whose content hash still matches;
missing, stale, extra-text, or mismatched projected-worker authority fails with
`CompactionTaskAuthorityError`. Attachment and Artifact bytes remain behind
their canonical locators. After later continuation Turns create newer
descriptors, compaction validates that the initial anchor descriptor and latest
descriptor carry the same complete Task authority; their descriptor identities
are intentionally different.

`Message.fromError` is the only raw Provider-error parser. Assistant error,
affected Tool failure causes, and Session protocol error share
`session_id + assistant_message_id + canonical discriminant`. Tool cleanup
converges open Parts from that canonical error before SessionLoop chooses
reactive compaction or terminal settlement. Compaction projects the original
control-text Parts once, retains stable attachment/Artifact locators, and does
not re-inject original media bytes.

Managed cancellation is a canonical physical error occurrence rather than a
generic stream failure. `SessionPromptState` constructs one
`ExecutionCancellationError` from the initiating boundary's strict origin and
uses that same object for the prompt owner and activity monitor. The Large
Language Model activity layer preserves the external AbortSignal reason as the
cause of `LLMActivityAbortedError`; `Message.fromError` then serializes the
origin into `MessageAbortedError`. Assistant completion, Tool convergence,
Session status publication, and the existing `session.error` protocol bridge
therefore observe the same origin without a second table, event writer, or
compatibility reader.

Convergence reports physical state only after database readback: a terminal
Part whose write committed but whose update event failed is terminal, while
the publication failure remains separate observation evidence. Open-Part
inspection failure records unknown physical scope instead of inventing Part
IDs. Snapshot/patch observation failure is secondary typed evidence and cannot
replace the canonical assistant error. Every schema-valid Session kind uses
this same compaction route; the retired Session-kind eligibility policy and
its unreachable disabled branches do not exist.

Worker Turn completion, worker terminal status, reviewer verdict, Task
acceptance, and Task lifecycle remain distinct facts. Every active Orchestrator
decision epoch ends with a real dispatch, coordination response, question,
named wait, completion, or proven force-majeure failure. Narrative `finish=stop`
does not close an active execution epoch. Host code must not infer a decision
from idle time, text, worker cardinality, or terminal children.

## Recall

### User request

Systemically refactor OpenCorvus Agent input, domain-output, physical-run
completion, and result handoff protocols. Remove the authority overlap among
`AgentContextPacket`, Build evidence Pack/Manifest round-trips, per-domain
terminal report/finalizer tools, generic `AgentReport`, trace reports, and
Host-observed git/test facts. The result must use durable facts, ephemeral
prompt projection, real domain artifacts, physical Agent-turn observations,
visible final assistant messages, Host observations, and natural Orchestrator
judgment.

The 2026-07-24 follow-up additionally requires restart-safe targeted operator
steer. A Session/Trace is a durable identity and fact container, a Turn/Attempt
is one model execution, and Runtime is disposable process-local execution
machinery. Losing `SessionRuntimeContract`, stream, `AbortController`, Model
Context Protocol connection, or callback state must never invalidate the
Session or prevent a durable coordination request. Operator steer must freeze
the target from the persisted `WorkerTurnDescriptor`, write the request, and
wake the Orchestrator. Only explicit in-flight injection/continuation may
require the old Runtime.

### Acceptance criteria

- `AgentContextPacket` is not a domain fact, handoff authority, retry payload,
  or dispatch gate.
- Prompt input is rendered from visible text plus stable Artifact, Finding,
  and Attachment references. The renderer has no identity or lifecycle.
- Build input has no Packet → Pack → Manifest → Pack cycle.
- Domain schemas describe Requirement Sets, Contract Graphs, Briefs, Designs,
  and Reviews, not a shared report lifecycle.
- A normal stream end remains a normal physical Agent-turn end even when no
  domain submit/finalizer tool was called.
- A model-owned `finish=length` is not a normal stream end: the shared Runner
  projects the existing `MessageOutputLengthError` through the ordinary Agent
  failure path before publishing Session completion. This is physical
  execution truth, not a missing-domain-output gate or an automatic retry
  policy.
- Targeted operator steer succeeds after process restart from the persisted
  Session lineage and latest hash-verified `WorkerTurnDescriptor`.
- A persisted terminal Session status remains historical execution evidence and
  cannot reject a new durable steer request.
- A `cancel_worker` decision acts only on a current-process prompt owner and
  records whether that physical resource was actually cancelled and settled.
  Persisted `completed` or `aborted` rows can neither skip nor prove the
  cancellation.
- `liveRuntimeContinuation` and Runtime-gated automatic compaction partitions
  do not exist.
- Registered partial domain facts remain visible; missing and contradictory
  facts are Orchestrator evidence, not Host-generated business failure.
- Each Task completion appends one typed `task_completion_decision` artifact
  with the exact Orchestrator decision message/tool call and validated refs to
  current same-Task Slice revisions, workflow selection, package revision,
  reviewer/domain artifacts, Session, message, and
  Host-observation facts. Reopen preserves prior decisions; the current
  projection exact-joins artifact time to the Task terminal time. The artifact
  does not copy the narrative summary. There is no shared acceptance aggregate
  or Host pass/fail rollup.
- Metric definitions and measurements have no `gate_class`, blocking count,
  Arbiter verdict, accept/stall/abort outcome, or other scheduling authority.
- `DispatchAdapterContractRegistry` has no completion type and
  `terminalToolCompletion(...)` does not exist.
- Generic `AgentReport` and trace-report summary/detail copies do not exist.
- Build does not self-report git diff, changed files, commit refs, command/test
  exits, or consumed-input restatements. Those values come from Host tools.
- Final Agent summaries, limitations, and blockers remain in the real visible
  assistant message.
- No compatibility path, fallback, active/live/current aggregate, keyword
  matcher, state machine, or replacement universal payload is introduced.
- API, UI, describe, decision-log, tests, prompts, and documentation consume
  the new facts directly.
- Active/inactive Expert Squad projection isolation and fully visible natural
  message flow remain intact.
- The running OpenCorvus, Overlay, and sidecar processes are not restarted,
  refreshed, stopped, or otherwise manipulated.
- Targeted tests, typecheck, API/docs checks, second review, commit, and
  `legacy-remote` push complete successfully.

### Hard constraints

- Root `AGENTS.md` was read in full before modification.
- The existing worktree is authoritative and must be preserved. The initial
  snapshot was `b73af601f` on branch `v0.0.17beta`; concurrent user work
  advanced `HEAD` first to `9e7fd126b` and then to `1b483fc12` while this
  refactor was in progress. During the residual-protocol implementation it
  advanced again to `92d765c38` on `v0.0.18beta`, matching
  `legacy-remote/v0.0.18beta`. No reset, restore, cleanup, worktree creation, or
  staging rewrite is allowed, and unrelated changes remain unstaged.
- Delivery Slice revision identity and execution-ownership → dispatch-lineage
  changes are concurrent user work. This refactor must compose with them
  instead of reverting or reimplementing them.
- No OpenCorvus/Overlay/sidecar process operation is authorized.
- All implementation changes require focused regression coverage.
- Commit subjects use the `dsw-33987` prefix and delivery follows the
  authoritative current branch to `legacy-remote/v0.0.18beta` without bypassing hooks.

### Sources read

- `AGENTS.md`
- `specs/current/architecture/01-agents.md`
- `specs/current/architecture/02-data.md`
- `specs/current/architecture/11-agent-oop-protocol.md`
- `specs/current/architecture/13-agent-communication-matrix.md`
- deleted predecessor context-packet chapter
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-02-build-evidence-pack-role-separation.md`
- `specs/records/2026-07/2026-07-03-generic-build-evidence-gate-removal.md`
- `specs/records/2026-07/2026-07-17-terminal-tool-scoping-retirement.md`
- `specs/records/2026-07/2026-07-20-task-research-dispatch-observability-systemic-repair.md`
- `specs/records/2026-07/2026-07-23-coordination-continuation-terminal-convergence.md`
- Agent context, Runner, Session loop/runtime contract, dispatch adapter,
  Build evidence/result, Engine persistence/store/describe, every domain
  Agent/output-tool, Orchestrator stage, trace, API/UI, prompt, and focused
  test surface listed below.

### Whole-repository searches

The investigation ran repository-wide searches over production source, tests,
Expert Squad packages, current specs, and relevant dated records for:

- `AgentContextPacket|agent_context_packet|context_packet`
- `BuildEvidencePack|BuildInputEvidenceManifest|buildEvidenceContextPacket`
- every `report_*|submit_*|finalize_*` tool name
- `DispatchAdapterContractRegistry|terminalToolCompletion|terminalFinalizer`
- `AgentReport|buildTraceReport|build_report|host_facts`
- `reported_changed_files|consumed_*|contract_restatement|repair_report`
- `TerminalToolMissingError|StructuredOutputError|stage_continuation`
- all missing-terminal/finalizer failure and continuation paths
- `operatorSteerAgentSession|resolveOperatorSteerTarget|operator-steer`
- `SessionRuntimeContractMissingError|liveRuntimeContinuation`
- `WorkerTurnDescriptor|worker_turn_descriptor|queued_operator_wake`
- automatic-compaction Runtime readiness and Session-kind partitions
- `AcceptanceEvidenceDecision|functionalAssessment|primaryFailureIds`
- `arbitrateAcceptanceEvidenceDecision|preRuntimeAssessment|skippedChecksPass`
- `MetricGateClass|gate_class|ArbiterVerdict|arbiter_verdict`
- `blocking_unmet_count|regressed_blocking|engine_iteration`
- `invalid_architect_artifact_id|evidence_refs`
- all API/UI/describe/decision-log/report consumers

### Independent Agent feedback

The user explicitly requested independent Agent review on 2026-07-24. Three
independent Agents audited architecture ownership, physical runtime
completion/tests, and database/API/UI consumers and implemented bounded
portions of the agreed deletion. They did not create worktrees or touch running
processes.

Their converged review found at that review point that the first implementation
had removed the named packet/finalizer/report types but had not removed every
same-semantics protocol. Later revisions in this chapter supersede these audit
findings:

- global `task_report` is still a required terminal report in Channel Runtime
  and is persisted through `task.report`, the protocol bridge, SDK, UI policy,
  and product docs;
- `TaskAgentOutcome` still aggregates final-message identity, domain artifact
  data, Host git observations, and business status into a provider registry;
- `build_attempt_outcome` then still derived business conclusions from Host
  git/session observations and coupled those conclusions to scheduling;
- Runner still promotes a part-level tool-call error into an Agent-turn
  failure even when the model stream ended normally and earlier facts exist;
- full prompt projections (`system` and provider-visible messages) are still
  persisted in Agent Trace JSONL and exposed through API/UI;
- post-turn domain-artifact persistence errors can overwrite an already
  completed Session as terminal/error;
- no-writer compatibility readers for `StructuredOutputError` and
  `acceptance-review-verdict` remain active;
- `SubAgentProtocol.yieldResult(headline, summary, fields, pointer)` is a
  renamed generic report that copies domain narratives into parent tool
  results instead of returning stable refs;
- Build attachment staging failure can still prevent Session creation instead
  of becoming a visible missing/corrupt-input observation;
- walkthrough translation still forces a terminal submit tool; and
- an unused acceptance persistence helper still writes a parallel
  `assistant-summary` report.

### Codex review feedback and revision

The independent review invalidates the earlier conclusion that the architecture
was closed merely because the original symbol names were absent. This revision
expands the implementation boundary from exact-name deletion to semantic
ownership deletion. Each item above must be removed at its complete
producer-consumer chain, and tests must assert that the old automatic behavior
no longer occurs.

## Artifact Consumption Provenance

Tool execution history has a strict evidence boundary: “called”, “accepted”,
“rejected”, “failed”, and “completed” describe an action only when its exact
persisted tool input and result/error prove that execution. A schema or tool
contract may support a counterfactual prediction, but an unexecuted prediction
must remain explicitly labeled as inference and cannot be rewritten as a past
tool event.

Durable inter-Agent evidence uses consumer-owned catalog facts rather than a
handoff packet. Each consumer enumerates/searches the current Task catalog,
completely exact-reads every candidate it inspects, and calls
`artifact_select` for each Artifact that semantically supports its typed
output. The persisted output records two exact-locator sets:

- `observed_artifact_locators`: complete, non-contradictory reads in the
  physical Turn;
- `source_artifact_locators`: successful semantic selections in that Turn.

`source` is a validated subset of `observed`; both may be empty. Missing
optional fields and complete-but-unselected reads are valid. Incomplete,
foreign, corrupt, wrong-path, or digest-mismatched evidence cannot enter either
set and is an error when selected. Read integrity is scoped by exact locator:
an invalid locator never validates itself, but it does not invalidate an
independent complete locator from the same physical Turn.
For a large `task_artifact_resource`, `artifact_read
delivery=materialized_file` verifies the complete immutable bytes and returns
a read-only content-addressed cache path. That one call is a complete-read fact
for the exact locator; bounded command-line or library inspection of the path
replaces repeated model-context pagination.
Typed post-Turn producers derive both sets from real tool facts. Immediate
`artifact_publish` and package-host publications declare sources for that
specific publication and validate them against earlier complete reads under
the same persisted assistant-message parent, so multiple outputs in one Turn
do not contaminate each other. Cross-Task import preserves the source
Artifact's original consumption provenance inside immutable
`import_lineage.source_provenance`; the imported envelope's own observed/source
sets remain target-Task-local.

## Causal diagnosis

### Observable behavior

An Agent can emit real tool facts and a visible final assistant message, but a
normal `finish=stop` is rewritten to `TerminalToolMissingError`; Runner then
throws for an unsatisfied collector; an Orchestrator wrapper creates a
`stage_continuation` artifact and asks the same Session to call a finalizer.
For Build, the finalizer additionally repeats changed files, commits, tests,
evidence consumption, contract text, and repair bookkeeping that Host tools
already observe.

### Direct triggers

1. `session/loop.ts` installs `TerminalToolContract`, forces terminal tool
   choice, stops immediately when satisfied, and injects missing-terminal or
   missing-StructuredOutput errors after ordinary stream termination.
2. `agent/runner.ts` validates `terminalTool.isSatisfied`, constructs
   `AgentReport`, publishes the report summary as Session terminal text, and
   records the same report in trace.
3. `dispatch-adapter-contract.ts` declares `plain`, `structured-output`, and
   `terminal-tool` completion kinds, making domain output shape part of
   physical Session completion.
4. `engine/stage-continuation.ts` and
   `orchestrator/stage-continuation-runtime.ts` persist and replay finalizer
   misses rather than exposing the already-produced facts.
5. Build parses evidence from Context Packets into `BuildEvidencePack`, binds
   it to `BuildInputEvidenceManifest`, converts it back to a Pack for prompt
   and report validation, and compares Agent-reported consumption to that
   reconstructed copy.
6. Build persistence stores `build_report` beside `host_facts`, and read
   models expose both actual and reported changed files.

### Deeper cause

Physical execution, domain fact production, narrative handoff, and lifecycle
judgment were modeled as one terminal-report protocol. Because the Host schema
owned that aggregate, absence of the aggregate was interpreted as absence of
work. Repeated attempts to make terminal reporting more reliable added forced
tool choice, continuation artifacts, retry prompts, report builders, and
Host/self-report comparison instead of separating fact ownership.

### Why previous repairs did not root-correct it

Earlier work retired some global terminal-tool scoping and moved next-step
choice to the Orchestrator, but preserved terminal finalizers as adapter
completion contracts. Later continuation repairs made those gates more
observable and recoverable, which improved diagnostics while cementing the
wrong ownership boundary. Build evidence work similarly made staged bytes
verifiable but retained Packet/Pack/Manifest copies around the valid
AttachmentStore binding fact.

### Restart-steer causal chain

The visible `"runtime context is gone"` error is not proof that the Session is
gone. `task-api/index.ts::resolveOperatorSteerTarget` first asks
`validateSessionRuntimeContractForContinuation(... requireRuntimeContract:
true)`, even though the operation it is validating is not a continuation. It
then merges process-local and persisted `session.status` and rejects any
terminal observation. Those checks run before
`createOperatorSteerCoordinationRequest`, so the durable coordination protocol
is never reached after restart or after an ordinary completed Turn.

The deeper cause is that a process-local execution cache was used as the
identity authority for a durable business operation. `WorkerTurnDescriptor`
already persists the exact projected identity, Expert Squad, model, tool
projection, Task/work scope, and immutable hash. The request therefore had a
restart-safe source available, but read it indirectly through Runtime. The
same inversion appears in `liveRuntimeContinuation`: automatic compaction
eligibility is classified by whether process-local continuation machinery is
installed instead of by durable Session/message facts.

## Target ownership model

### Durable facts

Task, Goal, Artifact, Finding, Attachment, Session message, and tool call are
stored once by their real producer. Other layers carry stable references.

### Prompt projection

`PromptProjection` is a pure renderer over:

- visible text;
- artifact/finding references;
- attachment references.

It has no ID, scope, source identity, persistence, current/active state, retry
semantics, or dispatch authority. Provider-specific message parts remain
internal rendering data.

### Domain artifacts

- Requirements → `RequirementSet`
- Architect → `ContractGraph`
- Research → `ResearchBrief`
- Frontend Design → `FrontendDesign`
- Visual QA → `VisualReview`
- Integrity → `IntegrityReview`
- Fact Check → `FactCheckReview`
- Workload Analysis → `WorkloadBrief`
- Build → Host git/command/test observations plus optional implementation
  notes in the visible final assistant message

Incremental registration tools write or accumulate domain facts. Session
completion never requires a final submit. Completeness findings are readable
artifact data for Orchestrator judgment.

### Agent turn

Runner records only Session ID, final message ID, tool-call references,
produced artifact references, stream end, runtime error, or cancellation. It
does not express business pass/fail.

### Session, Turn, and Runtime

- Session/Trace owns durable identity, messages, tool calls, descriptors, and
  historical facts.
- Turn/Attempt owns one model execution and its physical outcome.
- Runtime owns only the current process' stream, cancellation handle, tool/MCP
  instances, callbacks, and completion promise.

Runtime may accelerate or cancel a physical operation while it exists. Its
absence is an observable physical fact, never Session liveness or business
validity.

### Typed Wake Occurrences And Prompt-Owner Closure

An Orchestrator wake carries typed occurrence identity when infrastructure
knows which durable event triggered it. Worker terminal delivery references the
exact Task, dispatch lineage, execution attempt, child Session, and either the
real completed assistant message or terminal error/tool event. The ordinary
`dispatch_agent` tool result carries that locator; no synthetic message,
Goal-terminal refill, or coordination request substitutes for it.

An occurrence is not a cached lifecycle verdict. Restart reconstruction reads
the same immutable terminal facts and makes stale delivery a natural no-op.
Queue persistence only transports the wake; it does not create business
completion or a second lifecycle inbox.

Multiple physical callers may attach to one Session prompt owner. When that
owner closes naturally before an attached caller receives a result,
`SessionPromptLoopFinishedError` describes only that callback disposition. It
is not a provider, stream, tool, scheduler, Session, or Task failure and cannot
stamp Task error or terminal facts. The already-durable later wake reconstructs
the current Task snapshot in its own scheduling turn. Concrete cancellation
and execution failures retain their distinct typed errors and existing
evidence paths.

### Host observations

Git refs/diffs, changed files, merge results, command/test exits, tool calls,
attachment reads, and physical dispatch/worktree observations are Host-owned
facts. They belong to Task execution lineage, never to a Delivery Slice
workspace lifecycle. No Agent field duplicates them.

## Call-site disposition

### Context protocol

| Files                                                                                                                                                                                                                                                                                                                                                                             | Decision                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `agent/context-packet.ts`, `context-packets/visual-handoff.ts`                                                                                                                                                                                                                                                                                                                    | Delete packet identity/schema/router. Replace with pure prompt projection and domain-specific ref renderers. |
| `build/agent.ts`, `build/prompt-context.ts`, `build/evidence-pack.ts`                                                                                                                                                                                                                                                                                                             | Accept stable fact refs/attachments directly; delete packet extraction and structured-schema routing.        |
| `architect/agent.ts`, `requirements/agent.ts`, `research/agent.ts`, `explore/agent.ts`, `fact-check/index.ts`, `frontend-design/agent.ts`, `visual-qa/agent.ts`, `delegated-worker/agent.ts`, `goal-workload-analyst/prompt.ts`, `integrity/team-agent.ts`, `integrity/acceptance-tools.ts`, `integrity/replay-context.ts`, `visual-qa/context.ts`, `delegated-worker/context.ts` | Replace `contextPackets` inputs with visible prompt text plus stable fact/attachment references.             |
| `orchestrator/tools.ts`, `requirements-stage.ts`, `architect-stage.ts`, `build-tool.ts`, `integrity-review-stage.ts`, `visual-qa-stage.ts`, `workload-analysis-tool.ts`, `orchestrator/agent.ts`                                                                                                                                                                                  | Project prompts from durable facts at dispatch time; do not construct packet identities or snapshots.        |
| `test/agent/context-packet.test.ts`, Build/Integrity/Visual QA context tests, homogeneity tests                                                                                                                                                                                                                                                                                   | Delete packet-contract assertions; add projection/restart/no-hidden-message regressions.                     |
| `architecture/11-agent-oop-protocol.md`, this chapter                                                                                                                                                                                                                                                                                                                             | Remove old cross-Agent packet authority and document stable refs plus prompt projection.                     |

### Build evidence and Host facts

| Files                                                                                  | Decision                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `build/evidence-pack.ts`                                                               | Delete role aggregate and Packet conversions.                                                                                                                                                          |
| `build/evidence-manifest.ts`                                                           | Rename/narrow to Session attachment binding: canonical project/task/session/attachment SHA and staged path only. It is infrastructure provenance, not prompt or report state.                          |
| `build/agent.ts`                                                                       | Consume bindings once, stage once, render refs once; remove Pack/Manifest reconstruction and consumed-ref validation.                                                                                  |
| `build/types.ts`, `build/report.ts`                                                    | Delete `BuildResult`, generic Build report, changed files, commits, tests, consumed refs, contract restatement, repair report, and workload guidance self-report fields.                               |
| `engine/persist.ts`, `engine/store.ts`, `engine/goal-evidence.ts`, `agent/outcomes.ts` | Persist/read Host observations once. Remove `build_report`, `reported_changed_files`, and Agent/Host comparison.                                                                                       |
| `orchestrator/build-tool.ts`, `build-feedback.ts`                                      | Return final visible message reference plus Host observations and domain artifact refs; expose conflicting facts without status rewriting.                                                             |
| `orchestrator/build-tool.ts`, `build-context.ts`                                       | Project architect graph, dependency evidence, prior output, annotations, comparisons, diagnostics, and missing/corrupt-source findings as independent prompt facts. None is a Build admission verdict. |
| `engine/goal-evidence.ts`, `engine/describe.ts`                                        | Keep evidence status and lifecycle observations; remove `dependency_ready`, `blocked`, bootstrap-first, dispatchable, and active-current scheduling conclusions.                                       |
| Build evidence/result/persistence/API contracts                                       | Validate one-way binding and exact Host-owned observation output. UI presentation uses real-page interaction and manual screenshots only. |

### Acceptance evidence and metric observations

| Files                                                                                                                                                                              | Decision                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host-observation writer | Persist one immutable Host observation whose payload owns exact diff/command facts for an execution attempt and may cite exact Slice revisions. |
| Engine observation queries | Expose execution-scoped Host observations and their owned diff bytes without another business-state read model. |
| Orchestrator reviewer consumers | Consume Host observations, reviewer artifacts, dispatch/final-message facts, and diffs directly; never infer accepted/delivered from commit presence. |
| Board/model/debug projection | Project current Slice revision and independent execution/evidence/review facts; never recreate mutable acceptance or attempt status. |
| Task API, OpenAPI, SDK, API docs | Expose Delivery Slice revision, independent activity/evidence/review associations, explicit Completion Decision acceptance, and exact locators; no Goal-attempt endpoint. |
| `engine/git.ts`, `engine/memory-bridge.ts`                                                                                                                                         | Remove unused acceptance-shaped completion inputs and metadata copies; final checkpoints and durable learnings consume Task/Plan/fact refs, not a synthetic delivery row.                                                                                                             |
| Git/API/Board/Integrity non-UI contracts | Validate exact append-only execution observation/diff output and reviewer-to-Task decision references. |
| `acceptance/{manifest,specialist-review,surface-detector}.ts`, `acceptance/checks/{project-assessment,runtime-readiness}.ts`, `acceptance/specialists/**`, `acceptance/arbiter.ts` | Delete the unused generic acceptance aggregation family. Verification remains in its real producer artifacts and cannot become a parallel lifecycle or Host arbitration layer.                                                                                                        |
| Retired acceptance aggregation tests and fixtures | Delete tests that only kept the dead aggregation family alive; validate the current exact-producer and real message-flow outputs. |
| `metrics/{types,metrics.sql,score,store,executor}.ts`, `storage/ddl.ts`                                                                                                            | Keep immutable metric definitions, raw results, freshness, aggregates, and trends. Replace gate classes and blocking-specific counts with neutral observation classes and target-trend counts; delete Arbiter verdicts.                                                               |
| `engine/describe.ts`, `orchestrator/agent.ts`                                                                                                                                      | Render metric observations and trends as context only. Do not call the description a gate or expose an Arbiter outcome.                                                                                                                                                               |
| Metrics store/executor tests and DB write-boundary tests                                                                                                                           | Replace veto/accept/stall semantics with measurement/freshness/aggregate facts and prove no metric row carries scheduling authority.                                                                                                                                                  |
| `agent/dispatch-adapter-input.ts`, `orchestrator/tools.ts` Architect input                                                                                                         | Bind the exact RequirementSet artifact selected by the Orchestrator. Project structural re-entry artifact, defect, evidence, and repair-rationale fields as optional observations; missing or contradictory observations must reach Architect instead of preventing Session creation. |

### Completion, reports, and continuation

| Files                                                                                                                                                                             | Decision                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent/dispatch-adapter-contract.ts`                                                                                                                                              | Remove completion union/helpers. Registry keeps input schema, Session kind, and private domain tool inventory only.                                              |
| `session/runtime-contract.ts`, `session/loop.ts`, `session/message.ts`                                                                                                            | Remove terminal-tool and structured-output completion gates/recovery errors. Stream termination remains physical termination.                                    |
| `agent/runner.ts`, `agent/report.ts`, `trace/index.ts`                                                                                                                            | Delete `AgentReport`, report builders, report return fields, and report trace copy. Trace keeps final message/tool/artifact/runtime facts.                       |
| `engine/stage-continuation.ts`, `orchestrator/stage-continuation-runtime.ts`                                                                                                      | Delete finalizer-miss continuation protocol and its artifact/schema references. Coordination handoff remains a separate visible protocol.                        |
| `orchestrator/tools.ts` and every stage wrapper                                                                                                                                   | Remove missing-finalizer catch/retry paths. Read final message, domain artifacts, and Host observations.                                                         |
| `overlay/store/card-tree.ts`, Web architecture explorer, describe/API consumers                                                                                                   | Read Session final message and domain/Host facts; remove terminal report presentation.                                                                           |
| Runner/session/continuation/adapter API contracts | Validate a normal completed Turn with its real final message locator. UI presentation uses real-page interaction and manual screenshots. |
| `tool/task-report.ts`, `tool/global-tools.ts`, `tool/tool-id-catalog.ts`, `engine/model.ts`, `orchestrator/protocol/message-bridge.ts`, `channel-runtime/core.ts`, SDK/docs/tests | Delete the generic required terminal report and report-driven channel loop. Channel delivery uses visible assistant messages and physical Session idle only.     |
| `agent/outcomes.ts`, `workbench/board.ts`, `orchestrator/read-context-tool.ts`, Integrity/Visual QA replay/context consumers                                                      | Delete the universal provider outcome aggregate. Consumers read strict domain artifacts, final-message refs, Session/tool facts, and Host observations directly. |
| `session/message.ts`, `orchestrator/build-retry-session.ts`, SDK/tests                                                                                                            | Delete no-writer `StructuredOutputError` compatibility. Keep `StructuredOutputPayloadError` because it represents an actual invalid tool payload.                |
| `agent/sub-agent-protocol.ts` and all Orchestrator callers                                                                                                                        | Delete generic headline/summary/fields yields. Parent tool results carry only Session/final-message/domain-artifact/infrastructure-observation refs.             |
| `agent/runner.ts`                                                                                                                                                                 | Record part-level tool errors as Host observations without promoting a normally ended stream to Agent-turn failure.                                              |
| `session/llm.ts`, `trace/index.ts`, trace API/UI/tests                                                                                                                            | Do not persist prompt projection text. Trace keeps model identity and stable Session/message/tool/artifact/Turn facts only.                                      |
| Research/Requirements/Architect/Workload/Frontend Design stage catches                                                                                                            | Separate Agent execution failure from post-turn persistence/materialization failure. Never rewrite a completed Session because a later write failed.             |
| `acceptance/review-verdict.ts`, Store/Describe/Orchestrator/Build feedback readers/tests                                                                                          | Delete no-writer acceptance-verdict compatibility and its scheduling influence.                                                                                  |
| `acceptance/checks/walkthrough/translate.ts`                                                                                                                                      | Remove the required submit-tool completion contract. Preserve returned facts and expose malformed/missing output as observations.                                |

### Restart-safe operator steer and Runtime metadata

| Files                                                                                                                                         | Decision                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `task-api/index.ts::resolveOperatorSteerTarget`                                                                                               | Validate Task/Session/project lineage and worker Session kind, then load the latest hash-verified persisted descriptor and freeze `ProjectedWorkerBinding` from it. Delete Runtime-contract and persisted-terminal admission checks. |
| `agent/worker-turn-descriptor.ts`                                                                                                             | Keep descriptor persistence as the single restart source; expose one validated Session-target resolver instead of reconstructing identity in route code.                                                                             |
| `engine/agent-coordination.ts`, `engine/queue.ts`                                                                                             | Keep durable request creation and root-Session wake as the execution path. Missing Runtime is not a request status or failure rewrite.                                                                                               |
| `orchestrator/tools.ts`                                                                                                                       | Keep `continue` as the immediate process-local same-Session action and `redispatch_worker` as the durable same-Session reopen action. Describe the distinction to the Orchestrator; do not make Runtime availability or historical terminal status a Host scheduling gate. |
| `runtime-template-registry.ts`, `session/agent-runtime-metadata.ts`, `session/loop.ts`, `session/compaction.ts` | Delete `liveRuntimeContinuation` and Runtime-readiness or Session-kind compaction partitions. Every schema-valid persisted Session uses the same compaction path, and projected identity resolves from the source message's persisted descriptor; Runtime remains optional physical context. |
| `server/routes/orchestrator.ts`, `server/error.ts`, generated OpenAPI/SDK                                                                     | Remove 410 Runtime-loss from the operator-steer contract. Direct reply may retain its separate in-flight Runtime error taxonomy.                                                                                                     |
| `overlay/AgentSessionReplyBox.tsx`, locale files                                                                                              | Remove the false “Session runtime context is gone” steer branch and text; keep durable request/wake diagnostics.                                                                                                                     |
| operator-steer, descriptor, compaction, OpenAPI, and overlay tests                                                                            | Prove no installed Runtime and persisted terminal history still accept steer, descriptor/task/hash mismatches fail before writes, and Runtime loss no longer appears in the steer API/UI contract.                                   |

### Domain tools and artifacts

| Domain files                                                                                                                 | Decision                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `requirements/{agent,output-tools,types}.ts`                                                                                 | Keep requirement/decision registration; remove `submit_requirements` and `finalized`; persist a `RequirementSet` snapshot with completeness findings after the turn.                                                                                                                                                                                                                                         |
| `architect/{agent,output-tools,contract-graph}.ts`                                                                           | Keep graph registrations; remove `submit_architect` and finalized gate; expose validation findings without blocking persistence.                                                                                                                                                                                                                                                                             |
| `research/{agent,output-tools,schema,persist}.ts`                                                                            | Keep incremental brief updates; remove `submit_research_brief`; persist current `ResearchBrief`, including missing fragments.                                                                                                                                                                                                                                                                                |
| `frontend-design/{agent,output-tools,schema,static-tools}.ts`                                                                | Keep incremental design updates; remove `submit_frontend_template`; persist current `FrontendDesign` plus completeness findings.                                                                                                                                                                                                                                                                             |
| `visual-qa/{agent,output-tools,schema,static-tools}.ts`                                                                      | Keep check/evidence/finding registrations; replace terminal report with `VisualReview`; verdict may be absent.                                                                                                                                                                                                                                                                                               |
| `integrity/{team-agent,acceptance-tools,fact-projection,tool-ids,root-history}.ts`, `orchestrator/integrity-review-stage.ts` | Keep check/reviewer/finding/repair registrations and `IntegrityReview`. The stage passes only natural instruction plus exact Task/Goal/Artifact/Attachment refs. Prompt and drilldown tools rebuild an identity-free projection from durable stores; delete `ReviewPromptInput`, `IntegrityEvidenceToolContext`, `implementationEvidence`, copied Host diffs, Goal state snapshots, and attachment metadata. |
| `fact-check/{index,tools,schema,persist}.ts`                                                                                 | Replace terminal report with optional upserted `FactCheckReview`; normal stream end is independent.                                                                                                                                                                                                                                                                                                          |
| workload-analysis producer                                                                                                  | Keep Task-level workload briefs with explicit Slice revision subjects; persist collected `WorkloadBrief` rows and gaps without per-Slice worker multiplication. |
| `delegated-worker/{agent,output-tools}.ts`                                                                                   | Delete generic result tool; final visible assistant message is the handoff.                                                                                                                                                                                                                                                                                                                                  |
| `intent-analysis/{agent,output-tools}.ts`                                                                                    | Structured output may produce an intent domain artifact, but its absence does not rewrite Session completion. Incremental slots/clarifications remain visible.                                                                                                                                                                                                                                               |
| All `prompt/core/*` and affected Expert Squad overlays                                                                       | Remove finalizer instructions; require concise visible final summary, limitations, blockers, and stable refs.                                                                                                                                                                                                                                                                                                |

## Implementation order

1. Remove Session/Runner completion gates and generic report copies.
2. Remove finalizer-miss continuation persistence and wrapper recovery.
3. Convert domain collectors to artifact snapshots without terminal submit.
4. Convert Orchestrator consumers to final message plus domain/Host facts.
5. Replace Context Packets with pure prompt projection and stable refs.
6. Collapse Build evidence to one-way Session attachment binding.
7. Remove Build self-report/Host duplicate fields and status rewriting.
8. Update API/UI/describe, prompts, generated SDK/OpenAPI, docs, and tests.
9. Make targeted steer and automatic compaction descriptor-driven across
   restart; retire `liveRuntimeContinuation` and the false steer 410.
10. Run focused tests, typecheck, API/docs checks, real message-flow
    verification, Expert Squad isolation checks, and a second diff review.

## Implementation result

- Targeted operator steer validates durable Task/Session/project ownership,
  resolves the latest hash-verified `WorkerTurnDescriptor`, writes one durable
  coordination request, and wakes the Orchestrator without consulting a
  process-local Runtime or historical terminal status.
- A coordination request and its delivery wake are separate facts. Distinct
  pending steer requests remain durably ordered, an immediate wake failure
  cannot cancel either request, and project bootstrap reconciles missing or
  interrupted delivery wakes idempotently by request ID.
- Persisted scheduler rows no longer prove that execution is live. Project
  initialization immediately reclaims a `running` row that has no
  current-process owner, and a queue/runtime failure records its own
  infrastructure observation without publishing a Session or Task failure.
- Automatic compaction resolves projected identity from the persisted source
  descriptor after Runtime disposal. `liveRuntimeContinuation` is deleted.
- A terminal projected-worker Turn disposes its process-local Runtime contract
  and Model Context Protocol resources. Only an actual in-flight continuation
  retains those physical resources.
- Generic Agent reports, Build self-reports, terminal submit/finalizer tools,
  missing-finalizer rewrites, stage-continuation recovery, Context Packets,
  Build evidence Pack/Manifest round-trips, and completion types in dispatch
  adapters are deleted.
- Domain collectors persist their actual Requirement, Contract Graph, Brief,
  Design, Visual Review, Integrity Review, Fact Check, and workload facts.
  Partial and contradictory facts remain visible with completeness findings.
- Integrity dispatch now carries only its natural review instruction, Task/work
  scope, and exact Goal/Artifact/Attachment refs. Its prompt renderer and
  evidence drilldown resolve those refs from durable stores at call time; Build
  Host observations and diffs are never copied through the stage or Agent
  input, and an empty attachment ref list never expands to all Task uploads.
- Visual QA and Build persistence failures are recorded as infrastructure
  findings without rewriting a completed specialist Turn.
- Architect contract-graph findings, dependency evidence, Build evidence
  projection failures, and Frontend Design materialization failures are prompt
  facts. They no longer reject the specialist dispatch.
- Goal descriptions expose the current revision plus independent activity,
  review-association, and acceptance facts. Task and Session surfaces retain
  their own physical execution and failure facts without projecting them into
  a Goal lifecycle aggregate.
- Build stream completion leaves managed worktree cleanup to the explicit
  terminal Task lifecycle. Physical cleanup failure cannot retroactively
  change the Build specialist result.
- Structured output no longer forces provider tool choice as a hidden routing
  mechanism.
- Acceptance has no generic readiness/check/coverage/specialist collection
  pipeline. Commands, Browser Preview, Visual Review, Integrity Review, and
  workspace facts retain their own producers and artifact schemas; the
  Candidate binds their exact identities without copying or classifying them.
- Metrics persist quality, diagnostic, and efficiency observations, raw
  results, freshness, aggregates, unmet targets, and regressions without gate
  classes, blocking counts, or Arbiter outcomes. Missing, stale, or failed
  measurements persist `null` values and an unmeasured count rather than a
  fabricated zero or unmet result.
- Stale research briefs stay visible with their exact stale reasons and
  evidence references. The retired `filtered` conversation placement is
  rejected at protocol boundaries rather than silently hiding messages.
- Unexpected Orchestrator-loop, git-baseline, or queue-delivery failures create
  `task-infrastructure-error` artifacts and `task.infrastructure.failed`
  protocol events. These facts never mutate the Task, Goal, Session, or expert
  result they follow.
- The unused `task.lifecycle` recovery event and its queue identity were
  deleted. Restart recovery is derived from durable requests/descriptors and
  current-process resource ownership, not a persisted lifecycle assertion.
- Architect structural re-entry diagnostics are prompt facts. Missing artifact,
  defect, evidence, or repair-rationale observations no longer prevent a real
  Architect Session; only the requirements snapshot identity remains a Host
  data-integrity prerequisite.

## Verification plan

- Runner/Session: normal `finish=stop` without submit returns final message and
  never produces `TerminalToolMissingError` or `StructuredOutputError`.
- Domains: partial registered Requirements/Graph/Brief/Design/Review facts are
  persisted and readable without a final submit.
- Orchestrator: complete, missing, and contradictory facts are rendered
  together and left for natural decision.
- Build: stable attachment binding is one-way; no Packet/Pack/Manifest
  round-trip or consumed-ref echo exists.
- Host: changed files, commits, merge facts, command/test exits, and workspace
  binding have Host-only producers and consumers.
- Restart: the next dispatch prompt rebuilds from Task/Goal/Artifact/Session
  facts with no runtime packet/live aggregate.
- Operator steer: clear all in-memory Runtime contracts after persisting a
  worker descriptor; the route still writes exactly one coordination request
  and wakes the Orchestrator. Repeat with terminal Session history.
- Runtime boundary: direct in-flight continuation still requires a real
  Runtime, while durable steer and compaction request creation do not.
- Queue restart: leave a persisted coordination request, an interrupted wake,
  and an ownerless `running` scheduler row; bootstrap rebuilds delivery and
  reclaims execution without synthesizing Session/Task failure.
- Orthogonality: force git preparation, Orchestrator decision, queue delivery,
  metric evaluation, and evidence persistence errors after successful domain
  facts; each remains a visible infrastructure/evidence observation without
  rewriting the specialist result.
- Message flow: every input/final message and tool result remains visible; no
  synthetic/hidden branch is introduced.
- Expert Squad: Registry/Manager/Resolver/runtime tests prove active/inactive
  projection isolation.
- API/UI/describe: no deleted report/packet fields are read.
- Documentation: architecture source, product docs, generated OpenAPI/SDK, and
  document health agree.

Targeted commands will be selected from changed call sites, followed by:

```bash
bun run --cwd packages/opencorvus typecheck
bun run --cwd packages/overlay typecheck
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
bun run api:routes-check
bun run docs:check
git diff --check
```

## Verification results

- Acceptance/metric/orchestrator observation suite: 65 passed, 0 failed.
- Full affected Orchestrator and projected-adapter suite: 159 passed, 0
  failed, 1,097 assertions.
- Final combined acceptance/metrics/Orchestrator tool suite after removing the
  structural re-entry admission check: 153 passed, 0 failed, 1,023
  assertions.
- Restart-safe operator steer, durable coordination, role contracts, and
  Overlay service controls: 49 non-browser tests passed. The persisted
  terminal worker Session accepted a new steer from its hash-verified
  descriptor without an installed Runtime.
- The expanded restart/orthogonality suite passed 184 tests across operator
  steer, coordination ordering, queued-wake reconciliation, scheduler
  recovery, Session reuse, Runtime disposal, stale evidence, metric unknowns,
  infrastructure failure projection, Overlay controls, and transport protocol.
- Node-launched Overlay browser test for the real Agent reply box: 1 passed, 0
  failed. The runner verified that accepted durable steer clears the draft and
  that structured backend errors remain visible.
- Engine event/model plus historical-document and document-health suites: 86
  passed, 0 failed.
- Full repository typecheck: 9 package tasks passed.
- `bun run api:routes-check`: passed, 6 rules over 32 route files.
- `bun run docs:check`: passed, 284 operations over 24 groups.
- `git diff --check` and `git diff --cached --check`: passed.
- Residual production scans found no `liveRuntimeContinuation`, acceptance
  decision/functional-assessment/arbiter symbols, metric gate class, blocking
  metric count, or metric Arbiter verdict. Remaining `active runtime/current
invocation` references are scoped to actual tool closures, streams,
  cancellation, and resource ownership.
- Real Vite/Overlay visual review inspected a completed Mission, expanded the
  visible final Agent message, and opened the Trace panel. The UI showed the
  durable message/tool facts and exposed an old Session trace 404 as a visible
  infrastructure fact; it did not fabricate a Run or terminal report.
- No running OpenCorvus, Overlay, or sidecar process was restarted, refreshed,
  or stopped. Only isolated Vite and Node/Playwright verification processes
  were created and allowed to terminate.

The following bounded suites passed on 2026-07-24:

- `packages/opencorvus/test/orchestrator/tools.test.ts`: 101 tests.
- Runtime/steer/descriptor/coordination/compaction/tool-description suites:
  112 tests after repairing four retired-contract assertions.
- Domain fact, Build feedback, Visual QA persistence, describe, writer,
  projected-adapter, prompt, and runtime-contract suites: 54 tests.
- Deleted-infrastructure, Expert Squad projection, frontend-design, Visual QA,
  Build prompt, provider, memory, and decision-log handoff suites: 133 tests.
- Historical-doc and document-health suites: 82 tests.
- `bun run typecheck`: all 9 package typecheck tasks passed.
- `bun run api:routes-check`: 32 route files and 6 rules passed.
- `bun run docs:check`: 284 operations in 24 groups passed.
- `git diff --check`: passed.
- Isolated real Overlay page review passed for the default workspace,
  completed Mission conversation, expanded long message card, and scoped
  `Add guidance`/`Steer` composer. Screenshots showed stable layout and no
  retired Runtime-loss steer text; no guidance was submitted.
- A Node-launched real Vite browser fixture rendered an Orchestrator card and
  a projected solution-architect card together. The screenshot and DOM
  assertions proved that only the worker owns the scoped `Steer` composer;
  accepted requests clear the draft and a structured target error remains
  visible without disabling future durable steer.
- A second isolated real-page review expanded the Session trace panel in a
  completed Mission card. The panel preserved its layout and exposed the old
  Session's missing task-trace binding as a visible 404 fact instead of
  inventing an `agent_turn` result.

An unscoped `bun test packages/opencorvus/test` run was intentionally stopped
after its completed test workers left the Bun main process waiting on an open
HTTP handle. This repository already had another identical directory-level
runner waiting for more than eight hours, which confirms why rule 21 forbids
untargeted blocking test runs. Every failure printed before that wait was
reproduced in a bounded file suite, root-corrected, and rerun successfully.

## Codex review feedback

Initial review found that deleting only `terminalToolCompletion(...)` would
leave the same gate in `SessionLoop` and `stage_continuation`; the plan was
revised to remove the complete error/continuation chain. It also found that
retaining `BuildResult.status` while deleting only changed-file fields would
still let Host persistence convert Agent judgment into a retired per-Goal business
status. The plan now treats Build output as visible narrative plus orthogonal
Host observations and leaves acceptance judgment to the Orchestrator.

The implementation diff review found three additional old-protocol remnants
and revised the implementation rather than accepting them:

- `runAgentSessionWithRetry` had no production caller but still implemented an
  `isComplete` collector gate, terminal fail-fast classification, and a second
  `agent_turn_retry_final` trace event. The helper and its old-behavior test
  were deleted; Runner records each physical Turn once.
- Overlay `TracePanel` and trace CSS still interpreted `agent_report*` events.
  Those compatibility readers were removed and the panel now renders only
  `agent_turn`, `agent_turn_failure`, and Orchestrator physical trace facts.
- delegated-worker, local `delegate_agent`, intent-analysis, and explore
  adapters were still copying visible final assistant text into tool results,
  decision logs, or exploration artifacts. Their handoffs now carry
  `sessionID` and `finalMessageID`; domain facts remain in their own artifact
  stores, and the visible final message is not persisted again.

A second independent read-only review found no P0 issue, but identified five
remaining P1 authority leaks. All five were treated as architecture defects,
not accepted variances:

- `cancel_worker` still used persisted terminal Session rows to bypass real
  cancellation and required a later persisted `aborted` row to prove success.
  It now validates identity through the durable Session, frozen worker binding,
  and `WorkerTurnDescriptor`. A Runtime contract is consulted only when it
  exists and owns a real physical resource; Runtime absence completes the
  durable action with `physical_cancelled=false` and
  `prompt_cancelled=false`. Historical status rows remain observations.
- Operator steer could return `queued` after dispatch failure without proving
  a durable wake. The request and its first wake now commit in the same
  transaction. Each failed delivery attempt remains immutable, reconciliation
  creates a new numbered attempt, and the API returns `queued` only while a
  pending wake exists.
- Metric raw results used `null` for unmeasured values while aggregate,
  per-Slice, global, and delta projections still fabricated zero. Every score
  layer is now nullable; weights are normalized only across fresh measured
  inputs, and delta is absent when either side is unmeasured.
- Nested Agent cards used a separate steer predicate, allowing an Orchestrator
  child to receive a worker composer. Top-level and nested cards now share the
  same worker-only target projection.
- `EngineGit.prepare()` failure still returned before Orchestrator judgment.
  The loop now records a `task-infrastructure-error` and continues with that
  fact visible to the Orchestrator.

The same review noted a P2 cleanup-observability gap. Terminal worker Runtime
removal remains best-effort and cannot rewrite the expert result, but a failed
resource close now emits a `worker-runtime` infrastructure observation after
the in-memory contract has been removed.

The final protocol follow-up added a two-lifecycle recovery test. The first
project Instance persists an operator coordination request and numbered wake
after the worker Runtime is disposed. After that Instance is fully released, a
fresh project Instance configures the task-loop runner, drains the durable
wake, starts a new Orchestrator Turn with the exact request ID, and marks that
wake `drained`. The bounded verification after this correction passed:

- `packages/opencorvus/test/orchestrator/tools.test.ts`: 100 tests, 0 failed,
  including Runtime-absent cancellation and the complete Frontend Innovate
  workflow.
- `packages/opencorvus/test/server/task-session-operator-steer.test.ts`: 15
  tests, 0 failed, including the cross-Instance restart recovery path.
- Durable coordination, queue, metric, Runner, Orchestrator loop, Overlay
  worker-steer, and transport suites: 91 tests, 0 failed.
- Full repository typecheck: 9 package tasks passed.
- Node-launched real Vite browser verification: 1 test passed; visual
  inspection confirmed that Orchestrator cards have no worker-steer composer
  while projected worker cards retain the scoped composer.

### Rejected acceptance-aggregate design

An earlier review proposed an immutable `AcceptanceCandidate` closure. The
active/current/latest ownership audit below rejected that design because it
still copied Plan, Spec, Goal, review, Turn, and Host-observation payloads into
one lifecycle aggregate and selected it through a mutable Task pointer.
Completion now records the Orchestrator decision message/tool call with exact
fact refs; the referenced facts remain independently owned and readable.

### Final independent protocol review and corrections

The user requested another independent review after the first closure. Three
independent Agents audited runtime completion, schema/consumer ownership, and
Build/Orchestrator behavior against the current filesystem. Their review found
a typecheck-blocking stale Build consumer plus additional same-semantics
ownership leaks:

- Orchestrator Build code still read removed workspace/diff/commit fields from
  `BuildAgent.RunOutput` and independently persisted the same Host facts.
- completed Orchestrator status publication still happened after optional
  tool-error and trace writes, so a secondary observation failure could mask a
  normal stream end.
- Requirements, Visual QA, Integrity, and Research persistence failure paths
  could throw after the specialist Turn had already produced visible facts.
- Legacy Goal execution records copied workspace triples into three artifact
  families and used a binding-first fallback reader.
- Acceptance retained a test-only generic Evaluation/criteria rollup and
  `contractAuditBlocksBuild` hard gate.
- FrontendDesign used a permissive partial payload and persisted both a full
  artifact and materialized Markdown/manifest copies.
- Visual QA retained DecisionLog-based frontend-design/report renderers used
  only by compatibility tests.
- Requirements, Architect, Visual QA, and Research stages wrapped stable fact
  references in mini `status/result/sessionID` outcomes.

The corrections establish one producer and one durable source per fact:

- BuildAgent is the sole Build Host-observation producer. Its handoff contains
  only Session/final-message and stable artifact references. Orchestrator does
  not recollect or repersist git facts.
- Orchestrator publishes physical Session completion before best-effort
  secondary observations. Trace, tool-error, domain-persistence, and
  infrastructure-observation failures cannot rewrite the completed Turn.
- Workspace location belongs only to the physical dispatch/worktree evidence.
  Slice revision and Build observations contain no copied workspace ownership
  or fallback payload.
- Strict Zod schemas validate FrontendDesign partial facts, WorkloadBrief
  artifacts, and Host verification observations at write/read boundaries.
- The dead generic Evaluation/criteria manifest, contract-review selector, and
  build-blocking helper were deleted with their old-behavior tests.
- FrontendDesign persists only the strict domain artifact. Every downstream
  dispatch rebuilds a visible text projection from that artifact; no
  `frontend-template.md` or evidence-manifest authority remains.
- Visual QA tests write `visual_review` artifacts directly. The unused
  DecisionLog renderer and report compatibility fixture were deleted.
- Domain stage handoffs are plain stable-reference text. They do not expose a
  second persisted/partial/observed lifecycle aggregate.

Focused regressions cover natural stream completion without a finalizer,
best-effort post-terminal writes, partial artifact visibility, Research
persistence failure, plural/conflicting Host observations, Build
single-producer behavior, task-level diff persistence, workspace single-source
payloads, strict domain schemas, FrontendDesign restart projection, and the
absence of old report/gate behavior.

### Final consumer and schema review closure

The final independent consumer/schema audit found five remaining semantic
copies after the runtime review had passed:

- public `StageRouting.evaluation`, the `evaluator` Session identity, Overlay
  event/role presentation, Mission prompt, and Panel tests still described the
  retired Evaluation lifecycle;
- Host verification readers silently discarded malformed checks and converted
  an invalid persisted fact into an empty observation;
- the Design Resource Manifest was stored once as an Engine artifact and again
  as a JSON Attachment/system artifact;
- frozen Candidate Board projection still fell back between two retired Goal
  workspace representations; and
- Integrity still wrapped stable references in an
  `IntegrityReviewOutcome`/renderer mini lifecycle.

All five paths were removed rather than retained as compatibility:

- Task/Panel schemas reject `routing.evaluation`; the `evaluator` Session,
  message-source, generated SDK/OpenAPI, Overlay role/icon/color/event
  consumers, and the obsolete mocked full-pipeline Evaluation test are gone.
  Mission reconciliation reads Task failure, final messages, domain artifact
  refs, Session/tool facts, and Host observations.
- Host verification parses the complete strict payload and throws on any
  malformed check. A negative regression proves invalid facts cannot disappear
  into an empty list.
- Design Resource Manifest has one durable producer, the
  `design_resource_manifest` Engine artifact. AttachmentStore continues to own
  referenced resource bytes but no longer receives a serialized manifest copy.
- Candidate Board does not project Slice-owned workspace. Physical workspace
  evidence is read only through the exact dispatch lineage when diagnostics need it.
- Integrity singleflight carries the final stable-reference string directly;
  the outcome aggregate and second renderer no longer exist.

Expert Squad prompts and tests were also calibrated to the real handoff:
Requirements and Architect dispatch results expose Session/final-message and
`domain_artifact_refs`; no `status: "persisted"`, headline, count aggregate,
terminal report, or nested terminal-tool transcript is authoritative.

Final bounded verification after these corrections:

- full repository typecheck: 9 package tasks passed;
- protocol, schema, Panel, Overlay identity, and Expert Squad suites: 90
  passed, 0 failed, 2,918 assertions;
- full affected Orchestrator tool suite: 100 passed, 0 failed, 911 assertions;
- historical-document and document-health suites: 82 passed, 0 failed, 1,369
  assertions;
- `api:routes-check`: 6 rules over 32 route files passed;
- `docs:check`: 284 operations over 24 groups passed;
- `git diff --check`: passed.

No OpenCorvus, Overlay, or sidecar process was restarted, refreshed, stopped,
or otherwise manipulated during the final review and correction.

### Active/current/latest ownership review and implementation revision

The user requested a further audit of `findActiveSpecForTask` and other
`active`, `live`, `current`, and `latest` concepts before continuing the
implementation. Three independent read-only Agents and the primary Agent
traced every production writer and consumer. They found that the names were
not merely stale vocabulary:

- `findActiveSpecForTask` selects any non-`superseded` Spec snapshot ordered by
  version, so `ready`, `blocked`, and `completed` rows all become the mutable
  Task contract head. Build, Architect, Integrity, Visual QA, Workload,
  Acceptance Candidate, Board, describe, API, and prompt consumers use that
  selection. `add_goal` refuses to write without the selected Spec and Plan.
- Requirements atomically supersedes every prior non-superseded Spec before
  writing its fixed v1 row, but Architect reads one prior Spec outside its
  write transaction, writes a fixed v2 row, and supersedes only that prior ID.
  The table has no uniqueness constraint for one non-superseded Spec or one
  `(task_id, version)`, so concurrent Architect runs can leave multiple v2
  heads and the reader has no deterministic tie-break.
- `findActivePlanForTask`, `engine_task.acceptance_candidate_id`,
  `EngineArtifact.label="active"`, and task-scoped `findLatest*` domain
  readers retain the same mutable-current ownership under different names.
  The Candidate artifact is immutable, but the Task pointer selecting it is
  cleared and replaced as the current terminal decision.
- `CompactionHandoff.CurrentState` is a persisted cross-domain aggregate. It
  copies objective, acceptance criteria, todos, working context, chronology,
  domain-specific handoff payloads, decisions, files, tests, errors, user
  messages, next actions, and risks. Compaction still requires one valid
  `StructuredOutput` terminal tool call, rewrites a normal stream end without
  that call to error, persists structured and Markdown copies, writes another
  Memory copy, and replays the assistant summary by injecting it into a user
  message.
- Process-local prompt ownership, supervised process handles, scheduler
  promises, short-lived protocol replay buffers, UI selection, Git HEAD, and
  the explicit `prompt_profile.active` Expert Squad selection are legitimate
  physical or configuration selections. They do not become domain authority
  and remain outside this deletion.

This review supersedes the earlier Candidate-closure design in this document.
The implementation must not replace the current aggregates with another
universal snapshot:

1. Requirements writes immutable `RequirementSet` artifacts. Architect writes
   immutable `ContractGraph` artifacts that reference exact RequirementSet
   IDs. Goals bind the exact ContractGraph and RequirementSet facts that
   justify them.
2. Consumers use `list*` plus `find*ByID`. A dispatcher or Goal supplies exact
   stable refs; the Host never silently selects a Task-latest domain artifact.
   Missing, parallel, superseding, and contradictory artifacts remain visible.
3. Active Spec/Plan statuses, current Task pointers, `label="active"`, and
   domain `findLatest*` authority are deleted after every consumer is switched.
   Replanning appends new graph/Goal facts and preserves the earlier facts.
4. Task completion appends a typed decision artifact containing the real
   Orchestrator message/tool call and validated same-Task evidence refs. The
   Task row stores only lifecycle facts. Exact terminal-time joining selects
   the current projection without deleting earlier decisions or introducing a
   latest/current pointer. The artifact does not copy the visible summary and
   does not materialize an Acceptance Candidate that copies Plan, Spec, Goal,
   evidence, Turn, and decision payloads.
5. Compaction keeps the original durable messages and facts. Any bounded
   continuation projection is temporary. A model-authored summary is an
   ordinary visible assistant message, remains an assistant message on replay,
   has no domain-specific structured payload, and is not duplicated into
   Memory. Missing a structured finalizer cannot invalidate the maintenance
   Turn or any earlier specialist fact.

Focused regressions must prove that concurrent or conflicting domain artifacts
remain independently readable; no missing active Spec/Plan blocks dispatch or
artifact persistence; Task-level consumers use their exact Slice revision refs; later
artifacts cannot mutate a prior Orchestrator decision input; compaction does
not require StructuredOutput; provider and UI observe the same natural message
roles; and restart projection uses Task, Goal, Artifact, Attachment, Session,
message, and tool facts rather than a current/live aggregate.

### Final independent review closure

The requested independent Agent re-reviewed the current disk after the first
implementation pass. It confirmed that `AgentContextPacket`, generic
`AgentReport`, trace-report text copies, domain terminal finalizers,
`terminalToolCompletion`, and the Build Pack/Manifest round trip were gone. It
found four remaining ownership leaks, which this revision removes:

1. Orchestrator's natural Task description did not expose RequirementSet or
   ContractGraph refs and validation findings, and ResearchBrief detail capping
   omitted even the stable refs of older conflicting briefs.
2. Architect flattened selected WorkloadBrief artifacts into anonymous briefs
   and rendered only `decomposition_concern`, while Build correctly retained
   every exact artifact identity.
3. Task completion decision production and one test had drifted back toward a
   copied narrative `summary`.
4. Dead Spec/Plan/Milestone events remained public through the event model,
   event log, OpenAPI/SDK generation, Overlay event policy, mailbox fixtures,
   and protocol tests after their durable tables and producers had been
   deleted.

The resulting facts boundary is:

- `describeTask` enumerates every Task artifact as a stable ref before
  bounded detail projection. RequirementSet IDs/decision keys and every
  ContractGraph ref/finding are rendered for natural Orchestrator judgment.
  Research detail remains bounded, but no ResearchBrief artifact ref is
  hidden.
- `panel query_task` returns every artifact ID/kind pair, and `view_plan`
  renders ContractGraph validation findings. Neither selects a Task-current
  RequirementSet or ContractGraph.
- Architect receives `Array<{ artifactID, brief }>` and renders every exact
  selected WorkloadBrief, including parallel facts with opposing conclusions.
- A ContractGraph whose Goal references cannot be projected without changing
  the specialist fact is persisted with blocker findings instead of throwing
  away the produced graph. The Orchestrator sees the artifact and decides
  whether to redispatch or repair.
- `TaskCompletionDecision` contains only the producing Orchestrator
  Session/message/tool refs, validated evidence refs, and recorded time. Its
  natural summary remains the real assistant/tool conversation text.
- `spec.created`, `spec.updated`, `spec.approved`, `plan.created`,
  `plan.activated`, and the three Milestone events no longer exist in the
  producer model, API schema, generated SDK, event log, Overlay policy, or
  positive tests.

The final `active`/`current`/`live`/`latest` audit found no remaining
Task-latest domain artifact selector. `findActiveSpecForTask`,
`findActivePlanForTask`, and all Spec/Plan domain rows are absent.
Physical execution history is queried by exact dispatch lineage and execution
attempt. There is no latest-tip Goal-execution selector; Slice revision selection
uses stable logical identity plus immutable revision identity.
`prompt_profile.active` remains the explicit Expert Squad configuration source.
Session prompt controllers, runtime contracts, process handles, live protocol
cursors, browser URLs, database transaction-local variables, and UI selected
rows remain physical/configuration facts. Same-Session continuation is an
Orchestrator-owned in-process operation and requires its process-owned
RuntimeContract. There is no public direct child-Session reply protocol;
restart-safe operator steering and natural redispatch use durable
WorkerTurnDescriptor, Task, Goal, Artifact, Session, and message facts instead.
The physical runtime requirement is not a business-success or domain-current
gate.

Final targeted verification on the current disk:

- full repository typecheck: 9/9 package tasks passed;
- full affected Orchestrator tool suite: 100 passed, 0 failed, 919 assertions;
- streamed Requirements → Architect → Build → Integrity → completion fact
  chain: 1 passed, 0 failed, 56 assertions;
- Runner/finalizer removal, completion, Host-ref, parallel WorkloadBrief, and
  static-render lifecycle group: 17 passed, 0 failed, 89 assertions;
- protocol suite: 28 passed, 0 failed, 110 assertions;
- Panel query artifact-ref projection: 12 passed, 0 failed, 29 assertions;
- document health, historical links, and database writer boundary: 100 passed,
  0 failed, 1,432 assertions;
- `api:routes-check`, `docs:check`, and `git diff --check`: passed.

No OpenCorvus, Overlay, or sidecar process was restarted, refreshed, stopped,
or otherwise manipulated during implementation or review.

### 2026-07-24 protocol residual audit and implementation revision

The user identified four additional same-semantics remnants after the named
packet/report protocols were deleted. The current-disk audit confirmed them:

1. `control/message.ts` still configures `format.type=json_schema`, tells the
   Control Agent that structured output is required, rejects an otherwise
   completed assistant Turn when `Message.Assistant.structured` is absent, and
   copies `structured.message` into a second synthetic summary message.
2. Incremental domain tools such as `register_requirement`,
   `register_decision`, `register_goal`, `register_contract`, and
   `register_workload_brief` write completed Session tool parts before their
   enclosing stage materializes a domain artifact. `describeTask` exposes
   artifacts, failures, and abandoned open tool calls, but not the stable refs
   of completed tool calls. A process loss after those calls therefore leaves
   durable facts in the database without placing their refs in the next
   Orchestrator prompt.
3. Requirements, Visual QA, Integrity, and research persistence already keep
   the completed specialist Session/final-message refs when a later Host write
   fails. Architect and Workload Analysis still put Agent execution and
   post-Turn persistence inside one catch, so a persistence exception is
   mislabeled as `architect_threw` or `workload_analysis_threw`.
4. `/task/:taskID/session/:sessionID/reply` has no production caller. Overlay
   guidance uses the restart-safe `operator-steer` route. The direct-reply
   route, its Task API implementation, reply-specific errors, response
   schemas, generated SDK surface, and tests are a historical public protocol
   rather than a required current capability.

Whole-repository searches for this revision covered:

- `StructuredOutput|structured_output|appendSummary|ControlMessageResult` in
  Control, Session, Gateway, Channel ingress, Panel routes, Overlay, SDK,
  tests, and documentation;
- every collector/output-tool factory and every stage call that consumes
  `finalMessageID`, persists a domain artifact, or records an infrastructure
  observation;
- `MessageTable`, `PartTable`, Session lineage, completed/error/open tool-part
  readers, `describeTask`, `renderTaskDescription`, and the Orchestrator prompt
  consumer;
- `replyAgentSession|/reply|AgentSessionReply*`, all reply-only error classes
  and HTTP mappings, `directSessionReply`, operator-steer callers, OpenAPI,
  generated SDK, Overlay, transport packages, product docs, and tests.

Call-site decisions:

| Surface                                                                                                                                               | Decision                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `control/message.ts`, Control prompt, Control model fixtures, timeline/Gateway/Channel tests                                                          | Remove `json_schema`, required `StructuredOutput`, missing-output failure, and `appendSummary`. Return the real final message ID plus stable tool-result refs and action-owned IDs without creating or copying another message. Channel consumers read the exact assistant message by ref when they need its text. |
| `control/message-schema.ts`, Panel/Gateway routes, OpenAPI/SDK/docs                                                                                   | Keep a typed ref-only transport result with `message_id`, `control_session_id`, and stable `{session_id,message_id,part_id,call_id,tool_name}` refs. Action fields come only from completed panel tool results. The result has no narrative field, persisted report, or terminal gate.                     |
| `engine/describe.ts` and Orchestrator prompt                                                                                                          | Add an ephemeral, complete stable-ref inventory of completed tool parts from the Task Session tree. Do not copy tool input/output payloads, infer domain success, or persist another aggregate. Existing message/part APIs remain the exact drill-down path.                                                |
| Requirements/Architect/Workload/Visual QA/Integrity/research stage wrappers                                                                           | Retain the existing Agent-execution catch only around the physical Agent call. Put post-Turn persistence in a separate catch that returns Session/final-message refs plus a best-effort infrastructure observation. Never write an Agent-abort decision for a Host persistence failure.                     |
| `/task/:taskID/session/:sessionID/reply`, `EngineService.replyAgentSession`, reply schemas/errors, `directSessionReply`, generated API/SDK/docs/tests | Delete. There is no production consumer, and retaining it would preserve a second operator-to-agent protocol that depends on disposable Runtime state. `operator-steer` remains the single user-facing guidance path.                                                                                       |
| `SessionRuntimeContractMissingError` used by actual physical continuation/tool ownership validation                                                   | Retain as a Session runtime error, move it out of the deleted direct-reply module, and keep it unavailable as an operator-steer failure.                                                                                                                                                                    |

Focused validation for this revision must prove:

- Control completes from a natural visible assistant message with no
  `StructuredOutput`, does not append a second summary message, and exposes
  real message/tool refs;
- completed domain tool-call refs remain visible after the enclosing Turn
  errors and after process-local Runtime state is cleared, while no artifact is
  fabricated;
- Architect and Workload persistence failures return the completed
  Session/final-message refs and an infrastructure observation without an
  Agent-abort decision;
- the `/reply` operation, reply-only schemas/errors, runtime-template flag,
  generated SDK operation, and product-doc row are absent, while Overlay
  guidance still calls `operator-steer`;
- targeted Control, describe/restart, stage persistence, route/OpenAPI/docs,
  typecheck, and independent review checks pass without touching a running
  OpenCorvus, Overlay, or sidecar process.

### 2026-07-24 bounded independent protocol review closure

The first open-ended currentness reviewer was interrupted at the user's
request after it stopped converging. Its incomplete output is not acceptance
evidence. A separate bounded, read-only reviewer inspected the final disk with
an explicit no-delegation and no-scope-expansion contract. Earlier bounded
reviews had identified copied Control text, copied Requirements/Intent/
Architect/FrontendDesign/FactCheck inputs, implicit Architect attachments, and
Frontend Design terminal vocabulary. The implementation disposition is:

| Review finding | Final disposition |
| --- | --- |
| Control required `StructuredOutput` and copied its message into a second summary | Control now uses one natural Session prompt and returns only the real final message, Session, tool-call, action, Task, and attachment refs. Channel delivery reads the exact message by ref. |
| Requirements and Intent received copied Task/request/context payloads | Their dispatch inputs now contain instruction, Task/work scope, exact artifact IDs, and exact attachment refs. Agent-local prompt projectors read the durable facts. |
| Architect received copied artifacts and implicit Task attachments | Architect now receives exact RequirementSet/Research/FrontendDesign/Workload artifact IDs and explicit attachment refs. Empty selections remain empty. |
| Frontend Design received a materialized DesignResourceManifest and attachment rows | The Orchestrator passes the exact manifest artifact ID, artifact IDs, and attachment refs. The Agent-local projector resolves only that selection and exposes missing refs. |
| Fact Check received a copied `fact_check_items` array | Fact Check receives exact selected artifact IDs plus the exact target Session/message/hash. Its local projector retains artifact attribution and exposes missing, unsupported, partial, and conflicting facts. |
| Frontend Design retained `Final`, `Submit`, report renderer, and finalization lifecycle names | The live domain model is `FrontendDesignPayload`, `FrontendDesignDraft`, and `FrontendDesignCollector`; the terminal aliases, dead submit schema, report renderer, and lifecycle wording are deleted. |

The bounded final reviewer found one additional P1: completed tool-call Parts
were nested only under assistant messages with `time.completed`. A process
could persist a completed incremental domain tool result and then stop before
the enclosing assistant message received that timestamp. The open-tool
projection also correctly excluded completed calls, so the durable fact was
not present in the next Orchestrator projection.

This is fixed without a partial report or another runtime aggregate:

- `TaskDesc.completed_tool_call_refs` is an ephemeral stable-ref inventory
  built directly from completed specialist Message Parts in the Task Session
  tree.
- It is independent of assistant-message completion. `agent_message_refs`
  remains the inventory of physically completed assistant messages and no
  longer duplicates tool refs.
- The Orchestrator can call `read_agent_message` with the exact
  Session/message ref to inspect the original tool input/output. No payload is
  copied into `describeTask`.
- The restart regression now deliberately omits assistant
  `time.completed`, closes the database and process-local Runtime, reopens the
  project, and proves the completed registration ref and original Message Part
  remain readable without fabricating a RequirementSet or `PartialReport`.

Final verification on the resulting disk:

- full repository typecheck: 9/9 package tasks passed;
- affected Orchestrator tool chain: 102 passed, 0 failed, 945 assertions;
- completed-tool fact restart reconstruction: 1 passed, 0 failed, 20
  assertions;
- Requirements, Intent, Architect refs-only projection: 19 passed, 0 failed,
  2 real-LLM smoke tests skipped;
- StructuredOutput non-gate, Runner, Session, and restart description group:
  50 passed, 0 failed;
- Fact Check, Frontend Design, Integrity, Workload, and streamed fact-flow
  group: 161 passed, 0 failed, 2 environment-dependent tests skipped after
  the one browser-owning Frontend Design file passed 4/4 in isolated
  execution;
- Control, Channel, and workspace ref handoff: 20 passed, 0 failed;
- active/inactive Expert Squad projection: the corrected Advanced fixture and
  selected resolver/mount suites passed;
- document health, historical links, database writer boundary, and product
  documentation single source: 104 passed, 0 failed, 1,480 assertions;
- SDK/OpenAPI and API docs regenerated; `api:routes-check` passed 6 rules over
  31 route files; `docs:check` passed 282 operations over 23 groups;
- isolated Node Vite/Playwright visual checks confirmed the visible final
  assistant message is the sole summary surface and operator guidance uses
  `operator-steer`. The generated screenshot was inspected directly;
- `git diff --check` passed.

Residual production scans contain no live `AgentContextPacket`,
`BuildEvidencePack`, `BuildInputEvidenceManifest`, `terminalToolCompletion`,
generic `AgentReport`, domain terminal finalizer, required StructuredOutput,
Control summary copy, public `/reply`, or Task-latest domain-artifact
selector. Ordinary physical/configuration uses of `active`, `current`, and
`live` remain only where they identify the explicit Expert Squad selection,
process ownership, transport cursors, Git state, browser state, or local UI
selection.

No OpenCorvus, Overlay, or sidecar process was restarted, refreshed, stopped,
or otherwise manipulated during implementation, independent review, or
verification.

## 2026-07-27 model-facing Artifact publication transport

`artifact_publish` remains a worker-only projection over the canonical Engine
Artifact publisher. Its model-facing application binary interface uses one
`payload_json` string containing strict JSON with unique object keys, rather
than exposing the recursive Artifact value as a provider-dependent dynamic
record schema. `resources` is required and must be `[]` when there are no
files, so strict-provider normalization and Host execution accept exactly the
same domain. The Host parses this transport exactly once, validates the
result as a canonical Artifact JSON value, and persists only the structured
`payload`. Plugin ToolHost `engineArtifacts.publish` continues to accept that
structured `payload` directly and calls the same `publishExpertArtifact`
authority; this is one publisher with two boundary-specific transports, not two
fact sources. Programmatic package consumers call
`engineArtifacts.search` / `read` / `select`; publication sources must be
covered by complete invocation-local or same-Turn persisted reads and by an
earlier explicit selection.

## 2026-07-28 process-shutdown attempt and fresh-pass convergence

A graceful process shutdown settles the exact physical execution that the
exiting process owns before cancelling its prompt controller:

- Current-process prompt ownership remains the only shutdown ownership source.
  When an owned Build Session terminates during shutdown, the runtime records
  its physical execution outcome and exact terminal error/event locator against
  immutable dispatch lineage. It does not write a Slice business result.
- That outcome, the Task `process-recovery` infrastructure fact, and its durable
  wake commit in one transaction. A failed transaction leaves the prompt owner
  running and exposes the persistence failure; it cannot leave a cancelled
  prompt with an unresolved attempt.
- The aborted outcome describes producer execution termination only. It is not
  a Build Host observation, Slice satisfaction decision, product-defect verdict,
  or acceptance fallback. A later corrective dispatch has a new immutable
  lineage and remains independent execution evidence. The Orchestrator decides
  Task completion from the current durable snapshot; Goal acceptance comes only
  from the terminal Completion Decision's exact current Slice revision IDs.

Retry and replan use one actor-qualified `taskIntent` written only by explicit
operator control surfaces with `actor="operator"`. A fresh-pass request retires
older pending delivery notices before admitting its new wake and preserves
ordered refs to unconsumed operator messages. The messages, coordination
requests, artifacts, failures, and other durable domain facts behind those
notices remain unchanged and visible. Ordinary delivery cannot reopen a later
terminal Task, and the Orchestrator does not author Retry/Replan intent.

Mission Artifact acceptance reads reuse the same `readTaskArtifact` bytes,
digest, pagination, attachment, and complete-read coverage facts as
`artifact_read`; Panel does not own a second reader. Resume evidence is admitted
only when the exact source-Task locators have complete coverage earlier in the
same physical Mission Turn. The resulting nonterminal Orchestrator wake reads
the visible Mission message and chooses repair and fresh review through normal
Large Language Model scheduling; there is no Host keyword/verdict router,
retry counter, gate, or parallel workflow state.
