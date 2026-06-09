# 2026-05-29: Compaction Continuation Rewrite

## Status

Accepted for implementation planning.

This spec supersedes the auto-compaction continuation portions of
`2026-05-13-compaction-handoff-hardening.md`. The older handoff-quality work
remains useful background, but the current production bug is no longer a
summary-prompt-only problem. It is a lifecycle and single-source problem.

## Trigger

Task `tsk_e733a9837001gu02wunRbcji5p` hit the following build-session failure
after an internal compaction checkpoint:

`Session prompt loop ended after internal compaction summary checkpoint before continuation`

The user asked for independent-agent audit before any sixth patch. Three
read-only audit agents reviewed:

- Agent A: `019e736a-a192-7630-84ed-1879dbd45f3f`, session loop and
  continuation lifecycle.
- Agent B: `019e736a-b587-7730-9f52-20f32074e255`, compaction handoff and
  transcript pruning contract.
- Agent C: `019e736a-c9c0-7010-a275-d02873f6e1d7`, live task evidence and
  impact surface.

The draft spec was then reviewed by three additional independent agents:

- Agent G: `019e737e-a734-7e33-86ad-807c9601e56a`, implementation ordering,
  public API surface, and missing loop gates.
- Agent H: `019e737e-bb4d-7710-a398-fdbb2e50789e`, control-record model,
  continuation single-source risks, and conversation/UI projection.
- Agent I: `019e737e-cf6c-7d51-8d0b-9aee873f764f`, worker/orchestrator
  boundary, external executor exclusion, and phase scoping.

Their blocking review result is incorporated below. The main correction is that
durable continuation cannot be implemented before the executable worker turn
descriptor exists, and control records must not be represented as fake
`user`/`assistant` transcript messages or `Message.Part` variants.

## Live Incident Evidence

Project directory:

`D:\myhexin-local\demos\tradingview-screener-exhaustive`

Task:

`tsk_e733a9837001gu02wunRbcji5p`

Goal #6:

`gol_e7346a184006l1CUhjEgLQ14Ol`

The first goal #6 build attempt failed after compaction:

- Build session: `ses_18c9f9760ffefEdsNIPJJJRIXz`
- Orchestrator session: `ses_18cc55262ffegcQuXM7lIxfxZ3`
- Orchestrator message: `msg_e736047d2001U0kDhMpW954t84`
- Build tool part: `prt_e73605776001hFYxNwdKERmIpn`
- Error: `Session prompt loop ended after internal compaction summary checkpoint before continuation`
- Protocol event sequence: `389`

The same goal later passed only after retry:

- Retry build session: `ses_18c98e243ffe5TMUGToVI2rpZZ`
- Retry goal run: `glr_e73671dc2001H6jIU5bPsL10eE`
- Build tool part: `prt_e7366f5f1001aKCjRSzli2nMBm`
- Final report part: `prt_e736d87180024rgTpvbu`
- Commit: `179d4bbf4f53`
- Changed file: `src/app/index.css`, `+1894/-0`

The failed session did not have a pending user interaction. Compact succeeded
far enough to produce a structured summary, then the continuation environment
was wrong:

- Compaction marker: `prt_e7365ed8e001wX1sQw0Xot57N0`
- StructuredOutput part: `prt_e7366220a001ohnYi83FGkalz0`, completed
- Continuation text part: `prt_e7366abc2001vBLGItdNnNWZgd`
- Failed tool part: `prt_e7366abc8001BDG4WAheXxk4PQ`
- Tool failure: `Model tried to call unavailable tool 'bash'. Available tools: StructuredOutput.`

This means the goal passed because retry escaped the broken compacted session.
It does not prove compaction resumed correctly.

## Current Control Flow Findings

### Agent implementation also has split sources

The communication bug is reinforced by agent implementation double sources.
The current implementation does not have one durable source for "what an agent
turn is":

- `Agent.Info` stores identity, prompt, model, permission, tools, options, and
  step limits in one object.
- `AgentRoleContract` separately stores role semantics such as
  `promptEditable`, `defaultPromptRequired`, and `promptConfigMode`.
- `config.agent.*` can override prompt/model/tools/steps at runtime.
- `prompt-catalog.ts` independently re-interprets prompt mode and default
  prompt rendering for the UI.
- `resolveAgentModelRef()` is the intended model resolver, but turn creation
  still persists selected model refs on user messages and accepts explicit
  model refs at several call sites.
- `SessionRuntimeContract` is an in-memory source for executable tools,
  terminal tool state, structured-output guards, and stream hooks, while
  `runAgentSession()` mirrors only a small expectation descriptor into user
  message `extra.runtimeContract`.

This means an agent turn can be described by at least four overlapping
surfaces:

1. static agent registry / role contract,
2. effective config and session overlay,
3. user message envelope,
4. in-memory runtime contract.

The correct split is not to keep all four as equal sources. Runtime execution
must have one turn contract descriptor, and executable closures must be derived
or installed from that descriptor for the current process.

### Failure message branch

`packages/opencorvus/src/session/loop.ts` generates the incident string through
`maintenanceSummaryFailureMessage()`.

The branch is:

1. `selectPromptFinalMessageFromNewest()` classifies `assistant.summary === true`
   as `maintenance-summary`.
2. `flushPromptFinalMessage()` accepts that summary only when
   `result_mode === "summary"`.
3. In normal reply mode, a latest maintenance summary causes an exception:
   `Session prompt loop ended after internal compaction summary checkpoint before continuation`.

The exception is rejected to the caller as an ordinary loop failure. It is not a
durable compaction state and not a successful handoff.

### Continuation is not durable

`SessionCompaction.create()` writes a user message containing a `compaction`
part. It does not create a durable continuation queue item.

After `SessionCompaction.process()` returns `"continue"`, `SessionPrompt.loop`
only relies on the same in-memory `while` loop to continue to the next turn.
If the loop exits, crashes, aborts, or is called in a result mode that treats
the summary as a final result mismatch, there is no independent continuation
record to recover from.

### Compaction and continuation tool surfaces are mixed

The live failure shows a business continuation attempted to call `bash` while
the available tool set was still only `StructuredOutput`. This is a hard
boundary violation:

- A compaction turn is a maintenance turn.
- A build turn is a business turn.
- Their tools, model messages, and final result semantics must not share one
  processor turn.

### Handoff data is not a single source

The current code accepts handoff validity from `assistant.structured`, renders
Markdown text, then later uses text summary in follow-up compaction and memory
flush paths. That creates two representations:

- Structured object as validation source.
- Rendered text as continuation/memory source.

Only one can be authoritative. The rendered text may exist for UI display, but
it must be derived from structured data and never become the merge source.

### Tail boundary can start in the wrong place

`selectCompactionInput()` / turn splitting can use assistant `step-start`
messages as boundaries. `filterCompacted()` can accept assistant-only tail when
an anchor is present. This allows replay to resume from a partial assistant
suffix rather than a complete user turn.

## Impact

Execution impact:

- A compacted build session can fail after summary generation.
- A goal can pass only because retry starts a fresh session.
- Work already performed before compact can be lost or duplicated.

State projection impact:

- Board can show a later retry as passed while raw artifacts still contain the
  failed compact attempt.
- Consumers that bypass board projection and read artifacts directly can
  misclassify stale `attempt-running` / failed rows.
- Active run state can look confusing while integrity or retry work proceeds.

Reliability impact:

- Restart after summary checkpoint is not explicitly recoverable.
- Summary quality fixes alone cannot solve the missing continuation durability.

## Decision

Do not patch the existing auto-compaction path again.

Implement a staged replacement:

1. Disable automatic compaction for workflow/build/orchestrator sessions until
   the durable continuation design is implemented.
2. Keep manual summarize available only as a summary-mode maintenance action.
3. Split session communication boundaries:
   - transcript messages are natural participant/tool transcript,
   - session-local control records drive wake/subtask/compaction/continuation
     and never enter provider replay as participant text,
   - structured artifacts carry durable handoff/evidence,
   - engine artifacts remain workflow/domain facts.
4. Rewrite compaction as a two-phase durable protocol:
   - summary-only maintenance turn,
   - explicit durable continuation wake/marker.
5. Make the structured handoff object the single source of truth.
6. Consolidate runner-managed worker agent turns into one
   `WorkerTurnDescriptor` plus one executable runtime installation path.
   Orchestrator wake/runtime remains orchestrator-owned, and external build
   executors that do not use `SessionPrompt` are excluded from compaction
   continuation unless they are explicitly migrated later.
7. Delete old compatibility paths instead of keeping fallback behavior.

This is not a mandate to add a new global engine-level
`AgentInvocation` truth. `goal_run_attempt`, `acceptance`, and related workflow
facts remain engine artifacts. The new control/turn records are session-local
execution plumbing and must not become a competing task status source.

## Phase 0: Disable Auto Compaction For Workflow Sessions

Files:

- `packages/opencorvus/src/session/context-budget.ts`
- `packages/opencorvus/src/session/loop.ts`
- `packages/opencorvus/src/session/compaction.ts`
- `packages/opencorvus/test/session/predictive-compaction-decision.test.ts`
- `packages/opencorvus/test/session/compaction.test.ts`

Change:

- Automatic predictive and reactive compaction must not run for build,
  orchestrator, integrity, requirements, architect, frontend-design, or other
  workflow child sessions.
- When a workflow session exceeds budget, stop with a typed visible budget error
  instead of creating an auto compaction marker.
- Manual `/summarize` remains allowed because it uses `result_mode: "summary"`
  and is explicitly user-triggered maintenance.
- Do not add a fallback larger model or silent retry path.

Acceptance:

- A workflow build session that exceeds predictive budget records one visible
  typed assistant error and does not create a `compaction` part.
- A workflow build session that hits provider `ContextOverflowError` records a
  visible typed error and does not create a `compaction` part.
- Manual summarize still creates a summary and returns only in summary mode.
- The incident string is not produced by workflow auto compaction because that
  path no longer exists.

## Phase 1: Split Summary Turn From Continuation Turn

Files:

- `packages/opencorvus/src/session/loop.ts`
- `packages/opencorvus/src/session/compaction.ts`
- `packages/opencorvus/src/session/processor.ts`
- `packages/opencorvus/test/session/compaction-continuation.test.ts`

Change:

- `SessionCompaction.process()` must be summary-only.
- It may expose only `StructuredOutput`.
- After StructuredOutput succeeds, the processor must stop immediately.
- It must not call business tools, emit business text, or continue into the
  source user's tool set.
- The normal reply loop must never treat a latest maintenance summary as a
  successful reply.

Acceptance:

- Test a compaction processor with a model output that attempts `StructuredOutput`
  and then `bash`: `StructuredOutput` is accepted, the turn stops, and no `bash`
  tool part is executed.
- Test a latest summary in reply mode yields a diagnostic error only if no
  durable continuation is scheduled.
- Test summary mode still returns the summary assistant as the route result.

## Phase 1A: Worker Turn Descriptor Before Continuation

Files:

- `packages/opencorvus/src/agent/runner.ts`
- `packages/opencorvus/src/session/loop.ts`
- `packages/opencorvus/src/agent/agent.ts`
- `packages/opencorvus/src/agent/role-contract.ts`
- `packages/opencorvus/src/agent/model.ts`
- `packages/opencorvus/src/config/prompt-catalog.ts`
- `packages/opencorvus/src/build/agent.ts`
- `packages/opencorvus/test/agent/*.test.ts`
- `packages/opencorvus/test/session/*runtime-contract*.test.ts`

Change:

- Define one `WorkerTurnDescriptor` shape for a concrete runner-managed worker
  invocation:
  - descriptor id and descriptor hash,
  - worker agent id,
  - role contract id,
  - model ref resolved through `resolveAgentModelRef()`,
  - prompt mode and resolved prompt-source ids,
  - executable tool names,
  - prompt tool switches, including explicit disabled tools,
  - output format/result mode,
  - terminal tool requirement,
  - workflow/session ids when present.
- The descriptor is durable and comparable after restart. It is not a new
  engine/task status source.
- Executable closures remain process-local and are installed from the
  descriptor by the worker runner. Historical user message `model`, `tools`,
  and `extra.runtimeContract` are audit-only for continuation.
- `AgentRoleContract` owns role policy. `prompt-catalog.ts` must render from the
  same helper and must not reimplement prompt-mode rules.
- `resolveAgentModelRef()` remains the only model resolver.
- Scope:
  - Applies to `runAgentSession()` / `SessionPrompt` managed worker turns.
  - Does not collapse orchestrator wake into the runner; orchestrator keeps its
    own `OrchestratorWakeRuntime` and may share only prompt-envelope helpers.
  - Does not apply to external build executor paths that manually synthesize
    messages/structured output unless those paths are explicitly migrated.

Acceptance:

- Tests prove prompt mode for every native agent is read from
  `AgentRoleContract` through one helper used by runtime and
  `prompt-catalog.ts`.
- Tests prove changing a stored user message `model`, `tools`, or
  `extra.runtimeContract` after the fact does not alter continuation model/tool
  selection.
- Tests prove continuation validates descriptor executable tools against the
  runtime contract while applying descriptor prompt switches for provider tool
  exposure, so build-only disabled tools do not silently reappear.
- Tests prove a worker build turn can reinstall its executable tool surface from
  the descriptor after restart.
- Tests prove orchestrator wake still uses its orchestrator-owned runtime and is
  not routed through `runAgentSession()`.

## Phase 1B: Session Control Records

Files:

- `packages/opencorvus/src/session/control.ts`
- `packages/opencorvus/src/session/message.ts`
- `packages/opencorvus/src/session/compaction.ts`
- `packages/opencorvus/src/session/subtask.ts`
- `packages/opencorvus/src/session/wake.ts`
- `packages/opencorvus/src/session/loop.ts`
- `packages/opencorvus/test/session/session-control.test.ts`
- `packages/opencorvus/test/session/message.test.ts`

Change:

- Add a session-local durable control-record source, such as
  `session_control_record`. It is session execution plumbing, not an engine
  artifact and not a transcript message.
- Supported control kinds for this rewrite phase:
  - `manual_summarize`,
  - `compaction_request`,
  - `subtask_request`,
  - `wake_reason`.
- The previous `continuation_pending` design is explicitly withdrawn for this
  phase. A pending control that the loop cannot consume is worse than no
  continuation because it suppresses standby and can replay the old last user
  turn. Auto compaction must either continue synchronously in the same loop
  after the durable boundary is written, or stop with a visible error. A
  restart-durable continuation record is deferred until it is descriptor-backed
  end to end.
- Control records must never be written as `role: "user"`, `role:
"assistant"`, `CompactionPart`, or `SubtaskPart`.
- Control records must never enter provider replay directly. The loop converts
  a consumed control record into a normal prompt envelope only when that control
  kind requires a model turn.
- Every control kind must define owner, consume-once behavior, model replay
  behavior, UI visibility, and restart behavior:

| Control kind         | Owner                  | Consume once | Provider replay                    | UI projection    |
| -------------------- | ---------------------- | ------------ | ---------------------------------- | ---------------- |
| `manual_summarize`   | session route          | yes          | summary-mode maintenance turn only | maintenance card |
| `compaction_request` | session loop           | yes          | summary-mode maintenance turn only | maintenance card |
| `subtask_request`    | session loop           | yes          | only via owning prompt envelope    | control card     |
| `wake_reason`        | scheduler/orchestrator | yes          | only via owning runtime            | control card     |

Acceptance:

- `rg` finds no new compaction/subtask/wake control writes to `Message.Part`.
- A model replay after compaction contains no literal internal control text such
  as "Context compaction checkpoint" unless that text is explicitly rendered
  from the structured handoff for model context.
- Manual summarize creates a control record and summary assistant, but no
  continuation record.
- Auto compaction creates a consumed request, writes the durable compaction
  boundary to the real source user message, and re-enters the loop with
  `Message.filterCompacted()` output. It must not write any dormant
  continuation control.
- Subtask and wake controls are consumed once and do not appear as fake user
  messages.

## Phase 2: Add Restart-Durable Continuation Record

Files:

- `packages/opencorvus/src/session/control.ts`
- `packages/opencorvus/src/session/compaction.ts`
- `packages/opencorvus/src/session/wake.ts`
- `packages/opencorvus/src/session/loop.ts`
- `packages/opencorvus/test/session/compaction-continuation.test.ts`

Change:

- Introduce one restart-durable continuation record only after the
  `WorkerTurnDescriptor` can reinstall the worker model, tool set, terminal
  collector, output format, and runtime ownership without reading message
  extras as a parallel source of truth.
- The continuation record must carry:
  - continuation id,
  - `WorkerTurnDescriptor` id,
  - `WorkerTurnDescriptor` hash,
  - source user message id,
  - summary assistant id,
  - structured handoff artifact/object id,
  - tail start id,
  - anchor id,
  - session id,
  - status,
  - owner/lease metadata for consume-once safety,
  - created/consumed/failed timestamps.
- The continuation record must not copy agent/model/tools/system/extra fields
  from the historical user message. Those fields are validated through the
  descriptor hash and executable runtime installer.
- The continuation record must be visible to `SessionPrompt.loop` after restart.
- The loop must consume the continuation by starting a normal business worker
  turn from the `WorkerTurnDescriptor`.
- Once consumed, the continuation must be marked consumed or made structurally
  non-repeatable.

Acceptance:

- Crash/restart test: after valid summary is written but before business
  assistant output exists, a fresh `SessionPrompt.loop({ sessionID })` resumes
  the business turn instead of throwing `before continuation`.
- Duplicate wake test: two concurrent loop calls after the same summary consume
  exactly one continuation.
- Tool surface test: resumed build turn has build tools, not only
  `StructuredOutput`.
- Tamper test: mutating stored source user `model`, `tools`, or
  `extra.runtimeContract` does not alter the resumed continuation.

## Phase 2B: Conversation And Control Projection

Files:

- `packages/opencorvus/src/conversation/view.ts`
- `packages/opencorvus/src/server/routes/session.ts`
- `packages/opencorvus/src/server/routes/orchestrator.ts`
- `packages/opencorvus/src/session/control.ts`
- `packages/opencorvus/src/session/message.ts`
- `packages/opencorvus/src/protocol/tree-writer.ts`
- `packages/opencorvus/src/overlay/*CardParts*`
- `packages/sdk/openapi.json`
- `packages/sdk/js/src/gen/types.gen.ts`
- `packages/opencorvus/test/conversation/*.test.ts`
- `packages/opencorvus/test/server/*.test.ts`

Change:

- Conversation APIs must project session control records as control/maintenance
  cards, not as transcript messages.
- The public `Message.Part` union should not gain replacement fake control
  parts. If an API needs control visibility, expose a separate control-card
  projection with stable type names and schema.
- Sorting must be deterministic across transcript messages, control records,
  and protocol events. Ties must include id-desc or another stable tiebreaker.
- Overlay rendering must display:
  - compaction requested,
  - summary completed,
  - continuation pending,
  - continuation consumed,
  - continuation failed,
  - wake/subtask requested.
- Control cards are hidden from provider replay and transcript export unless an
  export mode explicitly asks for execution diagnostics.

Acceptance:

- Conversation route tests prove compaction/subtask/wake controls appear as
  control cards and not `role: "user"` / `role: "assistant"` messages.
- Overlay tests prove old `CompactionPart`/`SubtaskPart` render paths are gone
  or only support historical read-only residue.
- SDK/OpenAPI generation is updated or a test proves no public schema changed.
- Negative replay test proves no control-card display text is included in model
  input.

## Phase 3: Structured Handoff Is The Only Source

Files:

- `packages/opencorvus/src/session/compaction-handoff.ts`
- `packages/opencorvus/src/session/compaction.ts`
- `packages/opencorvus/src/memory/flush.ts`
- `packages/opencorvus/src/session/message.ts`
- `packages/opencorvus/test/session/compaction.test.ts`
- `packages/opencorvus/test/memory/*.test.ts`

Change:

- Store and validate the `CompactionHandoff` structured object as the only
  authoritative summary.
- Rendered Markdown is display-only and must be regenerated from structured
  data.
- Follow-up compaction merge must read the structured object, not text parts.
- Memory flush must read the structured object and render from it, not parse
  Markdown.
- `assistant.structured` must be typed as the handoff schema for compaction
  summaries rather than accepted as `z.any()` for this path.

Acceptance:

- Tampering with rendered Markdown does not change follow-up compaction input.
- Tampering with structured handoff invalidates the summary boundary.
- Memory flush rejects summaries without a valid structured handoff.
- Renderer determinism test proves the same handoff object always produces the
  same Markdown.

## Phase 4: Fix Tail And Anchor Boundaries

Files:

- `packages/opencorvus/src/session/compaction.ts`
- `packages/opencorvus/src/session/message.ts`
- `packages/opencorvus/test/session/message.test.ts`
- `packages/opencorvus/test/session/compaction-build-session-tail.test.ts`

Change:

- `tail_start_id` may only reference a real user turn boundary.
- Assistant `step-start` may not become a retained tail start.
- If a recent assistant-heavy region cannot fit without its user turn, compact
  that region into the handoff instead of retaining an assistant-only suffix.
- `filterCompacted()` must reject assistant-only retained tail even when an
  anchor is present.

Acceptance:

- A huge build turn never produces assistant id as `tail_start_id`.
- `filterCompacted()` never returns history that begins the retained tail with
  assistant when a source user turn exists.
- Existing complete user-turn tail preservation remains intact.

## Phase 5: Compaction Prompt Contract Hygiene

Files:

- `packages/opencorvus/src/agent/role-contract.ts`
- `packages/opencorvus/src/agent/agent.ts`
- `packages/opencorvus/src/session/compaction.ts`
- `packages/plugin/src/index.ts`
- `packages/opencorvus/test/agent/*.test.ts`
- `packages/opencorvus/test/session/compaction.test.ts`

Change:

- This phase is config/UI hygiene, not the primary incident fix. The incident
  root cause is the continuation/runtime boundary; compaction already uses
  host-owned `buildPrompt()` plus structured schema and an empty system stack.
- `compaction` agent prompt must not be config-replaceable.
- Plugin `experimental.session.compacting` remains context-only.
- No plugin or config path may replace the host-owned handoff schema or prompt
  contract.
- Generic chat system transform must not apply to compaction maintenance turns,
  or must be proven unable to weaken the structured handoff contract.

Acceptance:

- Typecheck prevents plugin callers from returning a prompt replacement.
- Configuring `agent.compaction.prompt` cannot remove host handoff instructions.
- A plugin context string appears as evidence context only.
- A plugin cannot cause non-handoff summary acceptance.

## Phase 6: Remove Legacy And Prune Side Paths

Files:

- `packages/opencorvus/src/session/compaction.ts`
- `packages/opencorvus/src/session/message.ts`
- `packages/opencorvus/src/memory/flush.ts`
- `packages/opencorvus/script/*compaction*.ts`

Change:

- Delete legacy prose `assistant.summary` boundary acceptance.
- Delete "summary=true and no error" as a valid compact boundary.
- Remove or rewrite `SessionCompaction.prune()` so tool output mutation is not
  a second compression mechanism.
- Add a dry-run diagnostic for old compact residue:
  - failed compaction summaries,
  - empty placeholders,
  - legacy prose summaries,
  - assistant-only tail markers,
  - stale continuation markers.

Acceptance:

- Legacy prose summaries are displayed as ordinary assistant messages, not used
  as compact boundaries.
- Memory flush rejects legacy summaries.
- Diagnostic identifies the incident session residue without rewriting it into a
  valid handoff.
- Repair mode, if added, only deletes exact structural residue after backup; it
  never invents summaries.

## Phase 7: State Projection Regression Guard

Files:

- `packages/opencorvus/src/engine/describe.ts`
- `packages/opencorvus/src/engine/store.ts`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/test/engine/*.test.ts`
- `packages/opencorvus/test/orchestrator/*.test.ts`

Change:

- Audit and test that failed compact attempts and later retry attempts project
  deterministically. Do not redesign engine projection unless the regression
  proves the current latest-wins helpers are wrong.
- Board/progress must prefer latest-per-goal attempt by artifact time/id and must
  not expose stale `attempt-running` as current.
- Raw duplicate `attempt-completed` artifacts must either be impossible or be
  harmless under a documented latest-wins projection.
- If a helper is missing, add one scoped helper such as
  `currentGoalAttempt(goal_id)` that orders by artifact time and id. Avoid a new
  engine status source.

Acceptance:

- Reproduced incident projection shows goal #6 failed attempt followed by retry
  passed, with current status passed.
- Run remains active only when integrity or another live phase is actually
  running.
- Tests cover consumers that read board/progress, not raw artifact guesses.

## Phase 8: Agent Catalog And Prompt Config Hygiene

Files:

- `packages/opencorvus/src/agent/agent.ts`
- `packages/opencorvus/src/agent/role-contract.ts`
- `packages/opencorvus/src/agent/model.ts`
- `packages/opencorvus/src/config/prompt-catalog.ts`
- `packages/opencorvus/src/session/loop.ts`
- `packages/opencorvus/src/agent/runner.ts`
- `packages/opencorvus/test/agent/*.test.ts`
- `packages/opencorvus/test/session/*runtime-contract*.test.ts`

Change:

- This phase removes remaining catalog/config double-source behavior after the
  `WorkerTurnDescriptor` is in place.
- `Agent.get()` may still build the catalog of available agent definitions, but
  a session loop must not infer runtime behavior directly from the catalog plus
  a user message envelope.
- `AgentRoleContract` owns role policy. `prompt-catalog.ts` must render from the
  same role-policy helper and must not reimplement prompt-mode rules.
- `resolveAgentModelRef()` remains the only model resolver. Persisted messages
  may record the model actually used for audit, but replay/continuation must
  not derive model choice from historical user messages.
- `runAgentSession()` must install the worker descriptor once, then install
  executable closures from that descriptor. It must not use user
  `extra.runtimeContract` as a parallel source of runtime truth.
- Keep the orchestrator exception explicit: orchestrator wake has its own
  runtime contract because its lifecycle is not a runner-managed worker turn.

Acceptance:

- Tests prove `compaction` prompt cannot be config-overridden because it is an
  internal maintenance role with a host-owned handoff contract.
- `rg` finds no second prompt-mode switch outside the shared helper.
- Tests prove no runner-managed worker continuation reads `Agent.get()` or
  historical user message fields as the active execution contract.

## Phase 9: Task Operator Input Single Source

Files:

- `packages/opencorvus/src/task-api/index.ts`
- `packages/opencorvus/src/engine/helpers.ts`
- `packages/opencorvus/src/server/routes/orchestrator.ts`
- `packages/opencorvus/src/workbench/note-store.ts`
- `packages/opencorvus/src/workbench/board.ts`
- `packages/opencorvus/src/workbench/brief.ts`
- `packages/opencorvus/test/task-api/*.test.ts`
- `packages/opencorvus/test/engine/*.test.ts`

Change:

- Task-level operator messages must have one durable truth.
- Prefer root session messages as the truth because conversation/transcript
  already reads them.
- `WorkbenchTaskNote` may remain only as an index/projection if needed. It must
  not be a separate prompt source with different coverage than transcript.
- `operatorNotesSection()` and orchestrator describe must derive from the same
  source as task conversation, or the note table must be explicitly documented
  as a projection regenerated from root session messages.

Acceptance:

- `handleTaskMessage` and `injectMessage` produce the same source-visible
  operator context for orchestrator describe.
- Deleting/regenerating note projections does not lose operator prompt facts.
- Tests prove transcript and describe cannot disagree about the latest operator
  message.

## Phase 10: Progress Snapshot Contract Check

Files:

- `packages/opencorvus/src/engine/state.ts`
- `packages/opencorvus/src/engine/pipeline.ts`
- `packages/opencorvus/src/task-api/index.ts`
- `packages/opencorvus/test/engine/*.test.ts`

Change:

- Assert and document that `engine_progress_snapshot` is a diagnostic/timeline
  surface, not current status truth. Do not redesign this area unless a
  regression test proves a stale snapshot can override board/current state.
- `/progress` may include snapshots, but current task/run/goal status must be
  derived from board/read-model facts: task, run artifacts, goal_run_attempt,
  acceptance, and live session status.
- UI consumers must not prefer progress snapshots over board projection.

Acceptance:

- A stale progress snapshot cannot make a passed goal appear running.
- `/progress` documents snapshots as timeline entries.
- Tests cover the incident shape: failed compact attempt, retry passed, current
  goal status passed.

## Non-Goals

- Do not make a second memory system.
- Do not summarize durable instruction files into handoff text as a replacement
  for disk reload.
- Do not add provider-specific fallback behavior.
- Do not add non-streaming LLM calls.
- Do not silently recover old invalid summaries by rewriting them.
- Do not introduce a new global engine-level agent-invocation truth that
  competes with `engine_artifact` domain facts.

## Required Regression Tests

Targeted tests:

- `bun test packages/opencorvus/test/session/compaction-continuation.test.ts`
- `bun test packages/opencorvus/test/session/compaction.test.ts`
- `bun test packages/opencorvus/test/session/compaction-build-session-tail.test.ts`
- `bun test packages/opencorvus/test/session/session-control.test.ts`
- `bun test packages/opencorvus/test/session/message.test.ts`
- `bun test packages/opencorvus/test/session/predictive-compaction-decision.test.ts`
- `bun test packages/opencorvus/test/conversation/*.test.ts`
- `bun test packages/opencorvus/test/server/*.test.ts`
- `bun test packages/opencorvus/test/task-api/*.test.ts`
- `bun test packages/opencorvus/test/orchestrator/*.test.ts`
- `bun test packages/opencorvus/test/memory/index.test.ts`
- `bun test packages/opencorvus/test/engine/*.test.ts`

Incident regression assertions:

- A compacted workflow build session cannot end with
  `Session prompt loop ended after internal compaction summary checkpoint before continuation`.
- After a valid summary checkpoint and process restart, a normal business
  continuation resumes with the `WorkerTurnDescriptor` tool surface.
- Compaction maintenance turn cannot execute `bash`, `edit`, `report_build_result`,
  or any business tool after `StructuredOutput`.
- `tail_start_id` is never an assistant message id.
- Legacy prose summary cannot compact away older history.
- Control records never appear as provider-visible user/assistant messages.
- Tampering with stored source user `model`, `tools`, or
  `extra.runtimeContract` does not change resumed worker execution.
- Manual summarize does not schedule continuation.
- Wake and subtask controls are consume-once and do not create fake user
  messages.
- Conversation, task API, orchestrator, overlay, and SDK/OpenAPI surfaces either
  expose typed control cards or prove their schema is unchanged.

Manual HTTP probes for the incident task:

```powershell
$server = 'http://127.0.0.1:7878'
$dir = 'D:\myhexin-local\demos\tradingview-screener-exhaustive'
$task = 'tsk_e733a9837001gu02wunRbcji5p'
Invoke-RestMethod -Uri "$server/task/$task/board" -Headers @{ 'x-opencorvus-directory' = $dir } | ConvertTo-Json -Depth 30
Invoke-RestMethod -Uri "$server/task/$task/conversation/session/ses_18c9f9760ffefEdsNIPJJJRIXz" -Headers @{ 'x-opencorvus-directory' = $dir } | ConvertTo-Json -Depth 30
Invoke-RestMethod -Uri "$server/task/$task/conversation/session/ses_18cc55262ffegcQuXM7lIxfxZ3" -Headers @{ 'x-opencorvus-directory' = $dir } | ConvertTo-Json -Depth 30
```

Expected incident facts before repair:

- Failed old build session contains compaction marker and the unavailable
  `bash` after StructuredOutput.
- Retry build session contains `report_build_result` completed.
- Board projects the latest goal #6 attempt as passed after retry.

## Implementation Gate

Before code changes start, run a full call-site grep and update the work plan
with every keep/delete/replace decision for:

- `SessionCompaction.create`
- `SessionCompaction.process`
- `SessionCompaction.prune`
- `Message.filterCompacted`
- `assistant.summary`
- `CompactionHandoff.isValidSummaryMessage`
- `maintenanceSummaryFailureMessage`
- `selectPromptFinalMessageFromNewest`
- `flushPromptFinalMessage`
- `shouldEnterStandby`
- `result_mode: "summary"`
- `experimental.session.compacting`
- `agent.compaction.prompt`
- `AgentRoleContract`
- `promptConfigMode`
- `Agent.get`
- `Agent.nativeDefaultPrompt`
- `resolveAgentModelRef`
- `SessionRuntimeContract`
- `WorkerTurnDescriptor`
- `OrchestratorWakeRuntime`
- `SessionControlRecord`
- `session_control_record`
- `extra.runtimeContract`
- `WorkbenchTaskNote`
- `operatorNotesSection`
- `engine_progress_snapshot`
- `conversation/view.ts`
- `server/routes/session.ts`
- `server/routes/orchestrator.ts`
- `tree-writer.ts`
- `packages/sdk/openapi.json`
- `packages/sdk/js/src/gen/types.gen.ts`
- `workbench/note-store.ts`
- `workbench/board.ts`
- `workbench/brief.ts`

No implementation is accepted unless the tests above reproduce the incident
shape and prove it cannot recur.
