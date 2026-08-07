# 2026-07-10 Dynamic Expert Squad Agent Identity

Status: registry, immutable Prepared resource closure, exact external provider projection, task-loop ownership, Wake/message identity, runner lifecycle/abort, Build runtime-ready, Fact Check, continuation, A2A, and portable-template slices are independently accepted. Real package/payload migration and catalog/overlay/prompt cleanup remain in progress.

## 2026-07-12 Overlay Card And Screenshot Identity Recall

- User requirement: every projected worker key remains the runtime identity; `base_role` and derived stage are template/display metadata only.
- Acceptance: ordinary agent cards retain exact `agentID`; timeline regrouping cannot merge different dynamic identities; Screenshot Browser owner keys and labels use `agentID`, while stage remains the visual-role seed; user messages never receive a fabricated agent identity.
- Hard constraints: no role/agent fallback, no goal-phase/revision card restoration, no compatibility alias, and no synthetic identity.
- Sources reread: this record's Recall and acceptance criteria; `packages/overlay/src/services/tree-writer.ts`; `store/card-tree.ts`; `utils/screenshot-browser.ts`; `components/ScreenshotBrowserPanel.tsx`; current Controls and Screenshot Browser Node fixtures.
- Whole-repository call search: `rg -n "ensureMessageTurnProjection|createSessionCardNode|collectScreenshotBrowserItems|ownerKey|agentID|author" packages/overlay/src packages/overlay/test packages/opencorvus/src/conversation packages/opencorvus/test/server`.
- Evidence: the real Node browser test produced `build:session:ses_build_screenshot_browser` where the obsolete fixture expected a goal revision key. Source review proved the current owner still begins with normalized stage `build`, and `CardNode` has no `agentID`; this loses `implementation-engineer` before Screenshot Browser grouping.
- Independent-agent status: the prior Overlay review rejected base-role/phase residue and required ordinary agent cards. This correction preserves that disposition; it must be resubmitted to the same independent reviewer after implementation and focused Node browser verification.

### Independent Review Rejection And Corrected Identity Boundary

- The independent reviewer reproduced a child-session participant/worker identity collision: a real `role=user, author=user, channel=<worker stage>` turn was treated as an agent turn because code classified only by stage. It wrote `SessionInfo.agentID="user"`, then the next real projected worker reply failed with an identity-drift error.
- Hydration ignored the canonical projected `agentID` carried by the conversation view and reconstructed card identity from transcript `author`. A legacy/base-role author could therefore re-enter as runtime identity despite a different exact view identity.
- `ConversationAgentView` silently filtered a runtime session with no `agentID`; its tests supplied `agentID ?? stage` and `resolvedRole/channel` fallbacks, hiding the broken contract.
- Screenshot owner keys and DOM identity are correct, but goal-revision group headers make the revision label primary and expose the dynamic identity only through a tooltip. The visible group title must keep the exact agent ID primary and show the revision as secondary metadata.
- Corrected invariant: participant role decides whether a message is a user turn; canonical projected identity comes from the required view/session `agentID`; transcript author is a participant/evidence field that must agree for agent turns and must never create or override session identity. Missing or mismatched identity fails before any card/session/index mutation.
- Required tests: direct user reply followed by the real agent on one session; hydrate identity mismatch and missing session identity; two same-base-role agents through live/hydrate/regroup; tree-writer screenshot failure with no partial mutation; visible goal screenshot header retains exact dynamic identity; test helpers contain no stage/channel identity fallback.

### 2026-07-12 Expanded Identity Matrix Review Rejection Recall

- User requirement retained: `capability_projection.agents.<agentID>` is the exact runtime and projection identity; `base_role`, session kind, channel, and stage are template/display metadata only. No missing identity may be inferred from another field.
- Acceptance for this correction: message, part, lifecycle, hydrate, recovery, cache, screenshot, and browser fixtures all carry explicit canonical `agentID`; test helpers reject missing author/agentID instead of filling them; lifecycle projection requires event-owned channel/agentID and rejects drift before mutation; consecutive dynamic-worker boundaries retain the runtime template display role without replacing the dynamic owner.
- Hard constraints: no production or test fallback, no author-as-agent projection, no weakening the strict bridge/tree-writer checks, no phase/workflow topology restoration, and no compatibility aliases.
- Sources reread: this record's Recall and prior review rejection; `tree-writer.ts`; `conversation-agents.ts`; `screenshot-browser.ts`; message bridge/session mirror; the projection-primitives, stats-cache, message-tokens, hydrate/recovery/events, chronological browser, and timeline-order fixtures named below.
- Whole-repository searches rerun before editing:

```powershell
rg -n "agentID\\s*\\?\\?|agentID\\s*\\|\\||author\\s*\\?\\?|author\\s*\\|\\||info\\.author.*agent|agent.*info\\.author" packages/overlay/src packages/overlay/test packages/opencorvus/src/conversation packages/opencorvus/src/orchestrator/protocol packages/opencorvus/src/protocol
rg -n "lifecycleStageFromProps|ensureLifecycleSessionProjection|session.status|session.error|session.idle" packages/overlay/src/services/tree-writer.ts packages/overlay/test
rg -n "stampTestTranscript|stampTestViewMessages|stampTestViewSessions|stampedInfo|stampedPartEvent|agentID: String\\(info\\.author\\)" packages/overlay/test
```

- Independent reviewer confirmed the original three production P1 paths are fixed, message bridge/session mirror and Screenshot Browser exact identity paths pass, and production workflow/phase topology is gone. The expanded matrix remains rejected: 52 directed tests fail because adjacent fixtures omit canonical identity, the chronological Node browser test times out, and `tree-writer.ts` lifecycle projection still recovers missing channel/agentID from existing session state.

| Rejected call-point cluster | Required correction |
| --- | --- |
| `tree-writer.ts` lifecycle projection | Require event-owned channel and agentID for every non-filtered lifecycle event; reject existing-session identity/stage drift; never recover either value from `SessionInfo`. |
| `tree-writer-projection-primitives.test.ts` | Make message and part-event helpers accept and stamp explicit agentID/author. |
| `tree-writer-stats-cache.test.ts` | Add explicit message/session agent identity so all cache/stat assertions execute against the current protocol. |
| `tree-writer-message-tokens.test.ts` | Delete author/agent fallbacks and provide explicit transcript/view/session identities. |
| `selected-task-recovery.test.ts`, `events-refresh.test.ts`, `conversation-hydrate-replay.test.ts` | Stamp explicit lifecycle/message/part/hydrate identity; retain fail-loud negative cases as explicit malformed inputs. |
| `fixtures/timeline-order.ts` | Shared fixture helpers must validate explicit author, agentID, view-session identity, and part route metadata rather than fabricate them. |
| `browser/message-card-chronological-turns-browser.test.ts` | Add exact message/view/session identity and rerun through the formal Node browser runner. |
| `goal-group-benchmark.ts` | Read and validate `info.agentID`; never derive view identity from participant author. |
| `tree-writer-hierarchy.test.ts` | Remove helper-level author/resolvedRole fallback and add a dynamic build boundary assertion. |

## 2026-07-11 Continuation Recall

### 2026-07-12 Catalog Contract Review Recall

- Independent catalog review reproduced a dual identity source in `catalogProfileFromPackage`: the helper accepted a caller-provided `id` while the same response and declaration hash used the manifest-owned package `id`. The helper will no longer accept an identity argument; catalog identity comes only from the validated package manifest.
- Whole-repository search found `capability_profile_id` duplicated the same expert-squad manifest identity in catalog summaries, active skill projection, and skill-mount matrix/surface DTOs. Production Overlay has no consumer. The alias will be deleted from all three current surfaces and their generated Software Development Kit types rather than equality-checked or retained for compatibility.
- Independent review also found the final-candidate model-reference validator covers six project config families but only runtime-template rejection had a real persistence regression. The route slice is not accepted until top-level `model`, `small_model`, fixed native agent, runtime template, exact projected agent, and command model references all have real HTTP rejection/no-write evidence, and session PATCH has equivalent effective-candidate rejection/no-overlay-write evidence for its permitted model-bearing surface.
- Full call-point searches run before this correction:

```powershell
rg -n "catalogSummaryFromPackage|capability_profile_id|active_skill_projection|PromptProfileCatalogProfileSchema|CatalogProfile" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test packages/sdk/js/src specs
rg -n "catalogProfileFromPackage\(|catalogSummaryFromPackage\(" packages/opencorvus/src packages/opencorvus/test
rg -n "validateConfigModelReferences|small_model|runtime_templates|expert_squads|command.*model|agent\..*model|unknown model|invalid model" packages/opencorvus/src packages/opencorvus/test
```

| Reviewed call point | Disposition |
| --- | --- |
| `agent/prompt-profile.ts` catalog schema | Delete `capability_profile_id`; `id` is the manifest expert-squad identity. |
| `expert-squad/catalog-profile.ts` | Delete caller `id`; derive response identity and diagnostics from `pkg.id`. |
| `expert-squad/catalog.ts` active skill schema | Delete duplicate `capability_profile_id`; keep `active_squad_id`. |
| `skill/mounts.ts` matrix and resolved surface | Delete duplicate `capability_profile_id`; keep `active_profile`. |
| Resolver catalog assembly | Pass only the package and source kind; discovery keys remain collision/index evidence, not an identity input. |
| Overlay and route fixtures | Remove the retired field and continue parsing the strict current schemas. |
| Generated OpenAPI/JavaScript SDK | Regenerate after schema deletion; do not hand-edit generated output. |
| Config/session model validation | Add real HTTP rejection and persistence invariants for every schema-permitted model-bearing family. |

### 2026-07-12 Fixed Prompt Identity Review Recall

- Independent facade-removal review reproduced an identity-domain collision: `PromptCatalog` enumerated fixed Primary/Helper identities but delegated each entry to `PromptProfileResolver.resolvePromptCatalogEntry`. A valid dynamic worker named `coding` therefore injected its Build-template overlay into the fixed Primary Coding assistant catalog entry.
- Fixed identity names and dynamic projection IDs intentionally occupy different registries. String equality cannot create inheritance or ownership across those domains. Primary/Helper prompt defaults and configured override/append values are the complete fixed prompt catalog source; dynamic worker prompts remain available only through exact projected worker resolution.
- Whole-repository search found `resolvePromptCatalogEntry` has one production caller and two direct legacy test calls. `PromptCatalog.list({ projectDirectory })` has one production caller. All will be removed rather than guarded by reserved names or a conditional fallback.
- `composeResolvedAgentPrompt` remains the exact dynamic scheduler/worker composition API because projected runtimes consume a resolved capability object; only the name-probing catalog facade is deleted.
- Third-round review found the deleted facade left an exported zero-consumer `PromptInput` type and that the fixed system-prompt lookup returned an empty string for an unknown key. The dead type is deleted; static system metadata owns its required default prompt directly, while public unknown-key resolution remains an explicit `undefined` result.

```powershell
rg -n "resolvePromptCatalogEntry|PromptCatalog\.list|profilePrompt|profile_prompt" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test
rg -n "ComposeInput|PromptCatalogEntryResolution" packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts packages/opencorvus/src packages/opencorvus/test
rg -n "PromptCatalog\.list\(\{" packages/opencorvus/src packages/opencorvus/test
```

| Reviewed call point | Disposition |
| --- | --- |
| `config/prompt-catalog.ts` | Compose only registry default plus the fixed identity's configured override/append; `profile_prompt` remains null as an explicit API statement. |
| `PromptProfileResolver.resolvePromptCatalogEntry` | Delete the name-probing facade and its private input/output types. |
| Session-effective `/config/prompt` | Pass only the effective config; project directory is irrelevant to fixed prompt identities. |
| Role-contract tests | Delete direct facade assertions; add a real package whose dynamic worker ID is `coding`, prove its worker overlay resolves, and prove fixed Coding remains unchanged. |
| Invalid package-resource prompt route test | Replace the obsolete expectation that fixed prompt catalog parses dynamic package resources with isolation evidence; runtime/catalog surfaces retain strict package validation. |

- The six repository source packages now contain 58 unique dynamic agent IDs, no ID equals its `base_role`, canonical `agents/<agentID>/` directories and refs agree, and an independent read-only review found no semantic package defect. Source/registry/manager/protocol/bundle evidence is 100 pass, one intentional skip, zero fail. The only pending payload closure check is the tracked-input assertion, which must be rerun after the intended renames and MirrorTest `lib/` files enter the Git index.
- Overlay production catalog types had drifted from generated OpenAPI: the hand-written response exposed `virtual_agents`, `projected_agents`, `dynamic_attributes`, and `skills[].mounted_agents`. The current implementation replaces that response type with SDK `ExpertSquadCatalogResponse`, enumerates summary agents only from `capability_projection.agents`, and renders active rows by `agent_id` with `base_role` as template metadata.
- A whole-file run of `test/expert-squad/prompt-profile-resolver.test.ts` produced 12 pass, 45 skip, and 33 fail under the 120-second inactivity wrapper. Failures cluster around removed `manifest.agents`, `virtual-agents/**`, `dynamicAttributes`, package workflow/default-workflow assertions, local-process MCP fixtures, base-role worker IDs, removed resolver result fields, missing exact Orchestrator projection, and missing Instance context.
- Current replacement coverage already exists in `dynamic-agent-registry.test.ts`, `dynamic-agent-resolver.test.ts`, `projection-hash.test.ts`, `package-tool-bundle.test.ts`, `skill-mount-projection.test.ts`, repository package tests, and focused runtime/runner/A2A tests. The legacy resolver file must retain only unique current catalog/selector/inactive-isolation/hash/provider rejection coverage, migrated to dynamic agent fixtures. Tests whose only subject is a deleted schema, virtual root, workflow policy, result shape, or base-role runtime identity are deletion candidates; production compatibility code is forbidden.
- Local `dev` is the only available branch matching the user's comparison baseline; `myhexin` has no `dev` ref. `git diff --numstat dev --` currently reports 889,365 additions and 529,235 deletions across 7,009 paths. Generated SDK/OpenAPI account for a material portion, while large handwritten orchestrator/tests/resolver files and tracked QA/spec artifacts require later reachability and provenance review rather than line-count-based deletion.
- Overlay continuation audit proved the dynamic Tool projection renderer exists as `ToolsPanel`, but it is not registered in the single `CONFIG_SECTIONS` settings source. The only browser coverage still targets the retired, unreachable left `ExtensionActivityPanel`. The accepted correction is to register Tool as a normal Settings section, render the existing panel through `ConfigDialogHost`, delete the unreachable combined activity component, and rewrite the browser proof against the real Tool/Skills/MCP settings pages. Reintroducing the retired left activity or keeping both entrypoints would violate the single-source constraint.
- Independent prompt/domain review accepted the production prompt relocation but blocked closure on four residual surfaces: `test/tool/skill.test.ts` still assumes implicit/base-role mounts and production selector discovery; the full pre-terminal reflection hook is mock-only dead code carrying ambiguous `agentName`; several generic prompt invariants were deleted with domain-specific assertions; and document health still guesses `agents/build` / `virtual-agents/build` while requiring retired mount fields. Whole-repository call search confirms `SkillTool` now requires a turn-resolved `skillSurface`, selector use is independently covered by `expert_squad_selector`, no production caller supplies `takePreTerminalReflection`, `preTerminalToolInputStart`, or either optional reflection callback, and the live terminal reminder is separately covered in `terminal-tool-recovery.test.ts`. The accepted disposition is current-surface SkillTool tests, deletion of the unreachable reflection chain, restoration of concise generic prompt invariants, manifest-driven dynamic prompt-path health checks, and explicit selector-versus-production-grant documentation.

## Recall

### User Request

- Thoroughly refactor the external expert-squad agent schema and runtime projection.
- Remove the previous design's remaining assumption that `base_role` is the runtime agent identity.
- Make each key under `capability_projection.agents.<agent_id>` the dynamic agent identity used by dispatch, runtime messages, tools, skills, MCP, catalog, and mounts.
- Keep `base_role` only as the seed for an existing OpenCorvus agent/model/tool/session/finalizer/runtime template.
- Remove non-general preset prompt residue and prove package loading through registry, resolver, dispatch, runner, catalog, mounts, payload, and template paths.
- Continue autonomously until tests and independent reviews find no known issue; commit and push to `myhexin`.
- After the core refactor passes, compare against `dev` and perform a repository-wide reachability/debt audit. Remove proven legacy code, obsolete tests, and tracked intermediate/generated residue rather than accepting the branch's large net line growth.

### Acceptance Criteria

1. `capability_projection.agents.<agent_id>` is the only dynamic agent definition and identity source.
2. `base_role` is required and selects only a core-owned runtime template. No consumer may reverse-map a base role to an agent ID or accept a base-role target unless that exact key is declared.
3. Multiple agent IDs may share one `base_role` without collision, overwrite, or default selection.
4. External manifests remain `schema_version: 1`; v1 is replaced in place. There is no compatibility parser or v1/v2 branch.
5. The manifest has no duplicate agent identity or free-form runtime-policy surfaces: remove `team`, package-defined `workflow`, `workflow.dispatch_targets`, package-defined `primitive`, top-level `agents`, `virtual_agents`, and `dynamic_attributes`.
6. A worker projection contains its own required `label`, optional `description`, optional canonical prompt path, base-role seed, and projected tool/skill/MCP refs. Its canonical resource root is `agents/<agent_id>/`.
7. The scheduler remains the fixed host identity `orchestrator` and is configured only by `capability_projection.scheduler`; worker key `orchestrator` and worker `base_role: orchestrator` are rejected. Worker key `shared` is also reserved because the second package-ref segment `shared` exclusively denotes top-level shared resources.
8. `AgentRoleContract` is the only `baseRole -> sessionKind/dispatchAdapterID` authority. Every worker `base_role` must expose both values there; adapter implementation schemas/handlers and finalizers remain runtime code, not package data.
9. `dispatch_agent.target` literals are dynamic agent IDs. The internal handler is derived exactly once from that agent's `base_role` template.
10. Runner accepts a required dynamic `agentID`, resolves capability first, and derives `baseRole` and `sessionKind` from the resolved projection plus `AgentRoleContract`. Persisted user/assistant messages, worker descriptor, runtime contract, tool context, package tools, skills, MCP, A2A requests, continuation, wake, and redispatch retain that agent ID; model/core prompt/default tools/session lifecycle/finalizer use the derived template.
11. Catalog and skill-mount surfaces enumerate every declared worker projection, including agents without prompt overlays; no virtual-agent-only filtering or native-agent fallback remains.
12. Package resources are owned by the projection key. Unknown owners, orphan agent directories, unprojected agent-local resources, and missing mounts fail explicitly.
13. Real packages and the portable template use non-base-role agent IDs; at least two agents share `base_role: build` and remain isolated across prompt/tool/skill/MCP/hash/dispatch.
14. Generic prompts contain only system responsibilities and projection/dispatch protocol. Domain-specific frontend, replica, testing, benchmark, or product policy lives in the relevant expert-squad package.
15. Registry, manager, resolver, dispatch, runner, catalog, mounts, routes, payload freshness, template freshness, docs health, typecheck, and diff checks pass under stdout/stderr inactivity timeouts.
16. Tests that measure timeout from process/test start, while observable work continues, are repaired before being used as evidence.
17. After benchmark success, a second source review and independent agent review find no base-role identity fallback, same-name guessing, duplicate schema source, stale legacy test, or unexplained generated/intermediate artifact.
18. The final commit uses the `dsw-33987` prefix and is pushed to `myhexin/v0.0.2beta` without bypassing hooks.

### Hard Constraints

- No fallback, compatibility alias, name guessing, inactive package scan, hidden state, host gate, or second active expert-squad field.
- `prompt_profile.active` remains the only active expert-squad selection source.
- `PromptProfileResolver` remains the only effective package projection surface.
- Expert squads do not define a second workflow, dispatch engine, task state machine, context packet system, session kind, finalizer, or host tool ABI.
- Collaboration recommendations belong in README/selector/agent prompts and are executed by the Orchestrator through real tool calls.
- Do not create a worktree or restart/refresh/kill a running OpenCorvus/overlay process.
- Preserve unrelated dirty worktree changes. Do not use broad reset/restore/checkout operations.
- The user explicitly authorized removal of code/tests/intermediate files proven to be legacy or erroneous residue of this architecture. Unrelated or unproven files are not deletion candidates.
- Every implementation slice requires tests and an independent review before the next slice is accepted.

### Sources Read

- `AGENTS.md`
- `packages/opencorvus/test/AGENTS.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `C:/Users/chuan/.codex/skills/benchmark-debug-template/SKILL.md`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-06-agent-base-runtime-contract-projection.md`
- `specs/records/2026-07/2026-07-06-expert-squad-decoupling-agents-rule.md`
- `specs/records/2026-07/2026-07-06-expert-squad-formal-contracts.md`
- `specs/records/2026-07/2026-07-07-dispatch-agent-projected-target-schema.md`
- `specs/records/2026-07/2026-07-07-packaged-expert-squad-plugin-runtime.md`
- `specs/records/2026-07/2026-07-09-external-expert-squad-schema-base-role.md`
- `specs/records/2026-07/2026-07-09-preset-prompt-expert-squad-boundary-cleanup.md`
- `specs/records/2026-06/2026-06-23-agent-skill-mount-matrix.md`
- Current registry, resolver, catalog, agent contracts, runner, session loop/identity/wake, workflow, orchestrator tools, mounts, package manager/payload, template generator, manifests, fixtures, routes, and focused tests.

### Whole-Repository Search Evidence

The following inventories were run before this corrected plan:

```powershell
rg -n "ExpertSquadRegistry|ExpertSquadPackageManager|PromptProfileResolver|expert-squads|expert-squad\.jsonc|prompt_profile\.active|select_expert_squad|active_skill_projection|capability_projection" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test specs/current specs/records
rg -n "loadEmbeddedPackage|EmbeddedPackageSource|renderSelectorSkillMarkdown|discover\(|loadPackage\(|loadSourcePackage\(|importDirectory\(|importArchive\(|exportArchive\(|payload|seed|release" packages/opencorvus/src packages/opencorvus/test
rg --files .opencorvus/expert-squads packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad packages/opencorvus/test/server packages/overlay/test
rg -n "base_role|baseRole|projectionID|projection_id|virtual_agents|virtualAgents|dispatch_agent|workflow_tool_name|agentKind|SessionAgentIdentity|WorkerTurnDescriptor|resolveWorkerCapability|activeAgentProjection" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test .opencorvus specs/artifacts
rg -n "manifest\.team|manifest\.workflow|explicitSchedulerDispatchTargets|workflowsFromManifest|defaultWorkflow|agentProjectionForBaseRole|agentProjectionBaseRoleSet" packages/opencorvus/src packages/opencorvus/test
```

Call-point disposition:

| Concern | Current consumers | Corrected disposition |
| --- | --- | --- |
| Manifest agent identity | registry, resolver, catalog, mounts, manifests, fixtures | One map: `capability_projection.agents`; remove all parallel identity maps. |
| Dispatch adapter | WorkflowRegistry-derived bindings, manifest primitive, orchestrator tool schemas | Core-owned base-role dispatch adapter is the only source; package primitive is removed. |
| Runtime identity | runner `agentName`, runtime `agentKind`, message agent, session kind, descriptor | Persist `agentID` separately from `baseRole` and `sessionKind`; rename misleading `agentKind`. |
| Prompt/resource owner | `agents`, `virtual_agents`, `agents/`, `virtual-agents/` | Projection entry plus `agents/<agent_id>/`; remove the virtual resource root. |
| Catalog/mount identity | projection ID, base role, virtual ID, native agent clone | Enumerate resolver projections by `agentID`; base role is display/seed metadata only. |
| Workflow | engine registry plus newly added package workflow | Keep engine workflow as advisory/core lifecycle data; packages carry prose collaboration contracts only. |

### Independent Agent Feedback

- Schema audit found five identities for one agent: projection key, team member, workflow target, top-level agent key, and virtual-agent ID. `team` duplicates projection keys, `primitive` is validated to equal the base-role binding, and `virtual_agents.<id>.id` is forced to equal the projection key. These fields add no independent information and must be deleted rather than cross-validated further.
- Runtime audit proved the partial implementation is broken: runner persists dynamic identity in descriptor/runtime contract but sends the base role in `SessionPrompt`; the session loop then rejects the mismatch. Wake, session routes, task API, tool context, A2A, and redispatch also reconstruct identity from session kind/base role.
- Both audits found catalog and mounts incomplete: catalog enumerates only virtual agents, while mounts contain `?? input.agent` fallback and a special general-profile source.
- Both audits found the portable generator/artifact drifted, old runner tests assert the opposite of the goal, and current typecheck has five related errors.
- One audit proposed retaining a simplified package workflow DAG. This plan rejects that recommendation for this phase because the user explicitly challenged free workflow semantics and repository rule 15.1 forbids expert squads from creating a second workflow/dispatch system. Agent identity and runtime projection must first converge on one source; collaboration remains model-visible package guidance over the existing kernel tools.
- Collaboration agent creation later failed because the local Codex access token could not refresh. Two already-running independent audits completed successfully. Later review rounds must use a healthy collaboration agent or locally invoked Codex/Claude reviewer; authentication failure is not accepted as review evidence.
- A second independent plan review initially blocked implementation on seven gaps: dispatch-adapter authority, free-form dynamic attributes, runner `kind` as a second role source, runtime identity aliases, implicit projected/native SessionPrompt selection, workflow capability gating, and incomplete projection-hash inputs. The amended contract closes all seven. The reviewer then confirmed that no blocker remains and explicitly accepted entry into the schema slice, with the continuing condition that WorkflowRegistry adapter references remain advisory and one-way only.
- Registry closure review found and then verified fixes for the reserved `shared` owner namespace, non-`ENOENT` filesystem error propagation, orphan files in skill grouping directories, package `lib` reachability, and catalog/source/installed loader equivalence. The final registry-local review found no remaining blocker; the resolver must consume the prepared bundle and snapshot without rebuilding it.
- A separate test review classified and removed legacy virtual-agent, package-workflow, and top-level-agent tests while preserving the unique README, selector, discovery, path, tool-ID, MCP, and MirrorTest protocol negative coverage. Focused registry/identity/package-tool tests pass under the no-activity wrapper; the whole-package typecheck currently has only the separately owned missing `Message.get/stream/parts/latestAcrossSessions` errors in the dirty worktree.
- The structured resolver-entry review verified that scheduler and worker capabilities expose only `{ ref, providerName }` entries, with package tools additionally carrying the exact prepared bundle used by hashing and execution. A repeated `package_tool_refs` regression now proves the one-to-one constraint fails explicitly; the reviewer independently reran it at 2/2 passing and accepted the slice. The next resolver slice must remove MCP/package reloads, absolute-path fingerprints, declaration-order-sensitive hashes, and duplicate active-package loads before aggregate projection can be accepted.
- Two independent Prepared-closure reviews accepted the final resource graph after adversarial mutation, relocation, and runtime-drift checks. Package skills are strict single-file snapshots, package tools execute the exact compiled content-addressed bundle, and package MCP supports only frozen remote declarations. The final review found and verified the last boundary defect: package declarations now reject local processes, blank/malformed/non-HTTP(S) URLs, and the redundant `enabled` policy at direct parse plus source/installed/catalog loader boundaries. The accepted evidence is 101 focused tests, zero failures, passing TypeScript typecheck, and scoped `git diff --check` under the inactivity runner. Canonical hash, selector/production separation, and single active-package load remain explicitly unaccepted until the next slice review.
- Independent selector/mount review proved that the remaining mixed `ResolvedSkillProjection.skills` array is not repairable by filtering names. It combines selector entries, all `Skill.all()` inventory, implicit directory-owner package skills, manifest grants, and raw `mounted_agents`. The same mixed array feeds catalog, SkillMount, SystemPrompt, and SkillTool. A bare `mounted_agents: string[]` also leaks across two expert squads that declare the same dynamic `agentID`, while the current `sessionID` mutation still writes project `SKILL.md` and therefore does not implement session scope.
- The corrected skill model has four disjoint values: ordinary skill inventory, manifest production grants, operator mounts, and selector skills. Manifest grants come only from explicit projection refs. Operator mounts are core-owned and qualified by `expertSquadID`, dynamic `agentID`, real project/session scope, and a canonical default-skill ref. Selector skills use a separate selection surface and digest; they are never production grants, mounts, worker/scheduler hashes, or generic `Skill.Info` inventory. The old `mounted_agents` field cannot be migrated by base-role or same-name inference and must be rejected and removed rather than interpreted compatibly.
- Storage review selected the existing project-config plus root-session overlay machinery, subject to two non-negotiable boundaries before acceptance: non-project config sources must reject mount state so global/managed/inline config cannot leak mounts across projects, and every write entry point must share the same structural validator. Boolean leaves under `skill_mounts.<expertSquadID>.<agentID>.<defaultSkillRef>` provide explicit grant/revoke overlay semantics and avoid array read-modify-write loss; effective runtime validation still rejects unknown squads, agents, and skill refs.
- Codex review feedback for the SkillTool/runtime slice rejected the first implementation because broad `stageOwnedToolIDs` bypassed active package projection, Frontend Design omitted the manifest-projected source-project and Innovate competitor implementations, Visual QA retained a stale barrel export, `default_tool_refs` accepted unknown IDs until execution, and projected/default/stage authorities could overlap. The review also found that an absent runtime contract was misclassified as projected, runner template lookup was conditional on prompt mode, and SessionLoop re-resolved skills from the child worktree instead of consuming the turn-owned project snapshot.
- Codex review revision separates base built-ins, canonical default host tools, and per-run stage ABI tools; preserves canonical default tool names at execution; rejects unknown refs and every authority overlap; makes runner base-template lookup unconditional; and installs the exact worker/scheduler skill projection plus authoritative project directory in the runtime contract. SessionLoop consumes that installed snapshot and treats an absent contract as an ordinary native primary session, while the explicit native runtime-contract branch remains reserved for Explore.
- A fresh independent recheck found one remaining scheduler snapshot split: `processTask` resolves `resolveSchedulerTurnProjection`, but `buildSystemParts` still called `composeAgentPrompt`, which reloaded the active package before composing the same wake's prompt. The revision passes the already-resolved scheduler capability and authoritative project directory into `buildSystemParts`, composes only with `composeResolvedAgentPrompt`, and adds a real wake regression proving one turn projection resolution and zero legacy prompt re-resolution calls.
- The phrase `non-executor source boundary` was also proven misleading because Requirements, Architect, research, and design agents still execute assigned work. The base-role template policy is now named `broadProjectSourceWork`, and the injected prompt is the `Scoped Project Source Boundary`; dynamic agent IDs never participate in that template-policy decision.
- The external projected-provider contract slice was independently reviewed twice. The first review rejected shallow freezing and `Omit`-based generic-tool leakage; the revision snapshots and recursively freezes tool definitions and schemas, rejects forged shallow-frozen surfaces, uses `tools?: never` / `toolMode?: never` at the type boundary, and repeats those checks at runtime for both run and resume. The independent re-review accepted the slice with 7 passing tests, 25 assertions, and a passing full typecheck. This acceptance covers only the immutable exact-provider contract; it does not accept the external Build execution path.
- The first independent runtime-adapter review accepted the `session-loop | external-coding` discriminator direction but blocked the implementation on three concrete issues: resume reused an invocation-scoped assistant message, SessionLoop rejected external contracts only after side effects, and descriptor/runtime/surface/provider/task/terminal evidence was not cross-validated. The revision now rejects immediately after `Session.get` and before start/status/control/compaction work; external runtime tools exist only under one frozen surface; resume loads the descriptor named by the runtime contract rather than `latestForSession`, rebinds the same callback functions and bijection to a new assistant message, and rejects provider-adapter instance replacement. A second independent re-review is pending before this slice can be accepted.
- Independent Claude SDK source review proved `allowedTools` is an auto-allow list and can bypass `canUseTool.toolUseID`; exact mode therefore uses `tools: []`, `settingSources: []`, empty allowed/disallowed lists, default permission mode, inline `permissions.ask` for every exact provider name, and one task-owned in-process MCP server. The same review experimentally proved `createSdkMcpServer.tools[].inputSchema` loses AI JSON schemas, so the revision registers raw MCP list/call handlers and validates the frozen JSON schema with AJV (Another JSON Schema Validator). The adapter maps deterministic local/provider names through an explicit bijection and correlates permission, callback, event, and result IDs. A second independent adapter review is pending.
- Current focused evidence after these revisions: 50/50 runtime-contract and extra-tool tests pass; 16/16 projected-contract and Claude SDK option tests pass; the dynamic external Build identity test passes; and full package TypeScript typecheck passes. The complete Build runtime file still contains legacy resume fixtures that install empty or generic external contracts; those tests are being split into honest SessionLoop fixtures and exact-provider callback fixtures and are not yet acceptance evidence.
- The external Build fixture migration now uses the production entry point exclusively: each resume regression first starts a real exact-provider Build turn, persists the dynamic identity/descriptor/runtime/surface/ledger closure, records a provider-native session ref, deliberately fails, and then resumes through the same adapter. The hand-built external runtime helper and Build `structured_output` fixtures were deleted. A same-project and cross-active-project attachment repair, absent original evidence contract, required visual-comparison consumption, incremental retry, and current Visual QA feedback retry all pass. An execution-speed regression also exposed `tool terminal end time must be later than start time`; completed and failed exact callback parts now use a strictly later end timestamp.
- SessionLoop early rejection now has observable side-effect evidence: a real Build session with an external-coding runtime and pending `subtask_request` rejects before prompt-owner creation, status mutation, or control consumption. Claude exact tests now execute raw `ListTools`/`CallTool` handlers and cover JSON Schema format rejection, same-input concurrent permission denial, same tool-use ID with changed input, callback failure, duplicate and missing result telemetry, pending completion, native UUID resume, and logical-session interrupt. Current combined evidence is 98/98 passing across managed external Build, external telemetry, runtime-contract tools, extra tools, Claude SDK exact execution, and immutable projected contract; full package TypeScript typecheck and scoped diff-check pass. Independent re-review of both runtime and Claude adapter slices is in progress.
- The second independent Claude review rejected callback errors that were visible only to the MCP caller: an unpermitted, unknown-local, or repeated callback could throw, be swallowed by the SDK, and still leave every final correlation set empty. It also proved that `extra.signal ?? input.signal` discarded the turn signal and that result telemetry was still order-dependent. The corrected ledger records every callback-boundary error as fatal, combines request and turn abort signals, buffers result telemetry until permission/callback/call evidence converges, emits canonical call-before-result order, and rejects every incomplete final set. Adversarial tests now include call-first, result-first, repeated ID with changed input, callback without permission, unknown local callback, callback twice, both abort sources, AsyncIterable/undefined/BigInt/circular output, exact run with an optional logical session ID, resume UUID, and interrupt.
- The second independent runtime review rejected three additional defects: a malicious `prepareSurface` could change project/task/assistant execution context before the first callback; tool end could be forced one millisecond past assistant completion; and external host-synth/structured-output return/comment residue remained. `assertExternalProjectedToolSurfaceMatchesSeed` now proves the prepared dynamic identity, expert squad, all five execution fields, projected/stage classification, host callbacks, and input schemas against the host seed before messages, descriptor, runtime, or provider invocation. Assistant completion is bounded by the latest success/error tool terminal time. The unused external `mergedHead`, `worktreeBranch`, and `ownsWorktree` return/parameter surface plus stale host-synthesis prose were removed. Malicious surface, successful terminal chronology, and errored open-tool chronology regressions pass.
- The third runtime and Claude reviews accepted the exact Claude adapter but independently reproduced one remaining Build seed-integrity defect: the prepared-surface comparison covered only tool IDs, `execute`, and input schema, so a provider could replace model-visible fields such as `description`, metadata, or `toModelOutput`. Runtime review also demonstrated that preserving an `execute` accessor lets its closure return a trusted callback during validation and a malicious callback afterward despite recursive freezing. The corrected contract compares every own property key, descriptor, nested data value, and function identity, using semantic comparison only for the immutable JSON Schema snapshot. Tool definitions and nested metadata reject accessors; `execute` and `inputSchema` must be own data properties captured once. Regressions cover description, metadata, `toModelOutput`, and a stateful execute getter.
- The fourth runtime review then reproduced a separate call-entry baseline defect: Build constructed a mutable seed, passed it to `prepareSurface`, and compared the returned surface against that same object only after provider return. An in-place provider mutation therefore changed both candidate and baseline. Build now creates one host-owned recursively immutable canonical seed before provider code runs, passes that snapshot to `prepareSurface`, and compares against the same unchanged snapshot. A pure contract test proves identity, execution, tool records, definitions, and schemas are frozen; a real fresh Build test attempts an in-place task-ID mutation and proves rejection before messages, descriptor, runtime contract, or provider run.
- The exact-surface final review then exercised graph and object-model cases absent from the fixtures. Tool snapshots now allocate every tool root before populating the graph, preserve aliases and cycles across all projected/stage definitions, freeze function objects and their own state, and compare candidate/seed graphs with an actual-to-expected plus expected-to-actual bijection. Tool records, tool roots, and nested values permit only plain objects/arrays plus primitive or frozen function references; RegExp, URL, typed/private-slot, accessor, Map/Set, and other unprovable shapes fail explicitly. Canonical tool IDs are compared as the exact sorted sequence rather than a set. Regressions cover nested aliases, self-cycles, shared tool roots, stateful callback properties, non-plain roots, and forged order.
- The same review found that Claude serialized callback output once but Build ignored the canonical event text and serialized the raw ledger object again. `serializeExactProjectedToolOutput` is now the single projected-contract serializer used by both layers; the ledger stores/returns only its text and requires provider result telemetry to match byte-for-byte. AsyncIterable, undefined, BigInt, and cyclic outputs fail before provider telemetry. Claude fatal completion now exposes the specific recorded boundary cause instead of hiding it behind incomplete-correlation prose. Observed-call identity/input is checked in both permission and raw callback boundaries before host execution, and call-first mismatch proves zero callback side effects.
- Logical exact-provider interruption no longer relies on the SDK to propagate raw MCP request cancellation: one invocation-owned abort controller bridges the turn signal, callback signal, SDK query, and logical-session interrupt. An active callback waits for abort, receives it through `provider.interrupt(logicalID)`, and settles with canonical result evidence.
- Final evidence is 155/155 passing across seven Build/runtime/Claude/contract files with 617 assertions under the inactivity runner and `--timeout=0`; full TypeScript typecheck, historical docs links (20/20), and scoped diff-check pass. The conditional-built-ins regression can exceed five seconds, so Bun's default per-test timeout is not acceptance evidence and does not replace the repository's real inactivity timeout. Two independent final read-only reviews accepted the current exact surface, Claude adapter, External Build fresh/resume persistence order, terminal chronology, and SessionLoop boundary; one also exercised the raw MCP handlers through real `InMemoryTransport`. This slice is accepted. The task-loop queued-start race remains the next unaccepted slice.
- The same recheck found that heading-based idempotence let a package overlay or user append suppress `Scoped Project Source Boundary` by supplying the heading first. The boundary has one canonical injection point per runtime path, so heading detection is removed and a regression proves untrusted prompt content cannot bypass the base-role template policy.
- Selector review also found executable legacy tests that still read the deleted mixed `projection.skills` array and `mounted_agents` metadata. These tests retain real selector discovery/content/location and production-grant isolation requirements; they must be migrated to the disjoint `selectorSkills`, `productionSkills`, and `skillInventory` surfaces rather than deleted or allowed to fail at runtime.
- Runtime-contract review found that a cast-invalid projected worker with a different but otherwise valid `dispatchAdapterID` passed `SessionRuntimeContractStore.set` when agent ID, base role, session kind, projection hash, and skill owner matched. The store boundary now validates the five-field worker identity with the canonical `ProjectedWorkerIdentitySchema`; a negative contract-install test changes only the adapter and requires immediate failure.
- Scheduler review found that `createOrchestratorTools.dispatchAgents` remained optional and silently converted omission to `[]`, making a missing turn-owned dynamic-agent projection indistinguishable from a real empty projection. The API now requires and validates an explicit array, as already done for `selectorSkills`; every caller must pass the resolved projected agents or an intentional empty array.
- The stage-tool recheck found that `BuildAgent.RunInput.additionalRuntimeTools` lets any caller inject an arbitrary host tool and then promotes every injected key into `stageOwnedToolIDs`. This bypasses the single `projectWorkerTools` join and the manifest/default/package/MCP authorities. Whole-repository search found no caller, so the free injection field and spread must be deleted; only the build wrapper's intrinsic `report_build_result` and conditional `merge_back` tools remain stage-owned.
- The same recheck found an unused `stageOwnedTools` object in Frontend Design. The live runtime already supplies one raw `agentTools` map plus the canonical `FRONTEND_DESIGN_STAGE_OWNED_TOOL_IDS`; the dead parallel object must be removed so there is no misleading second construction path.
- A deeper tool-closure recheck found that registry validation currently accepts projected built-ins/default host tools from global `AgentToolPool` sets, while runtime first ceilings registry tools through the selected base-role pool and only later discovers whether a wrapper supplied a projected default host implementation. This creates load-success/runtime-drop behavior. The corrected closure must define whether built-ins are seed extensions or a base-pool subset and must validate package-projectable host defaults against one base-role wrapper-supply authority; scheduler and worker-only host surfaces cannot cross. Real `resolveTools` tests must cover a projected built-in outside a base pool and rejection of a Build projection that references a Frontend-only host tool.
- Independent tool-closure audit rejected arbitrary worker built-in extension: no current worker wrapper/provider proves a cross-base-role extension ABI. Worker `built_in_tool_ids` therefore selects only from the chosen base role's seed (and can reconstruct a subset when `inherit_base_tools` is false); package/default/MCP refs are the explicit extension surfaces. The earlier proposed Requirements-plus-Edit positive test is superseded by an exact-Requirements regression proving its inherited `websearch`/todo registry tools materialize. A cross-role built-in declaration must fail during package load.
- Scheduler built-ins use a separate fixed wrapper contract: the inherited scheduler seed plus the proven public `refine`, `browser_preview`, and `bash` implementations. Scheduler `default_tool_refs` are currently empty because no scheduler wrapper supplies package-projectable default host tools.
- `default_tool_refs` is not a second spelling for built-ins. The role-specific default-host domain is Frontend Design -> `FRONTEND_DESIGN_EXPERT_DEFAULT_TOOL_IDS`, Visual QA -> `VISUAL_QA_EXPERT_DEFAULT_TOOL_IDS`, and empty for every other worker/scheduler role. `default/tool/read`, Build-plus-frontend-host refs, and cross-specialist refs fail at package load.
- Every projected worker, including an exact-runtime base role, must materialize only its turn-owned projected registry built-ins. Exact means no unprojected registry/MCP tools; it does not mean skipping projected registry providers. Task-scoped same-name implementations from the selected base-role wrapper may replace the registry implementation only inside the same projected built-in slot; stage-owned tools remain the separately accepted explicit wrapper ABI, and arbitrary caller injection has already been removed.
- `AgentToolKit.stageOwnedToolIDs` and the corresponding `projectWorkerTools` input are still optional and default omission to an empty set. This repeats the missing-projection ambiguity already removed from `dispatchAgents`. Both contracts must require an explicit array; wrappers with no per-run host ABI pass `[]`, while cast-invalid omission fails at the projection boundary.
- The explicit stage-owned subset revision was independently accepted after an initial rejection exposed eight stale positive test callers. Every production wrapper and positive `projectWorkerTools` call now supplies the array and `toolDirectory`; Explore supplies `[]`; the only omission is the cast-invalid negative test. Independent evidence was passing typecheck, six stage-owned tests, and eleven runner/frontend/visual/integrity wrapper tests.
- The next independent tool-closure probe rejected the slice on two executable counterexamples. A Build/GPT-5 projected registry request silently omitted `edit`, `write`, `lsp`, and `batch`; a Requirements runtime contract then installed an arbitrary flat `bash` extra even though the active worker projection did not contain `bash`. Green focused tests did not cover either path and are not acceptance evidence for this boundary.
- The corrected built-in materialization contract separates the role's static package-projectable allowlist from the current runtime availability set. One provider-availability authority in `global-tools.ts` owns `question`, `lsp`, and `batch` conditions and the deferred `skill` provider. Resolver inheritance excludes currently unavailable conditional providers, explicit projection of an unavailable provider fails, and projected-worker materialization must prove `materialized IDs + deferred skill === requested IDs`. The projected path does not reuse the native GPT edit/write/apply-patch suppression because doing so would make the declared capability and skill requirements false; changing that policy would instead require a model-bound final capability and hash.
- Independent re-review accepted that provider-availability/materialization sub-slice after the regression was upgraded from five hand-picked IDs to the real resolver-produced complete Build seed. The persistent evidence covers exact GPT materialization, inherited and explicit `batch`/`question`/`lsp` behavior, worker and scheduler hash changes, scheduler question projection, 21 focused passing tests, TypeScript typecheck, and scoped diff-check. Runtime extra authority remains explicitly outside that acceptance.
- Flat projected-worker `SessionRuntimeContract.tools` is also rejected. The replacement must classify projected provider implementations separately from private stage ABI tools, carry the exact built-in ID snapshot, validate it against the turn-owned projected-agent snapshot, forbid cross-authority overlap/shadowing, and validate stage IDs against a core base-role runtime authority rather than trusting caller-supplied `stageOwnedToolIDs`. The old flat field cannot coexist as a compatibility path.
- The words `executor` and `non-executor` are retired from this boundary. Every projected worker executes tasks. The actual distinction is the core `base_role` template policy `broadProjectSourceWork`: it controls whether that template may work broadly across project source, while the dynamic `agentID` remains the runtime identity and never participates in the decision.
- Runtime-authority recheck proved that `SessionRuntimeContractStore.set` retained caller-owned mutable arrays/maps. A caller could install a valid contract and then mutate the original references to inject an unprojected provider. The store must create a recursively immutable owned snapshot, and `get` must not expose mutable internals; a post-install mutation regression is required.
- The same recheck proved that subset-only validation accepts a worker contract missing projected package/default/MCP providers. Every non-built-in projected provider must be present in `projectedTools`; built-in same-slot overrides remain optional because the registry implementation can materialize them. Scheduler projected tools must match its projected tool set exactly.
- The private stage ABI map is not allowed to use `?? []` for unknown/non-dispatchable roles. It must be exhaustive over the dispatchable worker-role domain, include explicit empty entries such as Explore, fail for roles outside that domain, and have executable drift checks against each wrapper's actual private stage tool kit.
- The external Build executor currently passes executor-configured provider tools directly to the coding provider while recording empty projected/stage runtime maps. That is a second unvalidated tool authority: `inherit_base_tools: false` can still leave provider-native shell/edit capabilities available, while package/default providers are absent. External execution cannot claim projected-worker semantics until an exact adapter contract proves and enforces the provider input surface; otherwise the incompatible projection must fail explicitly rather than being recorded as empty.
- Scheduler wake tests still captured the retired `runtimeContract.tools` field, hiding the production migration behind empty tool IDs. They must capture `projectedTools`, assert `stageTools` is absent, and pass both general and project-package scheduler wake cases.
- `runner-prompt.test.ts` still assigns a fixed 30-second elapsed timeout to every real runner test. The outer `bun test --timeout=0` does not neutralize those local timeouts. Architecture evidence must remove the fixed per-test timeout and rely on `run-with-inactivity.ts`, whose clock resets only after real stdout/stderr activity.
- `extra-tools.test.ts` remains executable but still constructs the retired flat `tools` runtime contract plus stale identity/continuation fields. Focused replacement and registry-filter cases fail at the Store boundary. The file also owns unique coverage for replacement/persistence, MCP flags, exact registry filtering, continuation descriptors, and Orchestrator/Frontend Research/Frontend Design SkillTool surfaces, so it must be migrated to classified `projectedTools`/`stageTools` and current identities rather than deleted wholesale.
- Independent review rejected a first attempted `extra-tools` migration helper because it accepted `baseRole`, derived session/adapter fields, fabricated a frozen skill projection and project directory, and supplied an unpersisted descriptor. Tests cannot become a second projection authority. Every retained integration test must start from required dynamic `agentID` plus the real `resolveWorkerTurnProjection`/`resolveSchedulerTurnProjection`, persist the current WorkerTurnDescriptor shape, and install those exact resolved snapshots.
- The same review classified the file's 49 cases. Twelve runtime-contract cases are redundant with stronger `runtime-contract-tools` real-path coverage or directly assert retired `mounted_agents`/generic SkillTool selector behavior and must be deleted. Thirteen unique cases remain for migration: wholesale replacement, descriptor projection mismatch, cancellation retention, session mismatch, install-time missing descriptor, lifecycle/terminal staleness, persisted descriptor binding, plain-string wrapping, three provider strict dispatch-schema checks, re-export rename, and a corrected negative MCP assertion. Projected workers must not inherit ambient global MCP; package/default MCP arrives only through `projectedTools` with `includeMcpTools: false`. Dispatch schema tests must use the real scheduler projection's dynamic agents; `dispatchAgents: []` correctly produces `target: never` and cannot be used with old base-role/adapter target literals.
- The corrected `extra-tools` suite now has 37 tests and no synthetic projection helper. Retained integration cases install a non-base-role `runtime-build-worker` package, resolve by dynamic `agentID`, classify tools through `projectWorkerTools`, persist the current descriptor schema, and pass the resolved identity plus project/skill snapshot into the Store. Provider-schema cases derive targets from the real scheduler projection by exact `dispatchAdapterID` ownership. Evidence: 37/37 passing under the inactivity runner, plus 12/12 runtime-contract tests and 15/15 runner tests; the runner file took roughly 74 seconds, proving the retired 30-second per-test elapsed timeout is no longer active.
- The real external dynamic-identity Build test now fails at the strengthened Store boundary because its project package provider is absent from the external path's empty `projectedTools` map. This is accepted as a reproduced blocker, not a completed fix: `runWithExternalProviderImpl` still passes executor-configured native tools directly to the provider, so the external adapter remains a second unproven tool authority until its exact projection contract is redesigned or the unsupported path fails before starting.
- Independent re-review accepted the classified runtime authority and migrated legacy-test range. It verified the owned frozen Store snapshot, worker non-built-in completeness, scheduler exact set, exhaustive/no-fallback private stage ABI, removed runner fixed timeouts, scheduler `projectedTools` capture with absent `stageTools`, real resolver-backed `extra-tools` fixtures, and dynamic dispatch-schema targets. Its evidence was 49 runtime/extra tests plus two scheduler wake targets, all passing under the inactivity runner. External Build was explicitly excluded from that acceptance.
- A separate external-provider audit proved no current provider implements exact arbitrary projected-worker tools. Codex app-server drops `CodingRunInput.tools` from thread/turn start, emits dynamic-tool telemetry without host execution/results, cannot generally disable native shell/file tools, and boots ambient MCP inventory. Codex CLI and the legacy Claude wrapper expose fixed native surfaces. Claude Agent SDK has the primitives for an exact adapter but currently ignores input tools, loads ambient settings, and mounts global MCP. The corrected boundary is a distinct exact projected coding-provider adapter: same turn-owned identity/hash, immutable materialized provider callbacks, explicit canonical-native mapping, no ambient settings/MCP, undeclared-call rejection, and resume set/hash validation. Providers without that adapter must fail before descriptor/runtime installation/provider invocation; `builtinTools/customTools` booleans are not authority evidence.
- A separate scheduler continuation failure was reproduced as a real task-loop startup race: `launchTaskLoop` records `taskLoopChain` before its queued promise enters `beginTaskLoopPass`, while `awaitTaskLoopIdle` observes only abort/running state and can return in that gap. The wait contract must include the queued chain and receive a regression; its timeout evidence must remain based on observable activity rather than process age.
- Task-loop startup investigation then found an earlier EngineQueue-to-runner handoff before `runTaskLoop` can register its tail. Three independent BLOCK rounds exposed distinct ownership defects: interrupt deleted ownership without cancelling the underlying launch/tail; completion advanced the next sibling outside Instance context; same-count ownership replacement did not reset the inactivity deadline; abort could arrive while the queued pass waited on a dynamic state import; missing runners could leave claimed or reopened tasks active; terminal operator paths reopened before runner validation; and async failure persistence could cross into the owning Instance after an interrupt. The corrected model keeps exact AbortController ownership for every launch and every pass from queue registration through real settlement, tracks the completion drain/advance window explicitly, aborts rather than deletes on interrupt, statically loads queued-to-active state operations, validates the required runner before every claim/reopen/accepted-event side effect, and rechecks abort inside the owning Instance before durable failure persistence. Every ownership replacement records a monotonic revision, and idle revision state is cleared without leaking per-task entries. The final independent review accepted the slice after all four complete related files passed at 51/51 with 276 assertions under the inactivity runner; full TypeScript typecheck and scoped diff-check also pass. Coverage includes concurrent and stale launch tokens, interrupted real EngineQueue handoff and queued pass, same-count replacement, missing/throwing runners, terminal operator reopen prevention, durable wake retention, interrupt during failure persistence, completion-started sibling, selector continuation, and dependency boundaries. A broader queue run still exposes 35 executable-test failures: most queue/queued-wake fixtures create tasks without the required parentless root session, several use invalid synthetic task/goal IDs, and one source-string assertion expects the pre-Instance-context completion-hook spelling. These remain known queue/test-debt work and cannot count as final acceptance evidence.
- The next three-way dynamic-identity audit BLOCKED dispatch/session acceptance. Stage continuation artifacts store only base-role stage/finalizer/input scope and therefore can resume agent A's session through agent B when both share one template. A2A requests persist only an agent string and later reinterpret old requests through `WorkerTurnDescriptor.latestForSession`, so a newer descriptor can replace the original base role, adapter, or projection hash. The corrected contract must persist the exact projected-worker identity plus descriptor ID/hash at request/continuation creation and make claim, continue, redispatch, replay, and action completion consume that frozen binding; no response path may rediscover identity from latest session state.
- The same audits found three direct base-role identity residues: fact-check derives `target_agent` from `session.kind`; the A2A error branch calls `AgentRoleContract.isRoleID` on a dynamic request agent; and wake/prompt creation treats an arbitrary requested agent as a native base role when no runtime contract exists. Fact-check must bind the persisted target message's dynamic agent to its descriptor/runtime contract. A2A errors must report binding facts without static-role classification. Wake and prompt creation need one shared explicit native/projected resolver that rejects runtime-required roles without a contract and rejects fixed native session/agent mismatches before writing a message.
- Dispatch audit also found that build, intent-analysis, Explore, workload-analysis, fact-check, Frontend Design, and Integrity A2A redispatch reuse options without the target dynamic ID, while several result collectors select a child by static session kind and recency. Every redispatch adapter must receive the required frozen projected identity, install that exact target execution context, capture the actual created session ID, and validate its descriptor instead of guessing by kind/time. Continuation adapter tracking must carry the already-resolved binding rather than derive the adapter again from a hard-coded base-role literal. The minimum regressions are two dynamic IDs sharing one base role, cross-agent continuation rejection before claim, descriptor-A request stability after descriptor B exists, dynamic fact-check targets, all redispatch adapters preserving `binding.agentID`, and concurrent same-kind session isolation.
- Runtime test audit found stale executable evidence even where production source is correct. The package test preload did not install the production control-plane/task-wake composition, two resolver helpers called the retired flat tool-projection ABI, the base-template test used `agentID === baseRole`, and runner tests still passed an ignored `kind` field. The preload and resolver helpers now use the current explicit composition/classified-tool ABI; the base-template regression uses `runtime-base-template-worker -> build` and proves no provider/session side effect; ignored runner `kind` inputs are removed. The repaired resolver/runtime subset passes 56/56, and the strengthened base-template test passes independently. A runner-level two-agent shared-base-role execution isolation test remains required.
- Legacy-test audit found that `prompt-profile-resolver.test.ts` still asserts deleted `agents`/`mounted_agents`, catalog virtual/projection aliases, flattened worker tool/MCP aliases, and old `projectWorkerTools` inputs. These executable assertions must be migrated to structured `identity`, `tools`, `mcp`, `selectorSkills`, `productionSkills`, and explicit `toolDirectory` fields, or deleted only where current registry tests already provide the unique negative coverage.
- The same audit found runtime legacy outside tests: Overlay service models and panels still read `agents`, `projected_agents`, `virtual_agents`, `dynamic_attributes`, and `skills[].mounted_agents`; the current MirrorTest package still uses base-role-like dynamic IDs and a prompt calls itself a virtual agent. Catalog/Overlay/package acceptance therefore remains unproven until these consumers and the real package IDs/prompts are migrated.
- Catalog audit reproduced a production defect: inactive package summaries call `resolvePackageCapabilitySet` with the active profile's runtime configuration, so an inactive package's MCP declarations can fail or expand as if active. Catalog summaries must remain declaration/dynamic-agent metadata only; strict production capability expansion occurs only after exact active selection.
- The inactive-catalog correction replaces `CatalogPackage = LoadedPackage` with a metadata-only manifest/README/selector package. `squads[]` now carries a distinct `declaration_hash` covering canonical identity/version/capability declarations plus README and selector digests, while active runtime surfaces alone retain `projection_hash`. Project and session config PATCH validation now builds and schema-validates the final candidate before validating every model surface and active package identity; provider additions and their selected model are validated from that same candidate rather than stale provider state.

### Skill Mount Replacement Contract

- Ordinary default-skill metadata has no agent-identity or base-role compatibility field. Manifest grants and qualified operator grants decide which dynamic agents receive a skill; platform, permission, and exact projected `required_tools` decide whether it can execute. The retired `agents` and `mounted_agents` frontmatter keys are rejected at every discovery/import boundary and are not migrated, renamed, or inferred.
- Manifest `default_skill_refs` and `package_skill_refs` are immutable production grants. Package-skill grants cannot be changed by an operator. Selector skills remain outside both the production grant set and the mount store.
- Operator state has exactly one structural shape: `skill_mounts.<expertSquadID>.<agentID>.<defaultSkillRef>: boolean`. `true` adds an operator grant and `false` suppresses a lower-precedence operator grant; neither value changes an immutable manifest grant. A missing project leaf means no operator relation, while a missing session leaf inherits the project operator relation.
- Project overrides live only in the canonical project config. Remote well-known, global, custom-path, global/local config-directory, inline, and managed sources reject `skill_mounts` instead of merging it into a project.
- Root-session `Config.Overlay` stores the same qualified boolean leaves. A patch leaf of `null` deletes the session override and therefore inherits the project-effective value; stored overlays never contain `null`. Child sessions resolve their root owner's effective overlay by explicit lineage but cannot mutate it through a child ID; writes require the exact root session ID and never select an owner by directory or agent-name coincidence.
- Mount writes use an explicit discriminated project/session scope plus exact `expertSquadID`, dynamic `agentID`, and canonical `default/skill/<name>` ref. Project/config routes, session/config routes, and direct write APIs invoke the same semantic validator while their keyed lock covers read, merge, validation, write, and cache/event publication.
- Runtime resolution consumes one turn-owned resolved surface. It derives `baseRole` only after exact dynamic-agent lookup, checks `required_tools` against that dynamic agent's projected tool IDs, and passes the same result to SystemPrompt and SkillTool. Missing identity/surface data is an error; there is no `unbound`, `general`, native-name, or ambient-project fallback.

### Fixed Scheduler Skill Identity

- The scheduler is not a dynamic worker and never appears under `capability_projection.agents`. Its fixed runtime identity is `agentID/baseRole/sessionKind = orchestrator`, qualified by the active scheduler projection's exact `expertSquadID + projectionHash`.
- An Orchestrator wake that consumes projected scheduler tools uses the explicit runtime-contract discriminator `projected-scheduler`; plain `native` is reserved for the core Explore TaskTool session. Absence of the scheduler projection identity cannot select Orchestrator behavior.
- Scheduler production skills granted by `capability_projection.scheduler` use the ordinary production `skill` tool, but SkillMount resolves them only against the exact fixed scheduler projection and its projected tool IDs. It never searches workers or reconstructs authority from the `orchestrator` base role.
- Expert-squad selector skills are selection-only and use a separate `expert_squad_selector` tool bound to the turn-owned `selectorSkills` projection. They never enter SkillTool, production grants, production hashes, scheduler production prompts, or operator mount state.
- The Orchestrator base tool pool may seed both tool IDs. The active scheduler projection decides their runtime presence, and `select_expert_squad` remains the only mutation surface for `prompt_profile.active`.

### Stage-Owned And Package-Projectable Host Tools

- `stageOwnedToolIDs` is reserved for per-run host ABI tools that the selected base-role runtime cannot complete without, such as structured output/finalizer tools, attachment readers, and Integrity evidence collectors. These tools are still checked against the wrapper's actual runtime map, but they are not package capabilities and therefore do not participate in manifest grants.
- A host-implemented tool that is useful only to a domain package is a package-projectable host tool. Its ID is canonical so strict manifest validation can reference it, the role wrapper supplies its concrete task-scoped implementation in the raw runtime map, and the active worker projection must grant it through an explicit `default_tool_ref`. It is never added to the base-role assignment and never listed as stage-owned.
- Frontend Design skeleton/visual-region tools and Visual QA reference-comparison tools are package-projectable host tools. `update_frontend_competitor_reference` is projected only by Frontend Innovate. General receives none of those optional domain tools; Frontend Replica receives its skeleton/region and reference-comparison surfaces without the Innovate-only competitor tool.
- `projectWorkerTools` remains the single join point for base-role built-ins, manifest default/package/MCP grants, and stage-owned host ABI tools. A wrapper must expose one raw tool map and one explicit stage-owned subset; no wrapper may pre-filter the raw map by profile or recover package identity itself.

## Diagnosis

The root cause is the unbroken historical equation:

```text
AgentRoleID = runtime agent identity = session kind = workflow stage = dispatch primitive = capability owner
```

The July 9 schema separated projection key from `base_role`, but runtime still reverse-looked up by base role. The uncommitted July 10 attempt then added `team`, free workflows, dispatch targets, primitives, and virtual identities around the same equation. Validation grew because the model had no canonical owner.

The corrected model splits only facts that are truly independent:

```text
expertSquadID  selects one package
agentID        identifies one projected dynamic agent
baseRole       selects one core runtime template
sessionKind    stores that template's session lifecycle kind
projectionHash freezes the effective projected capability for continuation
```

Dispatch target is `agentID`; it is not another identifier. Dispatch adapter is core data derived from `baseRole`; it is not package data.

`AgentRoleContract` owns the mapping from `baseRole` to an explicit `sessionKind` and optional `dispatchAdapterID`. `orchestrator/tools.ts` owns only an exhaustive `Record<dispatchAdapterID, { inputSchema, execute }>` implementation table; it never repeats or reverse-maps a base role. `WorkflowRegistry` may reference adapter IDs for advisory workflow text/progress, but it owns no role, agent, or capability binding.

## Corrected Manifest Contract

```jsonc
{
  "schema_version": 1,
  "namespace": "wujiang",
  "id": "opentest",
  "label": "MirrorTest",
  "description": "Software testing specialists.",
  "version": "2026.07.10",
  "readme": "README.md",
  "selector": {
    "summary": "Use for software-test design and execution.",
    "selection_guidance": "Select for software-test work.",
    "instructions": "selector.md"
  },
  "capability_projection": {
    "scheduler": {
      "base_role": "orchestrator",
      "prompt": "agents/orchestrator/system.md",
      "inherit_base_tools": true
    },
    "agents": {
      "test-implementer": {
        "label": "Test Implementer",
        "description": "Implements and executes evidence-backed tests.",
        "base_role": "build",
        "prompt": "agents/test-implementer/system.md",
        "inherit_base_tools": true,
        "package_skill_refs": ["opentest/test-implementer/test-implementation"]
      },
      "failure-reproducer": {
        "label": "Failure Reproducer",
        "description": "Reproduces and classifies reported failures.",
        "base_role": "build",
        "prompt": "agents/failure-reproducer/system.md",
        "inherit_base_tools": true
      }
    }
  }
}
```

Rules:

- The worker map key is the dynamic `agentID`; no nested ID repeats it.
- Dynamic worker IDs reserve `orchestrator` for the host scheduler and `shared` for the package-ref shared-resource namespace.
- `label` is required so catalog identity never falls back to the base-role label.
- `prompt`, when present, must equal `agents/<agent_id>/system.md` and be nonblank.
- Scheduler prompt, when present, must equal `agents/orchestrator/system.md`.
- Agent-local skills/tools/MCP live only under `agents/<agent_id>/`; shared resources remain top-level and require explicit projection refs.
- Every agent-local discovered resource must be projected by its owning entry; orphan resources fail package validation.
- Worker projections require a dispatchable task-worker base role. Host, primary, helper, and scheduler roles are invalid worker seeds.
- `dynamic_attributes` is rejected. Domain-specific behavioral policy belongs in package prompts/resources; a true runtime-template switch must be a typed core role-contract field rather than free-form package data.

## Runtime Contract

| Surface | Uses `agentID` | Uses `baseRole` / `sessionKind` |
| --- | --- | --- |
| `dispatch_agent.target` and tool result | yes | adapter lookup only |
| Worker capability lookup/hash | yes | seed validation/expansion |
| Message/descriptor/runtime identity | yes | stored alongside identity |
| Model/core prompt/user base-agent append | no | yes |
| Expert-squad prompt overlay | yes | no |
| Default tool pool/runtime switches/finalizer | no | yes |
| Package tools/skills/MCP/mounts/catalog | yes | metadata only |
| Tool context/A2A/continuation/wake/redispatch | yes | lifecycle validation only |

No surface may recover `agentID` by searching projections for a matching `baseRole`.

Projected-worker runtime identity is one required value with exactly these fields:

```text
agentID, baseRole, sessionKind, dispatchAdapterID, projectionHash
```

It contains no `projectionID`, `targetID`, `virtualAgentID`, `agentKind`, or optional base-role alias. Projected-worker SessionPrompt/loop paths require this installed identity and use `agentID` for messages/tool context and `baseRole` for `Agent.get`/model/core prompt. Native non-projected sessions use a separate explicit discriminated-union branch; absence of a projected identity never selects a native branch implicitly.

The canonical worker projection hash covers `expertSquadID`, `agentID`, `baseRole`, `sessionKind`, `dispatchAdapterID`, label, description, prompt-content digest, effective built-in/default/package tools, skills, MCP servers/tools/prompts/resources, and digests of every projected package resource. Scheduler hash covers its own canonical identity and effective resources. Workflow data and removed schema fields are not hash inputs.

Package-tool source closure is part of that contract:

- Hashing and execution use the same content-addressed compiled bundle bytes; runtime never rebuilds a tool independently after capability resolution.
- Closure entries use package-relative paths, raw-byte digests, source extensions, and stable sort order. The compiled-bundle digest captures the actual Bun loader/import-attribute result. Absolute roots and temporary bundle paths are excluded.
- Executable entries remain direct `tools/*.ts|js` files. An agent-owned entry may import only its private `agents/<agentID>/lib/**` and the generic shared `lib/**` root. A shared entry may import only `lib/**`. Cross-agent imports, imports of another executable entry, absolute/file-URL imports, symlinks, and package-root escapes fail.
- Static imports and literal `import()` / `require()` are supported. Non-literal dynamic imports/requires and direct `eval`, `Function`, `require.resolve`, runtime plugin/spawn forms fail structural validation. This closure validator is not a JavaScript security sandbox; installation authenticity remains the trust boundary for deliberately obfuscated dynamic execution.
- Core imports are allowlisted and resolved in a separate core namespace whose internal dependency graph is not subjected to package owner checks. `node:` runtime modules and `@opencorvus-ai/plugin` use a versioned core ABI domain; any additional bare dependency must be explicitly allowlisted and contributes its resolved entry-byte digest. The initial external dependency allowlist contains only `typescript`, required by the MirrorTest shared library.
- `protocol-engine/**` is not a schema exception. MirrorTest shared implementation files migrate to the generic `lib/opentest/**` dependency root, and orphan shared-library files fail reachability validation.
- The worker/scheduler/aggregate hashes use distinct domain separators. Set-semantics refs are deduplicated and sorted before hashing.

Package skills and package MCP use deliberately different closure contracts:

- A package skill is one strict `SKILL.md` resource. Registry loading validates the shared package-skill authoring schema, rejects runtime-owned metadata and every ancillary entry, stores typed metadata plus content and a raw-byte digest, and exposes a content-addressed non-filesystem URI. Old resolved skills never scan the live package directory.
- A package MCP definition is a remote connection declaration, not a server implementation snapshot. Package `type: local` is rejected because arbitrary command interpreters cannot provide a provable content closure without a separately compiled ABI. The remote declaration snapshot covers its package-relative declaration path, raw bytes, parsed remote config, and declared capability names; it does not claim to freeze remote service behavior.
- Package MCP projection APIs require the caller's project/runtime directory explicitly even though remote transport does not execute from the package directory. Resolver never retains or derives a package root for MCP execution, never rereads the declaration, and never guesses a definition extension after registry loading.
- Prepared skill/tool/MCP values are recursively frozen. Loaded resource maps expose a frozen read-only view with no mutators and a frozen prototype, so validated entries cannot be replaced or have lookup semantics monkeypatched after loading.

Selector metadata belongs to catalog selection, not the active production-skill projection. `Skill.all()` is lookup inventory, never an implicit grant or mount source. Effective production skills are the union of (a) active scheduler/agent manifest grants from explicit `default_skill_refs` and `package_skill_refs`, and (b) validated operator grants for the exact active `expertSquadID + agentID + scope`. Those sources remain typed separately even when they grant the same effective skill. Selector skills are a fourth, selection-only surface and cannot enter production hashes, SkillMount, or the agent system skill section.

### External Build exact-projection boundary

The external Build path is not allowed to reinterpret `CodingProvider.capabilities().builtinTools/customTools` or `ExecutorRegistry.options.tools` as proof that a provider implements the active dynamic agent's projected surface. Those values belong to ordinary external-executor configuration and are not a runtime projection authority.

Whole-repository call-point disposition after the runtime-contract review:

| Call point | Current role | Required disposition |
| --- | --- | --- |
| `executor/contract.ts` `CodingProvider.run/resume` | Generic external coding execution | Retain for non-projected execution. Add a distinct exact-projected adapter contract; do not widen generic `tools` into a second expert-squad projection language. |
| Codex app-server / CLI / legacy Codex wrapper | Generic provider implementations | They do not control native tools and host callbacks exactly. They must not be called for projected Build until they implement the exact adapter. |
| Claude legacy wrapper | Generic provider implementation | It drops function tools and must not be called for projected Build. |
| Claude Agent SDK | Generic implementation with isolation primitives | Implement the first exact adapter with `settingSources: []`, an explicit native-tool set, and only a task-owned in-process MCP callback server. Ordinary SDK runs keep their existing generic configuration. |
| `executor/managed.ts` | Mission/direct executor adapter | Keep generic `run/resume`; it is not an expert-squad projection consumer. |
| `ExecutorRegistry.options.tools` | Operator configuration for generic executors | Remove from projected Build input, descriptor, and runtime authority. Extra configured tools must not leak into a projected worker. |
| `build/agent.ts` external path | Dynamic Build worker execution | Resolve one turn-owned worker/skill projection, materialize its exact tool implementations, install the same snapshot in the runtime contract, and pass that snapshot only through the exact adapter. |
| `WorkerTurnDescriptor.tools.enabled` | Persisted turn evidence | Store the canonical projected provider IDs used for the turn, not global executor options or provider-native aliases. |
| `SessionRuntimeContractStore` | Turn-owned identity/tool/skill authority | Continue validating the materialized OpenCorvus tool map. No empty map may stand in for a non-empty projected capability. |
| External Build tests | Provider input and persistence evidence | Fake providers must explicitly implement the exact adapter. Add negative tests proving unsupported providers fail before descriptor/runtime/provider invocation and that ambient configured tools do not leak. |

The exact adapter input is one immutable `ExternalProjectedToolSurface` containing the same projected worker identity, `expertSquadID`, projection hash, classified exact materialized `projectedTools` and `stageTools`, explicit `canonicalToProviderName` and `providerNameToCanonical` bijections, and the real project/session/assistant-message/task/agent execution identity used by the descriptor/runtime contract. Descriptor, runtime contract, and provider input are derived atomically from that one value and assert set equality; they do not independently rebuild or sort tool lists. External callback mode requires `keys(projectedTools)` to equal every projected tool ID, including built-ins that SessionLoop would otherwise materialize lazily. Descriptor `tools.enabled` is the canonical projected-plus-stage union, while `tools.terminal` identifies the stage finalizer.

Unsupported exact providers are rejected at the beginning of `BuildAgent.run`, before any worktree, session, evidence, message, descriptor, or runtime mutation. The ordinary generic provider remains registered and usable outside projected Build; capability rejection does not unregister or replace it.

Resume first consumes the existing descriptor plus frozen in-memory runtime callback surface and checks the exact identity/hash/projected/stage sets. It does not resolve the active package before that check. A process restart loses executable callback closures; until a persisted content-addressed closure reconstruction protocol exists, projected external resume after that loss fails explicitly instead of loading the currently active package as a substitute.

For the Claude Agent SDK adapter, every projected and private-stage OpenCorvus tool is exposed through one in-process MCP server backed by the already-materialized callback map. The SDK built-in tool set is explicitly empty for this mode, filesystem settings sources are empty, and no ambient OpenCorvus/global MCP server is mounted. The adapter owns an explicit bijection from each canonical ID to the exact Claude-visible `mcp__<server>__<tool>` name; `allowedTools`, `canUseTool`, callback dispatch, and event validation all consume that same map and never strip prefixes or normalize names. This avoids an incomplete canonical-to-native mapping and makes undeclared calls structurally unavailable.

`SkillTool` is materialized explicitly from the same frozen turn-owned skill projection: resolve `SkillMount` for the exact dynamic agent and available canonical set, initialize `SkillTool` with that surface, then insert its executable implementation before freezing the external surface. It is not expected to appear from `ToolRegistry`, which deliberately defers it.

External Build uses the existing private Build stage ABI as its single completion protocol. `report_build_result` and, for a managed worktree, `merge_back` are present in `stageTools`, the descriptor union, runtime contract, and provider callback map. Completion requires the real terminal callback to satisfy the collector. The retired external-only `structured_output` injection, done-event JSON parsing, prose inference, and host-after-exit merge path are deleted rather than retained as alternatives.

Every callback execution carries the real `projectID`, `sessionID`, `assistantMessageID`, provider tool-use ID, `taskID`, and dynamic `agentID`. The provider tool-use ID is also the persisted tool-part `callID`; neither BuildAgent nor the adapter invents a replacement. Event validation rejects undeclared provider names, non-bijective maps, call/result name disagreement, duplicate or missing results, a success result without one completed callback, and any attempt to execute one callback twice. Callback execution is the only execution path; telemetry only persists the already-executed call/result.

Codex and legacy Claude providers remain usable through the generic executor path but fail projected Build before any persistence until they implement this contract; that explicit unsupported result is not a fallback.

## Benchmark Definition

### Task and Input/Output

- Input: a strict external v1 package with two distinct dynamic agents sharing `base_role: build`, agent-local prompts/skills/tools/MCP, plus one invalid legacy package per removed schema surface.
- Output: the valid package loads and projects distinct agent identities end to end; every legacy/unknown/mismatched package fails at the authoritative boundary with a precise error.

### Environment

- Repository: `C:/Users/chuan/myhexin-local/opecorvus` on Windows host.
- Runtime/config isolation: existing `tmpdir` fixtures and isolated Bun runner; no live OpenCorvus/overlay restart.
- Package sources: repository `.opencorvus/expert-squads/**`, built-in `general`, generated payload, and `specs/artifacts/portable-expert-squad-template`.

### Timeout

- Disable Bun elapsed timeout for benchmark suites.
- Run child processes through the shared stdout/stderr inactivity runner.
- Default focused idle timeout: 120 seconds without output; long package/build checks may declare a larger idle interval only with a recorded reason.
- Test-local activity guards must reset from actual operation/log/progress events. A timer that starts at temporary-project creation and ignores ongoing Git/project-open output is invalid and must be repaired.

### Executable Acceptance Matrix

1. Strict schema accepts the canonical package and rejects `team`, `workflow`, `dispatch_targets`, `primitive`, top-level `agents`, `virtual_agents`, `dynamic_attributes`, old `role_base`, wrong prompt paths, orphan dirs/resources, and non-dispatchable base roles.
2. Registry/manager/payload/template all use the same parser and canonical directory semantics.
3. Resolver returns two distinct agent projections for a shared base role with isolated hashes and resources and exposes no projection/target/virtual aliases.
4. Dispatch schema accepts both dynamic IDs, rejects the bare base role, derives the adapter only through `AgentRoleContract`, and calls the exhaustive core implementation table without a workflow gate.
5. Real runner/session test proves dynamic ID in message, descriptor, runtime contract, tool context, package tool, skill, MCP, continuation, wake, direct reply, A2A request, and redispatch; base role/session kind stay `build`.
6. Catalog/routes/overlay/SDK expose every dynamic agent by agent ID and contain no virtual-agent fields.
7. Skill mounts reject unknown projected agents and never fall back to a native/base agent.
8. Generic prompt searches plus final composed-prompt tests find no package-specific strategy in core producers.
9. Focused tests, docs health, API generation/check, typecheck, `git diff --check`, and full relevant suite pass.
10. Independent review and manual second review find no known issue after benchmark success.

## Implementation Slices

1. **Schema and core adapter source**
   - Add explicit `sessionKind` and `dispatchAdapterID` fields to `AgentRoleContract`; this is the only base-role mapping.
   - Replace workflow-owned role/primitive bindings with advisory adapter references and make `AgentBaseRuntimeContract` derive from the role contract.
   - Replace manifest agent definitions in registry; delete duplicate identity/workflow/virtual schema and no-op options/helpers.
   - Delete free-form `dynamic_attributes` and its frontend-specific runtime parser.
   - Rewrite registry fixtures and strict rejection tests.
2. **Resolver and runtime identity**
   - Introduce one resolved dynamic-agent projection shape.
   - Make runner take required `agentID` only, resolve capability before model selection, and derive base role/session kind/adapter from the authoritative contracts.
   - Install one required projected-worker identity; use an explicit native/projected discriminated union in SessionPrompt and session loop.
   - Delete `agentName`, `agentKind`, `projectionID`, `targetID`, and virtual-agent runtime aliases.
3. **Dispatch, continuation, and A2A**
   - Derive dispatch adapter from base role exactly once and expose agent IDs as literals; delete workflow target filtering and resolved workflow bindings/primitive projections.
   - Preserve agent ID through tool metadata, continuation, wake, task API, coordination requests, and redispatch.
4. **Catalog, mounts, and package resources**
   - Remove virtual-agent API/types/UI and enumerate all projections.
   - Remove native/general fallback branches; make owner/mount failures explicit.
5. **Packages, payload, and template**
   - Migrate canonical directories/manifests to real dynamic IDs.
   - Regenerate payload and portable artifact from their generators; prove freshness and shared-base-role isolation.
6. **Prompt cleanup**
   - Audit final prompt producers, not only core text files; move non-general policy into packages and add composed-prompt regressions.
7. **Benchmark and debt audit**
   - Run the acceptance matrix with true inactivity timeout.
   - Compare `dev...HEAD` by path/line growth, run reachability/unused-code tools, inspect generated-source ownership, stale tests, temporary artifacts, and historical process teardown.
   - Delete only evidence-backed legacy/residue, rerun the full matrix, then independently review.
8. **Delivery**
   - Fetch `myhexin`, verify branch ancestry and hooks, commit with `dsw-33987`, push, and confirm remote ref.

## Baseline Failures

- `bun run --cwd packages/opencorvus typecheck`: five errors in workflow binding, resolver, and orchestrator dynamic-ID typing.
- Focused baseline under a 120-second stdout/stderr inactivity wrapper: fixture packages missing newly required `team/workflow`, legacy runner expectations, route-local false inactivity timeout, and final skill-route inactivity failure.
- Portable template freshness: checked-in artifact and generator disagree.
- Registry and targeted resolver tests fail on the half-migrated schema.
- `dev...HEAD` currently reports 4,268 commits ahead and roughly 897k additions / 528k deletions across 7,150 paths; `dev` predates this subsystem and is a debt/reachability comparison baseline, not schema authority.

## Legacy Candidates Already Proven

- Package `team`, package workflow/dispatch target/primitive schema and converters.
- Top-level `agents`, `virtual_agents`, `virtual-agents/**`, virtual-agent catalog/runtime/mount types and tests.
- Base-role reverse lookup helpers and unused `agentProjectionBaseRoleSet`.
- Empty `LoadPackageOptions` / `packageLoadOptions()` plumbing.
- `projectedPrimitiveTools` when it has no runtime consumer.
- Free-form `dynamic_attributes`, its frontend-only resolver, and workflow-owned base-role/adapter bindings.
- Old tests that require dynamic `agentName` rejection or base-role message identity.
- Fixed elapsed `{ timeout: 30000 }` runner tests used as architecture evidence.

These deletions are within the user's explicit cleanup authorization. Additional repository-wide candidates require reachability/generated-source evidence before removal.

## 2026-07-11 Runtime Closure Checkpoint

Accepted and verified:

- Wake preflights the dynamic identity, required base-role template, and model before session persistence; prepared user-message runtime ownership and transactional message/control persistence have focused regression coverage.
- Fact Check snapshots a terminal assistant message through its authoring user message's exact worker descriptor, retains the dynamic target agent ID, rechecks the canonical content hash before model execution, and remains bound to the original descriptor after a newer turn exists. The focused Fact Check suites pass 17 tests with 68 assertions; the A2A Fact Check group passes 3 tests with 28 assertions.
- `runAgentSession` resolves the dynamic agent before model selection, requires `Agent.get(baseRole)`, and separates fresh-session notification from per-turn exact-runtime readiness. Claim/listener/abort/observer cleanup is unified; the lifecycle suite passes 7 tests with 47 assertions, including an already-aborted listener-registration race. The broader runner prompt/error combination passes 28 tests with 231 assertions after replacing two legacy continuation fixtures with descriptor-derived exact worker bindings.
- Build's session-created event owns session/goal-run persistence. Build's runtime-ready event now means the first exact runtime of one Build dispatch; same-session internal continuation turns do not report another dispatch start and a different session fails. The external adapter carries the same `goalRunID` as both descriptor `goalRunID`/`attemptID` and runtime identity `goalRunID`/`attemptID` before provider execution.
- Build evidence currently passes: dynamic external goal identity 1 test with 14 assertions, runtime-ready observer semantics 1 test with 3 assertions, Build A2A start/recovery 2 tests with 23 assertions, and package TypeScript typecheck.
- Dynamic A2A continue/ask/fail/cancel/lineage/ownership/cancel-subagent coverage passes 20 tests with 167 assertions; an independent representative run passes 10 tests with 79 assertions. Every coordination request in `tools.test.ts` carries an exact worker binding.
- The portable template is a strict dynamic-agent package with nine non-base-role IDs and two isolated Build agents sharing `base_role: build`. Its exact-owned generator deletes stale files and empty directories; the independent template suite passes 6 tests with 105 assertions.

Still open at this checkpoint:

- Finish and independently review the six real repository package/payload migrations. Current focused evidence is repository dynamic packages 2/2, registry 50/50, and package manager 36/36 with one intentional skip; payload source content/freshness passes except for the tracked-file check that cannot see renamed destinations until they are staged.
- Replace catalog/server/overlay `virtual_agents`, `virtual_agent_id`, `dynamic_attributes`, old skill arrays, and old package paths with the current dynamic-agent catalog schema; perform real UI screenshot review for the affected settings panel.
- Remove global frontend/replica policy from generic core prompts and migrate it to the frontend packages; update current architecture and executable prompt tests.
- Migrate or delete the remaining resolver/route/overlay legacy tests, then complete repository debt audit, full verification, commit, and push.

New baseline evidence for the next slice:

- The six real packages now parse with 58 package-domain dynamic worker IDs and canonical `agents/<agentID>/` roots in the working tree; final test/review closure remains pending.
- `prompt-profile-resolver.test.ts` currently exposes 35 stale legacy-contract failures plus 46 skips. Unique current behavior must be migrated; redundant `virtualAgent`, mixed `skills`, local MCP, and deleted schema assertions must be removed rather than restoring production compatibility.
- Server route tests, overlay service/UI fixtures, core-prompt hygiene tests, document-health tests, and current architecture still contain executable/nonhistorical `virtual_agents`, `virtual-agent`, or base-role package-path assumptions.
- Independent prompt audit found global frontend/replica policies in `build-core`, `architect-core`, `requirements-core`, `visual-qa-core`, and `pre-terminal-reflection`, plus hard-coded base-role dispatch targets in `orchestrator-core`. These are pending direct replacement/package migration.

## 2026-07-12 Overlay Identity Projection Closure Checkpoint

### Recall

- Original requirement: `capability_projection.agents.<projection_id>` is the runtime identity; `base_role` is only a default agent/tool/runtime template seed. Overlay message cards, lifecycle projections, execution rail records, Screenshot Browser ownership, hydration, and browser fixtures must retain the exact dynamic `agentID`.
- Acceptance: no surface derives `agentID` from `author`, `resolvedRole`, `channel`, or base role; user-role messages do not claim the projected worker identity; missing or drifted lifecycle identity fails before mutation; dynamic Build boundaries retain the Build stage; real Node browser rendering remains chronological and visually coherent.
- Hard constraints: no fallback or compatibility path, no Bun-launched Playwright, real inactivity timeouts, real screenshots and manual visual review, independent review after the focused matrix.
- Recalled sources: this record, `specs/records/2026-07/2026-07-11-platform-runtime-external-goal-team.md`, `specs/current/architecture/04-extensions.md`, the expert-squad creator skill and checklist, and the prior independent rejection.
- Full-repository searches covered `agentID ??`, `agentID ||`, `author ??`, `author ||`, `String(info.author)`, `String(message.info.author)`, lifecycle handlers, hydrate view/session parsing, Screenshot Browser ownership, and all cited fixture factories. Remaining `String(...agentID || "")` sites are validation reads that reject absence; they do not synthesize identity.

### Implemented and verified

- Backend bridge/session mirror now require explicit root and standalone assistant identity; the removed `executor` default cannot reappear through persistence replay.
- Tree writer lifecycle projection requires explicit `channel` and `agentID`, rejects stage/agent/parent/goal drift, and never recovers either identity field from an existing session. A negative regression proves missing channel, missing agent ID, stage drift, and agent drift all fail without card mutation.
- Hydration validates transcript, view message, and view session identity before the first store mutation. Transcript/view fixture factories validate required identity rather than filling it.
- User-role messages remain real participant messages. A child user context uses the worker session's `agentID` only as ownership metadata, projects to a user card with no agent identity, and the later assistant continuation creates the dynamic agent card.
- Screenshot Browser ownership comes only from canonical card/message `agentID`; shared Build templates remain separate. Dynamic Build adjacent boundaries keep `role=build`, not `assistant` or the base-role identity.
- `goal-group-benchmark.ts` now carries and validates explicit transcript `agentID`; view identity is never built from `author`. The legacy benchmark still depends on Bun runtime services, so it was not used to launch Playwright; Node-porting remains explicit debt rather than a hidden exception.

Verification evidence:

- Overlay focused matrix: 207 tests, 1,030 assertions, zero failures across 10 tree-writer/hydrate/recovery/rail/Screenshot Browser suites.
- OpenCorvus bridge/session mirror: 24 tests, 95 assertions, zero failures.
- Overlay rail/static contracts: 35 tests, 184 assertions, zero failures.
- Overlay and OpenCorvus TypeScript typechecks passed.
- Formal Node browser tests passed for chronological adjacent message aggregation and Screenshot Browser projection; visual browser launch contracts passed 7/7.
- Manual screenshot review confirmed delegated user context and architect output are separate, chronological, unobscured cards; English expansion and Chinese collapsed labels render correctly.
- `git diff --check` passed except for Git's informational CRLF-to-LF notices on two existing Windows worktree files.

### Known non-identity visual debt

The freshly generated high-zoom Screenshot Browser full-window image still shows a real chat-header/workbench overlap, while the narrow panel itself renders correctly. Independent audit traced this to compressed center panes below their scale-adjusted minimum, an incorrect three-track chat-header layout, hidden overflow, and a non-reactive Screenshot Browser UI-scale memo. This is not an identity-projection failure, but Overlay cannot be called finalized until the separate visual slice is fixed and re-reviewed.

### Independent rejection and expanded browser-fixture closure

The second independent review rejected the first closure claim despite 251 focused tests, two Node browser tests, and both typechecks passing. It found two additional real Node fixtures, `agent-compact-visual-stress.test.ts` and `rewind-visual-stress.test.ts`, whose transcript/view builders still omitted `agentID`; both failed at the real page with `hydrateConversationView: view.messages entry missing messageID/sessionID/agentID`. It also found `document-health.test.ts` positively requiring already removed `goalWorkflows` fixture ABI.

The correction expanded beyond those samples:

- Both rejected stress fixtures now require exact message identity, derive stage only from real role/channel, carry exact view session/message identity, and stamp live part/lifecycle identity. Their formal Node tests pass and their compaction, minimum-layout, and rewind screenshots were manually reviewed.
- A TypeScript AST audit scanned every browser test object literal. It identified all remaining transcript info, view-message, and view-session shapes missing `agentID`, including long transcript, stream jank, global pressure, agent rail, summary/disclosure, controls, image preview, file link, reply box, card metadata, copy actions, titlebar, expert-squad selector, and goal-group fixtures. After migration, the same AST audit reports `missing_identity_objects=0`.
- Fixtures now separate display stage/session kind from dynamic identity. Global pressure resolves IDs from its declared projection templates; agent rail accessible labels assert dynamic IDs; root/user and assistant rows no longer share an invalid session identity.
- The related document-health subtest no longer requires deleted workflow/step factories, nonexistent fixture files, `goalWorkflows`, `board_step`, `goalLoopStepIDs`, or generic `Executor` labels. It passes with 84 assertions. Four unrelated pre-existing document-health failures remain recorded for the later debt slice: private lockfile URLs, helper wording, another missing old test path, and three records citing the untracked July draft.
- Formal Node browser verification after the expanded audit passed 21 cases across compaction, rewind, long transcript, streaming, global pressure, rail, summary, disclosure, reply, controls, image/clipboard/accessibility, file links, metadata tooltips, titlebar, expert-squad selector, and goal-group CSS. One parallel global-pressure sample exceeded its RAF threshold; the required isolated rerun passed at 70.2ms maximum without changing the threshold.

### Third independent identity review

The third read-only review accepted the dynamic-identity and Overlay-projection slice. Its independent TypeScript AST scan covered 100 browser test files and found 88 transcript/view identity objects, zero missing `agentID` fields, and zero initializers that derived `agentID` from display roles or authors. The reviewer also passed 91 identity unit tests, 19 representative Node browser tests, the rewind browser test, and the 84-assertion document-health subtest.

The reviewer reproduced one remaining failure in the compact visual fixture at its minimum-layout viewport assertion. Identity hydration completed, exact Build and Architect sessions existed in the card tree, and no identity notification was emitted. This is therefore retained as explicit layout debt for the next visual batch; it is not treated as an identity fallback or silently counted as a passing visual acceptance.
