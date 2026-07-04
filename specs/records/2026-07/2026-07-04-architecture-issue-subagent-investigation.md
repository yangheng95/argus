# 2026-07-04 Architecture Issue Subagent Investigation

## Recall

User request: "请你现在作为软件架构师，指挥独立子agent集团迭代调查架构问题，只做记录。"

Current objective:

- Act as software architect.
- Direct independent read-only subagents to iteratively investigate architecture issues.
- Only record investigation findings; do not implement fixes in this task.
- Keep requirements, acceptance criteria, and hard constraints in this record so context compaction does not shrink scope.

Acceptance criteria:

- Use independent direct subagents, not Codex/Claude CLI, for parallel architecture slices.
- Keep subagents read-only and prohibit further delegation.
- Record each round before continuing to the next challenge round.
- Separate confirmed issues, unproven risks, resolved historical issues, and rejected/downgraded findings.
- Use concrete code, test, spec, and grep evidence; do not infer root cause from names, titles, labels, or slugs.
- Do not modify product code.

Hard constraints:

- No fallback or compatibility logic.
- No gate or host-side routing workaround proposals as root fixes.
- No git reset/revert/worktree creation.
- Do not restart, kill, refresh, or otherwise interfere with running OpenCorvus or overlay processes.
- Do not treat mocked tests, string refs, or prompt text alone as real E2E evidence.
- Specs and records stay under `specs/records/2026-07/`; this file must be indexed by the monthly README.

Sources read before Round 1:

- `AGENTS.md`
- `specs/current/architecture/README.md`
- `specs/current/architecture/99-principles.md`
- `specs/current/architecture/01-agents.md`
- `specs/current/architecture/02-data.md`
- `specs/current/architecture/03-control.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/07-panel.md`
- `specs/current/architecture/07-panel-reactivity.md`
- `specs/current/architecture/08-agent-tool-adapter.md`
- `specs/current/architecture/09-verification-evidence.md`
- `specs/current/architecture/13-agent-communication-matrix.md`
- `specs/current/architecture/14-agent-runtime-mode.md`
- `specs/current/architecture/15-agent-context-packet.md`
- `specs/current/architecture/16-unified-teardown.md`
- `specs/current/architecture/18-webpage-replica-agent-workflow.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-04-communication-protocol-expert-squad-audit.md`
- `specs/records/2026-07/2026-07-04-communication-protocol-expert-squad-systemic-repair.md`
- `specs/records/2026-07/2026-07-04-direct-build-outcome-and-visual-qa-contract.md`
- `specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md`
- `specs/records/2026-07/2026-07-03-multi-task-storage-namespace-consensus.md`

Local repository search evidence before Round 1:

- `rg -n "Session\.get\(|Session\.getInProject\(|assertLineageInProject|sessionID|sessionId" packages/opencorvus/src/server packages/opencorvus/src/scheduler packages/opencorvus/src/session packages/opencorvus/src/coding-assistant packages/opencorvus/src/task-api -g "*.ts"`
- `rg -n "dispatchTaskLoop\(|processTask\(\)|\.catch\(|catch \{\}|void .*\.catch|fire-and-forget|SessionPrompt\.loop\(|TaskQueueService\.queue|SessionWake\.wake" packages/opencorvus/src/orchestrator packages/opencorvus/src/engine packages/opencorvus/src/task-api packages/opencorvus/src/tool packages/opencorvus/src/scheduler packages/opencorvus/src/session -g "*.ts"`
- `rg -n "AgentContextPacket|validateAgentContextPacket|parse.*Context|structured|schema|strict\(|passthrough\(|catchall|unknown" packages/opencorvus/src/agent packages/opencorvus/src/context-packets packages/opencorvus/src/build packages/opencorvus/src/visual-qa packages/opencorvus/src/integrity packages/opencorvus/src/evidence -g "*.ts"`
- `rg -n "promptProfile|prompt_profile|PromptProfile|expert-squad|projected|MCP|mcp|skillProjection|mounts" packages/opencorvus/src/expert-squad packages/opencorvus/src/skill packages/opencorvus/src/config packages/opencorvus/src/mcp packages/overlay/src/services -g "*.ts" -g "*.tsx"`
- `rg -n "direct agent|direct_agent|overlay_direct_reply|replyAgentSession|agent session reply|operator-steer|request_orchestrator_decision|agent_coordination" packages/opencorvus/src packages/overlay/src packages/opencorvus/test packages/overlay/test -g "*.ts" -g "*.tsx"`
- `rg -n "conversation/events|provideTaskProjectForConversationRead|conversation/session|conversation/history|conversation" packages/opencorvus/src/server/routes/orchestrator.ts packages/opencorvus/test/server/task-conversation-routes.test.ts -g "*.ts"`

Working tree boundary:

- The repository was already heavily dirty before this investigation started.
- Existing uncommitted architecture and repair files are treated as user/other-task state.
- This investigation must not revert, rewrite, or claim ownership of those unrelated edits.

## Round 1 Subagents

- Euclid (`019f2d67-b511-7c50-9e93-87a9e45ea011`): communication, orchestration, scheduling, wake/session lifecycle.
- Mill (`019f2d67-eb16-7ab3-9722-d18c3449fe55`): expert-squad, PromptProfile, skill/MCP capability projection.
- Meitner (`019f2d68-38d6-76f3-b0f0-2ba9fa064d84`): evidence, context packets, Build, Visual QA, Integrity contracts.
- Lagrange (`019f2d68-780c-7612-b069-e5a0b92f1cbf`): project/session/API/overlay projection boundaries.

All Round 1 agents were instructed to work read-only, not to spawn subagents, and to separate confirmed issues from risks and test/doc gaps.

## Round 1 Findings

### P1 Confirmed: scheduler wake success is split from actual session loop execution

Observable problem: cron/event jobs can record success, clear `last_error`, and disable one-shot rows after only injecting a wake message and starting a session loop. If the detached session loop fails later, the scheduler job has already treated the wake as successful.

Direct trigger:

- `packages/opencorvus/src/session/wake.ts` persists the wake message, starts `SessionPrompt.loop({ resume_existing: false })` through a detached `void ... .catch(...)`, then returns `sessionID`.
- `packages/opencorvus/src/scheduler/cron-service.ts` treats `executeJobWake()` return as job success and clears failure state.
- `packages/opencorvus/src/scheduler/event-service.ts` does the same for event jobs.

Deep cause:

- Scheduler success is bound to "wake message injected / loop launched", while real execution truth lives in `SessionPrompt.loop` and session status.
- This is a fire-and-forget lifecycle boundary, not an inactivity-timeout or visible orchestration result boundary.

Impact:

- One-shot cron/event jobs can be disabled even when the actual agent loop fails after launch.
- Scheduler history can disagree with visible session failure.
- Existing scheduler tests mainly mock `SessionWake.wake` resolve/reject and do not cover post-return loop failure.

### P1 Confirmed: worker expert-squad built-in tool projection can drift from AgentToolPool runtime visibility

Observable problem: a worker capability can declare `built_in_tool_ids`; if those IDs are not present in the runtime tool map for that worker role, the worker projection silently drops the missing tool. The capability can still appear declared at the expert-squad layer.

Direct trigger:

- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts` worker projection filters over available runtime tools and lacks the Orchestrator-side fail-fast assertion for every declared built-in tool.
- `packages/opencorvus/src/expert-squad/registry.ts` validates `built_in_tool_ids` against a canonical all-role tool set, not the specific role's visible `AgentToolPool`.
- `packages/opencorvus/src/agent/tool-pool-contract.ts` exposes the canonical tool set as a cross-role union.
- `packages/opencorvus/src/tool/registry.ts` filters actual runtime tools through per-agent visible tool IDs.

Deep cause:

- Capability declaration and actual worker runtime visibility have two authorities: expert-squad manifest projection and role-specific tool-pool projection.
- Orchestrator projection already has a stricter missing-tool check, so the inconsistency is worker-specific.

Impact:

- A package can declare worker capability that is accepted structurally but unavailable at runtime.
- The model sees no tool, while the architecture layer may imply capability projection succeeded.
- Mill did not find a current `.opencorvus/expert-squads/**` manifest that triggers this, so this is a confirmed architecture defect without a proven in-repo package trigger.

### P2 Confirmed: engine queue uses session directory and project worktree as dual cwd sources

Observable problem: queue cwd ownership is derived from two currently legal sources: `session.directory` when a session is present, and `project.worktree` when the task has no session directory or the session row has been deleted.

Direct trigger:

- `packages/opencorvus/src/engine/queue.ts` documents and implements `task.session_id -> session.directory`, then fallback to `project.worktree`.
- Queue SQL uses `COALESCE(SessionTable.directory, ProjectTable.worktree)` in cwd matching.
- `packages/opencorvus/src/engine/engine.sql.ts` allows task `session_id` to be set null on session deletion.
- `packages/opencorvus/test/server/session-routes.test.ts` asserts that deleting a session without `deleteTasks` keeps the task row and nulls `session_id`.

Deep cause:

- Queue cwd ownership has two data sources, and sessionless tasks are a legal durable model rather than automatically corrupt records.

Impact:

- A queue participant can be associated with either a session directory or the project worktree, depending on task/session lifecycle history.
- This makes cwd queue behavior depend on both task identity and session deletion history, so active exclusion and ordering are harder to reason about from a single durable owner.

### P2 Confirmed: overlay active-task delete clears local projection before durable backend deletion

Observable problem: deleting the selected active task first clears the overlay selection/projection, stops SSE, clears board/messages, resets the writer, and persists an empty workspace task. Only after that does it issue the backend DELETE. If the backend DELETE fails, the UI has already hidden local context.

Direct trigger:

- `packages/overlay/src/services/task.ts` calls `selectTask("")` before DELETE.
- `selectTask("")` clears task-local overlay state.
- Backend DELETE occurs later in the same flow.

Deep cause:

- The UI deletion command treats local projection cleanup as part of durable deletion rather than waiting for backend delete result and server-projected task list as the single visible source.

Impact:

- Failed deletion can produce a transient second truth source and remove the user's immediate diagnostic context.
- Lagrange found backend `deleteTask` itself does cancel/settle before removal, so the issue is the overlay command ordering, not backend stop-before-delete.

### P2 Confirmed: visual feedback verification projection still depends on a decision-log mirror

Observable problem: visual feedback verification writes a `verification-evidence` artifact, but also mirrors the full verification payload into decision log. Failure counting and workflow projection read from the decision-log mirror first and can return `undefined` on malformed mirror parse.

Direct trigger:

- `packages/opencorvus/src/orchestrator/tools.ts` writes the verification artifact, then writes a decision-log entry containing the same `visual_feedback_verification` payload.
- The same area counts prior failures from decision-log values.
- `packages/opencorvus/src/engine/workflow.ts` projects Visual QA state by parsing decision-log entries, then reading artifact IDs.

Deep cause:

- Decision log is carrying a report payload used for lifecycle/projection counting, while the architecture says persisted verification evidence is the authority.

Impact:

- Failure counts can be under-reported if the mirror is malformed.
- Workflow projection can disagree with the durable evidence artifact.

### P2 Confirmed Risk: visual feedback verification artifact has outer and inner status authorities

Observable problem: one verification artifact payload stores outer `status` / `verdict` / `checks` fields plus an inner `visual_feedback_verification.status`. The dedicated reader returns the inner object, while generic verification evidence readers and analytics read outer fields.

Direct trigger:

- `packages/opencorvus/src/acceptance/visual-feedback-verification.ts` writes both envelope-level fields and nested visual-feedback fields.
- The payload schema accepts passthrough outer fields while validating the nested visual feedback object.
- Generic readers in `engine/store.ts`, `tool/analytics.ts`, and `engine/describe.ts` consume envelope-level fields.

Deep cause:

- A generic verification envelope and a domain-specific payload each carry status-like fields without a strict equality contract.

Impact:

- Current writer appears to write consistent values, but historical rows, bad writes, or future changes could make analytics/describe disagree with the dedicated reader.

### P3 Confirmed API Contract Leak: public session prompt routes expose `byteMaterializationProjectID`

Observable problem: public session prompt/prompt_async REST schemas, generated SDK, and API docs expose `byteMaterializationProjectID`, an internal storage namespace field.

Direct trigger:

- `packages/opencorvus/src/server/routes/session.ts` uses `SessionPrompt.PromptInput.omit({ sessionID: true })` directly for public routes.
- `packages/opencorvus/src/session/prompt/schema.ts` includes `byteMaterializationProjectID`.
- Generated docs and SDK include the field.

Deep cause:

- An internal prompt materialization schema is reused as public REST contract.

Impact:

- Clients are taught they can choose a storage namespace field.
- Lagrange found downstream code validates/overrides this field, so no cross-project write bug was proven. The issue is public contract leakage.

### P3 Confirmed Route-Policy Inconsistency: conversation event replay uses current project while sibling conversation reads switch to task project

Observable problem: task conversation hydrate, session transcript, and history routes intentionally switch into the task-owning project. The event replay route instead calls current-project task lookup.

Direct trigger:

- `packages/opencorvus/src/server/routes/orchestrator.ts` wraps `/task/:taskID/conversation`, `/conversation/session/:sessionID`, and `/conversation/history` in `provideTaskProjectForConversationRead`.
- `/task/:taskID/conversation/events` calls `EngineService.getTask(taskID)` under the current request project instead.
- Existing tests cover cross-project 200 behavior for hydrate/session/history and 404 behavior for transcript/cancel, but do not cover conversation events.

Deep cause:

- One route in the same conversation-read family uses a different project-boundary policy.

Impact:

- Cross-project task conversation replay can hydrate initial state but fail to page event replay.
- This may be intentional, but it needs explicit architecture adjudication and test coverage.

### P3 Confirmed Documentation Gap: control architecture route inventory is stale

Observable problem: `specs/current/architecture/03-control.md` says `server/routes/` has 28 route files. Current route file count is 29, and `expert-squad` is mounted through app routes.

Direct trigger:

- `packages/opencorvus/src/server/routes/app.ts` mounts the `expert-squad` route.
- Current architecture route inventory was not updated.

Deep cause:

- Control surface inventory is not generated or checked from the actual route tree/OpenAPI inventory.

Impact:

- Architecture audits can miss the expert-squad surface.

### P3 Prompt/Document Conflict: Integrity is review-only but workflow metadata marks it non-skippable

Observable problem: architecture docs describe Integrity as report-only and not lifecycle authority. Workflow metadata marks `integrity` as `skippable: false`; prompt rendering only labels steps as optional when `skippable` is true.

Direct trigger:

- `packages/opencorvus/src/engine/workflow.ts` sets Integrity `skippable: false`.
- `specs/current/architecture/13-agent-communication-matrix.md` says Integrity is a review report tool, not lifecycle authority.

Deep cause:

- Workflow/progress metadata is carrying scheduling pressure that can read like a fixed pipeline requirement.

Impact:

- No host-level fixed pipeline was proven. This remains a prompt/document contract conflict.

## Round 1 Risks And Gaps

- MCP projected-context "base64 payload" wording is broader than current implementation. Code rejects blobs, image/audio, `_meta`, unknown fields, unknown content types, and inline `data:*;base64` URLs. It does not prove rejection of arbitrary bare base64-like text. This should not be "fixed" with a keyword gate without a precise protocol definition.
- `backend` and `algorithm` expert squads are loadable through catalog/active profile but not selector-skill discoverable. Existing records say this is a temporary product boundary, not an automatic bug.
- `renderVisualQaIntegrityContext` has a fail-soft normalizer for unknown payloads, but the main current upstream path appears to use strict Integrity attempt parsing first. Risk is future direct raw-payload use.
- Attachment byte routes are projectID-path scoped and do not use active directory/session semantics. Current architecture treats attachment URLs as durable identity and no consumer was found inferring task ownership from URL alone.

## Round 1 Rejected Or Downgraded

- Config/skill foreign `sessionID` leaks were not found in current hard-disk state; current routes use active-project session assertions.
- Right-sidebar coding assistant cross-project lineage leak was not found in current hard-disk state.
- Scheduler/wake cross-project lineage leak was not found in current hard-disk state; current create/execute/recover paths include lineage assertions.
- Direct child-session reply is not the operator-steer path. Overlay reply boxes call `/operator-steer`; `/reply` remains a separate explicit direct-reply API with no task-root fallback. This is a legitimate exception recorded in older A2A repair notes, not a targeted-steer double source.
- Package MCP prompt/resource leakage into global MCP prompt/resource lists was not found; tests assert package projected prompts/resources do not enter global MCP lists.
- Formal Visual QA reference parity does not accept arbitrary string refs: schema and output tools require durable browser-preview evidence refs. Build result string refs are lower-authority context, not final Visual QA acceptance authority.
- Static `PromptProfile.*` built-in-only helpers were not proven as active runtime double source. Production paths mostly use `PromptProfileResolver`.

## Round 2 Challenge Plan

Round 2 should challenge only Round 1 findings and boundaries:

1. Scheduler lifecycle: verify whether `SessionWake.wake` detached loop success is a real product bug or an intentional "message accepted" semantic. Challenge cron/event one-shot consequences.
2. Queue cwd: verify whether sessionless tasks are valid durable records; if not, challenge every `COALESCE(Session.directory, Project.worktree)` queue call site.
3. Expert-squad worker tools: challenge whether `projectWorkerTools` output is the only runtime-visible tool contract or whether capability projection separately exposes declared missing tools.
4. Overlay delete ordering: challenge whether clearing selected task before backend delete has visible failure handling that restores context.
5. Visual feedback evidence: challenge whether decision log is intended as mirror-only pointer or whether any consumer still needs full payload mirror.
6. Conversation events: challenge whether `/conversation/events` should be task-project read like hydrate/session/history or intentionally current-project-only.
7. Public prompt API: challenge whether `byteMaterializationProjectID` should remain an internal-only field or is an intentionally public advanced contract.

## Round 2 Challenge Findings

### Dewey: scheduler, queue, conversation events, and overlay delete

Result summary:

- `CLEAR`: `SessionWake.wake` still returns after wake-message/control insertion and detached `SessionPrompt.loop` launch, while cron/event services record success and clear failure state at that boundary. Durable session status can later record loop failure, but scheduler rows do not read it back.
- `CORRECTED`: queue cwd dual-source finding remains confirmed, but Round 1 overreached by implying sessionless tasks are necessarily corrupt. Current schema and route tests make sessionless tasks legal after session deletion.
- `CLEAR`: `/task/:taskID/conversation/events` still uses current-project `EngineService.getTask(taskID)` while sibling conversation hydrate/session/history routes switch into the task-owning project. No covering cross-project events test was found.
- `CLEAR`: overlay active-task deletion still clears the selected task and local projections before backend DELETE, and tests assert this split behavior rather than restoring context on failure.

Evidence anchors:

- `packages/opencorvus/src/session/wake.ts:176`, `packages/opencorvus/src/session/wake.ts:183`
- `packages/opencorvus/src/scheduler/cron-service.ts:501`, `packages/opencorvus/src/scheduler/cron-service.ts:506`
- `packages/opencorvus/src/scheduler/event-service.ts:181`, `packages/opencorvus/src/scheduler/event-service.ts:195`
- `packages/opencorvus/src/engine/queue.ts:5`, `packages/opencorvus/src/engine/queue.ts:520`, `packages/opencorvus/src/engine/queue.ts:541`
- `packages/opencorvus/src/engine/queue.ts:317`, `packages/opencorvus/src/engine/queue.ts:579`, `packages/opencorvus/src/engine/queue.ts:700`
- `packages/opencorvus/src/engine/engine.sql.ts:186`
- `packages/opencorvus/test/server/session-routes.test.ts:230`, `packages/opencorvus/test/server/session-routes.test.ts:271`
- `packages/opencorvus/src/server/routes/orchestrator.ts:108`, `packages/opencorvus/src/server/routes/orchestrator.ts:948`, `packages/opencorvus/src/server/routes/orchestrator.ts:1042`, `packages/opencorvus/src/server/routes/orchestrator.ts:1110`, `packages/opencorvus/src/server/routes/orchestrator.ts:1177`
- `packages/opencorvus/src/task-api/index.ts:1737`
- `packages/overlay/src/services/task.ts:273`, `packages/overlay/src/services/task.ts:286`, `packages/overlay/src/services/task.ts:293`, `packages/overlay/src/services/task.ts:301`, `packages/overlay/src/services/task.ts:359`, `packages/overlay/src/services/task.ts:363`
- `packages/overlay/test/task-selection-dead-task.test.ts:260`, `packages/overlay/test/task-selection-dead-task.test.ts:336`, `packages/overlay/test/task-selection-dead-task.test.ts:339`

Disposition:

- Retain scheduler wake as P1 confirmed lifecycle split.
- Retain queue cwd as P2 confirmed dual-authority model, with corrected wording that sessionless tasks are legal.
- Retain conversation events as P3 confirmed route-policy inconsistency.
- Retain overlay delete as P2 confirmed local-projection-before-durable-delete split.

### Erdos: expert-squad capability projection

Result summary:

- `CLEAR`: worker built-in tool drift is real. Expert-squad registry validates declared `built_in_tool_ids` against the canonical all-role tool union, while runtime registry filters by role-visible tool IDs. Worker projection iterates actual runtime tools and silently omits declared but unavailable worker tools.
- `CLEAR`: orchestrator and worker fail-fast behavior is inconsistent. Orchestrator projection throws when a declared built-in tool is missing from orchestrator tools; worker projection does not.
- `CORRECTED`: MCP base64 concern is a wording/test gap, not a proven arbitrary base64 payload leak. Current sanitizer rejects `_meta`, image/audio/blob, unknown fields/content, and inline `data:*;base64` URLs; bare base64-like text is not separately rejected because it is ordinary text.
- `CORRECTED`: `backend` and `algorithm` expert squads lacking selector blocks is a documented product boundary and discoverability risk, not a confirmed functionality bug.
- `CORRECTED`: static `PromptProfile.*` helpers remain maintenance risk, but current production catalog/prompt routes use `PromptProfileResolver`; no active runtime double source was proven.

Evidence anchors:

- `packages/opencorvus/src/expert-squad/registry.ts:576`
- `packages/opencorvus/src/agent/tool-pool-contract.ts:323`
- `packages/opencorvus/src/tool/registry.ts:121`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts:1470`, `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts:1633`, `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts:1904`, `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts:1980`, `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts:1988`, `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts:211`, `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts:2193`, `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts:2372`
- `packages/opencorvus/src/agent/runner.ts:790`, `packages/opencorvus/src/agent/runner.ts:819`
- `packages/opencorvus/src/util/inline-base64.ts:1`
- `packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts:654`, `packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts:789`
- `.opencorvus/expert-squads/backend/expert-squad.jsonc:1`
- `.opencorvus/expert-squads/algorithm/expert-squad.jsonc:1`
- `.opencorvus/expert-squads/frontend-replica/expert-squad.jsonc:8`
- `specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md:2425`
- `packages/opencorvus/src/agent/prompt-profile.ts:136`, `packages/opencorvus/src/agent/prompt-profile.ts:170`
- `packages/opencorvus/src/server/routes/config.ts:129`, `packages/opencorvus/src/server/routes/config.ts:250`

Disposition:

- Retain worker built-in tool projection drift as P1 confirmed architecture defect.
- Keep MCP base64, backend/algorithm selector absence, and static `PromptProfile.*` as downgraded risks/gaps.

### Sagan: verification evidence and Visual QA contracts

Result summary:

- `CLEAR`: visual feedback verification failure count and workflow projection still depend on decision-log full-payload mirrors. The verification artifact exists, but decision-log entries remain the discovery/counting entrypoint.
- `CLEAR`: visual feedback verification artifact outer `status` / `verdict` / `checks` and inner `visual_feedback_verification.status` can become double authorities because no strict equality schema was found. Current writer appears consistent, so this is a confirmed risk, not an observed current divergence.
- `CORRECTED`: `renderVisualQaIntegrityContext` fail-soft normalization is not a current main-chain confirmed defect because upstream Integrity attempt artifact reading strict-parses the payload before rendering. Keep as future-risk for direct raw-payload use.
- `CLEAR`: Formal Visual QA reference parity string-ref issue remains rejected. Formal report schemas and output tools require durable Browser Preview evidence references and validate reference-comparison operation kind/status.

Evidence anchors:

- `packages/opencorvus/src/orchestrator/tools.ts:4809`, `packages/opencorvus/src/orchestrator/tools.ts:4814`, `packages/opencorvus/src/orchestrator/tools.ts:4821`, `packages/opencorvus/src/orchestrator/tools.ts:4831`, `packages/opencorvus/src/orchestrator/tools.ts:4847`, `packages/opencorvus/src/orchestrator/tools.ts:7805`, `packages/opencorvus/src/orchestrator/tools.ts:7812`
- `packages/opencorvus/src/engine/workflow.ts:632`, `packages/opencorvus/src/engine/workflow.ts:682`
- `packages/opencorvus/src/acceptance/visual-feedback-verification.ts:33`, `packages/opencorvus/src/acceptance/visual-feedback-verification.ts:220`, `packages/opencorvus/src/acceptance/visual-feedback-verification.ts:291`
- `packages/opencorvus/src/verification/persist.ts:51`, `packages/opencorvus/src/verification/persist.ts:71`
- `packages/opencorvus/src/engine/store.ts:1028`
- `packages/opencorvus/src/integrity/attempt-payload.ts:148`, `packages/opencorvus/src/integrity/attempt-payload.ts:192`
- `packages/opencorvus/src/visual-qa/context.ts:308`, `packages/opencorvus/src/visual-qa/context.ts:357`
- `packages/opencorvus/src/visual-qa/schema.ts:26`, `packages/opencorvus/src/visual-qa/schema.ts:239`
- `packages/opencorvus/src/evidence/ref.ts:27`
- `packages/opencorvus/src/visual-qa/output-tools.ts:324`, `packages/opencorvus/src/visual-qa/output-tools.ts:371`
- `packages/opencorvus/test/visual-qa/output-tools.test.ts:213`, `packages/opencorvus/test/visual-qa/output-tools.test.ts:651`, `packages/opencorvus/test/visual-qa/output-tools.test.ts:733`

Disposition:

- Retain visual feedback decision-log mirror dependence as P2 confirmed.
- Retain visual feedback outer/inner status as confirmed risk.
- Keep Visual QA Integrity context fail-soft only as future-risk.
- Keep Formal Visual QA string refs rejected.

### Chandrasekhar: public prompt API, control docs, and Integrity workflow metadata

Result summary:

- `CLEAR`: public session prompt/prompt_async REST contract exposes `byteMaterializationProjectID`; no evidence was found that this is intentionally public advanced contract. This confirms contract leak only, not cross-project write bug.
- `CORRECTED`: control route inventory stale finding is valid, but docs health is not absent. Existing document-health coverage locks the stale "28 files" text instead of deriving the count from source.
- `CLEAR`: Integrity remains a P3 prompt/document metadata conflict. `skippable: false` creates non-skippable prompt/UI pressure, but current implementation was not proven to turn Integrity verdict into host fixed pipeline or lifecycle authority.

Evidence anchors:

- `packages/opencorvus/src/session/prompt/schema.ts:22`
- `packages/opencorvus/src/server/routes/session.ts:1143`, `packages/opencorvus/src/server/routes/session.ts:1185`
- `packages/sdk/js/src/gen/types.gen.ts:6909`, `packages/sdk/js/src/gen/types.gen.ts:7249`
- `packages/sdk/openapi.json:7684`, `packages/sdk/openapi.json:8378`
- `packages/web/src/content/docs/reference/api.mdx:169`, `packages/web/src/content/docs/reference/api.mdx:174`
- `packages/opencorvus/src/session/prompt/parts.ts:49`, `packages/opencorvus/src/session/prompt/parts.ts:51`
- `packages/opencorvus/src/scheduler/task-queue-service.ts:1011`, `packages/opencorvus/src/scheduler/task-queue-service.ts:1021`
- `specs/current/architecture/03-control.md:141`
- `packages/opencorvus/src/server/routes/app.ts:28`, `packages/opencorvus/src/server/routes/app.ts:127`
- `packages/opencorvus/src/server/routes/expert-squad.ts:64`, `packages/opencorvus/src/server/routes/expert-squad.ts:72`
- `packages/opencorvus/test/script/document-health.test.ts:1046`, `packages/opencorvus/test/script/document-health.test.ts:1072`, `packages/opencorvus/test/script/document-health.test.ts:1162`, `packages/opencorvus/test/script/document-health.test.ts:1165`
- `specs/current/architecture/13-agent-communication-matrix.md:27`
- `packages/opencorvus/src/engine/workflow.ts:10`, `packages/opencorvus/src/engine/workflow.ts:15`, `packages/opencorvus/src/engine/workflow.ts:333`, `packages/opencorvus/src/engine/workflow.ts:339`, `packages/opencorvus/src/engine/workflow.ts:601`, `packages/opencorvus/src/engine/workflow.ts:609`, `packages/opencorvus/src/engine/workflow.ts:823`, `packages/opencorvus/src/engine/workflow.ts:853`, `packages/opencorvus/src/engine/workflow.ts:856`
- `packages/opencorvus/test/engine/workflow-integrity-step.test.ts:1465`, `packages/opencorvus/test/engine/workflow-integrity-step.test.ts:1537`

Disposition:

- Retain public prompt API `byteMaterializationProjectID` as P3 confirmed contract leak.
- Retain control route inventory stale as P3 confirmed doc/test drift, with corrected note that document-health currently preserves stale text.
- Retain Integrity as P3 prompt/document metadata conflict only.

## Current Investigation Status

Round 2 challenged all Round 1 confirmed findings and downgraded areas in the stated scope. No implementation was performed.

Retained confirmed findings:

- P1: scheduler wake success is split from actual session loop execution.
- P1: worker expert-squad built-in tool projection can drift from role-visible runtime tools.
- P2: engine queue cwd ownership has two legal sources, `session.directory` and `project.worktree`.
- P2: overlay active-task delete clears local projection before durable backend deletion.
- P2: visual feedback verification failure counting/workflow projection depends on decision-log full-payload mirror.
- P2 confirmed risk: visual feedback verification artifact has outer and inner status authorities without strict equality enforcement.
- P3: public session prompt routes expose internal `byteMaterializationProjectID`.
- P3: conversation event replay uses current-project lookup while sibling conversation reads switch to task project.
- P3: control route inventory is stale, and the current document-health assertion preserves stale route-count text.
- P3: Integrity is review-only by architecture but marked non-skippable in workflow prompt/UI metadata.

Retained downgraded or rejected areas:

- MCP arbitrary bare-base64 rejection remains a protocol wording/test gap, not a proven payload leak.
- `backend` and `algorithm` expert squads without selector blocks remain a product-boundary discoverability risk, not a confirmed bug.
- Static `PromptProfile.*` helpers remain maintenance risk, not proven runtime double source.
- `renderVisualQaIntegrityContext` fail-soft normalization remains future-risk, not current main-chain defect.
- Formal Visual QA string-ref parity issue remains rejected because formal report refs are durable evidence references validated by schema and output tool.
