# 2026-07-04 Communication Protocol And Expert Squad Systemic Repair

## Recall

User request: "系统性分析，解析问题线索，再系统性修复-审查".

Current task objective:

- Treat `2026-07-04-communication-protocol-expert-squad-audit.md` as the issue clue source.
- Restore normal functionality broken or weakened by recent communication-protocol and expert-squad changes.
- Analyze the clues by call chain before editing.
- Fix systemically with tests, then review the repair.
- Updated objective: after communication-protocol/expert-squad functional blockers are clear, check and compress the scheduler prompt and review remaining prompt/protocol residue.

Acceptance criteria:

- Project-scoped HTTP routes must not accept a foreign-project `sessionID` and then read or mix another project's effective config, prompt catalog, prompt-profile catalog, or skill mount projection.
- Projected MCP prompt/resource context must never stringify inline image/audio/blob/base64 payloads into agent prompts or `/config/prompt` catalog responses.
- Structured context parsers must fail fast on malformed present fields instead of silently filtering or dropping enforcement data.
- API/product docs and test harness drift identified in the audit must be corrected when they are part of the same contract surface.
- Each code change must have focused regression tests.
- The final review must include targeted tests, docs health checks, `api:routes-check`, typecheck where needed, `git diff --check`, and an independent review pass.
- Scheduler prompt compression must move expert-specific content to the external expert-squad/profile sources and keep scheduler/orchestrator text focused on visible lifecycle/protocol decisions.

Hard constraints:

- No fallback or compatibility logic.
- No second source for expert-squad selection; `prompt_profile.active` remains the active expert-squad ID source.
- No host-side routing gates, hidden messages, or synthetic prompt splits.
- Do not change `EffectiveConfig` into a current-project-only helper because it is also used by internal task/session resolution outside HTTP route scope.
- Do not restart, kill, refresh, or reload a running OpenCorvus / overlay process.
- Do not create a worktree or use git reset/revert.
- Use direct subagents for review; do not use Codex/Claude CLI.
- Specs live under `specs/records/2026-07/` and this record must stay indexed by the monthly README.

Sources read before implementation:

- `AGENTS.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-04-communication-protocol-expert-squad-audit.md`
- `specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md`
- `specs/current/architecture/11-agent-oop-protocol.md`
- `specs/current/architecture/13-agent-communication-matrix.md`
- `specs/current/architecture/15-agent-context-packet.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `packages/opencorvus/src/server/routes/config.ts`
- `packages/opencorvus/src/server/routes/skill.ts`
- `packages/opencorvus/src/skill/mounts.ts`
- `packages/opencorvus/src/config/effective.ts`
- `packages/opencorvus/src/session/index.ts`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- `packages/opencorvus/src/mcp/materialize.ts`
- `packages/opencorvus/src/session/prompt/parts.ts`
- `packages/opencorvus/src/agent/context-packet.ts`
- `packages/opencorvus/src/visual-qa/context.ts`
- `packages/opencorvus/src/build/prompt-context.ts`
- `packages/opencorvus/src/integrity/acceptance-tools.ts`
- `packages/opencorvus/src/integrity/replay-context.ts`

Repository search evidence:

- `rg -n "sessionID|config/prompt|config/prompt-profile|skill/mounts|SkillMount|EffectiveConfig\.(effective|base|directory)|getInProject|Session\.get\(" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test -g "*.ts" -g "*.tsx"`
- `rg -n "PromptProfileResolver\.|projectSchedulerMcpPrompts|projectWorkerMcpPrompts|projectSchedulerMcpResources|projectWorkerMcpResources|renderProjectedMcpContext|JSON\.stringify|blob|base64|inline|data:" packages/opencorvus/src/expert-squad packages/opencorvus/src/mcp packages/opencorvus/test/expert-squad packages/opencorvus/test/mcp packages/opencorvus/test/session -g "*.ts"`
- `rg -n "parseVisualQaDispatchContext|referenceParityRequired|requiredReferenceRegions|visual_qa\.dispatch_context|VisualQaDispatch|parseBuildRepairContractContextData|buildRepairContractStructuredPart|uniqueIntegrityFingerprints|parseImplementationEvidenceContext|parseIntegrityReplayContext|validateAgentContextPacket|agentContextPacketTextByStructuredSchema|part\.type|media_ref|scope" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`
- `rg -n "promptProfile|taskAgentOutcomes|POST /task|/mission/wake|/task/\{taskID\}/message|Body" packages/web/src/content/docs packages/sdk/js/src/gen packages/opencorvus/src/server packages/opencorvus/src/engine packages/opencorvus/test/server packages/overlay/src/services -g "*.ts" -g "*.tsx" -g "*.mdx"`
- `rg -n "PromptProfile|builtIns|prompt_profile|frontend-replica|frontend-innovate|expert-squad|select_expert_squad|mounted Orchestrator expert-squad|skill tool|frontend-replica-expert-squad|frontend-innovate-expert-squad|frontend-automation-debug-expert-squad|builtin-skills|required_tools|mounted_agents|requiredBuiltInTargetMatrix|built-in registry pressure|overlay target|prompt-profile" packages/opencorvus/src packages/opencorvus/test specs -g "*.ts" -g "*.md" -g "*.jsonc"`
- `rg -n "getActiveProjectSession|assertActiveProjectSession|Session\.getInProject\(\{ sessionID, projectID: Instance\.project\.id|Instance\.project\.id" packages/opencorvus/src/server/routes packages/opencorvus/src/server -g "*.ts"`

Relevant search findings:

- `/config/prompt` and `/config/prompt-profile` are project-scoped routes but use `EffectiveConfig.*({ sessionID })` without first asserting the session belongs to `Instance.project.id`.
- `/skill/mounts`, `/skill/mount`, `/skill/unmount`, and `/skill/import-and-mount` pass `sessionID` into `SkillMount` directly; `SkillMount` then mixes session-effective config/projection with active-project skill manager writes.
- `Session.getInProject({ sessionID, projectID: Instance.project.id })` is already the route-level pattern in `session.ts`, `experimental.ts`, and `export.ts`.
- `EffectiveConfig.base/effective/directory` intentionally resolves by task or root session and is used by internal task/session contexts; making it current-project-bound globally would break legitimate non-route consumers.
- `renderProjectedMcpContext()` currently fetches projected prompts/resources and JSON-stringifies their raw MCP payloads.
- Existing materialization code covers MCP tool results and user-attached session prompt resources, not expert-squad projected prompt context.
- Structured context parsers for Visual QA dispatch, Build repair contracts, Integrity implementation evidence, Integrity replay context, and AgentContextPacket validation share the same fail-open pattern: present malformed fields or array elements are dropped, filtered, or cast.
- Existing working tree already contains uncommitted context-packet migration changes touching `packages/opencorvus/src/{build,integrity,visual-qa}/**` and related tests. This repair must extend those changes rather than overwrite them.

Independent agent feedback:

- Direct read-only agents started:
  - Banach (`019f2cb2-cf3d-72e3-b941-d0a53081c494`): project-boundary/sessionID route review.
  - Epicurus (`019f2cb3-00ac-7263-9856-c203274c4acb`): MCP projected payload review.
  - Kierkegaard (`019f2cb3-3849-7f43-97ba-469ba36df3ba`): structured context parser review.
- Initial wait timed out before feedback returned.
- Kierkegaard returned the structured-context review. Its conclusions are incorporated below:
  - `AgentContextPacket` must reject unknown `part.type`, invalid packet `scope`, and invalid `media_ref.scope.kind`; schema-specific rendering must throw if a selected packet contains an unknown part.
  - Visual QA dispatch must reject malformed present fields and unknown fields.
  - Build repair contracts must validate fingerprints before dedup/sort; producer and parser must both throw on invalid fingerprints instead of returning an empty contract.
  - Integrity implementation evidence must validate `diffs` and `goalReports` arrays and nested rows.
  - Integrity replay context must validate nested implementation evidence, prior attempts, and prior fact-check attempts before rendering.
  - Do not add preflight gates, source/title routing, legacy compatibility, or a large generic parser framework.
- Epicurus returned the projected MCP payload review. Its conclusions are incorporated below:
  - Safe projected prompt/resource context is text/link metadata only: prompt text content, prompt embedded resource text, resource text contents, and resource-link metadata without `_meta` JSON dumping.
  - Prompt image/audio `data`, embedded resource `blob`, resource read `blob`, mixed text/blob shapes, unknown content types, and raw `_meta` payloads must fail fast.
  - The single repair point should be the render boundary in `renderProjectedMcpContext()`, because agent prompt composition and `/config/prompt` catalog share that path.
  - Do not move prompt-safety checks into the four projection fetch helpers; those helpers own ref/provider/scoping, not prompt-safe serialization.
  - The stale MCP wrapper must stop asserting a hardcoded pass count. It should trust the isolated process exit code and, at most, assert positive pass count plus zero failures.
- Banach returned the project-boundary route review. Its conclusions are incorporated below:
  - `GET /config/prompt`, `GET /config/prompt-profile`, `GET /skill/mounts`, `POST /skill/mount`, `POST /skill/unmount`, and `POST /skill/import-and-mount` must assert a supplied `sessionID` belongs to `Instance.project.id` before any `EffectiveConfig.*` or `SkillMount.*` call.
  - `GET /skill/mounts?refresh=true&sessionID=<foreign>` must fail before `SkillManager.refreshDiscoveryState()`, because refresh is a side effect.
  - `EffectiveConfig` must not become current-project-bound; it is an internal effective-config resolver and is used by runtime, model resolution, session config preview, and task/session contexts.
  - The route-level assertion should accept root or child session IDs but verify the supplied session belongs to the active project before resolving effective root config.
  - Adjacent routes already scoped by `Session.getInProject`, explicit `projectID` checks, or taskID-owned conversation semantics should not be mixed into this repair.

Second review round feedback:

- Einstein (`019f2ccf-9eeb-70d3-84df-e0ff960c7e44`) returned BLOCKED:
  - The route helper that only checks the supplied `sessionID` is insufficient. A current-project child session can point at a foreign-project parent/root, then `EffectiveConfig` and `resolveSessionOverlay()` walk the parent chain through project-blind `Session.get()`.
  - Repair must reject cross-project parent chains at the shared active-project route boundary and reject cross-project `parentID` at `Session.create` / `Session.createNext` before persistence.
  - Tests must include a current-project child with a foreign parent/root and prove config/skill routes reject before leaking config or calling `SkillMount` side-effect functions.
- Volta (`019f2ccf-cfdf-7f00-851e-94529e095300`) returned BLOCKED:
  - Projected MCP text/resource strings can still contain inline `data:*;base64` payloads because the sanitizer only checks field types.
  - The sanitizer also rejects normal safe MCP metadata such as `annotations`, resource-link `description`, and resource-link `icons`; `_meta` must still fail fast.
  - Tests must cover prompt text, embedded resource text, resource read text, `_meta`, `resource_link` positive projection, audio rejection, and inline base64 rejection.
- Galileo (`019f2cd0-0161-7240-95e8-7525c683c17d`) returned BLOCKED:
  - Integrity replay `lineage` is still `z.record(...)` and accepts missing `activeSpecSnapshotID`, `inheritedSpecSnapshotIDs`, or `reason`.
  - Integrity implementation evidence rejects unknown top-level fields but still drops unknown nested fields in `diffs`, `goalReports`, nested `report`, `files_changed`, `checks_run`, and `design_decisions`.
  - Build evidence packet parsing rejects unknown top-level fields but drops unknown nested fields in evidence files and evidence scopes.
  - Visual QA required reference regions need an explicit key contract at parse time; without a proven format source, this is tracked as a lower-priority follow-up unless current output-tool contract can be reused without inventing a parallel rule.

## Problem Clue Analysis

### Root Pattern 1: Project Identity Boundary Is Applied In Some Routes But Not Config/Skill Projection Routes

Observable problem: a request scoped to project B can pass a project A `sessionID` to config or skill routes.

Direct trigger:

- `ConfigRoutes` reads `sessionID` query and calls `EffectiveConfig.effective/base/directory`.
- `SkillRoutes` passes `sessionID` body/query directly to `SkillMount`.

Deep cause:

- `EffectiveConfig` is a low-level session/task effective-config resolver and uses project-blind `Session.get()` by design.
- Project-scoped HTTP routes need an explicit project assertion before calling low-level resolvers.
- Existing `session.ts` already has this route-level pattern, but it is local to that module rather than shared.

Repair boundary:

- Add a small shared route helper that asserts `Session.getInProject({ sessionID, projectID: Instance.project.id })`.
- Use it only in project-scoped HTTP routes that accept user-supplied `sessionID`.
- Do not change `EffectiveConfig`.

### Root Pattern 2: Expert-Squad MCP Projection Reuses Raw MCP Payloads As Prompt Text

Observable problem: projected MCP prompt/resource payloads can include `data` or `blob` fields and are JSON-stringified into prompt/catalog text.

Direct trigger:

- `renderProjectedMcpContext()` calls `prompt.get({})` / `resource.read()` and passes raw payload to `JSON.stringify`.

Deep cause:

- Runtime MCP tool results have an attachment materialization path, but expert-squad prompt projection is not a message-part owner and has no safe binary materialization target.
- The correct prompt context contract for this path is text-only MCP context, not attachment conversion.

Repair boundary:

- Normalize projected MCP prompt/resource payloads into text-only JSON before rendering.
- Reject prompt content items of type `image`, `audio`, resource blobs, non-text resource contents, or unknown content item types.
- Reject resource contents that contain `blob` or lack text.
- Keep prompt/resource projection scoped to the active capability; do not register package MCP globally.
- Fix the stale MCP wrapper test by asserting semantic success from the isolated process instead of a hardcoded pass count.

### Root Pattern 3: Structured Context Parsers Treat Present Malformed Fields As Absence

Observable problem: malformed enforcement/evidence fields are silently omitted, filtered, or cast, weakening downstream review and repair.

Direct triggers:

- Visual QA dispatch filters non-string `requiredReferenceRegions` and ignores non-boolean `referenceParityRequired`.
- Build repair contract filters invalid integrity fingerprints in producer and parser.
- Integrity implementation evidence casts optional `diffs` and `goalReports` arrays without element validation.
- Integrity replay context checks only top-level shape then casts nested evidence/prior rows.
- AgentContextPacket validation does not enforce `scope`, `media_ref.scope.kind`, or part discriminants.

Deep cause:

- Optional field absence and malformed field presence are conflated.
- Shared packet validation prevents inline binary payloads but not discriminant/schema membership.

Repair boundary:

- Optional fields may be absent.
- Present fields must be strictly validated, including array elements.
- Producer helpers must fail on invalid values they receive rather than producing `undefined` after filtering all invalid data.
- Keep schema-specific helpers and packet validation as the single protocol surface; do not add parallel role-specific context aliases.

## Implementation Plan

1. Project boundary:
   - Add/export a server route helper for active-project session assertion.
   - Apply it to `/config/prompt`, `/config/prompt-profile`, `/skill/mounts`, `/skill/mount`, `/skill/unmount`, and `/skill/import-and-mount`.
   - Add route tests proving foreign-project `sessionID` fails before returning foreign config/projection or mutating the active project.
   - Extend the helper to validate the whole parent chain for the active project.
   - Add `Session.createNext` persistence-boundary validation so cross-project parent chains cannot be created by normal code paths.

2. MCP projected context:
   - Replace raw payload JSON rendering with text-only normalized rendering.
   - Add prompt-profile resolver tests for projected MCP prompt image/audio/resource blob and MCP resource blob rejection.
   - Update the MCP fail-fast wrapper to assert process exit and zero failures instead of `"10 pass"`.
   - Reject inline `data:*;base64` payloads from every string that is rendered into projected MCP context.
   - Preserve safe MCP metadata (`annotations`, resource-link `description`, `icons`) while rejecting `_meta`.

3. Structured context:
   - Tighten AgentContextPacket validation for packet `scope`, media-ref `scope.kind`, and known `part.type`.
   - Tighten Visual QA dispatch parser for present field types and string array elements.
   - Tighten Build repair contract producer/parser fingerprint validation.
   - Tighten Integrity implementation evidence parser for `diffs` and `goalReports`.
   - Tighten Integrity replay context parser for nested implementation evidence, prior attempts, and prior fact-check attempts.
   - Tighten Integrity replay lineage schema.
   - Tighten nested unknown-field checks for implementation evidence goal reports and build evidence files/scopes.
   - Add focused regression tests in existing context test files.

4. Docs/contracts:
   - Update API docs rows for `promptProfile` request fields if the generated docs renderer is not immediately repaired.
   - Prefer repairing the renderer if the omission is caused by a generic optional-body-field bug and tests can cover it.
   - Update mission/task docs for `promptProfile`.

5. Review and validation:
   - Integrate read-only subagent feedback into this record.
   - Run targeted tests for touched surfaces.
   - Run `bun run --cwd packages/opencorvus typecheck` or broader typecheck if exported types change.
   - Run `bun run api:routes-check`, `bun run docs:check`, `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`, and `git diff --check`.
   - Use a final direct subagent review or focused local review to check the diff for fallback/double-source mistakes.

## Working Tree Boundary

Before this repair began, these relevant files were already modified or untracked:

- `packages/opencorvus/src/build/prompt-context.ts`
- `packages/opencorvus/src/integrity/acceptance-tools.ts`
- `packages/opencorvus/src/integrity/replay-context.ts`
- `packages/opencorvus/src/visual-qa/context.ts`
- `packages/opencorvus/test/build-agent/prompt-context.test.ts`
- `packages/opencorvus/test/integrity/acceptance-tools.test.ts`
- `packages/opencorvus/test/integrity/replay-context.test.ts`
- `packages/opencorvus/test/visual-qa/context.test.ts`
- `packages/opencorvus/src/agent/context-packet.ts` (untracked)
- `packages/opencorvus/test/agent/context-packet.test.ts` (untracked)

These edits appear relevant to the current repair domain. The implementation must read and extend them carefully instead of reverting or overwriting them.

## Review Reports And Repair Log

### Third Review Attempt

Direct agents Noether (`019f2ce0-00d4-7150-8e50-e61a5b4f7597`), Sagan (`019f2ce0-3834-72d1-b040-3f18fd2ce70a`), and Turing (`019f2ce0-7195-7d00-a77e-ec7775de30e1`) did not produce a valid review because the subagent runner returned a usage-limit message. This attempt is not counted as a clear review round.

### Fourth Review Round

- Averroes (`019f2d0f-be5a-7220-9803-27db3cb35bb6`) returned BLOCKED:
  - `/experimental/schedule` and `/experimental/event-schedule` still delegated user-supplied `sessionId` to scheduler services.
  - `CronService.create`, `CronService.createDelayedSessionWake`, and `EventService.create` used shallow `session_id + project_id` SQL checks rather than full `Session.assertLineageInProject`.
  - The stored scheduler `session_id` later flows into `SessionWake.wake`, so a current-project child with a foreign parent could still become a cross-project wake target.
- Franklin (`019f2d10-2e66-7cd0-8690-61127148644d`) returned BLOCKED:
  - `AgentContextPacket` accepted present `media_ref.scope: null` because the check only ran for truthy scope values.
  - `VisualQaReportSchema` was strict only at the top level and silently stripped unknown nested fields in viewport, coverage, check item, production blocker, DOM region, evidence, and reference parity rows.
  - `buildPriorManifestIndex` still synthesized fingerprints from finding content when prior manifest items lacked persisted fingerprints.
- Hume (`019f2d0f-f5da-7b52-b495-3c7e57f2aca5`) returned CLEAR for the MCP projection surface:
  - MCP projected prompt/resource payloads are sanitized at the render boundary.
  - `_meta`, unsupported content, image/audio/blob payloads, and inline `data:*;base64` strings are rejected.
  - Safe resource-link metadata, annotations, and icons remain allowed.

Fourth-round repairs:

- Scheduler services now call `Session.assertLineageInProject` before persisting session-bound cron or event jobs.
- `CronService.create`, `CronService.createDelayedSessionWake`, and `EventService.create` are asynchronous so the shared deep-lineage assertion completes before insert.
- `/experimental/schedule`, `/experimental/event-schedule`, and the `wait` tool now await those scheduler service calls.
- Scheduler service and route tests now cover a current-project child session imported with a foreign-project parent; both cron and event creation reject it and do not insert rows.
- `AgentContextPacket` rejects present non-object `media_ref.scope`, including `null`.
- Visual QA nested schemas are strict across viewport, DOM box, coverage, check item, production blocker, code module reference, unresolved code module problem, problem DOM region, evidence, and reference parity.
- `buildPriorManifestIndex` now requires each prior finding/repair item to carry a persisted `if_[a-f0-9]{16}` fingerprint; malformed or missing fingerprints throw.

Fourth-round validation:

- `bun test --timeout=2147483647 packages/opencorvus/test/server/experimental-schedule-routes.test.ts packages/opencorvus/test/scheduler/cron-service.test.ts packages/opencorvus/test/scheduler/event-service.test.ts` passed: 24 tests, 107 expectations.
- `bun test --timeout=2147483647 packages/opencorvus/test/agent/context-packet.test.ts packages/opencorvus/test/visual-qa/output-tools.test.ts packages/opencorvus/test/visual-qa/context.test.ts packages/opencorvus/test/integrity/finding-manifest.test.ts packages/opencorvus/test/integrity/replay-context.test.ts` passed: 75 tests, 343 expectations.

### Fifth Review Round

- Boole returned CLEAR for the already-repaired project route/session lineage surface.
- Meitner returned CLEAR for the already-repaired structured context and Visual QA strict-schema surface.
- Popper returned BLOCKED:
  - Persisted integrity attempt payloads were still treated as loosely shaped JSON in replay/root-history readers.
  - Finding and repair fingerprints could be caller-shaped or missing rather than host-computed and persisted as part of a strict attempt payload contract.

Fifth-round repairs:

- Added a strict integrity attempt payload parser/creator.
- `recordIntegrityAttempt` now writes host-computed finding and repair fingerprints.
- Integrity store reads parse persisted attempt payloads before replay/root-history consumption.
- Replay/root-history tests now reject malformed persisted payloads and assert host-computed fingerprints.
- Stale integrity fixtures were updated to the strict persisted payload shape.

Fifth-round validation:

- `bun test --timeout=2147483647 packages/opencorvus/test/agent/context-packet.test.ts packages/opencorvus/test/visual-qa/output-tools.test.ts packages/opencorvus/test/visual-qa/context.test.ts packages/opencorvus/test/integrity/finding-manifest.test.ts packages/opencorvus/test/integrity/replay-context.test.ts packages/opencorvus/test/integrity/build-feedback.test.ts packages/opencorvus/test/build-agent/visual-reference-prompt.test.ts` passed: 99 tests, 439 expectations.
- `bun test --timeout=2147483647 packages/opencorvus/test/integrity/team-schema.test.ts packages/opencorvus/test/integrity/team-agent.test.ts` passed: 25 tests.
- `bun test --timeout=2147483647 packages/opencorvus/test/integrity/severity-stability.test.ts packages/opencorvus/test/integrity/severity-active-path.test.ts packages/opencorvus/test/integrity/consensus-severity-fold.test.ts packages/opencorvus/test/integrity/finding-traceability.test.ts packages/opencorvus/test/orchestrator/integrity-history-readcontext.test.ts` passed: 10 tests.
- `bun run typecheck` passed: 9 successful tasks.

### Sixth Review Round

- Descartes (`019f2d30-4d3a-7f73-8bbb-227d4fc31e2e`) returned BLOCKED:
  - `assertRightSidebarCodingSession` used shallow `Session.get(sessionID)`.
  - `/coding/sessions` queried direct session rows by `project_id`, `directory`, and metadata, but did not validate the whole parent lineage.
  - A current-project right-sidebar child session imported with a foreign-project parent could be listed or claimed, then canonical `/session/:id/prompt_async`, abort, selection, and delete flows would act on a broken lineage.
- Schrodinger (`019f2d30-81ac-78e0-948b-df8653ec23b9`) returned BLOCKED:
  - The MCP projection sanitizer covered image/audio/blob/base64 cases, but tests did not prove strict rejection for required string type violations, optional string type violations, unknown fields in prompt/resource/annotation/icon payloads, or unknown content types.
  - Follow-up testing proved unknown fields were being stripped by the SDK `GetPromptResultSchema` / `ReadResourceResultSchema` before reaching the project sanitizer.
- Curie (`019f2d30-b148-7ae3-aa18-5e58b026c7a7`) returned CLEAR:
  - Strict attempt payloads, structured context packets, Visual QA nested schemas, and expert-squad single-source selection were consistent with the repaired contract.

Sixth-round repairs:

- Coding Assistant right-sidebar session routes now use `Session.assertLineageInProject({ sessionID, projectID: Instance.project.id })`.
- `listRightSidebarCodingAssistantSessions` now validates each candidate session's full lineage before returning it and scans forward so invalid polluted rows do not hide later valid rows.
- Coding route tests now import a current-project right-sidebar child with a foreign-project parent and assert list/get/patch/abort/selection/delete all reject it.
- Prompt-async route tests now settle real queue work before database reset, and the queued abort fixture inserts a deterministic queued row instead of racing the background drain.
- MCP now exposes projection-only prompt/resource payload readers that use shallow passthrough schemas and preserve raw fields.
- Expert-squad projected MCP context rendering uses those projection payload readers, then the project sanitizer performs the strict final whitelist check.
- The package MCP fixture and prompt-profile resolver tests now cover required string violations, optional string violations, unknown prompt/resource/annotation/icon fields, and unknown content type rejection.

Sixth-round validation:

- `bun test --timeout=2147483647 packages/opencorvus/test/server/coding-routes.test.ts` passed: 15 tests.
- `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts` passed: 53 tests.
- `bun test --timeout=2147483647 packages/opencorvus/test/mcp/prompt-resource-fail-fast.test.ts` passed when run alone: 1 isolated wrapper test, 2 expectations.
- `bun run typecheck` passed: 9 successful tasks.

Current status:

- Sixth-round BLOCKED findings are repaired and locally validated.
- A seventh independent direct-subagent review round is required before declaring the goal clear.

### Seventh Review Round

- Ampere (`019f2d56-3b5d-7112-96e1-3750ae0093fc`) returned CLEAR for projected MCP context:
  - Projection-only payload readers preserve raw fields.
  - Resolver rendering uses projection payload readers instead of SDK-stripped `get/read`.
  - Sanitizer rejects `_meta`, image/audio/blob, unknown content types, required/optional type violations, unknown prompt/resource/annotation/icon fields, and inline base64.
  - Safe resource-link metadata, annotations, and icons remain allowed.
- Mill (`019f2d55-fd1b-7631-a189-79ea5ce4f1e2`) returned CLEAR for Coding Assistant lineage:
  - right-sidebar get/patch/delete/abort/selection all pass through full `Session.assertLineageInProject`.
  - `/coding/sessions` filters and paginates candidates after full lineage validation.
  - Regression tests cover current-project child sessions with foreign parents and normal prompt/abort/delete flows.
- Linnaeus (`019f2d56-b2b4-7631-9600-134d92fd898a`) returned BLOCKED:
  - Scheduler create routes/services validate full lineage, but persisted work consumption still relies on direct `session.project_id`.
  - `TaskQueueService.pending()` and `claim()` select rows by direct project only.
  - `TaskQueueService.executeSessionWake()` and recovery use shallow `Session.get`.
  - `CronService` and `EventService` execution pass persisted `job.session_id` directly to `SessionWake.wake`.
  - `SessionWake.wake` then uses shallow `Session.get` and calls `EffectiveConfig.effective({ sessionID })`, which can follow a foreign parent chain.

Seventh-round required repair:

- Add full lineage validation before consuming persisted scheduler/queue rows.
- Add regression tests that insert current-project child sessions with foreign parents directly into persisted cron/event/task queue rows, then run real consumption paths and assert they fail visibly without waking, prompting, or reading foreign effective config.

Seventh-round repairs:

- `SessionWake.wake` now validates an existing `sessionID` through `Session.assertLineageInProject({ sessionID, projectID: Instance.project.id })` before resolving effective config or entering `SessionPrompt.loop`.
- `TaskQueueService` validates full session lineage before executing queued prompt, queued wake, queued compaction, and stale running-task recovery.
- Invalid persisted queue rows now fail visibly before prompting, waking, compaction, or cancellation of a foreign lineage.
- `CronService` persisted job execution now relies on the repaired `SessionWake.wake` boundary; failed lineage is recorded on the cron row through `failure_count` and `last_error`.
- `EventService` persisted job execution now records failed lineage on the event row through `failure_count` and `last_error` instead of silently dropping the error.
- `TaskQueueService` in-flight wake cancellation tests were updated to block the current lineage assertion boundary rather than the old shallow `Session.get` boundary.

Seventh-round validation:

- `bun test --timeout=2147483647 packages/opencorvus/test/scheduler/task-queue-service.test.ts --test-name-pattern "foreign parent lineage"` passed: 2 tests, 6 expectations.
- `bun test --timeout=2147483647 packages/opencorvus/test/scheduler/cron-service.test.ts --test-name-pattern "parent lineage leaves"` passed: 1 test, 5 expectations.
- `bun test --timeout=2147483647 packages/opencorvus/test/scheduler/event-service.test.ts --test-name-pattern "parent lineage leaves"` passed: 1 test, 5 expectations.
- `bun test --timeout=2147483647 packages/opencorvus/test/scheduler/task-queue-service.test.ts --test-name-pattern "cancelSessionPrompts stops claimed in-flight wake before it starts a loop"` passed: 1 test, 5 expectations.
- `bun test --timeout=2147483647 packages/opencorvus/test/scheduler/task-queue-service.test.ts packages/opencorvus/test/scheduler/cron-service.test.ts packages/opencorvus/test/scheduler/event-service.test.ts packages/opencorvus/test/server/experimental-schedule-routes.test.ts` passed: 59 tests, 221 expectations.
- `bun run typecheck` passed: 9 successful tasks.

Current status:

- Seventh-round BLOCKED findings are repaired and locally validated.
- A new independent direct-subagent review round is required before moving to scheduler prompt compression.

## Scheduler Prompt Compression Plan

User question: after expert squads were externalized, can the scheduler prompt be compressed substantially?

Short answer: yes, but only by removing domain/expert-squad policy from the global Orchestrator core prompt. The core prompt must still keep task lifecycle authority, artifact-backed decision rules, workflow-projection discipline, tool ownership, and the visible `skill` / `select_expert_squad` expert-squad selection protocol.

Additional sources read for this subtask:

- `packages/opencorvus/src/prompt/core/orchestrator-core.txt`
- `packages/opencorvus/src/agent/prompt/general.txt`
- `.opencorvus/expert-squads/frontend-replica/expert-squad.jsonc`
- `.opencorvus/expert-squads/frontend-replica/selector.md`
- `.opencorvus/expert-squads/frontend-replica/agents/orchestrator/system.md`
- `packages/opencorvus/test/agent/core-prompt-hygiene.test.ts`
- `packages/opencorvus/test/agent/final-system-prompt-audit.test.ts`

Additional repository search evidence:

- `rg -n "scheduler|调度|expert-squad|expert squad|select_expert_squad|prompt_profile|frontend-replica|frontend-innovate|skill tool|built-in|builtin|orchestrator" packages/opencorvus/src/prompt packages/opencorvus/src/agent packages/opencorvus/src/orchestrator packages/opencorvus/test/agent packages/opencorvus/test/prompt -g "*.txt" -g "*.ts" -g "*.md"`
- `rg --files | rg "expert-squad.*(frontend-replica|frontend-innovate)|frontend-replica.*expert-squad|expert-squad\.jsonc$"`
- `rg -n "desktop source information architecture|Page Skeleton Blueprint|reference-region proof|visual_feedback_verification|mobile text|raw source-row goals|frontend-replica-expert-squad" .opencorvus packages/opencorvus/src packages/opencorvus/test specs -g "*.jsonc" -g "*.md" -g "*.ts"`

Findings:

- The old source path the IDE still shows, `packages/opencorvus/src/expert-squad/builtin/frontend-replica/expert-squad.jsonc`, no longer exists in the current worktree.
- The actual externalized source is `.opencorvus/expert-squads/frontend-replica/**`, including Orchestrator role overlay and selector text.
- The external frontend-replica Orchestrator overlay already owns desktop-only scope, source-region goal granularity, reference-region proof, rendered-feedback ledger, and second-non-pass failure discipline.
- `orchestrator-core.txt` still duplicates frontend/webpage/visual-replica details in general sections and tool-selection bullets. Those details should be compacted to "use the currently visible scheduler-projected evidence tools and persisted artifacts"; concrete replica policy belongs to the expert squad and tool-specific prompts/descriptions.

Compression boundaries:

- Remove or shorten global Orchestrator-core paragraphs that spell out frontend-research/frontend-design/Page Skeleton/visual-qa implementation details.
- Preserve the generic rule that source-evidence tools are bounded evidence producers, not fixed gates or repeated repair loops.
- Preserve the rule that visual/system-completeness review evidence is report-only and lifecycle remains an Orchestrator decision.
- Preserve `skill` / `select_expert_squad` as the visible expert-squad selection mechanism and `prompt_profile.active` as the active profile source of truth.

Prompt validation plan:

- Update prompt hygiene tests so they enforce the new compressed boundary instead of pinning long frontend-replica details inside `orchestrator-core.txt`.
- Run focused prompt tests: `bun test --timeout=2147483647 packages/opencorvus/test/agent/core-prompt-hygiene.test.ts packages/opencorvus/test/agent/final-system-prompt-audit.test.ts packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts`.

Prompt compression repairs:

- `packages/opencorvus/src/prompt/core/orchestrator-core.txt` now removes long frontend/page-skeleton/frontend-research/frontend-design/visual-qa details from the global scheduler core.
- The core prompt keeps generic lifecycle, visible evidence producer, source-evidence, review-as-report-only, and expert-squad selection boundaries.
- Prompt hygiene tests now assert the core is profile-neutral after expert-squad externalization and that frontend-replica desktop/mobile details live in the external expert-squad overlay instead of the global core.

Prompt compression validation:

- `bun test --timeout=2147483647 packages/opencorvus/test/agent/core-prompt-hygiene.test.ts packages/opencorvus/test/orchestrator/orchestrator-core-prompt.test.ts packages/opencorvus/test/agent/final-system-prompt-audit.test.ts packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts` passed: 73 tests, 1107 expectations.

### Eighth Review Round

- Russell (`019f2d68-5211-7ea0-9159-c376efa510ff`) returned CLEAR for prompt compression:
  - The global scheduler prompt can be compressed by removing domain/expert/tool details now owned by external expert squads.
  - Lifecycle authority, visible `skill` / `select_expert_squad`, terminal lifecycle, tool boundaries, and A2A cancellation/operator boundaries must remain in the core prompt.
  - Tool descriptions remain the right source for per-tool semantics.
- Nash (`019f2d67-fe57-7f53-a766-2db18d91dbfc`) returned BLOCKED for cron persisted consumption:
  - `CronService.consumePendingSessionWaits` deleted session-wait rows on message activity using only `project_id + session_id`.
  - `createTaskWake`, `consumePendingTaskWaits`, and due task cron execution validated only task project ownership, then consumed or dispatched based on a task whose `session_id` lineage could leave the current project.
- Aquinas (`019f2d68-2251-7d82-9baf-a92ad0f3b48c`) returned BLOCKED for taskID session lineage:
  - `POST /task/:taskID/message`, `GET /task/:taskID/operator-model-context`, `POST /task/:taskID/followup`, and `select_expert_squad` validated the task row's project but used `task.session_id` for effective config, prompt profile resolution, message writes, and overlay writes without validating full session lineage.
  - MCP projection prompt/resource payload schemas still defaulted missing `messages` / `contents` to empty arrays, masking malformed protocol payloads.

Eighth-round repairs:

- `CronService.createTaskWake`, `consumePendingTaskWaits`, session wait activity consumption, and due task cron execution now validate the task/session full lineage with `Session.assertLineageInProject` before writing, deleting, dispatching, or waking.
- `CronService.createTaskWake` and `consumePendingTaskWaits` are asynchronous; `wait` tool and engine queue accepted-wake consumption now await them.
- Invalid cron activity consumption preserves pending rows; invalid due task cron rows fail visibly through cron `failure_count` and `last_error`.
- `EngineService` now validates task root session lineage before task-root message context, prompt-profile overlay writes, operator model context resolution, followup generation, and task-root instance provisioning.
- `select_expert_squad` validates the task root session lineage before reading effective config, writing `prompt_profile.active`, recording selection evidence, or scheduling a continuation wake.
- MCP projection prompt/resource payload schemas now require explicit `messages` and `contents` arrays; explicit empty arrays are still accepted, but missing fields reject.

Eighth-round validation:

- `bun test --timeout=2147483647 packages/opencorvus/test/scheduler/cron-service.test.ts` passed: 22 tests, 71 expectations.
- `bun test --timeout=2147483647 packages/opencorvus/test/engine/describe-task-cron-wait.test.ts packages/opencorvus/test/engine/queue.test.ts --test-name-pattern "cron wait|pending task wait cron"` passed: 2 tests, 10 expectations.
- `bun test --timeout=2147483647 packages/opencorvus/test/server/task-message-routes.test.ts` passed: 26 tests, 212 expectations.
- `bun test --timeout=2147483647 packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "select_expert_squad"` passed: 2 tests, 44 expectations.
- `bun test --timeout=2147483647 ./packages/opencorvus/test/mcp/prompt-resource-fail-fast.isolated.ts` passed: 20 tests, 82 expectations.
- `bun run typecheck` passed: 9 successful tasks.

Current status:

- Eighth-round BLOCKED findings are repaired and locally validated.
- A ninth independent direct-subagent review round is required before declaring this goal clear.

### Ninth Review Round

- Mendel (`019f2d82-f005-75b2-956b-c7f196a194bd`) returned CLEAR for prompt compression and MCP projection strictness:
  - The compressed scheduler core no longer carries frontend-replica domain policy that belongs in external expert-squad overlays.
  - Projected MCP prompt/resource payloads require explicit `messages` / `contents` arrays and still reject unsafe binary/base64 payloads.
- Dalton (`019f2d82-c11a-7922-b2b5-a2790df638f6`) returned BLOCKED for engine queue launch lineage:
  - `startQueuedTaskInCwd`, `advanceQueue`, and queued operator wake drain paths could claim or drain task work before proving the task root session lineage.
  - `advanceQueue` claimed the next task before validation, so a polluted queued task could be flipped to active even if later launch validation failed.
- Pascal (`019f2d82-d8ef-7a22-be4b-1293cc67083d`) returned BLOCKED for orchestrator config/profile lineage:
  - `Orchestrator.processTask` resolved model/config/profile from `task.session_id` before full root lineage validation.
  - `buildSystemParts` and `orchestratorSessionForTask` also depended on the root session before a local guard.
  - `frontend_design`, `explore`, `refine`, and `propose_task` still had taskID/agentSessionID config/model resolver paths that could read through a polluted parent chain.

Ninth-round repairs:

- Engine queue launch paths now validate task root session lineage before starting active re-entry loops, draining queued operator wakes, explicit `start-now`, and queued task advancement.
- `advanceQueue` now reads the next queued candidate in the same priority/FIFO order, validates that candidate's root lineage, then claims that exact candidate; it no longer validates only after a generic claim.
- Batch queued-operator-wake drain records per-task lineage failures, preserves invalid wake rows, continues checking other rows, and throws a summary error instead of silently consuming invalid work.
- `Orchestrator.processTask` validates task root session lineage before any model, effective config, prompt profile, tool projection, or prompt construction.
- `orchestratorSessionForTask` and `buildSystemParts` now carry final root-lineage guards so future direct calls cannot bypass the main `processTask` boundary.
- `createOrchestratorTools` now has shared current-task/root-session and agent-session lineage helpers. `select_expert_squad`, `frontend_design`, `explore`, `refine`, `propose_task`, and build retry replay pressure use those helpers before reading config/model/profile or creating follow-up work.
- `CronService.consumePendingTaskWaits` first proves an eligible pending task-wait row exists. With no pending wait, ordinary wakes return an empty consumption result; with a pending wait, full task root lineage is still validated before deleting the row.

Ninth-round validation:

- `bun test --timeout=2147483647 packages/opencorvus/test/engine/queue.test.ts` passed: 34 tests, 168 expectations.
- `bun test --timeout=2147483647 packages/opencorvus/test/engine/queued-wake-ownership-drain.test.ts` passed: 7 tests, 52 expectations.
- `bun test --timeout=2147483647 packages/opencorvus/test/orchestrator/session-reuse.test.ts` passed: 2 tests, 9 expectations.
- `bun test --timeout=2147483647 packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "select_expert_squad|config-reading orchestrator tools"` passed: 3 tests, 50 expectations.
- `bun test --timeout=2147483647 packages/opencorvus/test/scheduler/cron-service.test.ts --test-name-pattern "consumePendingTaskWaits|early task wait|invalid root session lineage"` passed: 4 tests, 12 expectations.
- `bun run typecheck` passed: 9 successful tasks.

Current status:

- Ninth-round BLOCKED findings are repaired and locally validated.
- A tenth independent direct-subagent review round is required before declaring this goal clear.

### Tenth Review Round

- Hubble (`019f2d9e-39a2-73c0-a059-5812ee525a17`) returned BLOCKED for projected MCP payload strings:
  - The projected MCP resolver rejected explicit `data:*;base64` payloads, but did not reject raw base64 binary payloads returned as plain text or resource-link metadata.
  - A server route test was needed to prove `/config/prompt` fails before returning a catalog when a session-effective worker projection contains raw binary payload text.
- Confucius (`019f2d9d-e83c-7143-ac3c-e8bd8a9c2a9e`) returned BLOCKED for A2A `respond_agent_coordination` lineage:
  - Continue/redispatch validation still read the request worker `session_id` through shallow `Session.get`.
  - The current tool execution/orchestrator session was not re-proved against the task project before persisted message/tool artifacts were read.
- Heisenberg (`019f2d9d-a677-71d1-a773-fde8d1285dff`) returned BLOCKED for task API pre-mutation lineage:
  - `wakeTaskForOperatorIntent`, `recordOperatorNote`, and `handleTaskMessage` could mutate metadata, plans, progress snapshots, attachments, or prompt-profile overlays before proving the task root session's full project lineage.

Tenth-round repairs:

- Projected MCP string validation now rejects inline `data:*;base64` and raw base64 tokens that decode to known binary payloads or high-control-byte binary data.
- MCP regression fixtures now cover raw binary base64 in prompt text, embedded resource text, resource-link metadata, and resource reads.
- `/config/prompt` now has a route regression proving session-effective build worker MCP projections reject raw base64 before catalog response materialization.
- `respond_agent_coordination` now proves the task root lineage, current orchestrator tool-execution session lineage, and request worker session lineage before model/config/runtime contract checks or response/action artifact writes.
- A2A redispatch validation now shares the same task/session lineage helper across build, intent-analysis, explore, goal-workload, fact-check, frontend-research, frontend-design, deep-research, requirements, architect, visual-qa, and integrity branches.
- A2A fixture helpers now bind workflow tasks to the real worktree project namespace instead of arbitrary label project IDs; the two hand-written architect redispatch fixtures now use the canonical directory project ID.
- Frontend-design redispatch result summarization now parses the schema JSON `frontend_project` decision entry with `parseFrontendProjectDecisionEntry` instead of the retired rendered-text `status:` regex.
- Task API retry, replan, operator note, and task message paths now validate task root session lineage before metadata deletion, plan supersession, progress snapshot writes, attachment writes, task message append, effective config reads, or prompt-profile overlay writes.

Tenth-round validation:

- `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --test-name-pattern "raw base64|inline base64"` passed: 9 tests.
- `bun test --timeout=2147483647 packages/opencorvus/test/server/config-routes.test.ts --test-name-pattern "raw base64"` passed: 1 test.
- `bun test --timeout=2147483647 packages/opencorvus/test/server/task-message-routes.test.ts --test-name-pattern "root session parent lineage"` passed: 1 test.
- `bun test --timeout=2147483647 packages/opencorvus/test/engine/task-message-revive.test.ts --test-name-pattern "polluted task root lineage|retry clears a stale|replan supersedes|operator notes"` passed: 9 tests, 56 expectations.
- `bun test --timeout=2147483647 packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "architect stage dispatcher|pending architect action|frontend-design stage dispatcher"` passed: 3 tests, 34 expectations.
- `bun test --timeout=2147483647 packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "respond_agent_coordination"` passed: 42 tests, 381 expectations.
- `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts packages/opencorvus/test/server/config-routes.test.ts packages/opencorvus/test/server/task-message-routes.test.ts packages/opencorvus/test/engine/task-message-revive.test.ts` passed: 112 tests, 701 expectations.
- `bun test --timeout=2147483647 packages/opencorvus/test/orchestrator/tools.test.ts` passed: 135 tests, 1075 expectations.
- `bun test --timeout=2147483647 packages/opencorvus/test/agent/core-prompt-hygiene.test.ts packages/opencorvus/test/orchestrator/orchestrator-core-prompt.test.ts packages/opencorvus/test/agent/final-system-prompt-audit.test.ts packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts` passed: 73 tests, 1107 expectations.
- `bun run typecheck` passed: 9 successful tasks.
- `bun run api:routes-check` passed: route inventory clean across 29 files.
- `bun test --timeout=2147483647 packages/opencorvus/test/script/historical-docs-links.test.ts` passed: 19 tests, 66 expectations.
- `bun run docs:check` passed: 246 ops, 24 groups.
- `git diff --check` passed with line-ending warnings only.

Current status:

- Tenth-round BLOCKED findings are repaired and locally validated.
- An eleventh independent direct-subagent review round is required before declaring this goal clear.

### Eleventh Review Round

- Herschel (`019f2de4-a7ac-7021-a0be-7789e7461529`) returned CLEAR for MCP projection and external expert-squad context:
  - Projection-only MCP prompt/resource readers preserve raw fields and require explicit `messages` / `contents`.
  - The prompt-profile sanitizer rejects `_meta`, unknown fields, non-string projected text, image/audio/blob content, inline base64 data URLs, and raw binary base64.
  - `/config/prompt` and `/config/prompt-profile` validate active-project session lineage before reading session-effective config.
  - Active expert squad selection remains single-source through `prompt_profile.active`; `select_expert_squad` writes only the root session overlay and records visible selection evidence.
- Rawls (`019f2de4-d9d4-7f13-88b9-9b880779b2cf`) returned CLEAR for scheduler prompt compression, Coding Assistant, and workflow support:
  - Coding Assistant remains a hidden full-function primary agent with its own `coding.txt` prompt and right-sidebar overlay.
  - Workflow support comes from `WorkflowRegistry` and dynamic projection; the compressed Orchestrator core keeps lifecycle, tool ownership, terminal/abort/operator boundaries, review-as-report-only, and visible `skill` / `select_expert_squad`.
  - External expert-squad packages are loaded from `.opencorvus/expert-squads/**`; unknown profiles throw instead of falling back.
- Cicero (`019f2de4-d1d9-7941-a264-4ca1ef47c12e`) returned BLOCKED for remaining lineage-before-consumption gaps:
  - `task-api` direct reply and operator-steer paths still read worker messages/runtime contracts or write A2A requests after only shallow session/project checks.
  - `TaskQueueService.claim()` marks queued rows running before proving full session parent lineage.
  - `CronService.claim()` leases due jobs before proving the persisted task/session lineage.
  - `respond_agent_coordination` replay, `cancel_worker`, `ask_user`, and `fail_task` paths can create or read response/action artifacts before proving the request worker session lineage.

Eleventh-round repair plan:

- Move direct reply and operator-steer worker lineage validation before any worker message, runtime contract, attachment, model, or A2A artifact reads/writes.
- Move queue and cron persisted-work lineage validation before claim/lease mutation; regression tests must prove invalid rows are not claimed.
- Validate the request worker lineage immediately after loading an A2A request and before any response/action replay or creation for every decision.
- Add regression tests for the specific pre-mutation/pre-consumption boundaries, then rerun affected suites, typecheck, route/docs checks, and another direct-subagent review round.

Eleventh-round repairs:

- Direct agent reply now validates the task root session lineage and target worker session lineage before reading worker messages, attachments, runtime contract, model config, or persisting a reply.
- Operator-steer now validates the task root session lineage and target worker session lineage before reading runtime contract, pending coordination, session status, or creating an A2A request.
- `TaskQueueService` now validates queued session lineage before marking a row `running`; invalid queued rows are failed visibly while `time_started` remains null.
- `CronService` now validates due session/task lineage before acquiring a lease; invalid due rows record failure while `lease_owner` remains null.
- `respond_agent_coordination` now validates the request worker session lineage immediately after loading the request and before every response/action replay or creation path, including `cancel_worker`, `ask_user`, and `fail_task`.

Eleventh-round validation:

- `bun test --timeout=2147483647 packages/opencorvus/test/server/reply-error-taxonomy.test.ts --test-name-pattern "polluted task-root lineage"` passed: 1 test.
- `bun test --timeout=2147483647 packages/opencorvus/test/server/task-session-operator-steer.test.ts --test-name-pattern "polluted task-root lineage"` passed: 1 test.
- `bun test --timeout=2147483647 packages/opencorvus/test/scheduler/task-queue-service.test.ts --test-name-pattern "foreign parent lineage"` passed: 2 tests.
- `bun test --timeout=2147483647 packages/opencorvus/test/scheduler/cron-service.test.ts --test-name-pattern "parent lineage|invalid root session lineage"` passed: 4 tests.
- `bun test --timeout=2147483647 packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "polluted worker lineage"` passed: 2 tests.
- `bun test --timeout=2147483647 packages/opencorvus/test/server/reply-error-taxonomy.test.ts packages/opencorvus/test/server/task-session-operator-steer.test.ts` passed: 27 tests, 224 expectations.
- `bun test --timeout=2147483647 packages/opencorvus/test/scheduler/task-queue-service.test.ts packages/opencorvus/test/scheduler/cron-service.test.ts` passed: 56 tests, 179 expectations.
- `bun test --timeout=2147483647 packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "respond_agent_coordination"` passed: 44 tests, 393 expectations.
- `bun run typecheck` passed: 9 successful tasks.
- `bun test --timeout=2147483647 packages/opencorvus/test/script/historical-docs-links.test.ts` passed: 19 tests, 66 expectations.
- `bun run docs:check` passed: 246 ops, 24 groups.

Current status:

- Eleventh-round BLOCKED findings are repaired and locally validated.
- A twelfth independent direct-subagent review round is required before declaring this goal clear.

### Twelfth Review Round

- Kepler (`019f2e00-7915-7642-821c-f14c907d3a41`) returned CLEAR for task-api direct reply / operator-steer:
  - `resolveDirectReplyTarget()` now proves task root lineage and target worker lineage before reading worker messages.
  - Direct reply pending A2A checks, runtime contract validation, attachment read/write, model resolution, and `Session.persistMessage()` occur only after the lineage boundary.
  - `resolveOperatorSteerTarget()` now proves task root lineage and target worker lineage before runtime contract, pending coordination, status, ownership, and A2A request creation.
  - Tests cover polluted task-root lineage and prove direct reply does not call `Session.messages()`, while operator-steer writes no pending request/action/queued wake.
- Lovelace (`019f2e00-a875-7970-b211-793a581a9868`) returned CLEAR for scheduler persisted work consumption:
  - `TaskQueueService.run()` proves session lineage before `claim()`; invalid queued rows become failed while `time_started` remains null.
  - `CronService.run()` proves session/task lineage before lease claim; invalid due rows record failure while `lease_owner` remains null.
  - Pending task/session wait consumption still proves lineage before delete/dispatch, and `SessionWake.wake()` keeps its own pre-write lineage boundary.
  - Existing tests still cover queue concurrency, in-flight cancellation, cron retry, cron parallelism, and cron backoff.
- Ohm (`019f2e00-c17f-7ce0-9e95-13059ead5fb7`) returned CLEAR for A2A, MCP projection, prompt compression, Coding Assistant, and workflow:
  - `respond_agent_coordination` proves request worker lineage immediately after loading the request and before every response/action replay or creation path.
  - MCP projection still requires explicit `messages` / `contents`, preserves raw fields for sanitizer review, and rejects unsafe fields/content/base64.
  - The compressed Orchestrator core keeps visible `skill` / `select_expert_squad` and `prompt_profile.active` protocol while leaving frontend-replica details to external expert-squad packages.
  - Coding Assistant remains an independent `coding-assistant` agent with right-sidebar overlay, and workflow remains registry/projected rather than prompt-hardcoded.

Current status:

- Twelfth-round independent direct-subagent review found no new BLOCKED issues.
- Communication protocol lineage fixes, MCP projection strictness, external expert-squad selection, scheduler prompt compression, Coding Assistant behavior, and workflow projection are locally validated by tests and direct-subagent review.
