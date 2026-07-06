# Direct Build Outcome and Visual QA Contract Repair

Date: 2026-07-04
Status: In progress

## Recall

User request:

- Investigate task `tsk_f27349e1f001Bas0d2mDBv13yN` after Visual QA and
  Integrity found issues but the task debug clipboard made it look like Build
  did not fix anything.
- Expand the impact investigation with independent agents, including other
  agent scheduling paths.
- Treat repair-versus-review adversarial work with independent agents as
  cooperation, then repair the root chain.

Acceptance criteria:

- Task-level direct Build reports are persisted as a durable task/run/session
  scoped outcome, not only as an Orchestrator tool return or session transcript.
- `read_context`, Integrity replay, board projection, and task debug output all
  read the same durable task-level Build outcome source.
- Goal-scoped Build outcomes remain goal-scoped; task-level direct outcomes do
  not pollute `goalWorkflows`.
- Visual QA reference parity refs must be formal Browser Preview evidence refs,
  not arbitrary side-by-side PNG paths.
- Visual QA errors distinguish empty refs from nonempty refs that cannot resolve
  to `browser_preview_evidence` with `operationKind="reference-comparison"`.
- Visual QA is report-only review evidence unless a future spec explicitly
  changes that boundary; it must not expose file-editing or shell tools for
  code repair.
- Downstream scheduling and prompts must treat `effective_accepted=false` as
  the Visual QA status, even when the natural-language summary says "accepted".
- Focused tests cover the new producer-side persistence, projection, replay
  context, Visual QA formal-ref validation, and tool-surface boundary.

Hard constraints:

- No fallback or compatibility path.
- No host-side gate that bypasses LLM decision making; root facts must be
  persisted and exposed as evidence.
- Updated objective from the user: all repairs and design must stay generic and
  pluggable. Do not bind status/context/projection to one workflow. Workflow can
  only be declared at scheduler scope, and agents must expose evidence through
  pluggable context protocols. Do not add redundant tools, over-schema,
  over-gate, or create specialized context protocols when an existing shared
  event/artifact projection can carry the fact.
- Independent agents must review the implementation against that pluggable
  design objective until they report no remaining issues.
- Expanded objective from the user on 2026-07-04: the same generic,
  pluggable design rule applies to every OpenCorvus sub-agent, not only Build,
  Visual QA, and Integrity. Workflow declarations belong only in scheduler
  scope; agents must consume and publish through a unified pluggable context
  protocol that can carry multimodal context such as text, images, audio, and
  video. The multimodal context contract is link/index based: packets should
  point the model to readable media refs instead of inlining image/audio/video
  bytes into prompt context. Do not add redundant similar tools, broad task-manipulation tools,
  over-schema, over-gates, specialized context protocols, or workflow-bound
  routing. Continue independent Codex review until no P1/P2 architecture issues
  remain.
- Do not create a new worktree.
- Do not restart, close, refresh, or kill OpenCorvus / overlay processes.
- Preserve unrelated dirty changes in
  `packages/opencorvus/src/provider/models-snapshot.ts` and
  `specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md`.
- Every code change needs focused tests.
- Specs stay under root `specs/`; update the July records index.

Sources read:

- `C:/Users/chuan/.codex/skills/benchmark-debug-template/SKILL.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-01-visual-qa-feedback-consumption-chain.md`
- `specs/records/2026-07/2026-07-02-visual-qa-annotated-repair-consumption.md`
- `specs/records/2026-07/2026-07-02-direct-build-current-worktree.md`
- `specs/records/2026-07/2026-07-02-qa-integrity-evidence-backed-schema.md`
- `specs/records/2026-07/2026-07-03-rendered-reference-acceptance-redesign.md`
- `specs/records/2026-07/2026-07-03-build-session-replay-pressure-repair.md`
- `specs/records/2026-07/2026-07-03-generic-build-evidence-gate-removal.md`
- Runtime database
  `C:/Users/chuan/.local/share/opencorvus/opencorvus.db`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/engine/persist.ts`
- `packages/opencorvus/src/engine/store.ts`
- `packages/opencorvus/src/workbench/board.ts`
- `packages/overlay/src/utils/debug-info.ts`
- `packages/opencorvus/src/visual-qa/output-tools.ts`
- `packages/opencorvus/src/visual-qa/schema.ts`
- `packages/opencorvus/src/visual-qa/agent.ts`
- `packages/opencorvus/src/visual-qa/static-tools.ts`
- `packages/opencorvus/src/browser-preview/persist.ts`
- Existing tests under
  `packages/opencorvus/test/{orchestrator,workbench,visual-qa,build-agent}` and
  `packages/overlay/test/task-debug-info.test.ts`.

Whole-repository grep:

- `rg -n "build_attempt_outcome|findBuildOutcomesForTask|findBuildOutcomeByGoalRun|beginBuildAttempt|finalizeBuildAttempt|BuildResultSchema|report_build_result|orchestrator_tool_ownership|build_report_for_architecture_review|directBuildIntent|isTaskLevelBuild" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test specs/records/2026-07 -g "*.ts" -g "*.tsx" -g "*.md"`
- `rg -n "reference_comparison_evidence_refs|browserPreviewEvidenceIDFromRef|browser_preview_evidence|reference-comparison|set_visual_qa_reference_parity|VisualQaReferenceParity|effectiveAccepted|submitted_accepted|visual_qa_process_accepted" packages/opencorvus/src packages/opencorvus/test specs/records/2026-07 -g "*.ts" -g "*.txt" -g "*.md"`
- `rg -n "VISUAL_QA_IMPLEMENTATION_TOOL_IDS|visual-qa-core|safe in-scope repairs|modify project files|apply_patch|bash|edit|write|Visual QA.*repair|report-only review|report-only" packages/opencorvus/src packages/opencorvus/test specs/records/2026-07 -g "*.ts" -g "*.txt" -g "*.md"`
- `rg -n "buildTaskDebugBlob|debugGoalBoardFiles|goalWorkflows|task-level|attemptChangedFiles|Task-level Attempts|terminalReason|compileBoard|TaskBoard" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test -g "*.ts" -g "*.tsx"`

Independent agent feedback:

- `019f28cc-3326-75d3-906e-4d7e5cdd66de` confirmed the scheduling sequence:
  Visual QA failed, Orchestrator called task-level Build, second Visual QA
  submitted accepted text while effective acceptance failed, Integrity found a
  route/locale defect, Orchestrator called task-level Build, and the final
  Integrity rerun was externally aborted.
- `019f28cb-daef-7081-ac69-c46586014b2e` confirmed task-level direct
  `report_build_result` is only a tool return / transcript fact; no
  `build_attempt_outcome`, `build_session_contract`, or Build decision-log
  report is written for the two direct sessions.
- `019f28cc-b0e6-7621-b05c-c2727d387fc4` compared other agents and found the
  durable-writer gap is not global: Architect, frontend_design, Visual QA,
  Integrity, fact_check, and goal-scoped Build have durable writers; direct
  Build and similar direct structured tools are the affected class.
- `019f28cd-02d3-7b43-989b-3358dc70f4f1` confirmed task debug reads an overlay
  board snapshot and `goalWorkflows`; the debug clipboard was copied before the
  later cancellation landed, and a fresh board should not show active status
  with a terminal reason.
- `019f28cc-7092-7280-827f-72bdc3f9b5c0` confirmed the second Visual QA refs
  were nonempty but were `.opencorvus/.../side-by-side.png` paths, not formal
  `browser_preview_evidence` refs, so they were filtered out and misreported as
  missing.

## Root Cause

The Build repair chain worked, but the result authority was scoped wrong.
Task-level direct Build runs create a task run and an ownership artifact, then
return the terminal Build report to the Orchestrator. They do not write a
task-level Build outcome artifact. Goal summaries, Integrity replay, and task
debug therefore see the original goal-scoped world and miss later repair
commits such as `b75f756` and `44489b5`.

The Visual QA chain has a separate contract bug. The report graph allows
`reference_comparison_evidence_refs` to be any registered evidence string, but
the effective verifier only accepts refs that resolve to Browser Preview
evidence IDs. A side-by-side PNG path can pass registration and then be rejected
as no formal evidence. The error text currently hides that distinction, and
the prose summary can still say "accepted" while the structured status is
`effective_accepted=false`.

Visual QA also currently has implementation tools and prompt language for safe
repairs. That contradicts the report-only review boundary recorded in the QA /
Integrity specs and makes review evidence able to mutate the deliverable
outside Build's repair/outcome chain.

## Repair Plan

1. Add a task-level direct Build outcome writer at the Build producer boundary.
   The artifact must include `task_id`, `run_id`, `session_id`, optional
   `goal_run_id=null`, workdir, status, summary, changed files, commit refs,
   repair report, tests, and worktree fact fields already returned by the tool.
2. Reuse the existing Build outcome artifact authority where possible; if the
   current schema requires a goal run, extend the stored payload / reader rather
   than scanning session `part` rows.
3. Update `findBuildOutcomesForTask()` / Integrity replay so task-level direct
   outcomes are visible alongside goal-scoped outcomes.
4. Update board/debug projection with a sibling task-level attempts section.
   Do not append these attempts under any individual goal.
5. Update Visual QA output validation so `reference_comparison_evidence_refs`
   must resolve through `browserPreviewEvidenceIDFromRef()` and point to a
   readable `browser_preview_evidence` row whose operation kind is
   `reference-comparison`.
6. Update Visual QA error messages and prompt text so scroll-slice
   side-by-side PNG paths are supporting visual-diff evidence only, not formal
   reference parity refs.
7. Remove Visual QA code-editing tools and repair/commit prompt language from
   the report-only Visual QA agent surface.
8. Add prompt/tool-result tests that make `effective_accepted=false` the
   downstream status source and prevent consumers from using prose "accepted"
   as pass evidence.

## Non-Goals

- Do not change task-level direct Build back to managed worktrees.
- Do not make Integrity a lifecycle gate or visual verdict owner.
- Do not restore `VisualEvidenceBundle` as final visual acceptance authority.
- Do not parse historic session transcripts as the source of truth.
- Do not hide failed Visual QA behind a host-side bypass. The structured facts
  must be visible to the Orchestrator and later agents.

## Validation Plan

- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "task-level direct build" --timeout 180000`
- `bun test packages/opencorvus/test/workbench/board.test.ts packages/overlay/test/task-debug-info.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/visual-qa/output-tools.test.ts packages/opencorvus/test/visual-qa/agent.test.ts packages/opencorvus/test/visual-qa/strict-reference-fidelity.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts --timeout 120000`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/overlay typecheck`
- `git diff --check`

## 2026-07-04 Follow-Up Repair Notes

Independent review after the initial repair found three generic chain issues
that could still make Visual QA / Integrity feedback visible in reports but
not reliably owned by the next responsible agent:

1. Agent coordination redispatch could still be modeled as a global role
   binding. The fix removes global scheduler-agent fallback bindings and
   derives redispatch bindings from the active workflow's declared
   `agentRole` steps. Built-in scheduler-only agents that are valid in the
   pipeline (`deep_research`, `fact_check`) are now explicit workflow steps;
   direct workflow no longer inherits them.
2. Integrity replay context and implementation evidence used private fields or
   text-marker JSON. The shared `AgentContextPacket` protocol now has a
   `structured` part with schema/summary/data, validates media refs at
   producer and consumer boundaries, and renders only structured refs into
   prompts. Integrity consumes replay context from
   `integrityReplayContextPacket(...)` in `contextPackets`; direct
   `reviewIntegrity({ replayContext })` is rejected.
3. CLI session import wrote imported parts directly to `PartTable`, bypassing
   the `Session.updatePart` inline-base64 write boundary. The repair moved
   import into `Session.importSnapshot(...)`, which runs one DB transaction,
   uses the same synchronous Session part writer as `updatePart`, strips stale
   visible `orderKey` fields from imported snapshots, and leaves no
   header-only session/message rows when a part is rejected.

Second independent review found and closed four remaining P1/P2 issues:

1. `Session.persistMessage(...)` called async `saveMessage`, `updateMessage`,
   and `updatePart` inside a synchronous DB transaction without awaiting them.
   The fix factors synchronous message/part row writers and uses them inside
   the transaction, so inline-base64 rejection aborts the whole message write.
2. The inline-base64 detector only caught lower-case, unparameterized data URLs
   that started immediately after a JSON quote. The detector now rejects valid
   variants such as `DATA:image/png;base64,...`,
   `data:image/png;charset=utf-8;base64,...`, and prefixed data URLs before
   the row touches SQLite.
3. Integrity replay used `collectAgentOutcomesForTask(...)`, but
   `inspect_integrity_evidence` still got implementation evidence from
   acceptance rows. The fix makes `TaskAgentOutcome` carry changed-file and
   diff/stat summaries and builds `implementationEvidenceContextPacket(...)`
   from the same agent outcome registry used by replay.
4. Visual QA dispatch context still used `visual_qa_dispatch_json:` marker text.
   The fix replaces it with a schema-bearing structured context packet
   (`opencorvus.visual_qa.dispatch_context.v1`) and keeps rendered prompt text
   to readable summaries plus `structured_ref`.
5. Redispatch recovery still reconstructed bindings from top-level
   `workflow_tool_name/stage/target_kind` fields when nested
   `redispatch_binding` was missing. Recovery now reads only
   `result.redispatch_binding`; top-level fields, when present, must match the
   nested binding or the action is rejected as malformed.

Focused validation run in this round:

- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "redispatch" --timeout 240000`
- `bun test packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts packages/opencorvus/test/engine/agent-coordination.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/server/task-conversation-routes.test.ts --test-name-pattern "A2A" --timeout 180000`
- `bun test packages/opencorvus/test/util/log-pino.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/agent/context-packet.test.ts packages/opencorvus/test/build-agent/visual-reference-prompt.test.ts packages/opencorvus/test/integrity/acceptance-tools.test.ts packages/opencorvus/test/integrity/replay-context.test.ts packages/opencorvus/test/integrity/team-agent.test.ts packages/opencorvus/test/integrity/consensus-traceability.test.ts packages/opencorvus/test/integrity/severity-active-path.test.ts packages/opencorvus/test/cli/import.test.ts --timeout 240000`
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "frontend innovate expert squad" --timeout 240000`
- `bun run --cwd packages/opencorvus typecheck`

Additional validation after the second independent review:

- `bun test packages/opencorvus/test/session/inline-base64-rejected.test.ts packages/opencorvus/test/cli/import.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/visual-qa/context.test.ts packages/opencorvus/test/visual-qa/agent.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/integrity/acceptance-tools.test.ts packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "frontend innovate expert squad" --timeout 240000`
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "redispatch" --timeout 240000`
- `bun test packages/opencorvus/test/engine/agent-coordination.test.ts packages/opencorvus/test/server/task-conversation-routes.test.ts --test-name-pattern "A2A|redispatch|coordination" --timeout 240000`
- `bun test packages/opencorvus/test/agent/context-packet.test.ts packages/opencorvus/test/integrity/replay-context.test.ts packages/opencorvus/test/integrity/team-agent.test.ts --timeout 240000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts --timeout 180000`
- `bun run --cwd packages/opencorvus typecheck`

Final validation exposed two adjacent contract drifts and one test-loader
toolchain defect:

1. `packages/opencorvus/test/session/message-stream-early-death.test.ts`
   failed before running because `engine/model.ts` accessed `Message.User`,
   `Message.Part`, and `Message.VisibleWithParts` at module top level while
   `session/message.ts` was still initializing through a circular import path.
   The fix keeps `Message` as the single schema source and changes only these
   engine response wrapper schemas to `z.lazy(...)`.
2. `packages/opencorvus/test/server/overlay-contract.test.ts` still asserted
   that pipeline ended at `integrity`. Current production workflow explicitly
   ends `integrity -> fact_check`, so the overlay contract test now asserts
   that final pair.
3. `packages/opencorvus/test/server/task-conversation-routes.test.ts` still
   used the pre-registration Integrity reviewer fixture shape. The fixture now
   registers `checkItems`, reviewer `checkIDs`, and structured reviewer
   evidence rows matching `IntegrityTeamReportSchema`.

Final validation commands:

- `bun test packages/opencorvus/test/session/message-stream-early-death.test.ts --timeout 180000`
- `bun test packages/opencorvus/test/session/part-delta.test.ts packages/opencorvus/test/session/tool-status-monotonicity.test.ts packages/opencorvus/test/session/message-stream-early-death.test.ts --timeout 180000`
- `bun test packages/opencorvus/test/server/overlay-contract.test.ts packages/opencorvus/test/server/task-conversation-routes.test.ts packages/opencorvus/test/workbench/board.test.ts --timeout 240000`
- `bun run --cwd packages/opencorvus typecheck`

## Third Continuation: Workflow-Scoped Continuation and Report-Only Execution

Additional review after the second repair pass found three remaining generic
contract issues:

1. Integrity's `run_command` was report-only by prompt, but the executable
   command still ran in the real project directory. A post-command git-status
   guard could detect some mutations after they happened, but it could not make
   the tool report-only. The repair creates a shared isolated project check
   workspace and runs Integrity commands there. `source_cwd` and
   `execution_cwd` are both printed, and the same helper is reused by project
   assessment required checks.
2. `AgentContextPacket` rejected inline media refs but did not recursively
   reject data URLs inside text or structured packet data. Validation now
   rejects inline `data:*;base64` values in text, media refs, and structured
   data before prompt rendering.
3. Stage continuation helper text still derived tool names from global built-in
   scheduler bindings. That let direct/custom workflows accidentally inherit
   pipeline redispatch affordances. Continuation helpers now receive the
   `toolName` resolved from the active workflow binding at the call site. The
   helper no longer calls global built-in lookup, and tests assert this.

Focused validation for this continuation:

- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "redispatch" --timeout 240000`
- `bun test packages/opencorvus/test/engine/agent-coordination.test.ts --test-name-pattern "redispatch|coordination" --timeout 180000`
- `bun test packages/opencorvus/test/agent/context-packet.test.ts packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/integrity/acceptance-tools.test.ts packages/opencorvus/test/acceptance/project-assessment.test.ts --test-name-pattern "isolated|run_command|required checks" --timeout 180000`
- `bun run --cwd packages/opencorvus typecheck`

## Fourth Continuation: Independent P1/P2 Closure

The third independent review round found and closed five remaining issues:

1. `AgentContextPacket` still allowed inline payloads in renderable metadata
   and missed valid `data:` URLs without explicit media types. The data URL
   detector now rejects `data:image/...`, prefixed `x-data:image/...`,
   `data:;base64,...`, and `data:,...` forms across packet metadata, text,
   media refs, and structured data before prompt rendering.
2. Build visual / clone overlays still depended on `packet.source ===
   "frontend_design"`. Build now consumes the structured
   `opencorvus.build.visual_handoff.v1` packet schema instead. The
   frontend_design producer attaches that schema as provenance-neutral context,
   and tests assert that a third-party source can trigger the overlay while a
   source-only legacy packet cannot.
3. Build evidence context still used a private `build_evidence` source and
   media `role` as its consumer contract. The producer now emits
   `opencorvus.build.evidence.v1` structured data as the evidence authority and
   role-free media refs for model visibility. The consumer ignores legacy
   source-plus-role-only packets.
4. Agent coordination action progress/completion still accepted top-level
   `workflow_tool_name`, `stage`, and `target_kind` fields at the write
   boundary. Engine action normalization now rejects those legacy fields before
   DB update; redispatch bindings must stay nested under
   `result.redispatch_binding`.
5. Background Integrity `run_command` cleanup was not owned by the supervised
   process lifecycle. `Shell.launch` now requires process-tree cleanup support
   for background commands, returns an `exited` promise, and guarded command
   cleanup waits for exit / abort / lease, disposes live supervised processes
   under the isolated workspace, and retries workspace deletion. Windows
   background launch is rejected when the process-supervisor helper is missing.

Independent review closure:

- Galileo: no P1/P2 remaining in workflow fallback, redispatch binding, or
  stage-continuation scheduling.
- Avicenna: no P1/P2 remaining in Integrity isolated workspaces, symlink /
  junction handling, background abort, or required-check isolation.
- Harvey: no P1/P2 remaining in context packet inline payload rejection or
  Build visual handoff / evidence packet consumption.

Focused validation for this continuation:

- `bun test packages/opencorvus/test/agent/context-packet.test.ts packages/opencorvus/test/build-agent/prompt-context.test.ts packages/opencorvus/test/build-agent/visual-reference-prompt.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/shell.test.ts packages/opencorvus/test/integrity/acceptance-tools.test.ts --timeout 180000`
- `bun test packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts packages/opencorvus/test/engine/agent-coordination.test.ts --timeout 180000`
- `bun test packages/opencorvus/test/server/task-conversation-routes.test.ts --test-name-pattern "A2A|redispatch|coordination" --timeout 180000`
- `bun test packages/opencorvus/test/acceptance/project-assessment.test.ts --test-name-pattern "isolated|required checks|run_command" --timeout 120000`
- `bun test packages/opencorvus/test/agent/context-packet.test.ts packages/opencorvus/test/build-agent/prompt-context.test.ts packages/opencorvus/test/build-agent/visual-reference-prompt.test.ts packages/opencorvus/test/shell.test.ts packages/opencorvus/test/integrity/acceptance-tools.test.ts packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts packages/opencorvus/test/engine/agent-coordination.test.ts --timeout 240000`
- `bun run --cwd packages/opencorvus typecheck`

## Fifth Continuation: Redispatch Semantics and Generic Feedback Contracts

User follow-up clarified that redispatch must not become a stronger or broader
version of dispatch. The durable definition is:

- Dispatch is the first scheduler assignment from the task request and active
  workflow goal contract.
- Redispatch is a later scheduler-scope continuation edge created after a
  review agent such as Visual QA or Integrity publishes new evidence that
  requires the responsible implementation agent to repair an already delivered
  surface.
- Redispatch is not a fallback for broken initial dispatch, missing context,
  or missing workflow declarations. If it is needed to compensate for lost
  first-dispatch inputs, that is a dispatcher / producer bug, not a valid
  redispatch use.

Independent review widened the impact surface beyond Build, Visual QA, and
Integrity:

1. Build still recognized Integrity repair obligations through
   `packet.source === "integrity"` plus free-text marker content. This made the
   feedback transfer producer-name dependent instead of contract dependent.
2. Scheduler tool projection could expose profile-declared workflow tools that
   were not part of the active workflow, so direct/custom workflows could
   accidentally inherit pipeline affordances.
3. General and Explore prompts named frontend workflow stages directly,
   creating a second prompt-level workflow source outside scheduler scope.

Repairs completed in this continuation:

1. Shared visual handoff, Integrity drilldown, Build repair feedback, and
   implementation evidence now use schema-bearing `AgentContextPacket`
   structured parts. Consumers select by structured schema, not by producer
   source labels. Source labels remain provenance only.
2. Build receives Integrity repair obligations through
   `opencorvus.build.repair_contract.v1`, including blocking fingerprints. A
   legacy `source="integrity"` text marker is ignored by tests.
3. Visual QA / Integrity implementation context uses schema-bearing packets,
   so feedback can originate from any producer that honors the shared contract.
4. Scheduler capability projection intersects profile-visible workflow tools
   with the active workflow steps. Non-workflow tools remain profile projected;
   workflow tools are visible only when the current scheduler workflow declares
   them.
5. General, Explore, and Orchestrator core prompts now refer to the current
   scheduler workflow and its visible stages instead of hardcoding frontend
   workflow stage names.
6. `read_context` restores agent-outcome diagnostics needed by debugging and
   replay: goal, goal run, run, no-diff state, actual changed files, reported
   changed files, and commit refs.

Focused validation for this continuation:

- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --timeout 300000`
  passed: 130 tests.
- `bun test packages/opencorvus/test/agent/context-packet.test.ts packages/opencorvus/test/build-agent/prompt-context.test.ts packages/opencorvus/test/integrity/acceptance-tools.test.ts packages/opencorvus/test/integrity/build-feedback.test.ts packages/opencorvus/test/integrity/team-agent.test.ts packages/opencorvus/test/integrity/replay-context.test.ts packages/opencorvus/test/visual-qa/context.test.ts packages/opencorvus/test/visual-qa/agent.test.ts packages/opencorvus/test/prompt/integrity-severity-prompt.test.ts packages/opencorvus/test/orchestrator/build-feedback-context.test.ts packages/opencorvus/test/agent/orchestrator-core-grain-ladder.test.ts --timeout 300000`
  passed: 110 tests.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts --timeout 180000`
  passed: 65 tests.
- `bun run --cwd packages/opencorvus typecheck` passed.
- `git diff --check` passed with only CRLF/LF normalization warnings in
  pre-existing Windows-tracked files.
- Residual grep for retired source-bound helpers found no implementation
  occurrences; the remaining hit is a negative prompt hygiene assertion.

## Sixth Continuation: Redispatch Boundary and Durable Report Evidence Refs

User follow-up asked why `redispatch` exists if `dispatch` already exists. The
settled definition is narrower than a second dispatcher:

- `dispatch` is the first scheduler assignment for a task or goal from the
  current workflow declaration.
- `redispatch` is a scheduler-owned continuation edge after a worker/reviewer
  has already produced durable evidence that requires the same task surface to
  be repaired or rechecked.
- `redispatch` must not compensate for missing first-dispatch context, missing
  workflow declarations, or lost review evidence. Those are producer /
  scheduler bugs.

Independent review feedback and closure:

1. Parfit found no P1 and one P2: `agent/context-packet.ts` still embedded
   visual-handoff-specific schema helpers. The fix moved visual handoff helpers
   into `packages/opencorvus/src/context-packets/visual-handoff.ts`; the core
   packet module now owns only packet shape, rendering, schema lookup, and
   generic validation.
2. Goodall found no P1 and three P2 scheduler-path leaks: a top-level
   `orchestrator/tools.ts` helper could fall back to global built-in scheduler
   role bindings when no workflow was supplied, `mission-core.txt` hard-coded
   `requirements -> architect -> build -> integrity`, and
   `orchestrator-core.txt` named fixed stage lanes for refinement / visual
   review. The fix deleted the unused global-binding helper, kept redispatch
   binding lookup inside the active workflow closure, and rewrote mission /
   orchestrator prompts to depend on current scheduler-projected workflow tools.
3. Aristotle found one P1: Visual QA formal report refs still accepted bare
   paths, command text, file URLs, and local screenshot labels. The fix added
   `packages/opencorvus/src/evidence/ref.ts` with a generic durable evidence
   ref schema, applied it to all Visual QA formal `source_refs`,
   `evidence_refs`, `annotated_evidence_refs`, `evidence.ref`, and
   `reference_comparison_evidence_refs`, and removed direct path / `file://`
   resolution from Visual QA DOM screenshot annotation. Annotated screenshots
   now resolve only AttachmentStore URLs or Browser Preview evidence refs.

Current architecture documentation now records the shared context packet
protocol in `specs/current/architecture/15-agent-context-packet.md`, including
the formal report evidence ref rule. The rule distinguishes prompt input media
refs from persisted report evidence refs: report refs must be portable through
DB replay and worker-to-worker handoff, so they use namespaces such as
`browser_preview_evidence:*`, `frontend_research:*`, `deep_research:*`,
`frontend_design:*`, `build_attempt_outcome:*`, `integrity_attempt:*`,
`decision_log:*`, `visual_qa:*`, or `/attachment/<project>/<name>`.

Focused validation for this continuation:

- `bun test packages/opencorvus/test/agent/core-prompt-hygiene.test.ts packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts --timeout 180000`
  passed: 88 tests.
- `bun test packages/opencorvus/test/visual-qa/output-tools.test.ts packages/opencorvus/test/visual-qa/negative-fixtures.test.ts --timeout 240000`
  passed: 29 tests.
- `bun test packages/opencorvus/test/orchestrator/build-feedback-context.test.ts packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "visual qa|Visual QA|reference-comparison|redispatch|build feedback|feedback context" --timeout 300000`
  passed: 30 filtered tests.

## Seventh Continuation: Media Ref Contract Tightening

Recall for this continuation:

- User objective remains the broad generic pluggable agent architecture: all
  agent context must flow through a unified multimodal context protocol; media
  is carried by link/index refs rather than inline bytes; workflow declarations
  remain scheduler-scoped; no specialized context protocol, redundant tool, or
  source/role routing contract is acceptable.
- Sources read in this continuation:
  `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`,
  `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`,
  this record's Recall, `specs/current/architecture/15-agent-context-packet.md`,
  and `packages/opencorvus/src/agent/context-packet.ts`.
- Repository search evidence:
  `rg -n 'packet\.source|part\.role|media_ref\.role|\.role ===|\.source ===|source ===|source: "(integrity|visual_qa|frontend_design|build_evidence|task_attachments)"|visual_qa_dispatch_json|source_baseline_input|VisualQaContextPacket|replayContext\??:' packages/opencorvus/src -g '*.ts'`;
  `rg -n 'role\?: string|\.role|role=' packages/opencorvus/src/agent/context-packet.ts packages/opencorvus/src/context-packets packages/opencorvus/src/build packages/opencorvus/src/integrity packages/opencorvus/src/visual-qa packages/opencorvus/src/orchestrator -g '*.ts'`;
  `rg -n 'role:\s*"[^"\n]+"' packages/opencorvus/test packages/opencorvus/src -g '*.ts' | rg 'media_ref|AgentContextPacket|contextPackets|context-packet|buildEvidenceContextPacket|visualHandoff|integrityReplayContext|implementationEvidence'`.
- Independent agents for this continuation are running in parallel:
  Laplace audits context-packet protocol and source/role routing, Mill audits
  workflow/tool boundary and tool bloat, and Aquinas audits dynamic
  expert-squad single-source behavior.

Local finding before code edits:

`AgentContextMediaRefPart` still had an optional `role` field and rendered it
as `role=...` in prompt context. No production consumer was found routing on
that field, and Build evidence already carries semantic grouping in the
structured `opencorvus.build.evidence.v1` payload. Keeping a second role slot
inside the core media ref would preserve a similar semantic channel next to
`structured.schema`, making future source/role routing regressions easier.

Repair plan:

1. Remove `role` from the core `AgentContextMediaRefPart` type, validation, and
   rendering.
2. Update context-packet tests so multimodal refs prove modality, mime, URL,
   filename, and scope without a `role` field.
3. Replace stale `screenshot://` fixture text in Build prompt-context tests
   with a durable `browser_preview_evidence:*` ref so repair examples do not
   teach nonportable screenshot labels.

## Eighth Continuation: Scheduler Scope and Dynamic Expert-Squad Audit

Recall for this continuation:

- User asked what `redispatch` is and why `dispatch` is insufficient. The
  answer is part of the active architecture constraint: `dispatch` is the first
  scheduler assignment from the active workflow declaration, while `redispatch`
  is only the scheduler-owned continuation edge after durable review evidence
  already exists. `redispatch` must not become a second dispatcher, a fallback
  for missing first-dispatch input, or a way to hide broken evidence plumbing.
- User objective remains generic and pluggable for all OpenCorvus agents:
  scheduler workflow declarations are the only workflow scope; workers consume
  shared `AgentContextPacket` evidence; multimodal context is carried by refs
  and indexes; dynamic expert-squad packages remain the single source for
  package selectors and tools.
- Additional sources read:
  `packages/opencorvus/src/engine/workflow.ts`,
  `packages/opencorvus/src/orchestrator/agent.ts`,
  `packages/opencorvus/src/orchestrator/tools.ts`,
  `packages/opencorvus/src/frontend-design/handoff.ts`,
  `packages/opencorvus/src/integrity/team-agent.ts`,
  `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`,
  `packages/opencorvus/src/expert-squad/registry.ts`,
  `packages/opencorvus/src/project/project.ts`,
  `packages/opencorvus/src/config/config.ts`, and
  `packages/opencorvus/src/mcp/index.ts`.
- Repository search evidence:
  `rg -n 'direct|pipeline|source_baseline_input|frontend_project|replayContext|selectorCatalog|PackageCatalogEntry|media_ref|role=' packages/opencorvus/src packages/opencorvus/test -g '*.ts' -g '*.txt' -g '*.md'`;
  `rg -n 'Config\\.Mcp|McpLocal|McpRemote|loadPackage|selector\\.md|package MCP|Instance\\.provide' packages/opencorvus/src packages/opencorvus/test -g '*.ts'`.

Independent agent feedback and repairs:

1. Mill found one P2: runtime and prompt code still bound Build to the
   `direct` workflow and described fixed `pipeline` paths outside scheduler
   scope. The fix added task-kind default workflow lookup to
   `WorkflowRegistry`, moved Build default selection through that registry, and
   removed prompt language that encoded direct / pipeline as agent-owned
   behavior.
2. Laplace found two issues. P1: `frontend_project` was consumed through
   rendered prose and a `source_baseline_input` marker regex. The fix made the
   decision-log value schema JSON and added
   `parseFrontendProjectDecisionEntry`. P2: Integrity prompt builders still had
   a private direct `replayContext` field even though `reviewIntegrity` rejects
   direct replay context. The fix derives prompt replay context exclusively
   from `integrityReplayContextPacket(...)`.
3. Aquinas found one P1: general selector projection used metadata-only package
   discovery, so generated selector skills could drop package `selector.md`
   instructions. The fix changed `selectorCatalog` to load active package
   definitions through `ExpertSquadRegistry.loadPackage`, and tests now assert
   the package selector file content reaches selector projection.
4. Local validation exposed a separate DB boundary bug: some tests insert JSON
   text into `projects.sandboxes` / `projects.commands`, while
   `Project.fromRow` previously parsed the row as if those columns were already
   arrays. The fix added strict JSON column decoding at the row boundary. This
   is a schema boundary decode, not a fallback path.
5. Loading full package definitions exposed a `config -> prompt-profile ->
   registry -> config` module cycle around MCP schemas. The fix split the pure
   MCP schema into `packages/opencorvus/src/config/mcp-schema.ts` and made both
   `config.ts` and `registry.ts` use that single schema source.
6. Scoped package MCP provider projection then exposed a test-only missing
   runtime context. The production tool execution materializes MCP output with
   `Instance.project.id`, so the test now invokes the projected provider inside
   `Instance.provide({ directory: project.path, ... })` instead of relying on
   hand-written option metadata.

Focused validation for this continuation:

- `bun test packages/opencorvus/test/agent/context-packet.test.ts packages/opencorvus/test/build-agent/prompt-context.test.ts packages/opencorvus/test/build-agent/visual-reference-prompt.test.ts --timeout 180000`
  passed: 55 tests.
- `bun test packages/opencorvus/test/prompt/integrity-severity-prompt.test.ts packages/opencorvus/test/integrity/severity-stability.test.ts packages/opencorvus/test/integrity/scope-bounded-maturity-prompt.test.ts packages/opencorvus/test/integrity/finding-traceability.test.ts packages/opencorvus/test/integrity/consensus-severity-fold.test.ts packages/opencorvus/test/integrity/team-agent.test.ts --timeout 240000`
  passed: 30 tests.
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --test-name-pattern "projects active package MCP tools" --timeout 180000`
  passed: 1 focused test.
- `bun test packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts packages/opencorvus/test/build-agent/prompt-context.test.ts packages/opencorvus/test/frontend-design/handoff.test.ts packages/opencorvus/test/orchestrator/build-goal-reference.test.ts packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts packages/opencorvus/test/server/config-routes.test.ts packages/opencorvus/test/project/project.test.ts --test-name-pattern "JSON text project columns|." --timeout 300000`
  passed: 131 tests.

## Ninth Continuation: Current-Source Correction After Stale Skill Warning

Recall for this continuation:

- User corrected that the local `opencorvus-expert-squad-creator` skill is
  outdated. From this point forward it is stale context, not an authority.
  The authoritative sources are the current repository files:
  `AGENTS.md`, `specs/current/**`, `specs/records/2026-07/**`,
  `packages/opencorvus/src/**`, and tests.
- The active objective remains unchanged: all agents must use the generic,
  pluggable, multimodal-by-reference context protocol; workflow declarations
  remain scheduler-scoped; dynamic expert squads must stay pluggable and
  single-source; no fallback, over-gate, over-schema, or broad task
  manipulation tool should be introduced.
- Independent agents spawned in this continuation were interrupted with the
  same correction: ignore the stale skill and re-audit only against current
  repository code, docs, and tests.
- Repository search evidence:
  `rg -n "packet\\.source|\\.source ===|source ===|packet\\.title|part\\.role|media_ref.*role|VisualQaContextPacket|visual_qa_dispatch_json|source_baseline_input|input\\.replayContext|replayContext\\??:" packages/opencorvus/src packages/opencorvus/test specs/current -g "*.ts" -g "*.tsx" -g "*.txt" -g "*.md"`;
  `rg -n 'direct-path|Pipeline workflow|pipeline workflow|workflow\\.id|resolveSync\\("direct"|resolveSync\\("pipeline"|id:\\s*"direct"|id:\\s*"pipeline"' packages/opencorvus/src packages/opencorvus/test specs/current -g "*.ts" -g "*.txt" -g "*.md"`;
  `rg -n "task_manipulation|manipulat|complete_task|fail_task|cancel_task|retry_task|broad.*tool|one tool" packages/opencorvus/src packages/opencorvus/test specs/current -g "*.ts" -g "*.txt" -g "*.md"`;
  `rg -n "direct workflow 选择|pipeline workflow 或 Orchestrator|task-level direct 默认|pipeline 流程里|pipeline build 路径里" specs/current/architecture packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts`.

Local finding and repair:

- Current architecture docs still described agent-role responsibilities with
  built-in workflow names outside scheduler scope. In particular,
  `01-agents.md` said build fast path was owned by a `direct workflow` choice,
  Requirements were called by `pipeline workflow`, and planning deletion notes
  described `pipeline` as the build path. `04-extensions.md` and
  `13-agent-communication-matrix.md` carried the same agent-role wording.
- The repair changed those docs to describe scheduler-owned workflow registry
  selection, scheduler-projected tools, goal-scoped implementation lanes, and
  task-level implementation builds. Built-in workflow names remain documented
  where the workflow registry itself is the subject, but they no longer define
  agent role contracts.
- `packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts`
  now has a current-architecture guard rejecting the stale phrases
  `direct workflow 选择`, `pipeline workflow 或 Orchestrator`,
  `task-level direct 默认`, `pipeline 流程里`, and `pipeline build 路径里`
  in the agent-role architecture chapters.

Focused validation for this continuation:

- `bun test packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts --timeout 180000`
  passed: 31 tests.

## Tenth Continuation: Independent-Agent P2 Closure

Recall for this continuation:

- The `opencorvus-expert-squad-creator` personal skill remains stale context,
  not an implementation authority. Current repo code, `specs/current/**`, and
  focused tests are the authority.
- The live question is still the visual-qa / integrity feedback-to-build chain:
  reports must reach Build as structured context; scheduler workflow
  declarations own dispatch / redispatch; expert-squad packages own capability
  projection; multimodal evidence is passed by refs, not inline media.
- Repository search evidence:
  `rg -n "sessionID|PromptCatalog\\.list|PromptProfileResolver\\.list|PromptProfile\\.list|PromptProfileCatalogProfileSchema|capability_profile_id|default_tool_refs|default_mcp" packages/opencorvus/src packages/opencorvus/test packages/sdk packages/overlay specs/current specs/records/2026-07`;
  `rg -n "default_mcp_prompt_refs|package_mcp_prompt_refs|default_mcp_resource_refs|package_mcp_resource_refs|PromptProfile\\.list\\(" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/sdk -g "*.ts" -g "*.tsx" -g "*.json"`;
  `rg -n "resolveWorkerCapability\\(|capability_projection\\.agents|agentOwnedTaskWorkerIDs|role_base" packages/opencorvus/src packages/opencorvus/test specs/current/architecture -g "*.ts" -g "*.md" -g "*.jsonc"`.

Independent agent feedback and repairs:

1. Chandrasekhar found P2: redispatch action result patches could still
   overwrite the scheduler-derived `redispatch_binding` after creation. The fix
   added result merge validation in `agent-coordination.ts`; progress and
   completion updates now preserve the scheduler binding and reject replacement
   bindings. The related architecture explorer wording now describes
   scheduler workflow binding and response/action artifacts instead of
   "responsible agent kind".
2. Bohr found P2: `/config/prompt` had to be session-effective like
   `/config/prompt-profile`. Current code now accepts `sessionID`, resolves
   `EffectiveConfig.effective(...)` and `EffectiveConfig.directory(...)`, and
   tests cover prompt preview under session-active project packages.
3. Bohr found P2: profile catalog capability fields were not fully projected to
   clients. Backend schema / SDK already had the required fields; overlay's
   hand-written `PromptProfileOption` was stale. The overlay service and
   ChatComposer now reuse the full capability projection contract.
4. Bohr found P2: `default_tool_refs` / `default_mcp_tool_refs` were accepted
   by manifest schema and catalog but ignored by runtime projection. The fix
   added default tool projection from the runtime tool map, default MCP tool
   projection from effective `config.mcp`, provider-name hashing, metadata
   tracing, and tests for scheduler and worker surfaces.
5. Bohr found P2: `PromptProfile.list()` was stale against the strict catalog
   schema. It was retired; tests now use `PromptProfileResolver.list(...)`.
   Catalog profile/hash/provider helpers were centralized in
   `expert-squad/catalog-profile.ts` to avoid reintroducing a second catalog
   source.
6. The earlier "general package lists every agent" concern was reviewed against
   current runtime evidence. General scheduler projection exposes only the
   role-base scheduler tools and no workflow dispatch tools; the agent map is
   the explicit built-in worker capability source needed by
   `resolveWorkerCapability(general, <role>)`. Deleting it would break default
   worker runs, so it is not a P1/P2 defect. Current tests verify general
   scheduler isolation and role-manifest worker coverage.

Focused validation for this continuation:

- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --timeout 180000`
  passed: 24 tests.
- `bun test packages/opencorvus/test/agent/prompt-profile.test.ts --timeout 180000`
  passed: 18 tests.
- `bun test packages/opencorvus/test/server/config-routes.test.ts --timeout 180000`
  passed: 10 tests.
- `bun test packages/opencorvus/test/expert-squad/registry.test.ts --timeout 180000`
  passed: 39 tests.
- `bun test packages/opencorvus/test/engine/agent-coordination.test.ts --test-name-pattern "redispatch action updates|response helper rejects redispatch" --timeout 180000`
  passed: 2 focused tests.
- `bun test packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts --timeout 180000`
  passed: 7 tests.
- `bun test packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts --timeout 180000`
  passed: 33 tests.
- `bun test packages/opencorvus/test/agent/context-packet.test.ts packages/opencorvus/test/build-agent/prompt-context.test.ts packages/opencorvus/test/tool/request-orchestrator-decision.test.ts --timeout 180000`
  passed: 44 tests.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 180000`
  passed: 19 tests.
- `bun run --cwd packages/opencorvus typecheck` passed.
- `bun run --cwd packages/overlay typecheck` passed.
- `git diff --check` passed with only existing line-ending warnings.

## Eleventh Continuation: Stale Skill Exclusion and Active Workflow Binding Closure

Recall for this continuation:

- The user explicitly corrected that the personal
  `opencorvus-expert-squad-creator` skill is outdated. It is not an authority
  for this repair. Current repository code, current architecture docs, current
  July records, and focused tests are the only sources used here.
- The investigation question remains the visual-qa / integrity
  feedback-to-build chain: Build must receive structured context packets and
  repair contracts, scheduler workflow declarations must own dispatch /
  redispatch, and dynamic expert-squad packages must project capabilities from
  active workflow bindings without hidden default owner maps.
- Independent-agent review was continued until no P1/P2 remained. Faraday
  found two additional P2s in this continuation and then confirmed no remaining
  P1/P2 after the final repair. Ohm and Peirce had already confirmed no P1/P2
  for the context-packet/media-ref and scoped tool/panel/cancel-retry surfaces.

Independent agent feedback and repairs:

1. Faraday found P2: `ExpertSquadPackageManager` import/export validation had
   been updated to pass `workflowBindings`, but those bindings came from a
   hand-written config file list. That duplicated canonical config loading and
   could miss `OPENCORVUS_CONFIG_DIR`, managed config, inline config, and other
   canonical sources. The fix added `Config.snapshotForProject(...)` and made
   package import/export derive workflow bindings from the canonical config
   loading pipeline instead of a second JSONC loader.
2. Faraday found P2 in the first snapshot implementation:
   `Config.snapshotForProject(...)` used `Instance.provide(...)`, which could
   trigger bootstrap side effects such as `.gitignore` writes and attachment
   sweep. The final fix parameterized `Config.loadState(...)` with explicit
   `directory` / `worktree`, resolves the read-only worktree boundary with
   `git rev-parse --show-toplevel`, disables `$schema` writes and plugin
   dependency installation in read-only mode, and no longer creates or refreshes
   an `Instance`.
3. `ExpertSquadPackageManager.packageLoadOptions(...)` now calls
   `Config.snapshotForProject(...)`, converts the active assistant config with
   `EngineConfig.fromAssistantConfig(...)`, and passes
   `WorkflowRegistry.schedulerAgentWorkflowBindingsForEngineConfig(...)` into
   every `loadSourcePackage(...)` / `loadPackage(...)` validation path.
4. Package-manager tests now cover two failure modes that would have missed the
   repair: a package whose `build` workflow tool is owned by `integrity`, and a
   workflow config supplied only through `OPENCORVUS_CONFIG_DIR`. The latter
   also asserts package import does not create `.gitignore`, guarding the
   no-bootstrap/no-side-effect contract.
5. A selector projection type gap surfaced during typecheck. The fix made the
   built-in and project selector intermediate array use one explicit shape with
   optional `location`; this is a type-only correction for the existing selector
   projection behavior.

Validation for this continuation:

- `bun test packages/opencorvus/test/expert-squad/package-manager.test.ts --test-name-pattern "OPENCORVUS_CONFIG_DIR|active project workflow bindings|imports a source folder|exports a canonical package" --timeout 180000`
  passed: 4 tests.
- `bun test packages/opencorvus/test/config/config.test.ts --test-name-pattern "does not try to install dependencies in read-only OPENCORVUS_CONFIG_DIR|OPENCORVUS_CONFIG_DIR still works when flag is set" --timeout 180000`
  passed: 2 tests.
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts packages/opencorvus/test/expert-squad/registry.test.ts packages/opencorvus/test/expert-squad/package-manager.test.ts --timeout 240000`
  passed: 90 tests.
- `bun test packages/opencorvus/test/server/config-routes.test.ts packages/opencorvus/test/server/session-routes.test.ts packages/opencorvus/test/server/mission-routes.test.ts packages/opencorvus/test/mission/wake-route.test.ts --test-name-pattern "prompt|profile|mission" --timeout 240000`
  passed: 41 tests.
- `bun test packages/opencorvus/test/agent/agent.test.ts packages/opencorvus/test/tool/registry.test.ts packages/opencorvus/test/panel/actor-whitelist.test.ts packages/opencorvus/test/tool/panel-capability.test.ts packages/opencorvus/test/panel/query-task.test.ts --timeout 240000`
  passed: 116 tests.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 180000`
  passed: 19 tests.
- `bun run --cwd packages/opencorvus typecheck` passed.
- `git diff --check` passed with only CRLF line-ending warnings.

Known validation note:

- A broad config test pattern also matched
  `installs dependencies in writable OPENCORVUS_CONFIG_DIR when local plugins
  exist`, which launches a real `bun install` and timed out at 240 seconds.
  That test was not counted as passed. The read-only snapshot path is covered by
  the focused config and package-manager tests above.
