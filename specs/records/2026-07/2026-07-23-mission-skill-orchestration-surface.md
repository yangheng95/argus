# Mission Skill Orchestration Surface

## Recall

### User request

- Design a Mission Skill capability backed by an independent Mission Skill directory while reusing the existing Skill runtime logic.
- Mission Skills primarily describe Mission-level orchestration workflows that coordinate multiple Expert Squads.
- Selecting an exact `@mission-skill` reference and selecting an exact `@squad` reference must bypass the Chat submission route and wake the Mission agent directly.
- The Chat agent must not be able to discover, search, or load Mission Skills.
- Investigate the current implementation first, refine the design, and obtain an independent Agent review before implementation.
- This task stops after the reviewed design is committed and pushed. It does not implement runtime, UI, API, SDK, test, payload, or package-migration changes.
- The supplied desktop reference shows the existing cascading Composer `@` menu with `Skill` and `Expert Squad` categories. Mission Skill must extend that existing interaction language rather than create another launcher or command palette.

### Acceptance criteria

- Operator-authored Mission Skill packages live only under the exact dedicated roots:
  - project: `<project>/.opencorvus/mission-skills/<package>/SKILL.md`;
  - user-global: `Global.Path.config/mission-skills/<package>/SKILL.md`.
- The shipped `mirror-prism-cluster` launcher moves to the dedicated built-in Mission Skill author source under `packages/opencorvus/src/mission-skill/builtin/mirror-prism-cluster/**` and is emitted through an independent generated Mission Skill payload/cache. Its current Expert Squad package copy and `package_skill_refs` entry are deleted in the same change.
- The `SKILL.md` frontmatter/body, supporting-file closure, exact-name identity, platform eligibility, required-tool checks, permission checks, fuzzy search, exact load result, and sampled supporting-file behavior reuse one shared Skill kernel. There is no copied Mission-specific parser, loader, materializer, or search implementation.
- Built-in, global, and project Mission Skill roots form one strict current-project catalog. Duplicate frontmatter `name` values fail visibly; there is no built-in/global/project precedence, alias, filename identity, or compatibility lookup.
- Ordinary Skill discovery never scans `mission-skills/**`, including when an operator configures a broad ordinary `skills.paths` glob above `.opencorvus`. Mission Skills never enter `Skill.all()`, `SkillManager.installed()`, ordinary Skill markets/imports, `PromptProfileResolver` production grants, package Skill refs, `/skill`, `/skill/mounts`, or Task/Orchestrator Skill surfaces.
- The native Mission agent receives one turn-resolved Mission Skill surface through a distinct `mission_skill` tool ID produced by the same shared Skill loader factory. The surface is resolved only for `agent="mission"` on a `kind="mission"` session and contains only the strict Mission Skill catalog.
- Chat, Coding, Control, Task Orchestrator, and projected workers receive no Mission Skill entry, prompt section, runtime surface, or tool result. This is enforced by backend catalog/surface ownership, not an Overlay-only filter.
- The visible directive syntax is exactly `@mission-skill("<exact-name>")`. It is an atomic Composer entity and follows the existing keyboard, pointer, caret, deletion, Input Method Editor (IME), bounded ranking, and no-per-character-network contracts.
- `@mission-skill` and `@squad` both invoke the existing `wakeMission` → `POST /mission/wake` path before any Chat/session/task submission branch. Neither calls `createCodingAssistantSession`, `createGlobalCodingAssistantSession`, or `panelMessage`.
- A Mission-Skill-only launch omits `promptProfile`; the Mission inherits its existing effective `prompt_profile.active`. A launch that also contains one exact `@squad` passes that manifest ID as the existing `promptProfile`. No Mission Skill changes `prompt_profile.active`, creates an `active_mission_skill` field, or becomes an Expert Squad identity.
- Explicit directives take precedence over the Composer mode selector: `@mission-skill` without an explicit `@squad` omits `promptProfile` even when the current mode is `expert-squad`; only an exact `@squad` or a directive-free existing Expert Squad launcher supplies the selected Squad profile.
- The original visible request, including every `@mission-skill` directive, is the Mission user message. No hidden metadata, synthetic prompt, pre-executed tool result, audience split, or invisible routing message is introduced.
- The Mission system policy requires the Mission agent to load every exact user-authored Mission Skill before planning, writing Mission state, or creating child Tasks. Loading remains a real visible `mission_skill` tool call. The Mission then records the durable contract and selected workflow commitments in the existing Mission files so compaction does not require a hidden selection field.
- A Mission Skill may name exact Squad manifest IDs and instruct Mission to create dependent stage Tasks with explicit `create_task.promptProfile`; it does not create a workflow engine, persisted workflow state, automatic step advancement, Task-local squad switching, or a second scheduler.
- Multiple exact Mission Skills are additive and may all be loaded. Multiple distinct Squad directives remain invalid because one Mission wake has one `prompt_profile.active`; duplicate references to the same entity are de-duplicated.
- Focused discovery, isolation, runtime-tool, prompt, catalog, parser, routing, OpenAPI/SDK, browser interaction, request-log, and screenshot tests pass. The browser proof must show `POST /mission/wake` and the absence of Chat submission requests.

### Hard constraints

- Follow root `AGENTS.md`: no fallback, compatibility alias, dual source, keyword router, gate, hidden message, state machine, database migration, destructive Git operation, or unapproved running-process restart.
- Mission Skill is a Mission orchestration instruction package, not an Expert Squad, ordinary Task Skill, plugin, MCP server, or `prompt_profile` variant.
- Mission remains the only cross-Squad coordinator. Each child Task keeps one fixed Expert Squad for its full lifecycle and runs only that Squad's binding virtual workflow.
- `PromptProfileResolver` remains the sole owner of active Expert Squad Task/scheduler production Skill projection. It must not scan or project Mission Skills.
- The Mission agent remains a native primary assistant. Do not fabricate a projected-worker `SessionRuntimeContract` merely to expose Mission Skills.
- Host code may parse the exact visible directive for catalog validation and route selection, but it must not infer workflow semantics, choose Squads from prose/keywords, pre-load the Skill invisibly, or enforce Mission steps.
- “Chat cannot access Mission Skills” means the Chat runtime receives no Mission Skill catalog/prompt/tool surface and cannot search or load one through either Skill-family tool. Operator-authored Mission Skills remain ordinary files within operator-selected roots; raw filesystem confidentiality from a general-purpose native agent would require a separate role-aware filesystem/process sandbox spanning read/glob/search/bash and is not claimed by this Skill-capability design.
- The reference is desktop-only. No mobile/tablet/responsive work is added.
- Playwright is started by Node, never Bun. Visual acceptance uses an isolated target and does not restart or refresh the user's running OpenCorvus/Overlay process.
- Preserve all pre-existing staged and unstaged Mirror/Prism changes. Task commits are path-limited and use the `dsw-33987` subject prefix.
- This planning turn changes only this record and its two documentation indexes. Every runtime item below is a future implementation requirement, not authorization to implement it now.

### Hard-disk sources read before design

- `AGENTS.md`
- Supplied `codex-clipboard-146e6384-2649-493a-b8b4-9c498713d1f8.png`
- `specs/README.md`
- `specs/current/architecture/{04-extensions,08-agent-tool-adapter,99-principles}.md`
- `specs/records/2026-07/2026-07-15-composer-skill-squad-mentions.md`
- `specs/records/2026-07/2026-07-22-mission-squad-stage-task-orchestration.md`
- `specs/records/2026-07/2026-07-22-cross-squad-goal-ownership-and-sdk-collaboration-contract.md`
- `packages/opencorvus/src/skill/{skill,manager,mounts,discovery,name}.ts`
- `packages/opencorvus/src/tool/{skill,registry,global-tools,tool-id-catalog}.ts`
- `packages/opencorvus/src/tool/tool.ts`
- `packages/opencorvus/src/session/{loop,system,wake,runtime-contract}.ts`
- `packages/opencorvus/src/agent/{primary-assistant-registry,role-contract,tool-pool-data}.ts`
- `packages/opencorvus/src/mission/session.ts`
- `packages/opencorvus/src/prompt/core/mission-core.txt`
- `packages/opencorvus/src/server/routes/{app,skill,expert-squad,mission}.ts`
- `packages/opencorvus/src/expert-squad/{catalog,prompt-profile-resolver}.ts`
- `expert-squads/mirror/mirror-prd/{expert-squad.jsonc,README.md,skills/mirror-prism-cluster/SKILL.md}`
- `specs/artifacts/mirror-prism/source-capability-contract.json`
- `packages/sdk/js/test/{mirror-prism-collaboration,review-debug-collaboration}.test.ts`
- `packages/opencorvus/test/expert-squad/mirror-squads-package.test.ts`
- `packages/opencorvus/script/{generate-build-artifacts,generate-builtin-skill-payload}.ts`
- `script/{generated-artifacts,generate}.ts`
- `packages/opencorvus/test/{skill/builtin-payload-generation,script/document-health}.test.ts`
- `packages/overlay/src/components/{ChatComposer,ComposerMentionMenu}.tsx`
- `packages/overlay/src/services/{composer-mention,composer-expert-squad-catalog,expert-squad,mission}.ts`
- `packages/overlay/src/main.tsx`
- Focused backend, Overlay, SDK, and browser tests listed below.

### Whole-repository grep evidence

Commands:

- `rg -n "Skill\\.(Info|Definition|PackageDefinition|InvalidError|parseDefinition|materialize|all|get|dirs|state|builtin|bundle)" packages/opencorvus/src packages/opencorvus/test packages/sdk packages/overlay`
- `rg -n "SkillManager|SkillMount|SkillTool|SystemPrompt\\.skills" packages/opencorvus/src packages/opencorvus/test packages/sdk packages/overlay`
- `rg -n "@skill|@squad|ComposerMention|skillNames|forcedExpertSquadID" packages/opencorvus/src packages/opencorvus/test packages/sdk packages/overlay`
- `rg -n "mission/wake|wakeMission|SessionWake\\.wake|agent: \\"mission\\"|MISSION_CORE" packages/opencorvus/src packages/opencorvus/test packages/sdk packages/overlay`
- `rg -n "SessionRuntimeContract|skillProjection|SkillMount\\.resolve|finalizeResolvedToolSkillSurface" packages/opencorvus/src packages/opencorvus/test`
- `rg -n "roleAssignments|GLOBAL_TOOL_IDS|builtInToolProviderState|SkillTool.id" packages/opencorvus/src/agent packages/opencorvus/src/tool packages/opencorvus/test`
- `rg -n "active_skill_projection|production_grants|composerExpertSquadCatalog" packages/opencorvus/src packages/overlay/src packages/opencorvus/test packages/overlay/test`
- `rg -n "mirror-prism-cluster|package_skill_refs" expert-squads packages specs`
- `rg -n "generateBuiltinSkillPayload|generatedArtifacts|builtin-payload|SkillTool\\.id|skillSurface|resolvedToolSkillSurfaces|finalizeResolvedToolSkillSurface" packages/opencorvus/src packages/opencorvus/script packages/opencorvus/test`

Findings and call-site disposition:

| Owner / call site | Current evidence | Design disposition |
| --- | --- | --- |
| `Skill.state` in `skill/skill.ts` | Scans built-ins, external `.claude/.agents/.codex/.opencorvus` ordinary Skill roots, config directories, configured paths, and URLs into one `Skill.Info` inventory. Configured `skills.paths` uses a broad `**/SKILL.md` glob and can currently cross a semantic resource boundary. | Extract the reusable document/catalog kernel, but keep ordinary roots owned by ordinary Skill. Add a separate `MissionSkillCatalog` for built-ins plus the two exact operator roots. Make the shared resource-owner classifier exclude `mission-skills/**` from ordinary discovery even under a broad configured parent path. |
| `SkillManager` and `/skill/**` | Own ordinary market/install/import/remove/update/policy and installed metadata. | Leave unchanged in the first Mission Skill slice. Mission Skills are filesystem-authored packages; no ordinary market/config-path/URL entry may import them accidentally. A later manager, if requested, must target only the dedicated roots and reuse the shared package-write kernel. |
| `PromptProfileResolver.resolveSkillProjection()` | Owns active Expert Squad scheduler/worker production grants and package Skill isolation. | Remains unchanged and never receives Mission Skills. |
| `SkillMount.resolve()` | Requires an exact projected scheduler/worker identity and active Expert Squad Skill projection. | Keep projected Task behavior. Extract the common executable Skill surface shape/checks; add a native Mission resolver rather than forging a projected identity. |
| `SkillTool` | Already searches/loads exact names from an injected turn-resolved surface and materializes supporting files only on exact load, but its exported ID and SessionLoop finalizer encode the ordinary projected-Skill authority. | Extract one family-neutral loader factory and result renderer. Keep `skill` for projected production Skills and instantiate `mission_skill` for Mission Skills; no parser, search, materialization, eligibility, permission, or result-format copy is allowed. |
| `tool-id-catalog.ts`, `global-tools.ts`, and `ToolRegistry.materialize()` | `skill` is a core global tool ID with provider state `deferred`; Registry deliberately skips generic initialization because SessionLoop supplies its resolved surface later. The skip currently checks `SkillTool.id` directly. | Register `mission_skill` as a second core deferred provider created by the shared loader factory. Replace the one-ID skip with one shared deferred Skill-family predicate. Keep `mission_skill` out of package-projectable runtime-template sets and batch targets. |
| `SessionLoop.finalizeResolvedToolSkillSurface()`, its WeakMap, `Tool.InitContext.skillSurface`, and `SystemPrompt.skills()` | One ordinary-only surface/finalizer is called during initial turn setup and again after Structured Output changes; its result owns both final tool binding and system policy. Native Mission and Chat currently receive no bound ordinary Skill surface. | Replace it with one family-neutral `ResolvedSkillSurface` discriminated union and one turn finalizer that preserves both execution points. The finalizer selects exactly one family: projected production, native Mission, or none; binds the matching tool; and supplies the same resolved union to `SystemPrompt`. A parallel unconsumed Mission finalizer is forbidden. |
| `AgentToolPool.roleAssignments.mission` | Mission has read/search/panel/Mission-state tools but no Skill-family tool. | Add `mission_skill` only to the Mission role assignment. Its core tool registration makes it reservable/materializable but does not place it in Chat/Coding/Control/Orchestrator/worker pools or package-projectable tool sets. |
| `SystemPrompt.skills()` | Renders ordinary mounted-Skill policy and mandates exact `@skill(...)` loads, but only when SessionLoop produced a surface. | Parameterize the policy by surface family. Mission rows and explicit policy use `@mission-skill(...)`; projected Task rows retain `@skill(...)`. |
| `composer-mention.ts` | Hard-codes the `skill | squad` union, exact directive regex, atomic ranges, validation, and route output. | Add one declarative `mission-skill` kind through the same grammar/ranking/atomic-edit path. Return exact `missionSkillNames` alongside existing fields. |
| `ChatComposer.handleSubmit()` | Parses `skillNames`, but passes only `directives.squadID`; ordinary `skillNames` are not a routing field and survive solely as visible text. | Pass a boolean/exact Mission Skill list only to the shared submit callback for Mission route selection. Keep the directives in visible text; do not turn names into hidden prompt metadata. |
| `main.tsx` Composer submit | `forcedPromptProfile || expertSquadSubmitActive()` wakes Mission before Chat; otherwise Chat launcher creates a Chat session and calls `panelMessage`. | Make `missionSkillNames.length > 0` join the same first Mission branch. When no Squad is named, omit `promptProfile`; when a Squad is named, pass that exact ID. |
| `POST /mission/wake` | Creates/resumes one `kind="mission"` session, optionally writes existing `prompt_profile.active`, and wakes `agent="mission"` with the original user prompt. | Reuse unchanged routing/session semantics. Do not add `missionSkill`, active workflow, or hidden prompt fields to the route. |
| Expert Squad catalog route and Composer snapshot | One scope-keyed request supplies Squad identities and ordinary active production grants. | Keep that route and ownership unchanged. Add a dedicated Mission Skill catalog route and compose the two independent requests into one atomic, scope-keyed Overlay reference snapshot; there are no typing-time requests and no partial-category fallback. |
| `mission-core.txt` | Mission already owns durable contract files and explicit cross-Squad stage Tasks with fixed child `promptProfile`. | Add the Mission Skill load/durability contract only; Mission Skill content supplies domain orchestration instructions without changing scheduler/state ownership. |
| `mirror-prism-cluster` author package and references | The file calls itself a Mission launcher/static collaboration contract, but is currently stored and projected as a Mirror PRD package Skill. Its path is asserted by the Mirror manifest/README, source capability artifact, SDK collaboration tests, package tests, and generated payload. | Move it atomically to the dedicated built-in Mission Skill source, remove the old package copy/ref, update every current artifact/test/generated payload caller, and add isolation assertions. Do not keep an alias or compatibility copy. Historical records remain historical evidence rather than runtime sources. |
| Generated artifact closure | Ordinary Skill and Expert Squad payload generators are invoked by `generate-build-artifacts.ts`; tracked outputs/freshness are described by `generated-artifacts.ts`, `generate.ts`, and document-health tests. | Add one Mission Skill generator/output to that existing generation pipeline and tracked-output contract, with duplicate/frontmatter/supporting-file/freshness tests. Removing the cluster from Expert Squad payload and adding it to Mission Skill payload must be one generated-state transition. |

### Proven adjacent defect

The current ordinary `@skill` implementation is not a complete end-to-end Chat load path:

1. Composer builds its Skill rows by de-duplicating every active Expert Squad `production_grant`, without selecting the actual receiving agent.
2. `resolveComposerMentionDirectives()` returns `skillNames`, but `ChatComposer` does not pass those names to routing.
3. The visible directive reaches Chat, while `SessionLoop` deletes `skill` for native sessions that have no projected runtime contract.

Therefore the current code and the historical completion record do not prove that Chat can perform the required real `skill` tool call. This Mission Skill design must not copy or rely on that gap. The Mission implementation receives its own real native surface and covering tool-result test. Repairing ordinary Chat `@skill` projection is a separate architecture decision because choosing “all installed Skills” versus “active production grants for one receiving identity” changes ordinary Skill authority; it is not silently bundled into Mission Skill work.

### Independent Agent feedback

The read-only independent Agent returned `NEEDS REVISION` with five blockers:

1. `mission_skill` needed a complete core deferred-provider registration/Registry closure while remaining absent from projected allow-lists.
2. A parallel Mission finalizer would not close the current single WeakMap/finalizer/SystemPrompt dataflow.
3. Mission-Skill-only routing conflicted with the implicit Expert Squad mode selector profile.
4. The new built-in payload lacked generator, tracked-artifact, freshness, and document-health call sites.
5. Treating every Skill's eligibility as a surface-level assertion would create a preflight gate instead of shared disabled-row behavior.

This revision addresses them by specifying the provider-state predicate, one discriminated-union turn finalizer at both existing call points, explicit-directive precedence, the full generated-artifact closure, and per-Skill shared eligibility. It also adopts the non-blocking recommendations: one keyed in-flight Overlay snapshot owner, fresh turn-time catalog resolution, no absolute path in the public catalog, real SessionLoop/tool-result tests, and cross-family negative loads.

The final re-review confirmed all five blockers closed and accepted the explicit Chat capability-versus-filesystem boundary. It found two factual wording errors—`project/global` rather than the real `project/session` catalog scopes, and two generated-artifact scripts assigned to the wrong directory. Both are corrected above. Final independent verdict: `ACCEPT`.

## Root design

Mission Skill is a separate catalog projected onto the native Mission agent through the existing Skill execution kernel:

```text
dedicated built-in + project/global mission-skills roots
  -> MissionSkillCatalog (strict exact-name inventory)
  -> dedicated Mission Skill catalog read model
  -> visible @mission-skill("name")
  -> existing POST /mission/wake
  -> native Mission turn resolver
  -> shared Skill loader factory instantiated as mission_skill
  -> visible tool result + existing Mission state files
  -> Mission-owned child Tasks with exact per-stage promptProfile
```

The separation boundary is the catalog supplied to the tool, not a UI filter and not a second workflow runtime:

| Agent family | Skill-family tool surface |
| --- | --- |
| Native Mission | `mission_skill`, dedicated Mission Skill catalog only |
| Task Orchestrator / projected workers | `skill`, existing `PromptProfileResolver` production Skill projection only |
| Native Chat / Coding / Control | No `mission_skill`; existing ordinary behavior remains unchanged |

The same frontmatter `name` may exist once in ordinary Skill inventory and once in Mission Skill inventory because the two names live in disjoint semantic catalogs and can never be mounted on the same agent surface. Inside either catalog, duplicate names are fatal.

## Detailed design

### 1. Shared Skill kernel and dedicated catalog

Extract reusable, family-neutral code from `skill/skill.ts` and `tool/skill.ts` for:

- strict frontmatter parsing and `Skill.Info` construction;
- duplicate-name registration;
- safe supporting-file closure/materialization;
- platform and required-tool eligibility;
- permission evaluation;
- fuzzy list/search and exact-name load;
- sampled supporting-file rendering.

Keep two explicit adapters:

- `Skill` owns current ordinary roots, built-ins, configured paths/URLs, manager metadata, and Expert Squad projection.
- `MissionSkillCatalog` owns only its generated built-in payload/cache, `Global.Path.config/mission-skills/**/SKILL.md`, and the active project `.opencorvus/mission-skills/**/SKILL.md`.

Mission Skill discovery refreshes once for the scope-keyed Composer catalog read and again when constructing a Mission turn surface. It performs no background polling or per-keystroke work. Overlay submission validates exact directives against its atomic snapshot; `/mission/wake` receives only the original visible text and optional Squad profile, not the snapshot or a hidden Mission Skill field. If files drift before the Mission turn, the freshly resolved surface makes the real `mission_skill` load fail visibly; it never falls back to the Overlay snapshot or ordinary Skill discovery.

The common resource-owner classifier is applied before any ordinary configured-path glob registers a Skill. A file beneath a canonical `mission-skills` owner directory is rejected by ordinary discovery even when `skills.paths` points at its parent. This is a data ownership boundary, not a route gate: each physical package has exactly one catalog owner.

The shipped `mirror-prism-cluster` becomes the first dedicated built-in Mission Skill:

- canonical author source: `packages/opencorvus/src/mission-skill/builtin/mirror-prism-cluster/**`;
- generated source: `packages/opencorvus/src/mission-skill/builtin-payload.ts`;
- runtime cache: a Mission-Skill-owned built-in cache distinct from ordinary Skill and Expert Squad caches;
- identity: frontmatter `name`, subject to the same strict collision check against global/project Mission Skills.

The move deletes `expert-squads/mirror/mirror-prd/skills/mirror-prism-cluster/**` and its `package_skill_refs` projection. All current artifact, SDK, package-test, README, and generated-payload references move in the same commit; no old-path alias remains.

### 2. Native Mission runtime surface

Generalize the executable Skill surface type so it is not structurally coupled to a projected Expert Squad identity. `ResolvedSkillSurface` is a discriminated union whose variants carry:

- family: `production | mission`;
- exact agent ID and session scope;
- tool availability and projected/role tool IDs;
- compatible and disabled Skill rows;
- catalog identity/digest needed for diagnostics.

`SkillMount.resolve()` continues to produce the `production` family after its current projection identity checks. `MissionSkillRuntime.resolve()` produces the `mission` family only after asserting these data-integrity facts:

- requested agent ID is `mission`;
- session kind is `mission`;
- the Mission role tool pool contains `mission_skill`;
- the available turn tool table still contains `mission_skill`.

Platform, permission, and `required_tools` checks are not surface-level preflight assertions. Every Mission Skill passes through the same eligibility evaluator as an ordinary mounted Skill and becomes an enabled or disabled row with an exact reason. Disabled rows remain excluded from search/exact load without making unrelated Mission Skills unavailable.

`createSkillLoaderTool({ id, directiveKind, surface })` becomes the one implementation for both families. It instantiates the existing `skill` tool for projected production surfaces and the new `mission_skill` tool for native Mission surfaces. Both use the current `skill` permission category, eligibility rules, exact-load result, and supporting-file materialization; tool availability and the injected catalog surface provide the authority boundary.

SessionLoop replaces the ordinary-only surface WeakMap/finalizer with one family-neutral turn finalizer. It is executed at both current call sites: initial turn construction and post-Structured-Output tool reconstruction. At each point it returns exactly one of `production`, `mission`, or no surface, binds only the matching deferred tool, removes the other family member, and passes the same union to `SystemPrompt.skills()`. `Tool.InitContext.skillSurface` accepts that union. A production surface still requires the projected runtime identity; a Mission surface rejects any non-Mission agent/session pair. `global-tools.ts` marks both family members deferred, and ToolRegistry defers both through one shared provider-state predicate. This is one surface dataflow and one loader implementation with two explicit authority-bearing tool IDs, not parallel finalizers or loaders.

### 3. Prompt and durable Mission behavior

The Mission Skill policy is added to the current turn system messages only when the Mission surface exists. It states:

1. Inspect the Mission Skill rows before planning.
2. For every exact visible `@mission-skill("<name>")`, call `mission_skill` with that exact name before writing the Mission contract, delegating, or using other execution tools.
3. Do not substitute ordinary Skills or a similarly named Expert Squad.
4. Load additional Mission Skills only when their descriptions materially match.
5. Preserve the loaded workflow's durable requirements in the existing `contract.md`, `frontier.md`, `tasks.md`, and `handoff.md`.
6. Coordinate cross-Squad stages by separate Mission-owned Tasks with fixed exact `promptProfile`; never switch a started Task between Squads.

This is prompt-level execution guidance over a real visible directive and tool result, not a host gate or auto-run hook.

### 4. Composer grammar and routing

The existing category list becomes:

1. Skill — `@skill`;
2. Mission Skill — `@mission-skill`;
3. Expert Squad — `@squad`.

Mission Skill reuses the existing cube/Skill row treatment with a distinct label and description: it orchestrates a Mission and may coordinate multiple Squads. It does not introduce a second popup, chip model, toolbar selector, or Mission mode.

The exact route decision is:

| Directives / launcher | Submission |
| --- | --- |
| one or more `@mission-skill`, no `@squad` | New Mission; omit `promptProfile` |
| one or more `@mission-skill` + one `@squad` | New Mission; pass exact Squad ID as `promptProfile` |
| `@squad` only | Existing new-Mission path |
| ordinary `@skill` only | Existing non-Mission route; adjacent defect remains separately tracked |
| multiple distinct `@squad` | Visible validation error; do not submit |

Change `ChatComposer.onSubmit` from positional Skill/Squad fields to one typed directives object, so explicit entity intent cannot be confused with the mode selector. The priority is:

1. Any explicit `@mission-skill` or explicit `@squad` takes the directive branch.
2. In that branch, only explicit `@squad` supplies `promptProfile`; a Mission-Skill-only submission omits it even when `composerMode="expert-squad"`.
3. With no explicit Mission directive, the existing Expert Squad launcher uses its selected `expertSquadID`.
4. Remaining launchers and Chat/session submission retain their current order.

The explicit branch runs before current Task/Session/Chat launcher handling, so an explicit Mission reference always starts a new Mission from any center-panel context, matching current `@squad` semantics without treating the toolbar selection as a hidden Squad directive.

### 5. Catalog read model

Do not make `PromptProfileResolver.catalog()` or the Expert Squad catalog route discover Mission Skills. Add a dedicated read-only `GET /mission-skill/catalog` route backed only by `MissionSkillCatalog` for the current project directory. Its OpenAPI response and generated SDK expose `mission_skills: [{ name, description, required_tools }]`; absolute locations, contents, and supporting-file lists are not sent to the browser.

Overlay builds one `ComposerReferenceSnapshot` per existing project/session scope key through one `{ key, promise }` in-flight owner. Every caller for that key awaits the same promise, which resolves the unchanged Expert Squad catalog and dedicated Mission Skill catalog in parallel. It publishes the snapshot atomically only when both responses still belong to the active key. A failed Mission Skill catalog request produces a visible reference-catalog failure instead of silently hiding that category, key changes isolate an older result, and typing never initiates another request. The two backend catalogs remain independent sources for different resource families; the Overlay snapshot is only their presentation join.

## Implementation plan

1. Add the shared Skill document/catalog/tool-surface kernel and move ordinary Skill parsing/search/load callers onto it without changing ordinary discovery or projection behavior.
2. Add `MissionSkillCatalog` with its own built-in payload/cache plus the two operator roots, strict duplicate identity, canonical resource-owner isolation, scope refresh, and isolation tests.
3. Extract `createSkillLoaderTool`, register both Skill-family tools through one deferred-provider predicate, and replace the ordinary-only SessionLoop surface flow with one discriminated-union finalizer used at both existing turn construction points. Keep projected `skill` semantics unchanged, instantiate `mission_skill`, bind it only to the native Mission agent/session, and parameterize the system Skill policy by directive/tool family.
4. Add the dedicated Mission Skill catalog route/OpenAPI/SDK and the atomic two-request Composer reference snapshot while keeping the Expert Squad route and `PromptProfileResolver.catalog()` unchanged.
5. Extend Composer mention kinds, exact serialization/parser, ranking, atomic editing, i18n, and the existing Kobalte-backed cascading menu with `@mission-skill`; replace positional submit arguments with one typed directives object.
6. Route any exact Mission Skill directive through the existing Mission branch before all Chat/task/session paths. Keep visible text intact; only an explicit exact Squad directive supplies `promptProfile`, regardless of current Composer mode.
7. Add the Mission Skill payload generator to `generate-build-artifacts.ts`, tracked generated artifacts, CLI generation, and freshness/document-health closure. Move `mirror-prism-cluster` from the Mirror PRD Expert Squad package into the dedicated built-in Mission Skill source, delete its package projection, regenerate both affected payloads, and update every current artifact/README/SDK/package-test caller found by the repository grep.
8. Prove the migrated Skill and a minimal fixture both load through a visible `mission_skill` result and can lead Mission to create correctly profiled child Task requests without host-owned step execution.
9. Update `specs/current/architecture/04-extensions.md`, `08-agent-tool-adapter.md`, product docs, OpenAPI, generated SDK, and document indexes only when implementation lands.
10. Run focused unit/integration tests, typechecks, OpenAPI/SDK freshness checks, Node-started desktop browser acceptance with light/dark screenshots, inspect the rendered menu and Mission transcript, then perform an independent second code review.

## Verification plan

### Discovery and isolation

- `packages/opencorvus/test/mission-skill/catalog.test.ts`
  - discovers only the dedicated built-in/global/project roots;
  - rejects duplicate names;
  - excludes ordinary roots/config paths/URLs and proves a broad ordinary `skills.paths` parent cannot swallow `mission-skills/**`;
  - proves `Skill.all()` excludes Mission Skills and `MissionSkillCatalog` excludes ordinary Skills.
- `packages/opencorvus/test/server/skill-routes.test.ts`
  - proves `/skill`, `/skill/installed`, and `/skill/mounts` never return Mission Skills.
- `packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`
  - proves Task production grants never include Mission Skills.

### Runtime and prompt

- `packages/opencorvus/test/session/runtime-contract-tools.test.ts`
  - preserves projected production Skill behavior;
  - proves Mission native binding does not fabricate a projected runtime contract.
- `packages/opencorvus/test/mission-skill/runtime-surface.test.ts`
  - Mission can search/load exact Mission Skills through `mission_skill`;
  - Chat/Coding/Control/Orchestrator/projected workers do not receive the `mission_skill` tool ID and cannot see names or content;
  - ordinary `skill` cannot load a Mission Skill and `mission_skill` cannot load an ordinary Skill;
  - wrong session kind/agent ID fails visibly;
  - required-tool/platform/permission failures disable only the affected row with the shared reason and do not reject the surface.
- Tool catalog/registry/schema tests:
  - both Skill-family tools are deferred and share one schema/result contract;
  - generic Registry initialization never initializes either tool without a resolved surface;
  - only Mission role visibility contains `mission_skill`;
  - projected tool closure and batch targets reject `mission_skill`;
  - real `SessionLoop.resolveTools()` runs prove initial and post-Structured-Output finalization produce one matching surface/tool/prompt for Mission, Chat, Coding, Control, and a projected worker;
  - a real Mission tool execution emits the visible Mission Skill result.
- `packages/opencorvus/test/session/system-skill-directive.test.ts`
  - Mission uses `@mission-skill`, production agents use `@skill`, and prompts do not cross-contaminate.
- `packages/opencorvus/test/mission-skill/orchestration.test.ts`
  - real visible load result precedes Mission planning/delegation;
  - loaded contract uses existing Mission state and exact child `promptProfile` values;
  - Mission state survives context compaction without an `active_mission_skill` field or hidden replay message.

### API, SDK, and routing

- `packages/opencorvus/test/server/mission-skill-routes.test.ts`
  - the dedicated route returns only summaries for the strict current-project Mission Skill catalog;
  - OpenAPI and SDK use the dedicated response type and do not change the Expert Squad response.
- `packages/opencorvus/test/mission/wake-route.test.ts`
  - original visible directives are preserved; no new hidden Mission Skill field exists.
- `packages/overlay/test/composer-mention.test.ts`
  - three kinds, exact hyphenated directive, escaping, de-duplication, multiple-Squad rejection, and atomic editing.
- `packages/overlay/test/composer-mention-ui.test.ts`
  - Mission Skill enters the first Mission branch and ordinary `@skill` does not;
  - Mission-Skill-only input in `expert-squad` mode omits `promptProfile`, while an explicit combined `@squad` supplies it and a directive-free launcher preserves the selected profile;
  - one scope snapshot performs one Expert Squad request and one Mission Skill request, publishes atomically, performs no typing-time request, and exposes a visible failure rather than a partial fallback.
- OpenAPI/SDK freshness:
  - `bun run api:routes-check`;
  - generated SDK type/build tests covering `mission_skills`.
- Generated Mission Skill payload:
  - generator rejects duplicate names, invalid frontmatter, and unsafe/incomplete supporting-file closures;
  - tracked payload freshness proves `generate-build-artifacts.ts`, `generated-artifacts.ts`, `generate.ts`, and document-health agree;
  - `mirror-prism-cluster` exists only in the new Mission Skill payload and is absent from the Expert Squad payload/projections.

### Real desktop browser evidence

Node-started Playwright must:

1. Open the real Composer at desktop size.
2. Type `@`, navigate all three categories, and select a Mission Skill.
3. Verify exact visible `@mission-skill("...")`, caret navigation, deletion, focus, and IME-safe behavior.
4. Submit from Chat and from an existing Task/Session context.
5. Record exactly one `POST /mission/wake`, zero Chat/session submission requests, and an omitted `promptProfile` for Mission-Skill-only input.
6. Repeat Mission-Skill-only submission while the Composer is in Expert Squad mode and still record an omitted `promptProfile`; then submit a combined Mission Skill + Squad input and record the exact Squad manifest ID.
7. Hydrate the Mission conversation and prove the visible `mission_skill` tool call/result.
8. Capture and inspect light/dark screenshots of the three-category cascade and Mission transcript without altering the user's running process.

### Documentation and repository health

- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- corresponding current-architecture/document-health tests when implementation updates living docs
- focused Overlay typecheck/i18n/build
- focused OpenCorvus typecheck
- `git diff --check`

## Non-goals

- No runtime, UI, API, SDK, generated-payload, test, or package-source implementation in this planning turn.
- No Mission Skill marketplace, remote registry, ZIP installer, update service, or Settings management UI in the first runtime slice.
- No Mission Skill market/manager lifecycle is added. The first slice ships only the migrated `mirror-prism-cluster` built-in plus test fixtures; additional domain Mission Skills remain separately authored packages.
- No automatic Squad selection from Mission Skill name/content.
- No new Mission database columns, active workflow field, Task workflow state, or scheduler.
- No ordinary Chat `@skill` authority repair hidden inside this feature.
- No mobile/tablet/responsive work.

## Progress

- [x] Inspect current Skill discovery, projection, tool, prompt, and manager ownership.
- [x] Inspect Composer mention grammar/catalog/routing and Mission wake/session ownership.
- [x] Identify the native-session Skill-surface gap and ordinary `@skill` adjacent defect.
- [x] Record the Mission Skill architecture and acceptance plan.
- [x] Incorporate independent Agent review and close all five blockers.
- [x] Obtain final independent acceptance after correcting the two factual path/scope findings.
- [x] Validate documentation links and format-check the final plan.
- [ ] Commit and push the task-owned plan to `myhexin`.
