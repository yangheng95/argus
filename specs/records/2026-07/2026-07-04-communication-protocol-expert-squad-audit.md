# 2026-07-04 Communication Protocol And Expert Squad Audit

Supersession note: Package-layout statements in this record that use `.opencorvus/expert-squads/<id>` are superseded by `2026-07-06-expert-squad-namespaced-source-layout.md`; current project and repository package roots are `.opencorvus/expert-squads/<namespace>/<id>/`.

## Recall

User request: find several independent agents to review whether recent communication-protocol changes and expert-squad changes broke normal functionality. After each review round, write a report, then continue reviewing until no new issues are found.

Later constraint: use direct subagents, not Codex/Claude CLI. This report uses direct `multi_agent_v1` subagents for independent review. The earlier failed forked-agent attempts and one mistaken local runner invocation are recorded as tool observations, not audit evidence.

Acceptance criteria:

- Use multiple independent direct subagents in parallel.
- Review communication protocol, context packets, Visual QA dispatch, task/mission message paths, expert-squad loading/projection, overlay/SDK/API contract, and test/document coverage.
- Write a report for each round before continuing.
- Separate confirmed breakage from unproven risk and test coverage gaps.
- Continue to another round when new issues are found.

Hard constraints retained:

- No fallback or compatibility logic should be introduced.
- Do not use git reset/revert or create worktrees.
- Do not restart or kill OpenCorvus/overlay processes.
- Do not call Codex/Claude CLI for this goal.
- Specs and reports live under `specs/records/2026-07/`; update the monthly README.
- Tests must use real no-activity timeout semantics when they need a timeout.
- Subagents are read-only reviewers for this audit round and must not spawn further agents.

Landed context read before review:

- `AGENTS.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md`
- `specs/current/architecture/README.md`
- `specs/current/architecture/11-agent-oop-protocol.md`
- `specs/current/architecture/13-agent-communication-matrix.md`
- `specs/current/architecture/15-agent-facts-and-turns.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`

Repository search and verification evidence:

- `rg -n "PromptProfile\.(assertKnownProfileID|overlayFor|composeAgentPrompt|list|catalog|validateConfig|builtIns|activeID)" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test -g "*.ts" -g "*.tsx"`
- `rg -n "function projectionHash|const projectionHash|projectionHash\(|projectSchedulerMcpPrompts|projectWorkerMcpPrompts|projectSchedulerMcpResources|projectWorkerMcpResources" packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad -g "*.ts"`
- `rg -n "parseVisualQaDispatchContext|referenceParityRequired|requiredReferenceRegions|validateAgentContextPacket|media_ref|scope" packages/opencorvus/src/visual-qa packages/opencorvus/src/agent packages/opencorvus/test/visual-qa packages/opencorvus/test/agent -g "*.ts"`
- `rg -n "sessionID|config/prompt|config/prompt-profile|skill/mounts|effectiveConfig|mounts" packages/opencorvus/src/server/routes packages/opencorvus/src/config packages/opencorvus/src/skill packages/opencorvus/test/server -g "*.ts"`
- `rg -n "promptProfile|taskAgentOutcomes|PostTask.*Message|/task/.*/message|TaskAgentOutcome" packages/web/src/content/docs/reference packages/sdk/js/src/gen packages/overlay/src/services packages/opencorvus/src/server packages/opencorvus/src/task-api packages/opencorvus/test/server -g "*.ts" -g "*.tsx" -g "*.mdx"`
- `rg -n "copyRepositoryExpertSquadPackage|writeProjectExpertSquadPackage|PROJECT_EXPERT_SQUAD_ID|frontend-replica|frontend-automation-debug" packages/opencorvus/test packages/opencorvus/src packages/overlay/test packages/overlay/src -g "*.ts" -g "*.tsx"`
- `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/registry.test.ts packages/opencorvus/test/expert-squad/package-manager.test.ts packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts packages/opencorvus/test/server/config-routes.test.ts` passed: 104 tests.
- `bun test --timeout=2147483647 packages/opencorvus/test/agent/context-packet.test.ts packages/opencorvus/test/session/inline-base64-rejected.test.ts packages/opencorvus/test/build-agent/prompt-context.test.ts packages/opencorvus/test/integrity/replay-context.test.ts packages/opencorvus/test/visual-qa/context.test.ts packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts` passed: 97 tests.
- `bun test --timeout=2147483647 packages/overlay/test/prompt-profile-task-session-owner.test.ts packages/overlay/test/prompt-profile-config.test.ts packages/overlay/test/executor-settings.test.ts packages/overlay/test/mission-session-source.test.ts packages/opencorvus/test/server/task-message-routes.test.ts packages/opencorvus/test/session/extra-tools.test.ts` passed: 111 tests.
- `bun test --timeout=2147483647 packages/opencorvus/test/visual-qa/context.test.ts packages/opencorvus/test/visual-qa/output-tools.test.ts packages/opencorvus/test/mcp/prompt-resource-fail-fast.test.ts` failed only because `prompt-resource-fail-fast.test.ts` expects `"10 pass"` while the isolated MCP suite now reports `18 pass`; Visual QA context/output-tool tests in the same run passed.

Subagent round:

- Copernicus (`019f2c62-3638-7e90-9ffa-7153939650c3`): communication protocol, Visual QA dispatch, context packet validation.
- Hooke (`019f2c62-4ad3-7bb0-ba32-bf13283212a1`): expert-squad package loading/projection.
- Anscombe (`019f2c62-5840-79c2-8491-b4489441ed3b`): overlay, SDK, API contract.
- Pasteur (`019f2c62-5d37-7662-bc32-fc7cc4b06e16`): tests/docs/coverage gaps.

Earlier failed forked agents hit auth/shutdown issues and produced no audit findings. They are excluded from conclusions.

## Round 1 Findings

### P1 Confirmed: sessionID-scoped config and skill surfaces can cross the active project boundary

`packages/opencorvus/src/server/routes/config.ts:208` and `:256` accept a query `sessionID` and call `EffectiveConfig.effective({ sessionID })`, `EffectiveConfig.base({ sessionID })`, and `EffectiveConfig.directory({ sessionID })`.

`packages/opencorvus/src/config/effective.ts:62` resolves the root session with `Session.get(sessionID)`, not `Session.getInProject({ sessionID, projectID: Instance.project.id })`. `packages/opencorvus/src/skill/mounts.ts:176` and mount helpers use the same session-effective config and directory path.

The direct implication is that a request sent against project B can ask `/config/prompt`, `/config/prompt-profile`, or `/skill/mounts` for a session from project A and read project A's effective config/package projection. Round 2 corrected the write-path detail: `/skill/mount`, `/skill/unmount`, and `/skill/import-and-mount` do not write through `Session.mergeConfigOverlay`; they can validate/render using the foreign session-effective config while writing active-project skill files through the active `Instance` skill manager. That creates mixed-project semantics, not a safe project-filtered write.

Existing tests cover same-project positive paths only:

- `packages/opencorvus/test/server/config-routes.test.ts:358`
- `packages/opencorvus/test/server/config-routes.test.ts:428`
- `packages/opencorvus/test/server/skill-routes.test.ts:542`

Needed next check: add or run a cross-project route test that creates project A/session A and project B, then calls project B routes with session A. Expected behavior should be fail-fast, not silently reading A.

### P1 Confirmed Breakage: Projected MCP prompt/resource payloads are rendered directly into agent prompts

`packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts:1579` stringifies MCP projection payloads with `JSON.stringify`. `renderProjectedMcpContext()` reads each projected resource and emits it under `## Projected MCP Context` (`:1604`, `:1622`, `:1629`).

This path bypasses `AgentContextPacket`'s inline binary protections in `packages/opencorvus/src/agent/context-packet.ts:294`. Round 2 confirmed this is not only theoretical: valid MCP prompt/resource outputs can carry resource `blob`, prompt image/audio `data`, or embedded resource `blob`, and the current resolver can stringify those payloads into the system prompt instead of rejecting or materializing them to a durable ref.

Existing coverage proves inline payload rejection for context packets and MCP tool materialization, but not this prompt-profile resolver path:

- `packages/opencorvus/test/agent/context-packet.test.ts`
- `packages/opencorvus/test/mcp/materialize-browser-image.test.ts`
- `packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`

### P1 Product-Contract Risk: migrated domain expert squads are no longer available unless present in the current project

`packages/opencorvus/src/expert-squad/builtin/index.ts:5` now embeds only `general`. The domain squads `algorithm`, `backend`, `frontend-automation-debug`, `frontend-innovate`, and `frontend-replica` live under repository `.opencorvus/expert-squads/<id>`.

The July 3 design record explicitly states this target, so this is not automatically a code bug. It is still a normal-functionality risk: a fresh user project without `.opencorvus/expert-squads/frontend-replica` cannot select `frontend-replica`; tests that need domain profiles copy packages into temp projects through `copyRepositoryExpertSquadPackage()` or `writeProjectExpertSquadPackage()`.

This needs Round 2 adjudication: either document the expected installation/onboarding path as the normal behavior, or treat loss of out-of-box domain profiles as a regression.

### P2 Confirmed: Visual QA dispatch context drops malformed structured fields instead of failing

Copernicus found and local inspection confirmed `packages/opencorvus/src/visual-qa/context.ts:91` parses only fields with exact expected types and silently omits malformed values:

- `referenceParityRequired: "true"` becomes absent.
- `requiredReferenceRegions: [123]` becomes absent.

By contrast, `packages/opencorvus/src/context-packets/visual-handoff.ts:43` rejects unsupported or wrong-shaped structured data. Dropping the malformed Visual QA dispatch fields can weaken reference-parity enforcement in `packages/opencorvus/src/visual-qa/output-tools.ts:333` if an upstream producer emits a wrong-shaped packet.

Current Visual QA context/output tests pass, but they do not include malformed dispatch-packet cases.

### P2 Confirmed: MCP fail-fast wrapper test is stale and currently fails

`packages/opencorvus/test/mcp/prompt-resource-fail-fast.test.ts:41` expects the isolated process output to contain `"10 pass"`. The isolated suite currently reports `18 pass`, causing the wrapper test to fail even though the isolated MCP fail-fast cases pass.

This is a test harness defect. It can hide real MCP failures behind a stale count assertion and violates the project rule that broken debugging/testing tools must be fixed first.

### P2 Confirmed Contract Drift: API docs omit supported promptProfile request fields

Anscombe found the generated SDK and overlay already support `promptProfile` on task creation/wake paths:

- `packages/overlay/src/services/mission.ts:329`
- `packages/overlay/src/services/chat.ts:507`
- `packages/sdk/js/src/gen/sdk.gen.ts:5984`
- `packages/sdk/js/src/gen/sdk.gen.ts:7597`

The public API reference still documents `POST /task/{taskID}/message` body as only `source`, `text` at `packages/web/src/content/docs/reference/api.mdx:128`. This does not prove runtime breakage, but the documentation contract is stale.

### P3 Confirmed Runtime Validation Gap: AgentContextPacket scope enums are TypeScript-only

`packages/opencorvus/src/agent/context-packet.ts:1` declares `AgentContextScope = "task" | "goal" | "goal_run" | "session"` and `media_ref.scope.kind` with the same enum. `validateAgentContextPacket()` at `:204` validates id/title/source and part payload safety, but does not validate `packet.scope` or `media_ref.scope.kind` membership.

An `as any` or external construction path can render arbitrary scope labels into prompts at `:131` and `:359`. No current producer was proven to emit malformed scope values, so this is a validation gap rather than confirmed user-visible breakage.

### P3 Coverage Gap: task message unknown promptProfile lacks side-effect regression tests

`packages/opencorvus/src/task-api/index.ts:2762` checks `PromptProfileResolver.assertKnownProfileID()` before `Session.mergeConfigOverlay()` and before message persistence. That code path appears ordered correctly.

The gap is test coverage: `packages/opencorvus/test/server/task-message-routes.test.ts:740` covers valid `promptProfile`, but not an unknown profile with assertions that no message part, scheduler wake, or config overlay was written.

### P3 Contract Risk: taskAgentOutcomes response optionality mismatch

The overlay hand type expects `taskAgentOutcomes` to be present in `packages/overlay/src/services/mission.ts:208`; generated SDK/OpenAPI has optional shapes such as `packages/sdk/js/src/gen/types.gen.ts:13481`. Current backend snapshot construction writes an array, so no current UI breakage was proven. The contract should be tightened or documented to avoid future bypass regressions.

## Rejected Or Downgraded Subagent Findings

Hooke reported that scoped MCP prompt/resource helpers appeared test-only. Local search showed production usage in `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts:1647`, `:1648`, `:1658`, and `:1659` through `activeMcpPromptContext()`. That specific finding is rejected.

Hooke also reported `projection_hash` omitted MCP prompt/resource refs. Local inspection of `packages/opencorvus/src/expert-squad/catalog-profile.ts:28` shows `projectionHash()` hashes the whole `projection` object, and `catalogProjectionEntry()` includes prompt/resource refs at `:48`-`:51`. The original finding is rejected as stated. A narrower future question remains: whether provider implementation changes or resource payload changes should affect the hash.

Pasteur reported task-message unknown `promptProfile` as a possible break path. Local inspection shows the assertion happens before overlay write and message persistence. This is downgraded to a missing regression test.

## Round 1 Status

Round 1 found new issues, so the audit is not complete. Round 2 must focus on:

- Proving or refuting the cross-project `sessionID` route leakage with a concrete route-level scenario.
- Deciding the product contract for repository domain expert squads versus per-project installation.
- Checking whether projected MCP prompt/resource payloads need the same durable-ref materialization policy as context packets and tool results.
- Checking whether Visual QA dispatch should use strict schema validation like visual handoff packets.
- Checking whether API docs/OpenAPI optionality drift indicates broader SDK contract damage.

## Round 2 Findings

Direct subagents:

- Dirac (`019f2c70-f69f-7f82-82de-27d7bca17fda`): cross-project `sessionID` route boundary.
- Bernoulli (`019f2c71-9439-7d40-a0f1-4a00887d0c04`): MCP projection, context packet, Visual QA dispatch protocol.
- Fermat (`019f2c71-c5dd-78e2-9518-5ea84d625d4d`): domain expert-squad migration and onboarding contract.
- Goodall (`019f2c71-f3a8-7023-9a08-4c8839350d2e`): overlay, SDK, OpenAPI, and docs contract drift.

Additional validation:

- `bun run api:routes-check` passed: 6 route rules and route inventory clean across 29 files.
- `bun run docs:check` passed: 246 ops, 24 groups.
- These checks did not detect the hand-written API reference optional-field omission.

### P1 Confirmed: config prompt/profile routes can read foreign project sessions

Dirac confirmed Round 1 is actual runtime breakage. Request routing enters the active project directory through `packages/opencorvus/src/server/server.ts:332`, but `/config/prompt` and `/config/prompt-profile` then accept arbitrary `sessionID` and use `EffectiveConfig.*` without asserting that the session belongs to `Instance.project.id`.

The evidence chain is:

- `packages/opencorvus/src/server/routes/config.ts:208`
- `packages/opencorvus/src/server/routes/config.ts:256`
- `packages/opencorvus/src/config/effective.ts:24`
- `packages/opencorvus/src/config/effective.ts:41`
- `packages/opencorvus/src/config/effective.ts:64`
- `packages/opencorvus/src/session/index.ts:360`

`Session.getInProject()` exists but this route path uses project-blind `Session.get()`. The leaked directory then feeds prompt/profile rendering through `packages/opencorvus/src/config/prompt-catalog.ts:153` and `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts:2140`.

### P1 Confirmed: skill routes have mixed-project semantics with foreign sessionID

Dirac confirmed the skill surface issue and corrected the Round 1 explanation. `packages/opencorvus/src/server/routes/skill.ts:58`, `:80`, and `:123` pass query/body `sessionID` directly into `SkillMount`.

`SkillMount.matrix()` reads config/directory through foreign-session `EffectiveConfig` at `packages/opencorvus/src/skill/mounts.ts:182`, but installed skills and import/write operations use active project state through `packages/opencorvus/src/skill/manager.ts:256`, `packages/opencorvus/src/skill/skill.ts:383`, and `packages/opencorvus/src/skill/manager.ts:392`. Mount writes occur at `packages/opencorvus/src/skill/mounts.ts:345`.

Expected boundary: from project B, a request using project A's session ID should fail before reading A's projection or mutating B's skill files.

### P1 Confirmed: projected MCP binary payloads can enter prompts

Bernoulli confirmed the MCP projection issue as breakage for valid binary MCP outputs. Projected prompts/resources expose raw MCP prompt/resource results in `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts:927` and `:934`, then `renderProjectedMcpContext()` calls `prompt.get()` / `resource.read()` and JSON-stringifies the payload at `:1579`, `:1611`, and `:1622`.

Existing materialization helpers cover MCP tool results and session prompt parts, not this resolver path:

- `packages/opencorvus/src/mcp/materialize.ts:19`
- `packages/opencorvus/src/session/prompt/parts.ts:191`

Needed proof test: projected prompt/resource returns binary MCP content and `composeAgentPrompt()` must either fail or materialize to a durable reference, never render base64 JSON.

### P2 Confirmed: Visual QA dispatch parser is fail-open on malformed structured fields

Bernoulli confirmed the parser behavior and did not find a current malformed producer. The bug class remains a fail-open protocol boundary: malformed `referenceParityRequired` or `requiredReferenceRegions` can erase host-required reference parity before output-tool enforcement sees it.

Needed proof tests:

- A dispatch context packet with `{ referenceParityRequired: "true" }` must throw before prompt/tool setup.
- A packet with `{ requiredReferenceRegions: [123] }` must throw rather than filtering to an empty region list.
- A malformed dispatch context must not let an accepted Visual QA report pass by silently erasing required parity.

### P2 Confirmed And Broadened: API reference hides optional request fields

Goodall confirmed Round 1's docs issue and broadened it. The runtime/OpenAPI/SDK expose `promptProfile` on:

- `POST /mission/wake`
- `POST /task`
- `POST /task/{taskID}/message`

Relevant code/types:

- `packages/opencorvus/src/server/routes/mission.ts:51`
- `packages/opencorvus/src/engine/model.ts:287`
- `packages/opencorvus/src/engine/model.ts:576`
- `packages/sdk/js/src/gen/types.gen.ts:11354`
- `packages/sdk/js/src/gen/types.gen.ts:12187`
- `packages/sdk/js/src/gen/types.gen.ts:16000`

The API reference omits optional fields when required fields exist:

- `packages/web/src/content/docs/reference/api.mdx:90`
- `packages/web/src/content/docs/reference/api.mdx:103`
- `packages/web/src/content/docs/reference/api.mdx:128`

The renderer cause is `packages/opencorvus/script/docs/render-api-md.ts:73`, which chooses `required` over all `properties` for body summaries.

### P2 Confirmed/Narrowed: domain expert-squad migration is intended, onboarding is unproven

Fermat confirmed that moving domain squads out of built-in source is intended architecture, not an accidental regression:

- `packages/opencorvus/src/expert-squad/builtin/index.ts:5` embeds only `general`.
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts:222` discovers project package profiles.
- `packages/opencorvus/src/expert-squad/registry.ts:948` reads current-project `.opencorvus/expert-squads`.
- `specs/current/architecture/04-extensions.md:70` documents package-based non-`general` squads.

The remaining risk is onboarding: a fresh project does not automatically receive the repository domain packages, and the overlay appears to have read/select behavior but no expert-squad import UX. API import/export exists in `packages/opencorvus/src/server/routes/expert-squad.ts:64` and SDK generation exposes it, but tests mostly copy repository packages into temp projects before expecting full catalogs.

Fermat also checked migrated package manifests/files and reported no missing declared README/selector/prompt files and no git visibility problem for `.opencorvus/expert-squads/**`.

### P2 Confirmed: MCP fail-fast wrapper test remains stale

Bernoulli confirmed the test harness failure: `packages/opencorvus/test/mcp/prompt-resource-fail-fast.test.ts:40` hard-codes `"10 pass"` while the isolated suite currently has 18 tests and reports `18 pass`. This is a real test-tool defect.

### P3 Confirmed: AgentContextPacket scope enum validation gap remains unproven runtime breakage

Bernoulli confirmed runtime validation does not reject invalid `packet.scope` or `media_ref.scope.kind`, but no current producer was proven to emit malformed scope values. Classification remains validation gap rather than confirmed user-visible breakage.

### P3 Confirmed: taskAgentOutcomes optionality mismatch remains contract drift

Goodall confirmed backend producers currently normalize `taskAgentOutcomes` to arrays through `packages/opencorvus/src/status/task-status-snapshot.ts:79`, `:281`, and `packages/opencorvus/src/workbench/board.ts:212`, `:275`.

The drift remains because shared `TaskBoard` schema and generated SDK types mark the field optional while overlay hand types consume it as required:

- `packages/opencorvus/src/engine/model.ts:1053`
- `packages/sdk/js/src/gen/types.gen.ts:11082`
- `packages/sdk/js/src/gen/types.gen.ts:13481`
- `packages/sdk/js/src/gen/types.gen.ts:15729`
- `packages/overlay/src/services/mission.ts:208`

## Round 2 Status

Round 2 found no wholly separate route family or missing migrated package files beyond Round 1, but it did produce new material refinements: cross-project skill semantics were worse than originally described, MCP projected binary payloads were upgraded to confirmed breakage for valid MCP outputs, and the API reference issue was broadened to a renderer-level optional-field omission.

The audit must continue to Round 3 because Round 2 changed issue classification and broadened the API/docs finding. Round 3 should ask fresh agents to challenge the updated report and specifically look for additional affected surfaces, not re-argue the same known issues.

## Round 3 Findings

Direct subagents:

- Laplace (`019f2c7a-c2f9-7413-94d1-23e1bc695d0e`): updated communication-protocol/project-boundary challenge.
- Euler (`019f2c7a-f6bf-7182-805f-86e2d05e72c7`): updated expert-squad/API/docs challenge.

### P2 Confirmed: `/config/prompt` response schema erases prompt catalog typing in OpenAPI/SDK

Euler found a separate API/SDK contract issue from the optional request-body docs bug. `GET /config/prompt` returns `PromptCatalog.list()` entries with fields such as `effective_prompt`, `active_profile`, and `profile_prompt`, but the route declares `z.array(z.unknown())`.

Evidence:

- `packages/opencorvus/src/server/routes/config.ts:180`
- `packages/opencorvus/src/server/routes/config.ts:191`
- `packages/opencorvus/src/config/prompt-catalog.ts:153`
- `packages/opencorvus/src/config/prompt-catalog.ts:171`
- `packages/sdk/js/src/gen/types.gen.ts:4583`
- `packages/sdk/js/src/gen/sdk.gen.ts:914`

Generated SDK clients therefore see `ConfigPromptResponses[200]` as `Array<unknown>`, which loses the expert-squad prompt catalog contract even though overlay and tests consume concrete fields.

### P2 Confirmed/Broadened: projected MCP binary payloads also affect `/config/prompt` and settings-data loading

Euler broadened the MCP projection finding. `GET /config/prompt` calls `PromptCatalog.list()`, which composes agent prompts through `PromptProfileResolver.composeAgentPrompt()`. That compose path includes `activeMcpPromptContext()` and can stringify projected MCP prompt/resource payloads.

Evidence:

- `packages/opencorvus/src/server/routes/config.ts:207`
- `packages/opencorvus/src/config/prompt-catalog.ts:153`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts:1579`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts:1611`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts:2083`
- `packages/overlay/src/services/init.ts:265`

This means the binary payload problem is not limited to agent runtime prompts; it can also affect public config prompt catalog responses and overlay settings-data loading when an active expert squad projects binary MCP resources/prompts. Round 4 narrowed this wording: overlay cold project initialization calls `loadConfigInfo(..., { includeSettingsData: false })` and does not request `/config/prompt`; `/config/prompt` is requested when settings-data loading is explicitly included or when the settings dialog is opened/refreshed.

### P3 Confirmed/Broadened: hand-written Mission/Task docs also omit `promptProfile`

Euler confirmed the generated API reference issue has a hand-written docs companion. Mission/task integration guides do not document `promptProfile` for task creation, task messages, or mission wake, while backend models/routes accept it.

Evidence:

- `packages/web/src/content/docs/reference/mission-task.mdx:65`
- `packages/web/src/content/docs/reference/mission-task.mdx:164`
- `packages/web/src/content/docs/reference/mission-task.mdx:212`
- `packages/web/src/content/docs/zh-cn/reference/mission-task.mdx:135`
- `packages/opencorvus/src/engine/model.ts:287`
- `packages/opencorvus/src/engine/model.ts:576`
- `packages/opencorvus/src/server/routes/mission.ts:41`

### P2 Confirmed: Build repair-contract context silently filters invalid integrity fingerprints

Laplace found another fail-open structured context parser. `parseBuildRepairContractContextData()` rejects unsupported fields and non-array/non-string `integrityBlockingFingerprints`, but `uniqueIntegrityFingerprints()` silently filters strings that do not match `if_[a-f0-9]{16}`.

Evidence:

- `packages/opencorvus/src/build/prompt-context.ts:79`
- `packages/opencorvus/src/build/prompt-context.ts:94`
- `packages/opencorvus/src/build/prompt-context.ts:107`

Malformed upstream repair-contract context can therefore erase intended blocking fingerprints before Build consumes them.

### P2/P3 Confirmed: Integrity implementation-evidence context drops malformed optional evidence

Laplace found the same fail-open class in Integrity. `parseImplementationEvidenceContext()` fails on missing `summary` / `changedFiles`, but silently omits `diffs` and `goalReports` when they are wrong-shaped and casts array contents without element validation.

Evidence:

- `packages/opencorvus/src/integrity/acceptance-tools.ts:407`
- `packages/opencorvus/src/integrity/acceptance-tools.ts:421`

This is adjacent to the Visual QA dispatch parser issue: optional structured context fields are not consistently fail-fast even when they carry review evidence.

### P3 Confirmed/Broadened: AgentContextPacket validation also lacks a part.type discriminant rejection

Laplace broadened the AgentContextPacket runtime validation gap. The report already covered `packet.scope` and `media_ref.scope.kind`; additionally, `validateAgentContextPacket()` validates known part types but has no explicit rejection for unknown `part.type`.

Evidence:

- `packages/opencorvus/src/agent/context-packet.ts:204`
- `packages/opencorvus/src/agent/context-packet.ts:209`

Rendering will often fail later because unknown parts are treated like structured parts without a schema, but validation itself does not enforce the discriminant. This should be classified as a validation gap, not a proven current producer bug.

### Adjudicated Exception: task conversation read routes deliberately switch to task project

Laplace found `GET /task/:taskID/conversation`, `/conversation/session/:sessionID`, and `/conversation/history` switch into the task's owning project even when the active request directory differs. This is not the same class as arbitrary `sessionID` leakage: the route is taskID-owned, uses the task's project, and tests explicitly expect the behavior.

Evidence:

- `packages/opencorvus/src/server/routes/orchestrator.ts:108`
- `packages/opencorvus/src/server/routes/orchestrator.ts:948`
- `packages/opencorvus/src/server/routes/orchestrator.ts:1042`
- `packages/opencorvus/src/server/routes/orchestrator.ts:1110`
- `packages/opencorvus/test/server/task-conversation-routes.test.ts:4267`

This should be documented as an intentional project-boundary exception, not counted as confirmed breakage unless a later product/security decision says taskID-owned cross-project reads are forbidden.

Adjacent route: `GET /task/:taskID/conversation/events` is also a conversation read route, but it does not use `provideTaskProjectForConversationRead`; it calls `EngineService.getTask(taskID)`, which enforces current project. Current cross-project tests cover hydrate/session/history, not events. This is not breakage by itself, but the route family has inconsistent cross-project read policy and should be explicitly adjudicated.

## Round 3 Status

Round 3 found new affected surfaces, so the audit loop is still not complete. Round 4 must challenge:

- `/config/prompt` response schema and settings initialization as affected API/UI surfaces.
- Build and Integrity structured context parser fail-open behavior.
- AgentContextPacket discriminant validation.
- Whether task conversation project switching is correctly documented as an intentional exception rather than a bug.

## Round 4 Findings

Direct subagents:

- Aristotle (`019f2c83-8f72-78e1-a75a-82f88aa76a7d`): Round 3 protocol/API challenge.
- Tesla (`019f2c83-c068-7723-af67-9460979cc213`): Round 3 docs/settings/project-boundary challenge.

### P2 Confirmed/Broadened: Build repair-contract fingerprints are filtered on both producer and parser paths

Round 3 covered parser-side filtering. Aristotle found the producer path has the same filter: `buildRepairContractStructuredPart()` calls `uniqueIntegrityFingerprints()` and returns `undefined` when all values are filtered before any context packet exists. Downstream `validateBuildIntegrityRepairReport()` exits cleanly when the required list is empty, so malformed fingerprints can erase required repair-report enforcement.

Evidence:

- `packages/opencorvus/src/build/prompt-context.ts:37`
- `packages/opencorvus/src/build/prompt-context.ts:107`
- `packages/opencorvus/src/orchestrator/tools.ts:13790`
- `packages/opencorvus/src/build/agent.ts:1017`
- `packages/opencorvus/src/build/types.ts:286`

### P2/P3 Confirmed/Broadened: malformed Integrity implementation evidence can crash drilldown tools

Round 3 covered silent optional-field casts. Aristotle found the adjacent impact: accepted malformed `diffs[]` or `goalReports[]` elements can later be dereferenced by `inspect_integrity_evidence`, so this is not only evidence omission. It can make `diff_for_file` or `executor_reports` drilldown throw.

Evidence:

- `packages/opencorvus/src/integrity/acceptance-tools.ts:407`
- `packages/opencorvus/src/integrity/acceptance-tools.ts:309`
- `packages/opencorvus/src/integrity/acceptance-tools.ts:389`

### P3 Confirmed/Broadened: unknown AgentContextPacket part types can be misrendered

Round 3 said unknown part types may fail later or be ignored. Aristotle found a more precise behavior: if an unknown part carries `schema` and `data`, rendering falls through and treats it as a structured ref, while schema extraction still ignores it because `part.type !== "structured"`.

Evidence:

- `packages/opencorvus/src/agent/context-packet.ts:204`
- `packages/opencorvus/src/agent/context-packet.ts:215`
- `packages/opencorvus/src/agent/context-packet.ts:174`

### P3 Correction: `/config/prompt` settings path wording must not imply cold-start loading

Tesla confirmed the `/config/prompt` MCP payload exposure is real for public API and settings-data load, but not for normal overlay cold start or prompt-profile selector initialization.

Evidence:

- `packages/overlay/src/services/init.ts:110`
- `packages/overlay/src/services/init.ts:275`
- `packages/overlay/src/services/init.ts:366`
- `packages/overlay/src/services/dialog.ts:132`
- `packages/overlay/src/components/settings/PromptCatalog.tsx:9`

### P3 Adjacent Route: `/task/:taskID/conversation/events` has the opposite cross-project policy

Tesla confirmed the task conversation exception should be narrowed. The hydrate/session/history routes deliberately switch to the task project; `/task/:taskID/conversation/events` calls `EngineService.getTask(taskID)`, which enforces current project.

Evidence:

- `packages/opencorvus/src/server/routes/orchestrator.ts:1177`
- `packages/opencorvus/src/task-api/index.ts:1723`
- `packages/opencorvus/test/server/task-conversation-routes.test.ts:4315`

This is not counted as a confirmed bug yet. It is an adjacent route-policy inconsistency requiring product/architecture adjudication.

## Round 4 Status

Round 4 found additional precision and adjacent impacts, so the audit loop must continue. Round 5 should challenge only Round 4 additions and the updated wording. If Round 5 reports no new issues, the review loop can stop with the current issue set.

## Round 5 Findings

Direct subagents:

- Chandrasekhar (`019f2c8d-64b2-7e41-afa9-98d74e99f626`): Round 4 targeted challenge.
- Kuhn (`019f2c8d-96c0-7380-b27d-5ff81a4c397e`): stop-condition challenge.

### P3 Confirmed: IntegrityReplayContext packets have weak nested validation and can crash prompt rendering

Kuhn found a distinct Integrity structured-context path from the Round 4 `acceptance-tools.ts` issue. `parseIntegrityReplayContext()` validates top-level fields and then returns `candidate as IntegrityReplayContext`; nested `implementationEvidenceSinceLastReview` arrays are assumed valid by prompt rendering.

Evidence:

- `packages/opencorvus/src/integrity/replay-context.ts:462`
- `packages/opencorvus/src/integrity/replay-context.ts:349`
- `packages/opencorvus/src/integrity/team-agent.ts:881`

Malformed nested evidence can crash integrity prompt rendering when `renderIntegrityReplayContextPrompt()` accesses `evidence.changedFiles`, `evidence.diffs.map(...)`, `evidence.goalRuns.length`, or `evidence.taskAgentOutcomes.length`.

### P2 Confirmed/Broadened: malformed Integrity implementation evidence can abort prompt assembly before drilldown

Round 4 covered `inspect_integrity_evidence` drilldown. Chandrasekhar found the same malformed implementation-evidence packet can also abort Integrity prompt assembly. `parseImplementationEvidenceContext()` casts `diffs` elements without validation; `buildWorkerReviewPrompt()` consumes the packet and `renderImplementationEvidenceSummary()` dereferences `diff.file`.

Evidence:

- `packages/opencorvus/src/integrity/acceptance-tools.ts:421`
- `packages/opencorvus/src/integrity/team-agent.ts:1025`
- `packages/opencorvus/src/integrity/team-agent.ts:1150`

Malformed `diffs: [null]` or `diffs: [{}]` can therefore fail before a reviewer calls any drilldown tool.

### P3 Confirmed/Broadened: unknown AgentContextPacket part-type fallthrough also affects schema-specific text rendering

Round 4 covered body rendering. Chandrasekhar found schema-specific text helpers have the same fallthrough because `agentContextPacketTextByStructuredSchema()` selects packets containing a legitimate structured part, then renders the whole packet with `agentContextPacketText()`, which treats any non-text/non-media part as structured.

Evidence:

- `packages/opencorvus/src/agent/context-packet.ts:150`
- `packages/opencorvus/src/agent/context-packet.ts:165`

If a packet contains one legitimate structured part plus an unknown part with `schema`/`data`, the schema-specific helper can misrender the unknown part too.

### P3 Correction: settings-data refresh path should include config.changed while dialog is open

Round 4's narrowed settings wording was correct but missing refresh evidence. When the config dialog is open, `scheduleConfigReload()` chooses `loadSettingsInfo()` if `configRefreshIncludesSettingsData()` is true; `loadSettingsInfo()` opts into settings data and requests `/config/prompt`.

Evidence:

- `packages/overlay/src/services/events.ts:215`
- `packages/overlay/src/services/init.ts:366`
- `packages/overlay/src/services/init.ts:278`

The prompt settings UI itself uses `/config/prompt-profile`, not `appStore.promptEntries` from `/config/prompt`, so the `/config/prompt` risk remains scoped to the public API and settings-data load/refresh side effects.

## Round 5 Status

Round 5 found a new adjacent Integrity replay context issue and broadened two Round 4 impacts. The audit loop must continue to Round 6 and challenge only the Round 5 additions. If Round 6 finds no new issues or corrections, stop the review loop.

## Round 6 Findings

Direct subagent:

- Hegel (`019f2c93-e3e6-7852-8ac3-4f466faa1a55`): Round 5 targeted challenge.

### P3 Confirmed/Broadened: IntegrityReplayContext weak nested validation covers prior attempts and fact-check rows too

Round 5 covered `implementationEvidenceSinceLastReview`. Hegel found the same top-level-only cast also affects `priorAttempts` and `priorFactCheckAttempts`: `parseIntegrityReplayContext()` only checks these fields are arrays, then returns the candidate as `IntegrityReplayContext`.

Evidence:

- `packages/opencorvus/src/integrity/replay-context.ts:471`
- `packages/opencorvus/src/integrity/replay-context.ts:472`
- `packages/opencorvus/src/integrity/replay-context.ts:480`
- `packages/opencorvus/src/integrity/shared-prompt.ts:368`
- `packages/opencorvus/src/integrity/shared-prompt.ts:383`
- `packages/opencorvus/src/integrity/replay-context.ts:452`

Malformed prior-attempt rows can crash shared prompt rendering through `attempt.requiredRepairs.length` or `attempt.unresolvedDisagreements.length`. Malformed fact-check rows can crash directly at `fc.targetSessionID.slice(...)`.

### P3 Confirmed/Broadened: AgentContextPacket schema-specific fallthrough affects Integrity drilldown output

Round 5 covered schema-specific text rendering generally. Hegel found a concrete consumer: `inspect_integrity_evidence` uses `agentContextPacketTextByStructuredSchema()` for `frontend_design_contract` and `visual_qa_report`. A packet selected by one valid structured part can therefore misrender an unknown part in Integrity drilldown output.

Evidence:

- `packages/opencorvus/src/agent/context-packet.ts:167`
- `packages/opencorvus/src/agent/context-packet.ts:168`
- `packages/opencorvus/src/agent/context-packet.ts:156`
- `packages/opencorvus/src/integrity/acceptance-tools.ts:352`
- `packages/opencorvus/src/integrity/acceptance-tools.ts:355`
- `packages/opencorvus/src/integrity/acceptance-tools.ts:361`
- `packages/opencorvus/src/integrity/acceptance-tools.ts:364`

### P3 Coverage Gap: config.changed settings-data refresh branch lacks test coverage

Hegel confirmed Round 5 settings refresh evidence is code-supported, but existing overlay tests cover only plain config refresh. The `config.changed` branch at `scheduleConfigReload()` chooses `loadSettingsInfo()` when settings data should be included; current `events-refresh.test.ts` asserts only one `"config"` request.

Evidence:

- `packages/overlay/src/services/events.ts:215`
- `packages/overlay/src/services/init.ts:367`
- `packages/overlay/src/services/init.ts:371`
- `packages/overlay/src/services/init.ts:278`
- `packages/overlay/test/events-refresh.test.ts:1765`
- `packages/overlay/test/events-refresh.test.ts:1779`

## Round 6 Status

Round 6 still found adjacent details, so the audit loop must continue to Round 7. Round 7 should challenge only the Round 6 additions. If Round 7 finds no new issues or corrections, stop the review loop.

## Round 7 Findings

Direct subagent:

- Plato (`019f2c9a-5a03-7d52-9f56-8bed0f27cf64`): Round 6 targeted challenge.

### P3 Confirmed/Broadened: weak IntegrityReplayContext priorAttempts validation reaches severity rendering and final report normalization

Round 6 covered replay/shared prompt rendering. Plato found the same weak `priorAttempts` validation also reaches severity-context rendering and final report normalization. `parseIntegrityReplayContext()` only checks `priorAttempts` is an array, while downstream code dereferences nested finding arrays and passes unvalidated `requiredRepairs` into manifest indexing.

Evidence:

- `packages/opencorvus/src/integrity/replay-context.ts:471`
- `packages/opencorvus/src/integrity/team-agent.ts:894`
- `packages/opencorvus/src/integrity/team-agent.ts:916`
- `packages/opencorvus/src/integrity/team-agent.ts:959`
- `packages/opencorvus/src/integrity/team-agent.ts:981`
- `packages/opencorvus/src/integrity/team-agent.ts:1258`
- `packages/opencorvus/src/integrity/team-agent.ts:1381`
- `packages/opencorvus/src/integrity/team-agent.ts:1388`
- `packages/opencorvus/src/integrity/finding-manifest.ts:80`

### P3 Confirmed/Broadened: AgentContextPacket schema-specific fallthrough affects initial Integrity evidence prompts

Round 6 covered Integrity drilldown output. Plato found the initial Integrity evidence prompt also uses `agentContextPacketTextByStructuredSchema()` for frontend design and Visual QA context, so unknown part-type fallthrough can affect prompt assembly before drilldown.

Evidence:

- `packages/opencorvus/src/agent/context-packet.ts:166`
- `packages/opencorvus/src/agent/context-packet.ts:227`
- `packages/opencorvus/src/integrity/team-agent.ts:1029`
- `packages/opencorvus/src/integrity/team-agent.ts:1036`

### P3 Correction: config.changed test fixture can serve `/config/prompt`, but the branch is untested

Plato corrected the Round 6 test-gap wording. The `events-refresh` fixture already has a `/config/prompt` response; the missing coverage is specifically that the `config.changed` SSE test never opens/resets the config dialog branch and only asserts the plain `"config"` request.

Evidence:

- `packages/overlay/test/events-refresh.test.ts:105`
- `packages/overlay/test/events-refresh.test.ts:1765`
- `packages/overlay/test/events-refresh.test.ts:1779`
- `packages/overlay/test/events-refresh.test.ts:364`

## Round 7 Status

Round 7 still found adjacent details, so the audit loop must continue to Round 8. Round 8 should challenge only the Round 7 additions. If Round 8 finds no new issues or corrections, stop the review loop.

## Round 8 Findings

Direct subagent:

- Kant (`019f2c9e-a3fe-7381-8291-011d094c092a`): Round 7 targeted challenge.

Kant found no new confirmed issues beyond Round 7. It confirmed:

- The IntegrityReplayContext severity/final-normalization paths are code-supported; the report now includes additional prompt-builder reachability and both prior finding/repair manifest-index evidence.
- The AgentContextPacket schema-specific fallthrough into initial Integrity prompts is valid; the report now includes the direct render fallthrough evidence.
- The `config.changed` coverage correction is valid: the fixture can serve `/config/prompt`, but the existing test keeps the settings dialog closed and asserts only the plain config refresh path.

## Final Audit Status

The iterative direct-subagent audit loop stops after Round 8 because the latest independent review found no new issues or corrections. This report is therefore the current consolidated issue inventory for recent communication-protocol and expert-squad changes. It is an audit report, not a fix implementation.
