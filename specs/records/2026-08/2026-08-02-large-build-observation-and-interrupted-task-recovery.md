# Large Build Observation and Interrupted Task Recovery Root Repair

Date: 2026-08-02
Status: implemented and verified
Owner: Codex

## Recall

### User request

- Diagnose why Mission Session `ses_0472d0466ffeivLOlZpqgk4wEb` appeared idle with one Agent card and no visible messages or tools.
- Systematically repair the proven root causes rather than mutate the historical production row or add a Task-specific workaround.
- Start the repair after the diagnosis and repair design were reviewed.
- Diagnose and repair why Research Studio Mission Session
  `ses_041de0adeffen0id4T4g3deGyI` stalled while building a USGS earthquake
  monitoring site, why a nominal one-million-token model reported an output
  length failure when context diagnostics were near 150,000 tokens, and why
  the Task remained active instead of failing.

### Acceptance criteria

1. Build Host observation cannot materialize the aggregate text contents of a large project in Bun memory or one Engine Artifact JSON payload.
2. Every changed file uses one immutable Git-owned content identity; selected file bodies are read on demand rather than copied into a second durable content source.
3. An Orchestrator provider stream that exhausts the canonical LLM Activity retries closes the physical Session and Task execution window with durable interrupted terminal facts instead of leaving `time_completed=null`.
4. A persisted worker occurrence that lacks the now-required package revision is never resumed against a guessed installed package.
5. One incompatible interrupted Task cannot make project initialization or every Task/Session event route fail.
6. Conversation hydration exposes the real terminal Task, Orchestrator/worker Session lifecycle, and exact child transcript without fabricating a chat message.
7. Existing production database rows, the running backend on port 7878, and the running Overlay remain untouched during implementation and verification.
8. Focused tests assert positive current contracts. No UI automated test is added, changed, or run.
9. Real Desktop/browser acceptance uses a fresh isolated project, manual interaction, screenshots bound to the affected Conversation region, and a second visual review.
10. Task-owned changes are committed with the `dsw-33987` subject prefix and pushed to `myhexin/v0.0.28beta` without bypassing hooks.
11. A worker continued after an Agent coordination handoff cannot bypass the
    owning dispatch adapter's typed-output validation and persistence.
12. Context diagnostics distinguish the model context window, catalog output
    limit, effective runtime output cap, estimated input/context use, and
    provider finish reason.

### Hard constraints

- Preserve unrelated concurrent work. Do not stash, reset, restore, broadly format, or broadly stage.
- Do not migrate or edit the production database.
- Do not infer a missing Expert Squad package revision from the currently installed package, manifest ID, label, or namespace.
- Do not retain full-body and reference-only Build observations as parallel schemes.
- Do not add size thresholds, memory gates, provider-error keyword classifiers, automatic retry state machines, package aliases, recovery fallbacks, or synthetic messages.
- Preserve LLM Activity as the single bounded retry owner inside one physical model call.
- Preserve `terminalTask` as the canonical terminal Task writer and canonical Session status publication as the participant lifecycle writer.
- Use Git object identity as the one immutable Build content source.
- Delete the unused stream-error fuse and its obsolete threshold test when touching that path.
- Do not modify or run UI automated tests. UI acceptance is real interaction and manual screenshot review only.

### Sources read

- `AGENTS.md`
- `specs/current/architecture/02-data.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/07-panel.md`
- `specs/current/architecture/13-agent-communication-matrix.md`
- `specs/current/architecture/15-agent-facts-and-turns.md`
- `specs/current/architecture/17-code-work-agent-platform.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-02-runtime-status-timing-root-repair.md`
- `specs/records/2026-07/2026-07-25-research-deliverable-case-benchmark.md`
- `specs/records/2026-07/2026-07-30-orchestrator-capability-search-startup-visibility-repair-plan.md`
- `specs/records/2026-08/2026-08-01-dispatch-occurrence-process-recovery-root-repair.md`
- `packages/opencorvus/src/snapshot/{index,types}.ts`
- `packages/opencorvus/src/build/agent.ts`
- `packages/opencorvus/src/engine/{persist,queue,store,task-status,state,workflow-binding,workflow-binding-facts}.ts`
- `packages/opencorvus/src/orchestrator/{agent,loop,build-tool,task-event}.ts`
- `packages/opencorvus/src/session/{runtime-contract,status,status-publication}.ts`
- `packages/opencorvus/src/agent/{runner,worker-turn-descriptor,dispatch-outcome}.ts`
- `packages/opencorvus/src/server/routes/{session,task}.ts`
- `packages/overlay/src/services/diff.ts`
- `packages/overlay/src/utils/debug-info.ts`

### Live read-only evidence

The production database was opened only through SQLite `immutable=1`.

| Fact | Evidence |
| --- | --- |
| Mission Session | `ses_0472d0466ffeivLOlZpqgk4wEb`, six messages and 33 parts. |
| Phase 1 Task | `tsk_fb8d5b65b001Om84Ju1pviy7jq`, started 2026-07-31 15:40:41 UTC, `error` populated, `time_completed` null. |
| Task root Session | `ses_0472a498effeYBsmkJmU50eASD`, zero messages and zero parts. |
| Orchestrator Session | `ses_0472a4511ffe3gq379Rv6i2mJP`, 23 messages and 124 parts. |
| First infrastructure trigger | Two `task.infrastructure.failed` events for `persist-git-workspace`, both `Out of memory`. |
| Project shape | Approximately 3.2 GiB under `data/`; commit `dfc4093` contains the first normalized dataset delivery. |
| Provider trigger | `https://api.deepseek.com/chat/completions` exhausted two visible retry sequences and ended with `Cannot connect to API`. |
| Lifecycle defect | The error catch wrote `task.error` without `time_completed`; `deriveTaskStatus` therefore returned active. |
| Recovery defect | Current recovery rejects old Worker Turn Descriptors because `packageRevision` is absent, then throws one aggregate bootstrap error. |
| Visible result | `/task/events` and `/session/.../events` return 500; the Mission card cannot hydrate the real child failure/transcript. |
| Research Studio Phase 03 | Task `tsk_fbec20540001w66e0q9UIx2Ocj` remained active after Orchestrator Session `ses_0413df667ffeOv1lPcWUTDJfjm` became idle with `MessageOutputLengthError`. |
| Missing typed output | Architect Session `ses_0413979e5ffeLO2rhDGVVRPUjx` registered five Goals and five Contracts in its in-memory collector, then handed control to the Orchestrator. No `architect_contract_graph` or `goal_graph_projection` Artifact was persisted. |
| Continuation bypass | `respond_agent_coordination(decision=continue)` called the runner-owned `continueSession` directly. The continued physical Turn ended, but `createArchitectStageDispatcher` was never re-entered, so its validation and persistence block did not run. |
| Repeated reasoning | The Orchestrator repeatedly searched for the absent ContractGraph/Goal projection. Its context estimate grew from 73,565 to 152,735 total tokens across seven steps. |
| Real length boundary | Live provider metadata declares context `1,000,000` and output `384,000`, while `ProviderTransform.OUTPUT_TOKEN_MAX` defaults to `32,000`. The final assistant part contains 142,601 reasoning characters and provider finish reason `length`; this is an effective single-response output-cap failure, not a one-million-token input-context failure. |
| Missing usage truth | The interrupted assistant row retained zero token counters, so the durable error and diagnostics could not show the requested 32,000-token cap or separate input and output budgets. |
| Operator output-cap decision | After reviewing the proven 32,000-token runtime boundary, the user explicitly requested a 64,000-token default output cap. Explicit environment override and smaller model-owned limits remain authoritative. |

The historical worker descriptors prove the compatibility boundary: they
contain identity, model, prompt, tools, output, and lifecycle but no
`packageRevision`. That missing immutable identity cannot be reconstructed
without guessing.

### Repository-wide search inventory

The pre-implementation searches were:

```text
rg -n "Snapshot.diffFull|trackRequired|FileDiff|recordTaskLevelBuildHostObservation|build_host_observation|git-workspace"
rg -n "recordOrchestratorStreamError|Orchestrator failed|time_completed|terminalTask|deriveTaskStatus"
rg -n "reconcileInterruptedTaskExecutions|recover-interrupted-task-execution|packageRevision|WorkerTurnDescriptor"
rg -n "conversation/session|agentView|session.error|task.updated|build_host_observation|payload.diffs"
rg -n "maybeTripOrchestratorStreamErrorFuse|ORCHESTRATOR_STREAM_ERROR_FUSE"
rg -n "isAgentCoordinationHandoffResult|continueSession|executionAdapter|respond_agent_coordination"
rg -n "OUTPUT_TOKEN_MAX|maxOutputTokens|context diagnostics|MessageOutputLengthError|finish.*length"
```

#### Complete call-site disposition

| Owner or caller | Disposition |
| --- | --- |
| `snapshot/index.ts::diffFull` | Replace aggregate full-body return with immutable Git blob identities and file statistics. It must not collect every blob into one `ArrayBuffer`/Map. |
| `snapshot/types.ts::FileDiff` | Replace `before`/`after` strings with exact before/after Git blob references and byte metadata. One schema replaces the old schema. |
| `build/agent.ts` current-project observation | Keep baseline and terminal snapshot ownership, but pin the terminal observation with a durable Git reference and emit metadata-only file records. |
| `build/agent.ts` managed-worktree observation | Keep contribution-base semantics. Emit the same metadata-only schema from exact contribution refs. |
| `engine/persist.ts::recordTaskLevelBuildHostObservation` | Persist compact refs/stats only; never store file bodies. |
| `engine/store.ts::viewBuildHostObservationArtifact` | Parse the replacement schema and project changed-file summaries without eagerly reading content. |
| `session/summary.ts` | Consume metadata-only diffs for summary counts. |
| `overlay/services/diff.ts` | Stop treating Engine Artifact JSON as the body source; request an exact selected-file Git blob/diff resource on demand. |
| `overlay/utils/debug-info.ts` | Continue summing file/stat metadata from the compact observation. |
| Build diff server route | Add or reuse one Task-authorized exact Git-object reader with byte-range pagination; no project-working-tree fallback. |
| `llm/activity.ts` | Preserve as the sole retry/backoff/deadline implementation for a physical provider stream. |
| `orchestrator/agent.ts` pre-message catch | Preserve the implemented startup-failure funnel and terminal failure contract. |
| `orchestrator/agent.ts` post-message provider failure catch | Replace `updateTask({error})` with one physical-interruption settlement: stream-error Artifact, terminal-error Session, and `terminalTask` with interrupted metadata/time. |
| `orchestrator/loop.ts` | Continue one external wake per decision pass. Do not auto-rewake provider failures. Explicit Retry/Replan creates the next execution window. |
| `engine/persist.ts::maybeTripOrchestratorStreamErrorFuse` | Delete unused threshold gate and its threshold test. |
| `engine/queue.ts::reconcileInterruptedTaskExecutions` | Recover valid complete contracts; convert an exact incompatible persisted occurrence into task-scoped infrastructure + terminal interruption facts; continue processing the project. |
| `worker-turn-descriptor.ts` | Keep strict package revision validation for new descriptors. Missing revision is a typed incompatible persisted occurrence, not a defaultable value. |
| `workflow-binding.ts` / `workflow-binding-facts.ts` | Preserve the first selected workflow's exact package revision as the scheduler resume authority. |
| `session/runtime-contract.ts` | Keep strict package revision equality; do not weaken parsing. |
| `project/bootstrap.ts` | Project open must receive per-Task recovery results rather than fail the whole project for one terminalized incompatible occurrence. |
| Task/Session conversation routes | Hydrate real Session ledger/lifecycle facts after recovery isolation. Do not synthesize messages from Task summaries. |
| Overlay Conversation | Reuse real lifecycle cards and exact-session dock. Change UI only if manual acceptance proves backend facts remain invisible. |
| `agent/runner.ts::continueSession` | Preserve same-Session continuation, but return an adapter-owned settlement rather than declaring a raw physical `stream_ended` to be domain completion. |
| `session/runtime-contract.ts::ProjectedWorkerExecutionAdapter` | Carry the owning adapter continuation settlement contract and exact output-budget facts; a physical Turn alone is not typed adapter success. |
| Domain Agent completion functions | Reuse the same collector snapshot/provenance conversion after both the initial physical Turn and a continued physical Turn. |
| `orchestrator/architect-stage.ts` | Install the Architect continuation settlement callback and run the same ContractGraph/GoalGraph validation and persistence used by an uninterrupted dispatch. |
| `orchestrator/tools.ts::respond_agent_coordination` | Complete the coordination action only after the bound adapter settlement completes; expose typed terminal/partial/infrastructure outcome instead of `stream_ended`. |
| Other coordination-capable adapters | Never report a raw continued Turn as typed adapter success. Until their adapter settlement is bound, return explicit partial/infrastructure evidence rather than silently dropping collector output. |
| `provider/transform.ts` | Keep one effective output-cap owner, raise its default from the incident's 32,000-token boundary to the operator-selected 64,000 tokens, and expose that effective cap to diagnostics and length-error envelopes instead of presenting catalog output capacity as the effective request limit. |
| `session/context-budget.ts` and context diagnostics | Report context and output budgets as separate quantities. Do not describe output exhaustion as context-window exhaustion. |

### Independent agent feedback

No independent Agent was requested. Current collaboration rules prohibit
implicit delegation, so the primary Agent owns implementation and second
review.

## Causal chain

### Observable symptom

The Mission showed one idle Agent card with zero visible messages/tools even
though the Task had run for hours.

### Direct triggers

1. Build terminal observation attempted to serialize a multi-gigabyte working
   set and exhausted memory.
2. The repair Build and later Orchestrator wake exhausted DeepSeek network
   retries.
3. The provider-error catch persisted an error without completing the Task.
4. A later application version attempted to recover the active orphan through
   a stricter runtime contract that the old descriptor cannot satisfy.

### Deep design causes

- Build evidence conflates compact change identity with full file-content
  transport and stores both in one Engine Artifact JSON value.
- A terminal physical provider failure is represented as a non-terminal Task
  error even though no participant owns the promised later decision.
- Process recovery treats one invalid historical occurrence as a project-wide
  bootstrap exception.
- The UI's real child-Session projection is starved by the failed backend
  hydration, so the empty root Session becomes the only visible transcript
  fact.

### Why previous repairs did not cover this case

- The startup visibility repair correctly terminalizes failures before the
  first message but explicitly retained the older mid-prompt stream-error
  contract.
- Process recovery tests use current descriptors that already include exact
  package revisions.
- Build Host observation tests use small source files and assert payload
  structure, not aggregate memory ownership.
- Conversation tests prove child-session hydration only when project bootstrap
  succeeds.
- Output-limit handling correctly classified `finish=length`, but it did not
  include the effective request cap and intentionally left Task lifecycle to a
  later scheduler wake.
- Agent coordination made the physical Session resumable, but treated the
  runner's physical Turn completion as equivalent to the dispatch adapter's
  typed domain completion. The original dispatcher stack had already returned,
  so no owner remained to persist the collector.

## Decision

### Canonical Build observation

The immutable Git object database is the single file-content source.

Each changed-file observation contains:

- relative path;
- added/deleted/modified status;
- additions and deletions;
- exact before/after Git blob object IDs when present;
- exact before/after byte counts; and
- the pinned base/head observation refs.

The Host pins the observation refs durably. Engine Artifact payloads contain
only identity and statistics. Exact file content or a textual diff is streamed
for one selected path from the pinned objects through a Task-authorized route.
There is no body-size branch and no working-tree fallback.

### Canonical provider-exhaustion settlement

LLM Activity performs bounded internal retry. Once it returns a terminal
provider error:

- preserve the exact stream error Artifact;
- publish a terminal-error Orchestrator Session;
- terminalize the Task's current physical execution as interrupted with one
  completion timestamp; and
- require an explicit operator Retry/Replan to create a new execution window.

This is physical lifecycle truth, not a Host-authored business judgment.

### Canonical incompatible recovery

Recovery accepts only a complete persisted occurrence whose exact package
revision can be validated against its binding/descriptor. Missing revision
produces a typed task-scoped infrastructure fact, terminal interrupted Task,
and terminal affected Sessions. Recovery continues with other Tasks and
project bootstrap succeeds. No package revision is guessed or migrated.

### Canonical visibility

Conversation remains a projection of real messages, Session lifecycle, Task
lifecycle, and protocol facts. Once recovery no longer aborts hydration, the
existing task card and exact child-session transcript are the intended UI.

### Canonical coordination continuation

The projected dispatch adapter remains the owner of typed output across a
coordination pause. The runner owns only the physical Session Turn. A same-
Session continuation therefore completes in this order:

1. append the visible Orchestrator response;
2. run the continued physical worker Turn;
3. snapshot and validate the stage collector through the same Agent completion
   function used by an uninterrupted Turn;
4. run the same dispatch-adapter persistence transaction;
5. settle the coordination action with the typed dispatch outcome.

The action cannot translate `stream_ended` into success. If an adapter has no
continuation settlement owner, the result is explicit partial/infrastructure
evidence and the Task can converge through its normal terminal error contract;
the Orchestrator does not search indefinitely for output that was never
committed.

### Canonical context and output budget truth

The model catalog's context window and output capacity are capabilities, not
the effective request limits. Each model call records:

- catalog context limit;
- catalog output limit;
- effective runtime output cap after `ProviderTransform`;
- estimated input/context consumption before the call;
- provider finish reason; and
- provider-reported usage when available.

`finish=length` is reported as output exhaustion with the effective output cap.
It is never labeled a one-million-token context overflow merely because the
input estimate is present in the same diagnostic record.

## Implementation sequence

1. Land this Recall and implementation contract; update both spec indexes.
2. Commit and push the plan baseline.
3. Replace `FileDiff` full bodies with Git object identities and metadata.
4. Pin observation refs and add exact Task-authorized selected-file reading.
5. Update Engine Store/server/Overlay consumers to the single replacement
   schema.
6. Replace post-message provider-error non-terminal writes with physical
   interruption settlement.
7. Bind Architect same-Session continuation to its original typed completion
   and persistence path; make unbound adapter continuation explicit rather
   than reporting raw `stream_ended` success.
8. Add separated context/output-budget evidence to diagnostics and output-limit
   errors.
9. Delete the unused stream-error fuse and its obsolete threshold test.
10. Isolate incompatible interrupted occurrences during recovery and keep
   project bootstrap healthy.
11. Add positive non-UI regressions.
12. Run focused tests, typecheck, route/docs checks, document health, and diff
    integrity.
13. Build/package a fresh Desktop target and manually verify healthy and
    controlled-failure Conversation screenshots without touching production.
14. Perform a second scoped review, update this record with results, commit,
    and push `myhexin/v0.0.28beta`.

## Positive verification plan

- Snapshot/Build observation:
  - exact metadata schema references pinned Git objects;
  - reading a selected before/after object returns the exact expected bytes;
  - observation payload size is determined by file metadata, not file bodies.
- Orchestrator lifecycle:
  - exhausted retry produces one stream-error Artifact;
  - Orchestrator Session is terminal error;
  - Task has `time_completed` and `terminalReason=interrupted`.
- Coordination continuation:
  - an Architect that hands off after registering typed facts persists the
    exact ContractGraph and executable GoalGraph projection after continuation;
  - the coordination action records the adapter's terminal outcome, not a raw
    Session-loop completion;
  - a coordination-capable adapter without a bound finalizer yields explicit
    non-success evidence.
- Budget diagnostics:
  - a one-million-token context model with the operator-selected default
    runtime cap reports `context_limit=1000000` and
    `effective_output_limit=64000`;
  - `finish=length` reports output exhaustion even when estimated context use
    is well below the context limit.
- Recovery:
  - a complete current descriptor resumes with its frozen package revision;
  - an old descriptor missing package revision produces one exact
    `runtime-contract-incompatible` terminal result;
  - project bootstrap and other Task recovery continue successfully.
- Conversation API:
  - interrupted Task facts and exact child-session lifecycle/transcript are
    returned without a synthetic message.

Focused non-UI commands will be selected from:

```text
bun test packages/opencorvus/test/snapshot
bun test packages/opencorvus/test/build
bun test packages/opencorvus/test/orchestrator/session-hard-error.test.ts
bun test packages/opencorvus/test/orchestrator/session-abort-funnel.test.ts
bun test packages/opencorvus/test/session/dispatch-process-recovery.test.ts
bun test packages/opencorvus/test/server/task-conversation-routes.test.ts
bun run --cwd packages/opencorvus typecheck
bun run api:routes-check
bun run docs:check
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
bun test packages/opencorvus/test/script/product-docs-single-source.test.ts
git diff --check
```

UI acceptance will use Node-driven real interaction and manually inspected
screenshots. No UI test file, fixture, baseline, or automated visual assertion
will be created or run.

## Coordination, budget, and terminal settlement implementation evidence

Implemented on 2026-08-02:

- `ProviderTransform` now uses the operator-selected 64,000-token default
  runtime output cap while preserving explicit environment overrides and
  smaller model-owned limits.
- Session context diagnostics now publish catalog context/input/output limits
  and the effective runtime output limit beside the outgoing request estimate.
- `MessageOutputLengthError` now carries a human-readable output-cap message
  and the effective cap when known; the durable Orchestrator stream-error
  envelope therefore no longer collapses to `{}` for new failures.
- A message-backed Orchestrator hard error terminalizes its Session as
  `terminal/error` and its Task through `terminalTask` as
  `failed + interrupted`. It does not create an automatic retry wake.
- Same-Session coordination continuation now returns the owning typed adapter
  outcome. A raw `stream_ended` is no longer represented as domain success.
- Architect completion was factored into one collector/provenance conversion
  used by both uninterrupted and continued Turns. Its continuation callback
  re-enters the original ContractGraph/GoalGraph persistence function before
  the coordination action settles.
- Adapters that have not yet bound a typed continuation settlement produce an
  explicit `partial` outcome rather than silently dropping their in-memory
  collector.

Verified positive contracts:

```text
bun test packages/opencorvus/test/provider/transform.test.ts \
  packages/opencorvus/test/agent/runner-hard-error-propagation.test.ts \
  packages/opencorvus/test/orchestrator/session-hard-error.test.ts \
  packages/opencorvus/test/orchestrator/architect-coordination-continuation.test.ts \
  packages/opencorvus/test/orchestrator/tools.test.ts \
  --test-name-pattern 'ProviderTransform.maxOutputTokens|buildHardErrorFromFinalMessage|session hard-error funnel|Architect coordination continuation|respond_agent_coordination continue starts|continue recovers|continue supports frontend'
# 15 pass, 0 fail

bun run --cwd packages/opencorvus typecheck
# pass

bun test packages/opencorvus/test/script/historical-docs-links.test.ts \
  packages/opencorvus/test/script/document-health.test.ts \
  packages/opencorvus/test/script/product-docs-single-source.test.ts
# pass
```

## Final implementation and acceptance evidence

Completed on 2026-08-02:

- Build Host observations now persist only per-file status/statistics and exact
  before/after Git blob identities. A private `refs/opencorvus/build-observations`
  base/head pair retains the immutable object graph without putting file bodies
  in Bun memory or Artifact JSON.
- The Task-authorized Build observation content route reads one selected Git
  blob side in bounded 256 KiB byte ranges. Task deletion removes the matching
  private refs before removing the Task Artifact root.
- The Workbench board has a typed Build-observation projection so its generic
  Artifact summary compaction does not erase nested `{oid, bytes}` identities.
  This was found during real-page acceptance: the first page rendered the file
  row but displayed “No changes between before and after” because the generic
  depth limiter had replaced both identities with `{truncated, keys}`.
- Overlay Review keeps only compact identities in its inventory and requests
  the selected textual before/after bodies on demand.
- Provider exhaustion terminalizes the physical Orchestrator Session and Task
  execution window as interrupted; explicit operator Retry/Replan owns a fresh
  execution window. The impossible in-Task Orchestrator `retry_task` surface
  was removed while the external Panel/Gateway retry action remains.
- Persisted worker descriptors missing an exact package revision are
  terminalized as task-scoped runtime-contract incompatibilities without
  aborting project bootstrap or sibling recovery.
- Persisted retry wakes are drained and attached to a fresh root execution
  instead of being reported as started without a live owner.
- The unused Orchestrator stream-error fuse and its obsolete threshold test
  were deleted.

Final non-UI verification:

```text
Build observation and exact content: 11 pass, 0 fail
Recovery, retry wake, and diagnostics: 13 pass, 0 fail
Orchestrator tools: 72 pass, 0 fail
Provider and Integrity focused contracts: 148 pass, 0 fail
Workbench compact Git identity projection: 1 pass, 0 fail
packages/opencorvus typecheck: pass
packages/overlay typecheck: pass
api:routes-check: pass (33 route files)
docs:check: pass (310 operations, 24 groups)
historical/docs health group: 70 pass, 0 fail
git diff --check: pass
```

Real visual acceptance used a fresh production Overlay build, an isolated
`OPENCORVUS_HOME`, an isolated Git project, and a fresh server on
`127.0.0.1:17878`. No production database or port 7878 process was touched.
The manually inspected Conversation showed the terminal Completed fact and one
changed file. Opening Review caused real successful before/after content
requests and rendered the expected red
`return "legacy aggregate body";` line and green
`return "immutable Git object, loaded on demand";` line. A second screenshot
review confirmed the Conversation, Delivery/Files changed summary, expanded
Diff panel, and single-titlebar layout. No UI automated test, fixture, or
baseline was created or run.
