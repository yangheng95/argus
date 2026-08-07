# Session execution cancellation provenance repair

## Recall

### User request

- Diagnose why Mission chat `ses_0345d96cdffesHzB9syVK2CRSf` did not produce a normal final response after child Task `tsk_fcba376c00013KFLCcysO9oXe1` completed.
- Determine the systemic impact, repair the root cause, and perform a second review.
- Continue on the `0.0.32` delivery line.

### Acceptance criteria

1. A managed Session prompt cancellation preserves one exact typed origin from the initiating surface through the physical AbortSignal, Large Language Model (LLM, large language model) activity boundary, assistant error, Tool convergence evidence, Session terminal status, and durable `session.error` protocol event.
2. Panel stream disconnect, Mission abort, direct Session abort, Task lifecycle cancellation, scheduler timeout, process shutdown, and internal Agent cancellation use explicit source identities rather than a generic `external abort signal fired` message.
3. Ordinary terminal Task messages remain conversation-only. Mission acceptance continues to use the already implemented `read_task_artifact` and `resume_task` contracts.
4. Focused positive non-User Interface (UI, user interface) contracts pass on isolated temporary databases. Existing UI automation tests are not run or recreated.
5. Repository typecheck, route check, documentation health checks, and relevant focused contracts pass; the resulting diff receives a second code review by the primary Agent.
6. No database migration, compatibility reader, fallback, retry gate, keyword routing, lifecycle state machine, production database mutation, or running OpenCorvus restart is introduced.

### Hard constraints

- `SCHEMA_DDL` (Data Definition Language, database structure definition) remains the only database structure source; this repair uses existing message and protocol-event payload storage.
- Task business lifecycle and physical Session cancellation remain separate facts.
- Cancellation identity is supplied at the initiating boundary and propagated unchanged. Downstream code must not infer a source from error text.
- Tests assert complete positive output or an explicit typed error response. No UI or negative tests are added or run.
- Test waits use activity-based settlement already owned by `cancellation-scope.ts`; no fixed wall-clock benchmark deadline is added.

### On-disk material reviewed before implementation

- `AGENTS.md`
- `specs/current/architecture/01-agents.md`
- `specs/current/architecture/03-control.md`
- `specs/current/architecture/15-agent-facts-and-turns.md`
- `specs/records/2026-08/2026-08-03-task-activity-and-mission-completion-semantics.md`
- `specs/records/2026-08/2026-08-04-task-lifecycle-session-closure-system-repair-plan.md`
- `specs/records/2026-08/2026-08-04-task-resume-occurrence-and-overlay-recovery.md`
- `specs/records/2026-08/2026-08-04-terminal-task-stale-operator-wake-reopen-incident.md`
- `specs/records/2026-08/2026-08-05-mission-acceptance-evidence-and-source-task-resume-design.md`
- OpenCorvus debug evidence skill and benchmark debug template.

### Whole-repository search result

- `withLLMActivity` has one production caller: `session/processor.ts`; therefore its external-abort transformation affects every Session kind using the common processor.
- `llm/activity.ts` replaces every external signal reason with a new marked reason containing only `external abort signal fired`.
- `session/prompt/state.ts::cancelMatch` aborts the Session activity monitor with a generic Document Object Model (DOM, browser object model) `AbortError` before constructing the canonical `ExecutionCancellationError`.
- `ExecutionCancellationError` currently stores only `source` and optional Session identity. It cannot carry actor, surface, request, Task, Mission, message, Tool, wake, or causal event identity.
- Managed cancellation callers span Control panel streaming, Mission lifecycle routes, direct Session routes, right-sidebar Chat/Work, Task lifecycle cancellation, project deletion, scheduler timeout, process shutdown, Orchestrator/Agent cascades, and queue ownership settlement.
- The current Task cancellation event chain already owns durable actor/source/surface/request provenance. Physical Session cancellation should carry a causal reference to that chain rather than create a second Task-lifecycle source.
- The current branch includes commit `667694eb16`, which already implements Mission exact Artifact read and explicit same-Task acceptance resume. That path must be reused unchanged.

### Independent Agent feedback

- None. The user did not request sub-agents or parallel review, so the primary Agent owns both implementation and the explicitly documented second review.

## Proven causal chain

1. The child Task persisted a valid completion decision and terminal Task events.
2. Mission entered acceptance and failed during its own preview attempt with `AbortError: external abort signal fired`; no final Mission assistant text was persisted.
3. The exact initiating caller is unknowable from the incident database because the common LLM activity layer replaced the original AbortSignal reason.
4. The processor then serialized the replacement error as the canonical assistant failure and `session.error`, so every later diagnostic surface inherited the already-lost provenance.
5. Subsequent scheduling could not explain or safely continue the Mission because durable evidence described only an unattributed physical abort.

## Single repair design

### Typed physical origin

Extend `ExecutionCancellationError` with one strict `ExecutionCancellationOrigin` value. The origin records normalized actor, exact initiating source and surface, request identity, reason, target Session identity, and optional Task, Mission, message, Tool, wake, queue-occurrence, and causal protocol-event identities.

The initiating caller constructs this value. `SessionPromptState`, activity monitors, LLM activity, processor convergence, and status publication only propagate it.

### Preserve the abort reason

- `SessionPromptState.cancelMatch` constructs the canonical error first and uses the same object to abort both the activity monitor and exact prompt owner.
- `withLLMActivity` forwards `external.reason` unchanged through its external proxy. It still classifies the physical outcome as `external_abort`, but it no longer rewrites the evidence.
- `Message.fromError` serializes typed cancellation origin into the existing visible assistant error payload. The existing Session error bridge then persists that same payload in `protocol_event`; no new table or duplicate event writer is required.

### Caller ownership

Every managed caller passes an explicit origin. Existing Task cancellation provenance is propagated from `task.cancellation.requested`, including its event identifier as the physical cancellation cause. Transport disconnects and direct Hypertext Transfer Protocol (HTTP, web transport protocol) operations use their existing request IDs. Internal runtime owners create an occurrence ID at the source and reuse it for all descendants they cancel.

## Benchmark

### Input and output

- Input: a managed cancellation request entering each supported boundary while an isolated Session processor owns a stalled provider stream.
- Output: physical completion plus a visible assistant error and durable Session event containing the exact same typed origin supplied by the boundary.

### Environment

- Repository-local Bun and TypeScript toolchain after `bun install`.
- Isolated temporary project directories and databases supplied by existing test helpers.
- No connection to the user's running OpenCorvus database or server.

### Timeout

- Prompt settlement uses the existing activity-observing inactivity timeout in `cancellation-scope.ts`.
- Test harness safety races remain bounded, but pass/fail timeout begins again when observable Session activity changes.

### Positive verification matrix

| Contract | Required positive result |
| --- | --- |
| LLM activity | External typed cancellation returns `LLMActivityAbortedError` whose cause is the identical `ExecutionCancellationError` origin |
| Prompt owner | Activity monitor and prompt owner receive the same canonical error object |
| Processor | Assistant message completes with `MessageAbortedError` containing the supplied origin |
| Protocol | `session.error` contains the same origin and exact failure occurrence |
| Task cancellation | Every cancelled Task Session references the existing cancellation request event and request identity |
| Control stream | Disconnect records `control.message_stream_disconnect` and the panel request identity |
| Mission | Abort/archive/delete records the exact Mission source, Mission identity, and request identity |
| Other managed callers | Session, right-sidebar, scheduler, shutdown, project, Agent, and Orchestrator sources are distinct and attributable |
| Existing semantics | Mission acceptance-resume and ordinary terminal conversation focused contracts still pass |

## Implementation order

1. Commit and push this Recall/design as the implementation source.
2. Add the strict origin contract and canonical serialization.
3. Preserve exact external reasons through prompt state and LLM activity.
4. Update every managed production cancellation caller; use TypeScript exhaustiveness to find missing paths.
5. Add focused positive contracts and run the benchmark iteratively.
6. Update current architecture and documentation indexes.
7. Run repository checks, inspect the final diff, and perform a second review against this Recall.

## Review status

- Implementation: complete. Every managed cancellation boundary now supplies a
  strict origin, and the same `ExecutionCancellationError` travels through
  prompt ownership, activity abort, assistant error, and protocol publication.
  Generated OpenAPI and JavaScript Software Development Kit (SDK, software
  development kit) contracts expose the complete origin.
- Benchmark: complete. The cancellation core passed 43/43, Engine settlement
  passed 17/17, Wake passed 18/18, runtime Wake passed 8/8, prompt lifecycle
  passed 14/14, and Mission acceptance/ownership passed 6/6. The remaining
  impacted mixed run passed 112/113; its sole Windows Git-helper contention
  case then passed in the exact file rerun at 12/12. TypeScript, route
  inventory, API documentation,
  historical-document links, and frozen offline dependency installation also
  passed. Runs use the repository inactivity supervisor with Bun elapsed
  timeout disabled; the initial parallel run's Windows Git/process-supervisor
  contention was kept as infrastructure evidence and rerun serially.
- Second review: complete. It found and removed four provenance fractures:
  Task delete/archive overwriting the initiating source, one root cancellation
  minting separate request identities per Wake, right-sidebar source inference
  from reason text, and downstream creation of generic/untyped cancellation
  reasons. It also corrected the stale Mission ownership fixture so a cancelled
  Task first records and links its canonical `task.cancellation.requested`
  occurrence. No database, lifecycle state-machine, compatibility, fallback,
  gate, keyword-routing, User Interface test, or production-runtime mutation
  was introduced.
