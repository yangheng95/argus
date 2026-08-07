# CMS Java Write-Side Refactor Expert Squad

Date: 2026-07-19
Status: Implemented; application build acceptance externally blocked
Owner: Codex

## Recall

### User Request

Prepare OpenCorvus for a long-running autonomous refactor of a very large Content Management System (CMS) codebase, instantiate the actual project under `C:/Users/chuan/myhexin-local`, then use the current Expert Squad development Software Development Kit (SDK) to create one expert squad with a package-owned Skill that explains how to execute the refactor.

The supplied delivery scope is four legacy PHP modules and their operations user interface: seed, media, dictionary, and parent object. Existing Java services already own part of the read side; write behavior remains in `flashcms`. The declared Java repositories are `server-seed`, `media-source-server`, and `dictionary-server`; the parent-object service is not available yet. Dictionary is the first and smallest migration slice.

### Acceptance Criteria

- Instantiate `C:/Users/chuan/myhexin-local/cms-system-refactor` as a Git superproject whose explicit submodules are `flashcms`, `server-seed`, `media-source-server`, and `dictionary-server`.
- Install one project Expert Squad package with manifest ID `cms-java-refactor` under `C:/Users/chuan/myhexin-local/cms-system-refactor/.opencorvus/expert-squads/legacy-remote/cms-java-refactor/`.
- Create the package through `@opencorvus-ai/sdk/expert-squad-authoring`; do not hand-build a second schema, loader, installer, or active selection path.
- Provide concrete selector guidance, Orchestrator coordination, dynamic cross-repository roles, immutable virtual-workflow guidance, and one package-owned Skill named `cms-java-refactor-method`.
- Make the Skill define an evidence-first, vertical-slice migration method covering legacy PHP behavior, Java read/write contracts, persistence and side effects, the operations frontend, tests, cutover, deletion of the retired PHP write path, and post-change review.
- Treat dictionary as the first real slice without encoding a host-side gate or persisted workflow state. Seed, media, and parent object remain explicit later domain slices.
- Preserve `expert-squad.jsonc` manifest identity, `prompt_profile.active`, Registry, Manager, and `PromptProfileResolver` as their current single sources.
- Validate the source and installed packages through the real Registry/Manager/Resolver path, prove the package Skill is projected only to declared active agents, prove inactive-package isolation, and keep payload generation fresh if the package is distributed with the application.
- Record the target-environment preflight honestly. Do not claim the four application repositories or their build runtimes are ready when access or repository-owned version evidence is absent.

### Hard Constraints

- No fallback, compatibility alias, directory-name identity guessing, second active field, hidden message, host gate, state machine, keyword router, or package-owned workflow engine.
- Every runtime input must be a projected Skill file, a statically imported package asset, an explicit Task input, or a declared external service. The application repository locations and the unavailable parent-object repository are explicit Task inputs, not guessed package paths.
- Do not invent Java, Maven, PHP, Composer, database, frontend, or deployment versions before reading their repository-owned manifests.
- Do not create or switch worktrees. Do not restart, reload, close, or otherwise interfere with a running OpenCorvus or Overlay process.
- Preserve the existing OpenCorvus dirty worktree. The new package is project-local and must not alter the repository payload or the concurrently edited `packages/opencorvus/src/expert-squad/payload.ts`.
- Any code/package change requires focused regression tests. Specs remain under `specs/`, and indexes plus documentation-health checks must stay synchronized.
- New commits on `v0.0.9beta` must start with `dsw-33987` and push to `legacy-remote`, subject to the repository hooks.

### Sources Read

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-05-expert-squad-skill-projection-completeness.md`
- `specs/records/2026-07/2026-07-07-portable-expert-squad-template.md`
- `specs/records/2026-07/2026-07-16-expert-squad-development-sdk.md`
- `specs/records/2026-07/2026-07-18-crypto-trading-long-mission-benchmark.md`
- `specs/artifacts/长程编排测试.md`
- `specs/artifacts/portable-expert-squad-template/**`
- `packages/sdk/js/src/expert-squad-authoring.ts`
- `packages/web/src/content/docs/zh-cn/agents.mdx`
- Current project packages under `.opencorvus/expert-squads/**`, especially the package-owned Skill and projection patterns in `legacy-remote/mirror-watch`.

### Whole-Repository Search Evidence

- `rg -n "ExpertSquadRegistry|ExpertSquadPackageManager|PromptProfileResolver|expert-squads|expert-squad.jsonc|prompt_profile.active|select_expert_squad|active_skill_projection|capability_projection" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test specs/current specs/records`
  - Registry, Manager, Resolver, catalog/routes, Skill mounts, session runtime, Overlay, and records converge on the current package architecture. No new host surface is required for this package.
- `rg -n "loadEmbeddedPackage|EmbeddedPackageSource|renderSelectorSkillMarkdown|discover\\(|loadPackage\\(|loadSourcePackage\\(|importDirectory\\(|importArchive\\(|exportArchive\\(|payload|seed|release" packages/opencorvus/src packages/opencorvus/test`
  - Source validation belongs to Registry, explicit folder installation belongs to Manager, and generated payload release is provisioning rather than catalog fallback.
- `rg --files .opencorvus/expert-squads packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad packages/opencorvus/test/server packages/overlay/test | Sort-Object`
  - Repository packages use canonical namespaced roots, explicit agent projections, package-owned Skills, focused package contract tests, and generated payload coverage.
- `rg -n "expert-squad-authoring|writeExpertSquadPackage|validateFolder|importFolder" packages/sdk packages/web/src/content/docs packages/opencorvus/test/expert-squad specs/artifacts/portable-expert-squad-template`
  - `writeExpertSquadPackage` is the only SDK file materializer; `validateFolder` and `importFolder` are the distinct Registry and Manager operations.

### Callpoint Decisions

| Surface | Decision |
| --- | --- |
| SDK authoring subpath | Use unchanged to create a clean source directory. |
| `ExpertSquadRegistry` | Use unchanged to validate both source and installed package manifests/resources. |
| `ExpertSquadPackageManager` | Use unchanged for explicit project-scope installation; installation must not activate the package. |
| `PromptProfileResolver` | Use unchanged to prove active scheduler/worker/Skill projection and inactive isolation. |
| `cms-system-refactor/.opencorvus/expert-squads/legacy-remote/cms-java-refactor` | Add as the canonical installed project package. |
| `packages/opencorvus/src/expert-squad/payload.ts` | Leave untouched; a project-local package is not an application-distributed payload source. |
| Package-focused tests | Add a concrete target-project contract test and run it against the current Registry/Resolver implementation. |
| Overlay/catalog | No implementation change; validate through existing catalog/resolver tests rather than adding a UI-only path. |

### Environment Preflight Evidence

- `git`, Node.js, and Bun are available: Git 2.52.0, Node 25.7.0, Bun 1.3.13.
- Every supplied GitLab URL returned `Empty reply from server` during `git ls-remote`; no repository HEAD could be read or cloned.
- Java, Maven, PHP, and Composer are not available on the Windows Host path.
- The first URL probe without canonical `.git` suffix returned an empty response. A later canonical `.git` probe succeeded for all four repositories; the earlier result was a URL/access-path symptom rather than proof that GitLab itself was unavailable.
- The four repositories are now pinned as submodules under `C:/Users/chuan/myhexin-local/cms-system-refactor/repositories/`: dictionary `29ce9bf`, flashcms `7172c7f`, media `fe5cc28`, and seed `dfa8785`.
- The Java service POM files explicitly require Java 8 and Maven builds. `flashcms` owns its PHP dependency graph through `src/web/composer.{json,lock}`, its runtime through the internal Docker base `hub-dev.hexin.cn/website/flashcms:latest`, and multiple legacy Vue 2/Webpack frontends through their own lockfiles.
- Host Java, Maven, PHP, and Composer were absent at preflight. Runtime setup must follow these repository-owned facts; the unavailable parent-object repository remains a blocking input for that domain only.

### Independent-Agent Feedback

No independent Agent was requested or used. The current task uses one primary Agent as required by the active collaboration instruction.

## Design

The package will project a compact long-refactor team rather than copying all General agents:

- a requirements owner for the durable four-domain and dictionary-first acceptance contract;
- a cross-repository architect for domain boundaries, write ownership, contracts, and goal decomposition;
- PHP and Java source investigators that can inspect disjoint repositories concurrently;
- a migration implementer and operations-frontend implementer with non-overlapping owned paths when parallel work is safe;
- a behavior verifier for contract, data, side-effect, and sample parity evidence;
- an integrity reviewer that rejects fallback, dual write ownership, incomplete deletion, untested UI, or unsupported completion claims;
- a workload analyst for revising long-goal size from repository evidence.

The shared `cms-java-refactor-method` Skill is the single model-readable method authority. Role prompts specify ownership, required evidence, communication, and stop conditions without copying the method. Virtual workflows describe dictionary-first evidence dependencies and subsequent domain-slice reuse; they do not select an active workflow, persist step status, auto-advance, or dispatch agents.

## Implementation Plan

1. Author the manifest and files as an `ExpertSquadPackageDefinition`, then materialize a new source directory with `writeExpertSquadPackage`.
2. Validate the source package through the real Registry-owned validation path and install it explicitly at project scope through Manager ownership, without changing `prompt_profile.active`.
3. Add a focused package test covering identity, projected roles, shared Skill ownership, selector/README contracts, dictionary-first guidance, unsupported-completion rejection, active Resolver projection, and inactive isolation.
4. Read the checked-out repository manifests, document the multi-repository workspace, and install only the repository-proven build runtimes that can be validated locally.
5. Run focused Registry, Manager, Resolver, package, historical-link, document-health, and TypeScript checks, followed by `git diff --check` and a second manual review of the installed package.
6. Update this record with implementation and validation evidence. Commit the target superproject and the accepted OpenCorvus record changes separately. Push only to configured authorized remotes; the new superproject has no delivery remote until one is explicitly supplied.

## Initial Non-Accepted Boundary

The four supplied repositories and their build manifests are now present in the target superproject. The parent-object Java repository is still an explicit missing Task input. Full runtime acceptance additionally depends on access to legacy-remote's private Maven, Composer, Docker, configuration, database, and service infrastructure; each unavailable dependency must remain visible rather than being substituted.

## Implementation Evidence

- Created `C:/Users/chuan/myhexin-local/cms-system-refactor` as a Git superproject and pinned the four supplied repositories as explicit submodules under `repositories/`.
- Committed the complete target-project closure locally as `0da4597` (`dsw-33987 instantiate CMS Java refactor project`).
- Committed this OpenCorvus delivery record locally as `01ea00f01c` (`dsw-33987 record CMS refactor expert squad`).
- Authored the package through `writeExpertSquadPackage`, validated the generated source through `ExpertSquadPackageManager.validateDirectory`, and installed it with `ExpertSquadPackageManager.importDirectory` at explicit project scope with `replace: false`.
- Installed manifest ID `cms-java-refactor`, ten dynamic agents, Orchestrator guidance, selector guidance, the immutable `dictionary-first-write-migration` virtual workflow, and the package-owned `cms-java-refactor-method` Skill under `.opencorvus/expert-squads/legacy-remote/cms-java-refactor/`.
- Selected the package only through `.opencorvus/opencorvus.jsonc` → `prompt_profile.active`. Runtime Registry/Resolver validation observed the exact active identity, all ten agents, the declared Skill projection, and no CMS package leakage when `general` was selected.
- Installed Eclipse Temurin Java Development Kit (JDK) 8u492 and Apache Maven 3.9.16. Maven 3.9.16 was downloaded from the official Apache distribution, its SHA-512 digest was verified, and its `bin` directory was added to the user path.
- Configured Maven's single mirror at the Nexus repository reported by the internal service API: `http://repositories.myhexin.com:8081/repository/maven-public`. No credentials, alternate repository, or fallback mirror were invented.

## SDK Assessment

The first source-package validation rejected two non-canonical `depends_on` arrays before installation and left no installed package. After the authoring definition was corrected to canonical ordering, the same SDK/Manager path installed all fifteen package files successfully. The focused Registry, Manager, and Resolver regression suite also passed. This is expected strict validation behavior, not an SDK defect; no SDK source change is justified by the available evidence.

## Validation Evidence

- `bun test test/cms-java-refactor-package.test.ts` in the target project: 3 passed, 0 failed, 37 assertions.
- Real Registry/Resolver probe in `Instance.provide`: active identity `cms-java-refactor`, scheduler `orchestrator`, ten exact dynamic agents, one exact shared Skill, and inactive `general` isolation all matched the manifest.
- `bun run packages/opencorvus/script/run-with-inactivity.ts --inactivity-ms 120000 -- bun test packages/opencorvus/test/expert-squad/registry.test.ts packages/opencorvus/test/expert-squad/package-manager.test.ts packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`: 131 passed, 1 existing skip, 0 failed, 1,163 assertions.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`: 82 passed, 0 failed, 1,375 assertions after the record and indexes were staged.
- `git diff --check` passed for the target project and the task-owned OpenCorvus documentation paths.
- Maven builds were run serially under the inactivity-based supervisor. The dictionary and seed parent/API modules compile, but deploy modules and the media service cannot resolve the private `hexin-boot-starters` parent artifacts described below.

## Unresolved Acceptance Blockers

Full application-environment and migration acceptance is **not achieved** in this preparation task:

1. The parent-object Java repository URL has not been supplied, so that domain cannot be inventoried or built.
2. The reachable Nexus `maven-public` group does not contain `com.legacy-remote.b2cweb.boot:hexin-boot-starters:pom:2.3.4-M3` or `2.3.5-M1`. The repository-provided legacy Nexus endpoint timed out, and the exact-artifact Nexus search returned no item. Consequently all three Java deploy builds remain externally blocked.
3. `flashcms` requires the private Docker base `hub-dev.hexin.cn/website/flashcms:latest` plus private configuration, database, and service dependencies. Docker, PHP, and Composer were not installed as substitutes for that declared runtime, and the legacy Vue 2/Webpack projects have not yet produced executable evidence for a safe Node version.
4. The new superproject has no configured delivery remote. Its local commit can be created, but it cannot be pushed until an authorized remote is supplied.
5. OpenCorvus push hooks passed SDK import, AI runtime, eleven-package typecheck, API route, documentation, Overlay internationalization, and secret-scan checks, but legacy remote rejected the push as non-fast-forward because `legacy-remote/v0.0.9beta` is three commits ahead. The current worktree also contains more than one hundred unrelated staged files. Merging now would risk including another task's staged changes, so no merge, force push, reset, stash, or index rewrite was performed.

These blockers affect runtime/build readiness, not the completed project structure, Expert Squad package, active selection, package contract tests, or SDK-path validation.

## CMS long benchmark execution — Iteration 1

### Recall

- The operator corrected the benchmark scope: this run must exercise the real CMS refactor, not continue the unrelated
  cryptocurrency Mission. The persistent project is `C:/Users/chuan/myhexin-local/cms-system-refactor`; dictionary is the
  first vertical slice, followed by seed, media, and parent object when their own evidence and repositories permit.
- The operator explicitly selected model `hexin/gpt-5.6-sol` for this benchmark. Mission creation and every deliberate
  resume must pass that exact model reference; no default-model substitution is accepted.
- The run must use the development backend, Vite frontend, formal database, and a directory that will not be deleted.
  Progress supervision consumes bounded canonical `GET /mailbox` snapshots after real inactivity. Backend, Vite, worker,
  Maven, browser, and test logs are not tailed as a progress channel.
- Responsibility is explicit. OpenCorvus infrastructure owns generic Agent dispatch, durable lifecycle, session/tool
  visibility, cancellation, persistence, and mailbox liveness. The `cms-java-refactor` package owns CMS decomposition,
  cross-repository behavior recovery, functional correctness, package prompts/Skills, domain tools, verification, and
  honest blocker handling. Infrastructure must not branch on CMS, dictionary, PHP, Java, repository, agent, or error-text
  keywords.
- Sources re-read before execution: `AGENTS.md`; the benchmark and Expert Squad creator Skills and checklist; this record;
  `specs/artifacts/长程编排测试.md`; `specs/current/architecture/04-extensions.md`; the Expert Squad SDK record; Mission and
  Mailbox routes/docs; the installed project package, shared Skill, project config, package contract test, repository
  README, submodule identities, and repository-owned build manifests summarized above.
- Repository-wide searches re-enumerated Registry, Manager, Resolver, active profile, capability projection, Mission,
  Mailbox, health, project-directory, and SDK authoring call points. No CMS-specific host implementation is required before
  the run. No independent subagent was requested or used.
- The two Browser executor files and the cryptocurrency Iteration 69 section created during the wrong-scope investigation
  were removed exactly; no wrong-scope runtime restart, Mission wake, commit, or push occurred.

### Benchmark contract

1. Input: the pinned `flashcms`, `dictionary-server`, `server-seed`, and `media-source-server` repositories, the explicitly
   missing parent-object repository, project package `cms-java-refactor`, formal OpenCorvus database, and the operator's
   four-domain migration request.
2. Output: a durable Mission whose goals first reconstruct and migrate one behavior-complete dictionary write slice into
   Java together with its operations UI, executable positive/negative behavior evidence, inspected desktop screenshots,
   and deletion of the superseded PHP writer; later domains reuse the method only after domain-specific investigation.
3. Environment: healthy development backend and Vite frontend; database identity must equal
   `C:/Users/chuan/.local/share/opencorvus/opencorvus.db`; project identity remains the persistent path above; Java and Maven
   use the repository-proven toolchain; model identity is exactly `hexin/gpt-5.6-sol`; missing private artifacts and
   services remain visible rather than substituted.
4. Timeout: all local commands and benchmark waits use inactivity-based supervision. Mailbox snapshots are taken only
   after a bounded inactivity interval or an explicit timer wake, never by continuously following logs.
5. Infrastructure acceptance: every dispatch has one durable owner; every terminal or coordination outcome is visible;
   no duplicate goal/Task/session is created by recovery; a stopped Mission has a justified terminal, live-owner,
   operator-wait, or durable fail-stop explanation; formal database and mailbox projections agree.
6. Squad acceptance: the active Resolver projects exactly `cms-java-refactor`; the package preserves four-domain scope,
   dictionary-first behavior evidence, one final write authority, repository/path ownership, tests, UI states, screenshots,
   PHP retirement, and explicit external blockers without fallback, dual writes, copied assumptions, or unsupported success.
7. Product acceptance: real repository diffs and repository-owned tests support each completed claim. Mocked contracts are
   not End-to-End evidence. Frontend work must run the real page through Node-launched Playwright, inspect goal-bound desktop
   screenshots, cover required visible/error/focus states, and repeat until visually accepted.
8. Completion requires Mission and package success plus a separate manual review of repository diffs, legacy callers,
   Java contracts, persistence/side effects, UI data flow, screenshots, test outputs, mailbox chronology, and database
   lifecycle evidence. Any missing parent repository or private runtime dependency must keep the affected requirement
   explicitly unaccepted.

### Initial runtime evidence

- The existing development backend listens at `http://127.0.0.1:7878` and reports `healthy=true`, `version=local`, and the
  exact formal database path above. The existing Node-hosted Vite frontend listens at `http://127.0.0.1:5173` and returns
  HTTP 200. They are healthy reusable development processes; this run will not restart them merely to change project scope.
- The CMS superproject is clean on `main` at `0da4597`, with the four exact pinned submodule revisions recorded above.
  Package manifest ID and `prompt_profile.active` both equal `cms-java-refactor`; the project package test and real
  Registry/Resolver projection have already passed. The next action is one new CMS Mission wake, not a continuation or
  duplicate of any cryptocurrency Mission.

### Mission creation evidence

- The project Mission list was empty before creation. One wake created Mission `cms-java-refactor-20260719` with root
  session `ses_0865d37baffeG64lDgz2tb2Wd5`, model `hexin/gpt-5.6-sol`, and prompt profile `cms-java-refactor`.
- The wake preserved the four-domain objective, dictionary-first vertical-slice acceptance, external dependency boundary,
  infrastructure-versus-squad responsibility split, repository ownership, browser evidence, legacy deletion, autonomous
  repair/retest, and mailbox-only observer contract. No second Mission or unrelated Mission resume occurred.

### First mailbox/lifecycle observation

- Two bounded snapshots after 45 and 55 seconds of real inactivity returned an empty active Mailbox. This was treated as a
  missing-observability signal, not as proof that scheduling stopped; one read-only formal-database snapshot then inspected
  only Mission `cms-java-refactor-20260719` and root session `ses_0865d37baffeG64lDgz2tb2Wd5`.
- Durable messages prove `hexin/gpt-5.6-sol` remained active, read the package method/manifest/project boundary, persisted
  Mission frontier/notes/tasks, and prepared the required parallel PHP and Java investigator dispatch. No child Task had
  been created at the snapshot boundary because the first `panel` call was rejected before creation.
- Exact first bad transition: the model supplied array and boolean values under `panel.create_task` `checks.named`, whose
  schema requires each named check value to be a JSON Schema object. The host persisted a visible
  `AI_InvalidToolInputError`; the model identified the input-contract mistake, recorded it, removed the invalid optional
  named checks, and issued a second `panel` call that was pending at snapshot time.
- Classification: current evidence shows an Expert Squad/model tool-input quality error with successful infrastructure
  streaming, error visibility, and continued execution. It does not justify a host change or a CMS-specific validator.
  The still-empty Mailbox is a squad observability defect if no phase message appears after the corrected dispatch; wait for
  that real boundary before changing the package prompt.

### Phase 01 dispatch and Mailbox evidence

- The corrected `panel` call created one Task, `tsk_f79a600e5001Ow13GQbgxJV29V`, with Task root session
  `ses_08659feddffebyvyHut01i1EQk` and Orchestrator session `ses_08659f439ffeZyWmv4l8cbqclX`. It preserved model
  `hexin/gpt-5.6-sol`, active profile `cms-java-refactor`, the formal project namespace, and the investigation-only phase
  boundary. No duplicate Task was created from the rejected call.
- Durable child sessions prove true parallel start: Java investigator `ses_086589520ffed6hrXteLPcKCKN` and PHP
  investigator `ses_0865893e9ffeOVakq1Un8yyYIh` were created within 311 milliseconds of each other under the same
  Orchestrator. Both remained streaming at the bounded snapshot.
- The canonical Mailbox then exposed two progress items: `FlashCMS dictionary 调查已开始` and
  `dictionary-server 只读调查已开始`, with exact expert-squad, source-agent, Task, session, repository, and evidence refs.
  The earlier empty snapshots were therefore timing observations, not a Mailbox projection or persistence failure.
- Created current-thread heartbeat automation `cms-benchmark-mailbox-heartbeat` at a five-minute interval. Each wake must
  re-read this record and take one bounded project Mailbox snapshot; it must not tail logs. The heartbeat is deleted only
  after final benchmark acceptance or a proven terminal external blocker.

### Planning-role redispatch defect

- Mailbox and formal-database chronology proved that Task-scoped Requirements and Architect adapters first persisted the
  requirements snapshot and executable goal graph as intended. The resulting graph was defective: it contained meta-goals
  for requirements, architecture, and workload review instead of product-delivery goals.
- The Orchestrator then dispatched `cms-refactor-requirements-analyst` and
  `cms-cross-repository-architect` with `work_scope.kind=goal`. In particular, Architect was repeatedly called with
  `mode=initial_decomposition` for Goal 2. Each call produced a new plan/spec snapshot, after which the structured Task
  snapshot no longer recognized the preceding Goal 1 execution; the Orchestrator therefore dispatched Goal 1 again.
  Sessions `ses_08636ae86ffeBmSVPpvkvDAPCX` and `ses_0862d223fffe3jVA380Mwr4M40` are two distinct Requirements runs for
  the same `gol_f79c9237c001dKfuSRMzlXLkhP`, with different 11- and 9-requirement outputs.
- Classification: Expert Squad planning semantics, not infrastructure. The host persisted the exact requested sessions,
  goal bindings, adapter outputs, and plan revisions, and exposed each transition through Mailbox. No duplicate recovery,
  hidden failure, lost queue owner, or CMS-specific host branch is evidenced. The package's immutable workflow already
  declares Requirements, Architect, and Workload as Task-scoped, but its prompts did not explicitly forbid turning those
  planning stages into persisted delivery goals or re-running them at Goal scope.
- Repair plan: make the package method, README, Orchestrator overlay, and planning-role overlays state one lifecycle
  unambiguously: evidence investigators may precede planning; Requirements, Architect, and Workload run at Task scope;
  Architect emits only product-delivery and verification goals; planning documents are Task artifacts, not goals; later
  point repairs use the existing fine-grained Task tools rather than another `initial_decomposition`. Add package contract
  tests for these semantics, validate through the SDK-owned package Registry/Resolver path, then stop the looping Task and
  resume the Mission with exactly `hexin/gpt-5.6-sol` so a fresh Task receives the repaired projection.

### Expert Squad repair and Phase 02 recovery

- Updated the project package README, method Skill, Orchestrator overlay, Requirements/Architect/Workload overlays, and
  immutable workflow descriptions with the Task-planning versus product-goal boundary above. Added a package contract test
  that asserts all three planning nodes remain Task-scoped and that prompts forbid planning meta-goals and Goal-scoped
  `initial_decomposition`.
- Target-project package regression: 4 passed, 0 failed, 54 assertions. OpenCorvus Registry/Resolver regression: 74 passed,
  0 failed, 283 assertions. A broader PackageManager run exposed an independent Windows test-harness instability: tests
  that launch nested Bun fixtures can be terminated with exit 143 after a preceding test reset, and several ordinary tests
  still use Bun's mechanical five-second default. Targeted direct execution of the isolated Instance-backed case passed in
  7.12 seconds, while the same case after the preceding reset reproduced exit 143. An attempted timeout-only test edit was
  removed because it did not root-cause the child termination; no half-fix remains in OpenCorvus source.
- The package changed while Phase 01 still owned active projected sessions. The host correctly rejected later dispatches
  whose expected projection digests no longer matched the updated package and the Task terminated failed with visible
  evidence. This digest drift was caused by the deliberate package repair, so the Task's own label of it as a generic
  infrastructure blocker is not accepted as root-cause classification.
- The Mission autonomously created Task `tsk_f79dd28eb001BvwnxaaoZgDiNW` (`Phase 02: 恢复词典治理终态`) without a manual
  Mission resume. Its fresh projected agents consumed the repaired package and explicitly reported that the new graph will
  contain only future dictionary product-delivery and verification goals. It read the two investigator artifacts plus the
  prior requirements, architecture, and workload evidence, and did not rerun investigation or modify product code.
- The prior Task was then cancelled through canonical `POST /task/:taskID/cancel`; Mailbox exposed
  `agent.coordination.cancelled`. No Task or Mission record was deleted. The fresh Phase 02 Task remains the sole active
  recovery owner, so no additional resume is justified.

### Phase 02 completion and Phase 03 implementation start

- Phase 02 Task `tsk_f79dd28eb001BvwnxaaoZgDiNW` completed successfully. Its final executable graph snapshot
  `spc_f79f6980b001Y33c1g252RuUks` contains nine product-delivery and verification Goals rather than planning meta-goals.
  It preserved dictionary-first ordering, Java single-write authority, explicit private-environment blockers, real E2E and
  screenshot requirements, legacy deletion, independent behavioral/visual review, Integrity, and per-repository delivery.
- The repaired lifecycle did not reproduce the Phase 01 projection-digest mismatch. Requirements, Architect, Workload,
  Architect structural re-entry, and final Workload all completed. The contract evidence registry did not accept the
  historical Task/artifact/snapshot identifiers as research-evidence registry IDs; Phase 02 preserved the original IDs in
  Goal objectives and acceptance and required persistent-interface readability checks before dispatch, without inventing
  replacement evidence or rerunning investigators.
- The Mission autonomously created Task `tsk_f79fb1e47001gxWf62fpuzqRUt` (`Phase 03: 实现词典写合同`) without a manual
  resume. Goal 1 `gol_f79f69810001Do23TTCF10h7Ff` is owned by `cms-write-migration-implementer` session
  `ses_086044ca0ffeccCacaqJGZprVY`, using `hexin/gpt-5.6-sol`. Its first Mailbox message reports a preflight over the
  historical evidence and governing snapshots and explicitly refuses product changes until fields, authorization, errors,
  and the Goal 1/2 seam are confirmed. No intervention is currently justified.

### Phase 03 repeated-structured-output stall investigation

- Repeated unchanged Mailbox snapshots initially hid fine-grained activity. Read-only formal-database reconstruction then
  proved that implementer session `ses_086044ca0ffeccCacaqJGZprVY` retained a streaming owner and updated through
  `2026-07-19 11:14:22 UTC`; this is not a missing owner, dead scheduler, or lost session.
- The session is nevertheless functionally stalled. It accumulated 25 messages and 159 parts, including 58 tool parts,
  seven consumed/pending automatic compaction requests, and ten `StructuredOutput` calls between 10:48 and 11:14 UTC.
  Several structured calls completed successfully, several errored, and the latest was pending with empty input. After
  each compaction the agent returned to broad `search_code` queries over the Task trace (100-result truncations) and emitted
  the same Goal 1 objective/acceptance payload instead of editing or testing product code.
- Observable symptom: Mailbox remained at `Goal 1 preflight 已开始` / 5% while the hidden session repeatedly searched its
  own trace and compacted. Direct trigger: completed structured handoffs did not yield a terminal or implementation
  transition. Root ownership is not yet assigned: inspect all `StructuredOutput`, build-wrapper completion, compaction,
  and session-settling call sites before changing infrastructure or the squad. The active Task must not be resumed or
  duplicated while it still owns this streaming session.
- Source and message-part inspection assigned root ownership to the Expert Squad. The apparent repeated
  `StructuredOutput` calls belonged to automatic compaction turns, not a build finalizer lifecycle defect. The build agent
  repeatedly issued broad `search_code` calls over its own Task trace, often receiving 100-result truncations, which
  inflated context and triggered the next compaction. The host continuously persisted messages, tool parts, compaction
  controls, and streaming status; it did not lose or redispatch the owner.
- The architectural contradiction was explicit: Phase 02 called the Goal briefs self-contained while Goal 1 acceptance
  required the implementer to consume historical Task/artifact/snapshot IDs that its delivery tool surface could not read
  directly. This made runtime-history rediscovery the only apparent path. The implementer prompt also generically owned a
  PHP retirement surface even though Goal 1 explicitly excluded that later Goal's ownership.
- Cancelled looping Task `tsk_f79fb1e47001gxWf62fpuzqRUt` through the canonical project-scoped cancellation route after
  the first rejected request exposed the required `directory` query contract. Mailbox persisted `task.cancelled`; no Task
  or Mission record was deleted.
- Repaired the package README, method Skill, Orchestrator overlay, Architect overlay, implementer overlay, and immutable
  workflow descriptions. Delivery briefs must now embed accepted field-level facts, exact product paths or precise
  evidence references, known unknowns, ownership, dependency seams, and tests. Historical runtime IDs remain audit lineage
  and cannot be the only carrier of implementation facts. Delivery agents must not broad-search `.opencorvus` traces or
  replay planning transcripts; a missing fact is reported as an exact brief defect. PHP retirement is owned only by a Goal
  that explicitly includes it.
- Added package regression coverage for the self-contained evidence handoff and Goal-specific retirement ownership. Result:
  5 passed, 0 failed, 74 assertions. No OpenCorvus infrastructure source change was made for this squad-caused loop.
- Resumed Mission `cms-java-refactor-20260719` through canonical `/mission/wake` with model
  `hexin/gpt-5.6-sol` and active profile `cms-java-refactor`; the route returned the existing Mission session rather than
  creating a second Mission. The Mission first created Task `tsk_f7a19c95f0011LCD5WL9Ru4yiz` (`Phase 04: 核查取消后的词典工作区`).
- Phase 04 was a cancellation-cleanup/audit Task, not the replacement Goal 1 implementation owner. Its Requirements and
  Orchestrator sessions received `MessageAbortedError: external abort signal fired`. The Mission then persisted an operator
  note ordering the Task to stop runtime-trace rediscovery, make no product changes, record the no-change state, and leave
  the new Goal 1 to a fresh Task. A second Orchestrator session settled the Task as `task.cancelled`. This chronology does
  not evidence a scheduler-created duplicate or another implementation stall; immediately resuming again would risk
  creating another cleanup Task. Wait for the Mission's promised fresh Goal 1 Task before intervening.
- The Mission then created fresh Task `tsk_f7a21e6e0001m5pV2oa3bzmSWN` (`Phase 05: 实现词典写合同`) with implementer
  session `ses_085dcc924ffeuhJasYn3LNieCt`. The repaired prompt behaved correctly: it loaded the method, verified the clean
  dictionary-server worktree and three exact Java paths, refused broad FlashCMS or runtime-trace search, made no changes,
  and emitted an attention Mailbox message identifying one precise brief defect: four mandatory FlashCMS evidence paths
  were absent.
- Corrected that Task-scoped brief through canonical `POST /task/:taskID/message` without replacing the Task or rerunning
  investigators. The four proven product paths are `applications/input/controller/DictionaryController.php`,
  `package/Input/Business/Dictionary.php`, `package/Input/Service/Dictionary.php`, and
  `applications/recommend/controller/IfindController.php` under `repositories/flashcms/src/web/flashcms/`. The note limits
  the owner to targeted reads for sep/comma splitting, did/hashKey behavior, authorization, and stable error mapping, and
  explicitly excludes broad search, `.opencorvus` trace reads, later persistence/side-effect work, frontend cutover, and
  PHP retirement. The route recorded the operator note and returned `wake_status: started`, preserving
  `hexin/gpt-5.6-sol` and the same Phase 05 Task.
- The redispatched implementer consumed the correction without runtime-trace search and completed the owned Goal 1 code
  surface. It reports typed single-add, batch-add, batch-edit, and soft-delete contracts; stable errors and per-item
  results; an explicit authorization seam; a Goal 2 command port; controller orchestration; and nine positive/negative
  test methods. The API module clean-compiled 12 Java 8 sources.
- Deploy focused tests did not enter `testCompile`: the original private repository still lacks
  `com.legacy-remote.b2cweb.boot:hexin-boot-starters:pom:2.3.5-M1`, and the POM for
  `com.legacy-remote.zixun.boot:response-spring-boot-starter:1.3.3.RELEASE` is unavailable. A forced `-U` retry against the
  unchanged `legacy-remote-maven-public` configuration reproduced the blocker. Actual executed test count is zero; the worker
  explicitly did not claim authorization enforcement, persistence, DB writes, or migration completion.
- Reported worktree state is one tracked modification plus fourteen untracked files, all under accepted Goal 1 paths, with
  no commit, push, or worktree creation. This remains an implementation result with an explicit private-dependency
  verification blocker, not a fully accepted Goal or benchmark completion.
- Orchestrator correctly rejected treating the deploy private-dependency failure as a blocker for all still-executable
  tests. It redispatched the same implementer ownership to move pure field, batch, stable-error, and retry-semantics tests
  into the API module without changing dependency versions, repositories, or product runtime behavior.
- Fresh implementer session `ses_085bfaf0cffe285DoHlSxju404` completed through the build adapter with `status=passed`.
  It added the parent-managed `spring-boot-starter-test` dependency at test scope in the API module, clean-compiled the
  Java 8 API surface, and actually executed all nine API contract tests successfully. Deploy controller, authorization,
  and command-port tests remain blocked before Surefire by the original private dependencies, with zero deploy tests run;
  real authorization enforcement and Goal 2 persistence remain explicitly unimplemented.
- The active Orchestrator then entered independent code-review/finalization reasoning. Phase 05 Task terminal status and
  Mailbox completion were not yet persisted at the latest snapshot, so the Task is not yet recorded as accepted.
- Phase 05 Task `tsk_f7a21e6e0001m5pV2oa3bzmSWN` subsequently persisted `task.completed`. Acceptance is deliberately limited
  to the dictionary-server API/interfaces write-contract seam: `mvn -pl dictionary-server-api clean test` exited 0 with
  9 tests, 0 failures/errors/skips; clean compile built 15 main sources at Java target 1.8; `git diff --check` exited 0;
  Java 9+, TODO/FIXME, fallback, and dual/shadow-write self-checks had no hits.
- The terminal record explicitly excludes DB/domain/mapper/schema/repository implementation, FlashCMS, UI/E2E,
  `.opencorvus`, persistence, `isvalid` mutation, real authorization enforcement, and full migration completion. The
  deploy focused command still exits 1 before test execution because the original private dependencies are unavailable;
  its nine retained controller/auth/port tests remain at Tests run 0. Goal 2 owns transaction/persistence, hashKey/did
  generation, uniqueness/conflict, target existence, and selected-did plus direct-child soft deletion.
- No commit, push, or worktree was created. Mission has not yet exposed the next Goal 2 Task in Mailbox, so no manual
  resume is justified at this boundary.

### Independent route audit and Phase 06/07 Git checkpoint failure

- An independent read-only Agent re-read this record and `AGENTS.md`, took one bounded project Mailbox snapshot, checked
  the exact formal-database Task/session rows, and inspected the current dictionary-server diff without changing product,
  runtime, database, Mission, Task, process, or Git state. Its verdict is that the Mission remains on the intended
  dictionary-first route and Phase 05 did not overstate its API-only acceptance. The nine API tests and fifteen-source
  Java 8 compile are durable tool-output facts; deploy compilation/tests, persistence, real authorization, FlashCMS,
  UI/E2E, seed, media, and parent object remain unaccepted.
- The Mission did create Goal 2 Task `tsk_f7a4e409d001R42M4Vq4Am1WiV` (`Phase 06: 实现词典真实写入`), but it failed in
  about 2.3 seconds before any Orchestrator or worker session existed. A later automatic recovery Task
  `tsk_f7a557a3c001mO623a5Hp2gwWz` (`Phase 07: 修复脏子模块启动基线`) reproduced the same pre-agent failure. The bounded
  Mailbox exposes both `task.failed` events and the exact Git diagnostic: the superproject reports
  `repositories/dictionary-server` as modified with untracked content, while the root `git add -A` leaves no staged
  parent-tree change and `git commit` exits with `no changes added to commit`.
- Root cause is the generic Engine Git checkpoint boundary, not CMS functionality. `EngineGit.prepare()` is called before
  `Orchestrator.processTask`; its shared `commit()` stages and commits only `currentProjectDirectory()`. A Git
  superproject cannot stage file content inside a gitlink, so Phase 05's accepted child-repository diff received neither a
  child commit nor a parent gitlink anchor. Treating the root commit failure as `recorded_head`, manually committing the
  CMS repository, or repeatedly resuming would either record the wrong tree or bypass the infrastructure defect.

### Git repository-tree checkpoint repair plan

The repair is generic for initialized Git submodules and nested gitlinks; it must contain no CMS names, task-title routing,
fallback, compatibility alias, state machine, or product-specific gate.

| Callpoint | Decision |
| --- | --- |
| `EngineGit.prepare()` | Before orchestration, preflight the complete initialized repository tree for conflicts, checkpoint dirty repositories deepest-first, then commit the root gitlink changes and persist the root anchor plus repository commit mapping. |
| `EngineGit.complete()` | Use the same repository-tree checkpoint operation so accepted child-repository changes cannot be reported through a root-only commit. |
| `EngineGit.commitAcceptanceRound()` | Use the same repository-tree staging/commit semantics; an allow-empty root round may remain a time anchor, but child changes must first receive real commits and updated root gitlinks. |
| `forceAddDeclaredAcceptanceFiles()` | Route declared paths to their owning initialized repository instead of assuming every path is stageable from the superproject index. |
| `runTaskLoopInner()` | Keep the existing fail-stop ordering unchanged: a genuine repository-tree preflight/checkpoint error fails before Orchestrator execution. |
| `workspace_export` | Keep requiring `task.metadata.git.baseline.commit`; do not weaken or synthesize the baseline contract. |
| Worktree gitlink materialization | Leave unchanged. Its checkout/materialization behavior is a consumer of committed gitlinks, not the owner of Task checkpoint creation. |

Focused regression must construct a real parent repository with an initialized child submodule, leave tracked and untracked
changes inside the child, and prove: startup prepare creates a child commit plus parent gitlink commit; metadata records the
exact root and child anchors; a following Task starts clean and records the same root HEAD; completion captures a new child
change and advances the parent gitlink; conflict preflight fails before committing any repository. Existing single-repository
prepare/complete and loop fail-stop tests must remain green. After focused tests and typecheck, a fresh development runtime
is required before main-database E2E because the currently running backend cannot load edited source automatically; process
restart remains a separate action and is not authorized by this heartbeat.

### First infrastructure implementation candidate rejected by independent review

- The first candidate enumerated initialized gitlinks with `ls-files --stage -z`, recursively collected repository status,
  committed deepest-first, persisted clean and dirty repository mappings, and routed acceptance declared files to the
  longest matching repository path. Its focused regression passed 12/12 with 111 assertions, the loop/namespace tests
  passed 6/6, OpenCorvus typecheck passed, historical-doc links passed 21/21, and scoped `git diff --check` passed.
- Those green checks are insufficient. Independent read-only review rejected the candidate because it performed real child
  commits during the deepest-first loop. A later sibling/root/hook failure would return a Task error or skipped acceptance
  round while leaving unpersisted child HEAD changes. That is a new partial-checkpoint lifecycle defect, so the candidate
  is not accepted or eligible for commit.
- The same review found that `ensureGitignore()` could commit root maintenance before the candidate inspected child
  conflicts; the conflict test pre-seeded `.gitignore` and therefore did not exercise that order. It also required an
  existing cross-process project Git lock, explicit distinction between uninitialized and damaged gitlinks, detached-HEAD
  coverage, nested/sibling/root-failure coverage, acceptance force-add coverage, and a NUL-safe parser that does not reject
  newlines in legal paths.
- Revised design: acquire the existing cross-process project Git lock; inspect every gitlink and all conflicts before any
  maintenance commit; snapshot every owning ref and raw Git index before staging; checkpoint deepest-first with normal Git
  commits so repository hooks still execute; and treat the repository set as one compensating transaction. Any later
  sibling/root/hook failure restores every changed ref with compare-and-swap `update-ref` and restores every touched index
  byte-for-byte while leaving worktree content intact. Recovery success or exact recovery errors and partial commit IDs are
  persisted in baseline/result/acceptance-round progress evidence. No stash, reset, CMS-specific branch, hook bypass, or
  `nothing to commit` success inference is allowed.

### Second infrastructure candidate validation

- The second candidate reuses the existing `Worktree.withGitLock` process/disk lock, runs full repository-tree conflict
  inspection before `ensureGitignore`, distinguishes absent/empty uninitialized gitlinks from populated or unreadable
  damaged gitlinks, parses NUL-delimited gitlink paths without excluding newline characters, records detached `HEAD` and
  uninitialized gitlink identities, and applies the same transaction to baseline, result, and acceptance-round checkpoints.
- All fixture Git commands now use the production inactivity-supervised Git runner. Bun's unrelated five-second total test
  deadline is disabled only for this file; every external process still has the production 90-second no-activity deadline.
- Focused result after adding root-hook compensation, acceptance compensation, early-conflict/`.gitignore`, nested
  grandchild, detached child, explicit uninitialized, and damaged-gitlink cases: 16 passed, 0 failed, 132 assertions in
  112.64 seconds. This is candidate evidence, not final acceptance; independent second review is still required before
  commit, runtime refresh, or Mission continuation.

### Infrastructure repair accepted for source delivery

- The final candidate expands the maintenance transaction to begin before `ensureGitignore`: it backs up the root ref,
  raw index and `.gitignore` existence/content, then restores the exact pre-maintenance state if maintenance itself or any
  later repository-tree checkpoint fails. It also requires every successful `git commit` to resolve a non-empty new object
  ID and advance its owning ref. A post-commit missing ref is restored with a zero-object compare-and-swap rather than being
  skipped or overwritten without an expected value.
- Final real-Git matrix: 20 passed, 0 failed, 162 assertions. It covers the ten existing single-repository baseline/result
  scenarios plus initialized child baseline/following Task/result/acceptance, child conflict before maintenance, nested
  grandchild ordering, detached child rollback, root-hook ref/index rollback, maintenance-success then root-failure rollback,
  post-commit ref deletion, sibling failure compensation, unborn-root rollback, explicit uninitialized gitlink metadata,
  and damaged gitlink fail-stop.
- Acceptance/publisher and task-loop regressions pass: publisher 5/5; loop, namespace and export coverage 11/11 in the
  prior focused run; OpenCorvus TypeScript typecheck passes; historical documentation health passes 21/21; scoped
  `git diff --check` passes. Publisher Git fixtures were moved to the same production inactivity-supervised Git runner so
  the formerly failing 5.016-second case now passes without a mechanical five-second wall-clock timeout.
- Final independent read-only review found no P0/P1 and marked the source eligible to commit. One non-blocking P2 remains:
  failure to delete temporary index/maintenance backups or the existing project Git lock is currently emitted through
  ordinary runtime logging rather than durable Mailbox progress evidence. This can leave diagnostic resource residue but
  does not change checkpoint refs, indexes, worktree contents, or the Phase 06 recovery semantics.
- The running development backend still contains the pre-fix module graph. Source acceptance therefore does not authorize
  a Mission resume yet: main-database Phase 06 E2E requires an explicitly authorized backend restart or a separately
  started non-conflicting runtime that can use the formal database safely. No current OpenCorvus/Overlay process was
  restarted, stopped, refreshed, or otherwise disturbed during this repair.

### Phase 08 stale-runtime reproduction

- A later process probe showed Bun process `464` listening on `127.0.0.1:7878`, serving canonical project-scoped Mailbox
  requests, with command line `bun packages/opencorvus/src/index.ts serve --hostname 127.0.0.1 --port 7878`. Its creation
  time was `2026-07-19 13:53:54 +08:00`; repair commit `0c8241b924` was created at
  `2026-07-19 21:31:46 +08:00`. The process therefore predates the accepted source repair. This proves a runtime/source
  coherence risk; it does not by itself identify an authoritative loaded module hash.
- The existing Mission was woken once with `missionID: cms-java-refactor-20260719`, model `hexin/gpt-5.6-sol`, and active
  profile `cms-java-refactor`; the route returned `created: false` and existing Mission session
  `ses_0865d37baffeG64lDgz2tb2Wd5`, so no duplicate Mission was created. The prior claim that the process had loaded the
  repair merely because it ran the source entry point was incorrect and is withdrawn.
- The Mission created Task `tsk_f7aa443e7001cSRvPGGLHSsUQW` (`Phase 08: 实现词典持久化与副作用`). It failed before
  creating an Agent session with the same root-only Git diagnostic as Phase 06/07: the superproject saw the dirty
  `repositories/dictionary-server` gitlink, while root staging produced no commit. This is a real main-database
  reproduction against the stale process, not evidence that repair commit `0c8241b924` failed when loaded.
- Do not wake the Mission again against process `464`. The next valid E2E requires explicit authorization to restart the
  development backend after the repair commit (or an independently isolated runtime with single ownership of the formal
  database). No process restart is authorized by the heartbeat itself.

### Authorized post-repair runtime continuation

- The operator explicitly authorized the blocked restart. The exact Bun owner of `127.0.0.1:7878`, process `464`, was
  verified against its command line and stopped without touching Vite or other OpenCorvus/Overlay processes. New process
  `17344` started at `2026-07-19 21:58:48 +08:00` from the same development command, after repair commit `0c8241b924`.
- The new backend served the canonical project-scoped Mailbox for
  `C:/Users/chuan/myhexin-local/cms-system-refactor`. The existing Mission was then woken once with
  `hexin/gpt-5.6-sol` and profile `cms-java-refactor`; `/mission/wake` returned `created: false` and the existing session
  `ses_0865d37baffeG64lDgz2tb2Wd5`. No replacement Mission or duplicate wake was created.
- The immediate bounded Mailbox snapshot still ended at the historical Phase 08 failure. This is expected before the
  asynchronous Mission emits its next Task and is not yet evidence for or against the repaired checkpoint. Further
  supervision remains Mailbox-only and must not issue another wake while this one can still create the next Task.

### Phase 09 repaired-checkpoint E2E

- The resumed Mission created Task `tsk_f7aadec2e001U9O4LVCQ5iRYeh` (`Phase 09: 完成词典真实持久化`) on the new
  runtime. Mailbox event `pev_f7aaf5942001eGiS46Fdh9U2so` reports `Phase 09 Goal 2 启动基线已捕获` from Orchestrator
  session `ses_085512dd3ffeym2SD5idjssjXK`. This is the first main-database Task to pass the formerly failing dirty-child
  startup boundary after loading repair commit `0c8241b924`.
- A subsequent Mailbox event `pev_f7ab18181001gXPeZDyCYWVX5q` reports `Phase 09 Goal 2 架构分解已启动` from session
  `ses_0854ebf5effeLp7nWwusUqM9Ec`. The Task has therefore progressed beyond Git preparation into Expert Squad execution.
  No retry, duplicate wake, runtime restart, or manual child-repository commit is justified while these owners are active.

### Phase 09 repeated-build diagnosis

- Runtime identity is backend `http://127.0.0.1:7878`, formal database
  `C:/Users/chuan/.local/share/opencorvus/opencorvus.db`, Task root session
  `ses_08552138bffe8uN4xnJOcfeGM7`, and Orchestrator session `ses_08551e681ffe8QxOL9XjhIMROj`.
  The bounded Mailbox chronology showed three `goal.failed` events followed by one `goal.passed` event for implementation
  Goal `gol_f7ab5b726001JpbnngYGSt0S68`.
- Read-only database evidence confirms that this is not a persistence overwrite or fabricated pass. Build sessions
  `ses_085478f98ffe6x3MmxoBrf0lOu`, `ses_085400088ffeD8NP74V24OX3nY`, and
  `ses_0853b641affeFkmk5AoJJCXjGG` each persisted a failed execution report because the unchanged private parent POM
  prevented every deploy test from starting. The Orchestrator twice changed the Goal objective/acceptance contract and
  redispatched; after the third identical boundary it explicitly called `complete_goal`, accepting only the source/API/static
  delivery and exact blocker disclosure. Its durable reason states that Spring assembly, real DB/MyISAM persistence and
  Redis effects remain unproved.
- Independent verification Goal `gol_f7ab5b726002mYzPjgue5UNbb5` remains running under verifier session
  `ses_085367e9dffewBxBmX72Ux3GNM`. Therefore the implementation Goal's `passed` status is not full Goal 2 or migration
  acceptance. No Mission wake or Task restart is justified while that verifier owns the next transition.
- Responsibility is Expert Squad goal modeling, not generic scheduling. The implementation Goal mixed executable source/API
  delivery with unavailable runtime proof, then relied on blocker disclosure as an essential passing criterion. That
  ambiguity caused two contract rewrites and three attempts against the same immutable Maven blocker before the Orchestrator
  accepted the intended delivery boundary. After the current verifier reaches terminal state, revise the package Skill,
  Orchestrator overlay and Architect overlay so delivery and environment verification are separate acceptance owners. Once
  an external dependency blocker has been reproduced and precisely recorded, do not redispatch the same owner without new
  dependency/input evidence or a different still-executable acceptance surface. This remains prompt guidance, not a host
  gate, retry counter, state machine or keyword rule.

### Phase 09 verifier terminal evidence

- Verifier session `ses_085367e9dffewBxBmX72Ux3GNM` completed with durable terminal summary
  `fact-check verdict=needs_orchestrator_action (verified=8, corrected=3, unresolved=5)`. Its two
  `report_fact_check_result` tool calls completed successfully. The verifier found that source and mock-isolated tests can
  support several write semantics, but deploy/Spring/real DB/Redis evidence remains absent, the production authorization
  adapter is not implemented, and the legacy FlashCMS writer is still present. It therefore did not accept a unique
  runnable write authority.
- No verifier Mailbox terminal message accompanied the durable terminal event, even though the package method requires
  material blocker and terminal reporting through project-scoped Mailbox. The Orchestrator remains the active owner and
  must consume the fact-check result before the Task is terminal; no wake or redispatch is justified meanwhile.
- Expert Squad repair scope now includes three prompt defects after the Task owner settles: separate executable delivery
  from environment-only verification; prohibit repeating an unchanged external blocker without new input or a distinct
  executable surface; and require verifiers to publish a goal-scoped terminal Mailbox report that distinguishes failures
  owned by the current Goal from later cross-goal work such as PHP retirement. The verifier may expose later-slice gaps,
  but must not silently redefine them as current-Goal acceptance unless the persisted goal contract owns them.

### Phase 09 Task terminal and Expert Squad repair

- Task `tsk_f7aadec2e001U9O4LVCQ5iRYeh` reached durable `success` / `completed` with 2/2 persisted Goals terminal. Its
  bounded Mailbox terminal reports that the dictionary Java command service, Mapper write path, generated-hash ordering,
  update/soft-delete/cache semantics, and focused Java 8 API tests were delivered. Independent review found and caused
  correction of two real implementation defects: update SQL incorrectly changed `ctime`, and Redis invalidation occurred
  before generated-hash finalization. The final focused API matrix passes 9/9.
- This Task does not complete the dictionary vertical slice. Deploy tests still execute zero tests because private Maven
  parent `com.legacy-remote.b2cweb.boot:hexin-boot-starters:pom:2.3.5-M1` is unavailable. Spring assembly, real DB/MyISAM and
  Redis effects, production authorization wiring, the operations UI, FlashCMS writer retirement and PHP cutover remain
  unproved or undone. These are explicit later acceptance owners, not hidden success.
- The project Expert Squad was repaired at local superproject commit `26bc92c` (`dsw-33987 refine CMS squad blocker
  ownership`). The method Skill, README, Orchestrator, Architect, Implementer and Verifier overlays now separate
  repository-executable implementation delivery from environment-dependent verification; prevent equivalent redispatch
  when authoritative external dependency/input evidence is unchanged; require a terminal project Mailbox matrix; and
  separate current-Goal failures from cross-goal dependencies. This is prompt-level natural scheduling guidance, with no
  host gate, retry counter, state machine, fallback or keyword router.
- Target-project regression passes 6/6 with 98 assertions and scoped `git diff --check` passes. A real
  `Instance.provide` Registry/Resolver probe against the formal project resolves active identity `cms-java-refactor`,
  scheduler `orchestrator`, ten exact dynamic agents, one exact production Skill `cms-java-refactor-method`, active catalog
  identity `cms-java-refactor`, and no inactive `general` agent leakage.

### Workload granularity correction plan (superseded before implementation)

- This interpretation was wrong and was corrected by the user before any Expert Squad package file changed. It must not be
  implemented. The user's actual requirement is to create as many valid Goals as possible inside each Phase.
- Whole-package search covered `workload`, `goal size`, `small enough`, `smallest`, `fine-grained`, `granular`,
  `vertical slice`, and `behavior-complete` across the installed CMS package, its focused test, current OpenCorvus agent
  architecture, workload-agent tests, and July records. The live CMS callpoints are the method Skill, package README,
  Orchestrator overlay, Architect overlay, Workload overlay, virtual-workflow descriptions in `expert-squad.jsonc`, and
  `test/cms-java-refactor-package.test.ts`. Generic host workload machinery does not encode this CMS sizing policy and
  must remain unchanged.
- The proposed coarsening policy is withdrawn. No package or test change was made from it.

### Corrected high-cardinality Phase Goal plan

- Final user clarification: Phase scope must be large and each Phase must contain many Goals. A Phase represents a
  substantial domain migration milestone rather than one small use case; high Goal cardinality then exposes its independent
  delivery and verification work for concurrency and recovery.
- Within each Phase, maximize the number of independently executable, reviewable and recoverable Goals supported by the
  current repository evidence. Do not merge unrelated operations, acceptance surfaces or disjoint path owners merely
  because they belong to the same domain or repository.
- A Goal still owns a behavior-complete product increment: keep the controller/service/Mapper/test layers required for one
  use case together, while splitting create/update/delete, authorization, cache effects, PHP retirement, UI delivery,
  runtime verification and integrity review whenever their paths, owners, dependencies and terminal evidence are genuinely
  separable. This preserves useful Goal semantics while producing high cardinality and safe parallelism.
- Workload analysis must expand overly broad Goals, identify every disjoint path owner and independent acceptance boundary,
  and explain why any remaining combined scope cannot safely become separate Goals. No fixed numeric minimum, host gate,
  state machine, keyword rule or second workflow engine is introduced; the model maximizes decomposition from evidence.
- Live CMS callpoints remain the method Skill, package README, Orchestrator, Architect and Workload overlays, the
  virtual-workflow description, and the focused package test. Generic OpenCorvus workload infrastructure remains unchanged.
- Validation must assert the high-cardinality policy and rejection of broad same-domain bundling, then rerun package tests,
  real Registry/Resolver projection, Skill validation, scoped `git diff --check`, documentation health and manual review.

### Large-Phase / many-Goal package implementation

- Target-project commit `2f92ee0` (`dsw-33987 expand CMS phase goal cardinality`) updates package version
  `2026.07.19.2`. README, method Skill, Orchestrator, Architect and Workload now require each Phase to represent a large,
  substantial domain migration milestone while maximizing valid Goal cardinality inside it.
- Independent use cases, disjoint path owners, dependency boundaries, runtime proof, CMS UI delivery, PHP retirement and
  integrity review become separate Goals when they can execute and terminate independently. One behavior's necessary
  controller/service/Mapper/test layers remain together, preventing meaningless layer-only Goals.
- The policy explicitly rejects undersized one-use-case Phases, broad same-domain Goal bundling, fixed Phase templates,
  fixed Goal-count gates and a second workflow engine. Generic OpenCorvus workload infrastructure was not changed.
- Focused package regression passes 7/7 with 128 assertions; the package Skill passes `quick_validate.py`; scoped
  `git diff --check` passes. A real `Instance.provide` Registry/Resolver probe resolves active `cms-java-refactor`, ten
  dynamic agents, the one `cms-java-refactor-method` production Skill and the active catalog identity successfully.

### Mission wake empty-turn infrastructure diagnosis and repair plan

- After Phase 09 reached terminal success, the Mission child-result wake and one later operator wake both persisted their
  real user messages and consumed `wake_reason` controls, then each persisted a new assistant row with zero tokens, no
  parts, no `finish` and no completion timestamp. The exact pairs are
  `msg_f7ae76fb8001oKiDJU0XqBGOew` → `msg_f7ae76fed001kEaqg5eR5rYBRI` and
  `msg_f7af252010010OFebQcJU2Oc0q` → `msg_f7af2522b001PkTOVbftDQ0pVW`. There is no Mission queue row,
  pending control or protocol event after either wake. This proves that Mailbox projection and the CMS package are not the
  first bad transition: `SessionWake` entered a fresh prompt turn, created the assistant shell, then lost the turn before
  provider completion and before durable terminal publication.
- Source reconstruction found a lifecycle contradiction. `SessionStatus.set` intentionally seals the first terminal state
  to reject late writes from the same prompt owner, while `SessionWake` intentionally reuses a completed Mission session
  and starts a new prompt owner. `SessionPromptState.start` creates that new owner but does not begin a new lifecycle
  generation, so the prior terminal latch rejects the new `streaming`, `idle` and `terminal error` publications. The outer
  loop catch even treats the stale terminal as proof that the new error was already published. This is why the underlying
  pre-provider error is currently unknowable from durable state and why the session appears frozen.
- The assistant shell is created near the start of `processTurn`, before tool projection, Skill/system construction,
  memory injection, message conversion, context budgeting and `SessionProcessor.process`. Exceptions in those preparation
  surfaces escape without stamping the already-persisted shell with an error or completion time. The old terminal latch
  then suppresses the only remaining lifecycle error signal. Both defects are generic prompt-lifecycle infrastructure;
  neither is CMS-specific.
- Callpoint inventory: fresh prompt ownership is created only by `SessionPrompt.loop` through
  `SessionPromptState.start`; direct `start` references outside production are focused prompt-state tests. Wake callers are
  scheduler event, scheduler cron, Mission route, Task child-result refill and panel tool. Terminal writers in this
  lifecycle are `SessionPromptState.cancel`, the prompt-loop error publisher and outer Agent/session owners. The existing
  status-idempotency tests correctly protect one owner from streaming-after-terminal, but there is no test for a new owner
  reusing the same session after the old owner has fully finished.
- Repair design: make successful `SessionPromptState.start` explicitly begin a new prompt lifecycle generation before the
  loop publishes `streaming`; an attach to an existing owner must not reopen anything. Preserve first-terminal-wins within
  that generation. Separately, make `processTurn` terminalize its own assistant row when preparation fails after shell
  creation, then rethrow so the same error also reaches the session lifecycle. Add regressions for terminal → fully
  finished owner → fresh start → streaming/error, for attach preserving the existing latch, and for an exact pre-provider
  failure producing a completed assistant error rather than a zero-token empty shell. No CMS branch, fallback, keyword
  router, retry gate, state machine or second workflow engine is allowed.
- Runtime acceptance requires focused prompt/status/wake tests, typecheck, documentation health and independent read-only
  review. The currently running development backend cannot load the source repair automatically; formal-database Mission
  continuation must wait for an explicitly authorized runtime restart and then use the same Mission session, package and
  `hexin/gpt-5.6-sol` model exactly once.

### Mission wake lifecycle repair implementation and review corrections

- The first implementation merely deleted the old terminal latch when `SessionPromptState.start` acquired a fresh owner.
  Independent review rejected it: a late terminal writer from the released owner could still become the new owner's first
  terminal because status writes carried only `sessionID`. That candidate was not committed.
- The second implementation bound active prompt status writes to the exact `AbortSignal` owner and rejected old-token or
  unowned status writes while a new owner was active. Independent review rejected it because AgentRunner and Orchestrator
  publish their outer terminal after receiving the final assistant message; without a receipt they could be rejected while
  the prompt owner was still finalizing or standing by. That candidate was not committed.
- The accepted model gives every assistant message in the current prompt generation a stable in-memory
  `messageID → AbortSignal` receipt. `SessionStatus` recognizes only the active owner or the most recently finished owner;
  beginning a new generation clears the old terminal, old finished owner and old message receipts. AgentRunner,
  Orchestrator, local `delegate_agent`, and agent-coordination continuation failure publication carry the exact receipt
  captured from their returned/scheduled generation. A real lifecycle with a missing receipt fails explicitly; a caller
  using a custom loop that never created a `SessionPromptState` generation has no receipt contract and remains an ordinary
  unowned lifecycle publisher. One process now permits only one prompt owner for a session ID across directories, so a
  wrong-directory duplicate cannot overwrite ownership.
- Prompt-internal `streaming`, `retry`, `idle`, error and cancel writes carry the active owner. First-terminal-wins remains
  unchanged inside one generation. Tests prove that both a late old token and a late unowned outer terminal are rejected
  during a new generation; multiple assistant messages retain stable receipts until the next generation; the next
  generation clears every old receipt; and an outer terminal publisher can complete the active generation with the exact
  final-message receipt.
- The zero-token shell defect is repaired at the prompt-loop acceptance boundary. The outer catch reads only the latest
  assistant message bound to its exact owner and stamps `error`, `finish=error`, and `time.completed` before publishing the
  session terminal. If predictive/reactive compaction already deleted that shell, authoritative `NotFoundError` means there
  is no row to terminalize and no message is recreated. A failure to read or update a still-existing shell is surfaced as
  an `AggregateError`; it is not logged-and-swallowed.
- The real `SessionWake` regression starts from a completed session, injects a deterministic pre-provider preparation
  failure, waits using a no-activity deadline that extends on message/status changes, and proves a completed assistant
  error plus terminal session error. Focused validation currently passes: session lifecycle/wake/runtime/status matrix
  43/43 in the broad run; AgentRunner 26/26; cancellation ownership 6/6; local delegation and runner 19/19; coordination
  continuation 3/3; OpenCorvus TypeScript typecheck; and scoped `git diff --check`. The previously broken actor fixture now
  creates real persisted sessions before asking `SessionStatus` to publish lifecycle order keys (2/2).
- Writer inventory classification: AgentRunner, Orchestrator, local delegation and continuation supervision require and now
  carry receipts; Task direct-reply loop failures are terminalized and published by `SessionLoop` itself; stage setup
  failures occur before a prompt owner exists; cancellation publishes through the matched prompt owner; `SessionActor` is
  a separate actor lifecycle and its unowned late write is intentionally rejected if a prompt generation currently owns
  the same session. No CMS-specific routing, retry gate, keyword matcher, fallback or second workflow engine was added.
- Final post-review validation passes after replacing the reverse-map latest-message lookup with an explicit latest-message
  pointer inside the same generation receipt registry: OpenCorvus TypeScript typecheck; prompt lifecycle, wake and actor
  regressions 28/28; isolated runtime-contract wake regressions 4/4; AgentRunner and local delegation 19/19; coordination
  ownership 15/15; historical-document health 21/21; and the scoped diff check. The first combined test attempt caused
  unrelated Windows process-supervisor readiness and global `Instance.dispose()` interference between suites; every
  affected suite passed in its own process with Bun's explicit 20-second per-test timeout. This is test isolation evidence,
  not a product fallback or a relaxed lifecycle assertion. Independent read-only review found no remaining P0/P1 issue.
  Its non-blocking P2 observation is that same-generation message receipts remain allocated until the next generation;
  this is deliberate because standby outer publishers still need the stable receipt, while each new generation replaces
  the complete map rather than accumulating across generations. The suggested direct regression now also proves that the
  latest-message pointer advances on each bind and is absent at the beginning of the next generation.

### Standing authorization for Codex-owned development backend restarts

- On 2026-07-20 the operator explicitly authorized Codex to restart server processes that Codex itself started whenever
  needed. This supersedes the earlier per-restart authorization blocker only for proven Codex-owned services; it does not
  authorize interference with Vite, Overlay, or any process whose ownership has not been established.
- Before the first restart under this standing authorization, `127.0.0.1:7878` had exactly one listener: recorded Bun
  backend process `17344`, executable `C:/Users/chuan/.bun/bin/bun.exe`, command
  `packages/opencorvus/src/index.ts serve --hostname 127.0.0.1 --port 7878`, matching the prior authorized launch record.

### Formal-database recovery and post-lifecycle-repair Mission wake

- Process `17344` was stopped after exact executable and command-line ownership verification; Vite and every other process
  were untouched. The first replacement, process `10544`, was launched from the live dirty worktree. `/global/health`
  proved that it opened the correct formal path but had automatically rotated the database because the live worktree's
  concurrent, uncommitted `interactive_artifact` table was absent from the persisted schema. It reported backup
  `opencorvus.schema-backup-2026-07-19T16-56-32.099Z-34ee1fce-ac8a-4f9e-bd67-9e9392c23eb7.db` and reason
  `missing table interactive_artifact`; its new database contained zero sessions, messages, protocol events and Tasks.
  No Mission wake was sent to that empty database.
- Read-only comparison proved that the 83,861,504-byte backup retained 159 sessions, 3,171 messages, 7,187 protocol events
  and 19 Tasks. Process `10544` was stopped. The empty database plus WAL/SHM files were renamed and preserved as
  `opencorvus.empty-after-schema-refresh-2026-07-19T16-56-32.099Z.db*`; nothing was deleted. The authoritative backup was
  copied back to `opencorvus.db` with matching SHA-256
  `9CF873D8A5DEB5825C8B8888C52686942CBC51C80A77D67A870073918563894E`.
- Concurrent repository work had advanced committed `HEAD` to `fde22206db`; it contains lifecycle repair `782d78b9bf` as
  an ancestor and contains no committed `interactive_artifact` schema. A persistent non-worktree archive runtime was
  provisioned at `C:/Users/chuan/myhexin-local/opencorvus-cms-runtime-fde22206db`, dependencies were installed from the
  committed lockfile, and the repository SDK was built because generated `dist` files are intentionally absent from Git
  archives. This preserves the dirty primary worktree without copying its uncommitted schema into the benchmark runtime.
- Archive-runtime backend process `9396` listens on `127.0.0.1:7878`. `/global/health` resolves the exact formal database
  and reports no schema refresh. A bounded project Mailbox read restored the prior 55 active/unread entries, with Phase 09
  completion `pev_f7ae76fab001p02OwzymKJmHg8` still latest.
- Exactly one canonical `/mission/wake` then resumed `cms-java-refactor-20260719` with model `hexin/gpt-5.6-sol`, active
  profile `cms-java-refactor`, and the large-Phase/many-Goal contract. The route returned `created: false` and existing root
  session `ses_0865d37baffeG64lDgz2tb2Wd5`. The immediate bounded Mailbox snapshot remained at Phase 09 completion; further
  progress observation belongs to the existing heartbeat and must remain Mailbox-only.

### Mailbox inactivity resume

- Five consecutive bounded heartbeat snapshots through 2026-07-19T17:32:51Z retained the same latest event
  `pev_f7ae76fab001p02OwzymKJmHg8`, unread/active count 55, and no new failure, terminal, progress or operator-wait message.
  This established a real no-activity interval rather than a process-start deadline.
- The first two resume HTTP attempts were rejected before execution by the project-scoped route and request schema:
  `directory` must be supplied as the route query/header and the natural user message field is `text`, not `prompt`.
  Neither rejected request reached Mission wake execution.
- One corrected canonical `/mission/wake?directory=...` request resumed the existing Mission with exact model
  `hexin/gpt-5.6-sol`, profile `cms-java-refactor`, and an instruction to retain the large Phase/many-Goal frontier without
  repeating Phase 09 or equivalent private-POM probes. It returned `created: false` with the same root session
  `ses_0865d37baffeG64lDgz2tb2Wd5`; no second Mission or session was created. The immediate bounded Mailbox snapshot remained
  unchanged, so the next heartbeat must wait for a newly published canonical event rather than issue another wake.

### Phase 11 concurrent ownership failure and Expert Squad repair plan

- Canonical Mailbox chronology proves that this is a Squad stability defect rather than a generic scheduler failure. A
  Phase 11 implementation run first reported one batch request, index-derived deterministic sort and passing focused tests;
  a later independent verifier then observed that `DictionaryController.php` had been rewritten during verification into
  one `createBatch` call per item with success-driven sort. Its final contract checker failed `single_batch_call`,
  `index_sort`, `failure_gap`, and `exact_hash_field`. The shared product path changed between accepted implementation
  evidence and terminal verification while multiple Goal runs for the same Goal remained active.
- Repository-wide package search found the current single-owner sentence in `README.md`, `disjoint_goals` concurrency on
  implementation and verification roles, and decomposition prompts that split disjoint path owners. It found no instruction
  defining ownership as a temporal lease across active Goal runs, redispatches, verifiers and integrity review, nor an
  explicit handoff requirement before another Goal can read or write the same product path. The broad wording therefore did
  not prevent nominally separate Goals from concurrently mutating one shared controller and contract.
- Repair remains package-owned prompt guidance, not an OpenCorvus host gate or CMS-specific scheduler branch. The method,
  Orchestrator, Architect, Workload, frontend implementer, verifier and integrity reviewer will require an exact owned-path
  set per Goal; overlapping writers must be represented as dependencies under one current owner; redispatch transfers the
  same lease only after the prior run is terminal; read-only verification starts only after the mutable owner publishes a
  terminal handoff and must fail if those paths change during review. Disjoint repository/path owners retain safe
  concurrency, preserving the large-Phase/many-Goal requirement.
- Package regression tests will assert this temporal ownership and handoff contract across all relevant prompts, the
  manifest version will advance, and validation will cover the project package test, Skill validation, registry/resolver
  loading, historical-document health and scoped diff checks. No current FlashCMS product edits or private runtime blocker
  will be modified by this repair. No independent subagent is used for this package-local correction.

### Phase 11 temporal ownership repair implementation

- Target-project commit `bb153cf` (`dsw-33987 prevent overlapping CMS goal ownership`) advances package version to
  `2026.07.20.1`. README, method Skill, Orchestrator, Architect and Workload now define each Goal's exact owned-path set as a
  temporal ownership lease. A path intersection or shared mutable contract becomes a dependency under one current owner;
  redispatch transfers the same lease only after the prior run is terminal and publishes the authoritative path handoff.
- The frontend implementer is the exclusive temporal owner of its declared set and must stop visibly on an intersecting
  active Goal instead of overwriting it. Behavior and integrity reviewers begin from terminal ownership handoff, remain
  read-only and fail if leased paths change during review. Proven-disjoint path sets retain parallel execution, so the fix
  does not shrink the large Phase, reduce Goal cardinality, or serialize unrelated repositories.
- Test-driven evidence: the new package regression first failed because no prompt contained `temporal ownership lease`;
  after the package change, `bun test test/cms-java-refactor-package.test.ts` passes 8/8 with 155 assertions and scoped
  `git diff --check` passes. `quick_validate.py` accepts the updated package Skill. Live project-scoped Registry/Resolver
  routes resolve active/project identity `cms-java-refactor`, package version `2026.07.20.1`, ten projected agents, production
  Skill `cms-java-refactor-method`, and the updated temporal-lease virtual-workflow description. No OpenCorvus core or SDK
  source was changed because the observed defect was fully owned by Squad decomposition and handoff guidance.

### Recall — cross-Task product-surface ownership defect

- The operator's benchmark contract is unchanged: autonomously complete the four-domain CMS Java write-side refactor,
  dictionary first, using the formal database and exact model `hexin/gpt-5.6-sol`; supervise through bounded project
  Mailbox snapshots rather than logs; classify generic lifecycle failures as infrastructure and CMS functional or
  decomposition failures as Expert Squad defects; keep each Phase large and maximize valid Goal cardinality inside it.
- The first temporal-lease repair correctly changed worker behavior: when a worker observed an overlapping edit, it
  published a Mailbox conflict and stopped instead of overwriting the other writer. It did not, however, prevent two
  already-persisted Tasks (`Phase 10: 迁移词典运营写面` and `Phase 11: 迁移词典运营写面`) from each redispatching the same
  dictionary create/controller/test surface under contradictory sort contracts.
- Canonical Mailbox evidence is causal rather than title-based. Phase 11 terminal evidence accepted one batch request with
  `sort = baseSort + inputIndex`; a Phase 10 run then reported that it owned and restored per-item batch requests with
  success-driven sort; a later Phase 11 run observed those exact owned test paths change, stopped, failed, requested
  coordination, and was redispatched after its local Orchestrator concluded there was no live owner. Meanwhile the other
  Task also retained redispatch activity. The observable failure is therefore repeated cross-Task contract mutation, not
  merely two similarly named Tasks.
- Sources re-read before this repair: `AGENTS.md`; the Expert Squad creator Skill and complete checklist;
  `specs/README.md`; `specs/current/architecture/04-extensions.md`; the July record index; this record's Recall and latest
  execution entries; the installed package manifest, README, method Skill, Orchestrator, Architect, Workload, frontend,
  verifier and integrity overlays; and `test/cms-java-refactor-package.test.ts`.
- Whole-package search command:
  `rg -n --hidden "temporal ownership lease|live owner|authoritative|redispatch|project-scoped|mailbox|owned-path|contract" .opencorvus/expert-squads/legacy-remote/cms-java-refactor test/cms-java-refactor-package.test.ts`.
  It found Goal-local temporal lease language on every relevant prompt, but no rule that one overlapping product surface
  belongs to exactly one active Task across the project, no pre-dispatch reconciliation of project Mailbox evidence, and
  no rule preventing a new Phase/Task from duplicating an unfinished domain surface. Generic Registry, Manager, Resolver,
  scheduler, Task, and SDK callpoints remain unchanged.
- No independent Agent is used for this focused package correction. No host gate, atomic lease table, retry counter,
  state machine, keyword matcher, fallback, duplicate active-squad source, or CMS-specific scheduler branch is permitted.

### Cross-Task product-surface ownership repair plan

- The Expert Squad must model a CMS product surface as project-wide planning ownership before Goal concurrency is
  considered. One active Task owns an overlapping domain/controller/contract surface. A new Phase or Task may be created
  only for a genuinely disjoint product surface or after the previous Task has terminally handed off that surface; it must
  not duplicate an unfinished dictionary write surface merely to continue or recover it.
- Before creating a Task, revising a Goal graph, or redispatching an overlapping Goal, the Orchestrator must reconcile the
  current Mission task graph with bounded project-scoped Mailbox handoffs and coordination messages. If another Task owns
  the same paths or mutable contract, continue or repair that Task, or explicitly settle the stale duplicate and select
  one persisted acceptance contract. It must not let each Task infer authority from only its own local run state.
- Contract authority comes from the accepted persisted requirement plus terminal path handoff and cited product evidence,
  not latest timestamp, Task title, or whichever worker wrote last. Contradictory duplicate Tasks are dependencies to be
  reconciled by the Orchestrator, not parallel Goals and not a reason to oscillate product files.
- Large Phase scope and high Goal cardinality remain mandatory inside the single owning Task. Proven-disjoint path sets
  still execute concurrently; only duplicate Task ownership of an overlapping product surface is removed.
- Add the rejection contract to the focused package test first, then update README, method Skill, Orchestrator, Architect,
  Workload and immutable workflow guidance and advance the manifest version. Validate package tests, Skill validation,
  live Registry/Resolver projection, documentation health and scoped diffs before allowing the Mission to continue.

### Codex-owned archive backend recovery

- The archive backend process `9396` later exited. A bounded Mailbox request failed with connection refused, proving the
  process was dead rather than merely inactive. Under the operator's standing authorization, only that Codex-owned backend
  was restarted from `C:/Users/chuan/myhexin-local/opencorvus-cms-runtime-fde22206db`; Vite and Overlay were untouched.
- The current listener is process `29220`, executable `C:/Users/chuan/.bun/bin/bun.exe`, with command
  `packages/opencorvus/src/index.ts serve --hostname 127.0.0.1 --port 7878`. `/global/health` is healthy and resolves the
  formal database `C:/Users/chuan/.local/share/opencorvus/opencorvus.db`. The restored project Mailbox retained the prior
  chronology; no schema refresh or empty-database wake occurred.
- Because the earlier post-package-repair wake died before publishing progress, one recovery wake resumed the same Mission
  and root session with `hexin/gpt-5.6-sol`, `cms-java-refactor`, and `created: false`. Subsequent bounded Mailbox events
  produced the Phase 10/11 conflict evidence used above, so no additional inactivity wake was issued.

### Cross-Task product-surface ownership repair implementation

- Target-project commit `aa0815f` (`dsw-33987 unify CMS product surface task ownership`) advances package version to
  `2026.07.20.2`. README, method Skill, Orchestrator, Architect and Workload now require project-wide product-surface
  ownership: one active Task owns an overlapping domain/path/contract surface across the Mission, while the owning large
  Phase still exposes the maximum valid set of disjoint Goals.
- Before Task creation, graph revision or redispatch, the Orchestrator must reconcile the current Mission task graph with
  bounded project-scoped Mailbox handoffs and coordination evidence. It continues or repairs the existing owning Task, or
  explicitly settles a stale duplicate while preserving one evidence-backed acceptance contract. Contract authority is
  persisted requirements plus terminal path handoff and cited product evidence, not timestamp, Task title, or last writer.
- The focused regression was added first and failed on the absent `project-wide product-surface ownership` contract. After
  the package repair, `bun test test/cms-java-refactor-package.test.ts` passes 9/9 with 179 assertions. The package Skill
  passes `quick_validate.py`; target-project scoped `git diff --check` passes.
- Live project routes resolve active `cms-java-refactor` version `2026.07.20.2`, ten exact projected agents, production
  Skill `cms-java-refactor-method`, and workflow guidance containing one owning Task plus the maximum independent dictionary
  Goal set. Historical links and document health pass 82/82 with 1,354 assertions. No OpenCorvus core, SDK, Registry,
  Manager, Resolver, Task, or scheduler source changed because the defect remains package-owned decomposition guidance.
- The target superproject has no configured remote, so commit `aa0815f` cannot be pushed. Existing FlashCMS submodule
  modifications and `.test-tools/` remain untouched and outside the package commit.

### Recall — root reconciliation must produce a real Task decision

- The user request, acceptance criteria and constraints remain those in the main Recall and cross-Task Recall above. In
  particular, the benchmark remains Mailbox-supervised, every Mission resume uses `hexin/gpt-5.6-sol`, Phase scope stays
  large with many valid Goals, and CMS-specific coordination belongs to the package rather than host gates or state logic.
- Two exact same-Mission wakes delivered project-wide reconciliation instructions after Phase 10 and Phase 11 continued
  modifying shared FlashCMS controller/view/test paths. The Phase 11 Orchestrator then emitted prose claiming it had frozen
  writers and preserved the current paths, but called no tool. The host correctly published
  `OrchestratorNoDecisionStopError` as `pev_f7c096795001B06evvKaO4Wz5R`. This is the first bad transition for the freeze
  response; the later failed Goal is a consequence, not the root cause.
- Visible Mailbox chronology is sufficient to prove the package-side prompt defect: the Orchestrator understood the root
  request but treated prose as a lifecycle action. Per the heartbeat constraint, no database query is performed in this
  iteration; hidden database details remain unknown, while the public protocol event explicitly states that no tool call
  occurred. Source inspection confirms the scheduler exposes `manage_task` and the host core already requires a real
  deciding tool, so weakening `OrchestratorNoDecisionStopError` would be the wrong infrastructure fix.
- Sources read: `AGENTS.md`; this record; the Expert Squad creator Skill and checklist; the scheduler debug Skill;
  `orchestrator-core.txt`; `host-agent-registry.ts`; `orchestrator/tools.ts`; Task/Goal lifecycle schemas; the installed
  package README, method Skill, Orchestrator overlay, manifest and focused package test.
- Callpoint searches:
  `rg -n "manage_task|ManageTask|OrchestratorNoDecisionStopError|NoDecision" packages/opencorvus/src packages/opencorvus/test`
  and
  `rg -n --hidden "freeze|root Mission|manage_task|calling any tool|decision contract|project-wide product-surface ownership" .opencorvus/expert-squads/legacy-remote/cms-java-refactor test/cms-java-refactor-package.test.ts`.
  They show the exact package gap: `manage_task` is projected, the host contract is already explicit, but the CMS package
  never says that root-Mission reconciliation must end in a real lifecycle tool result.
- No independent Agent is used. No host core, Task schema, scheduler decision contract, retry gate, state machine, fallback
  or keyword router will change.

### Executable root-reconciliation repair plan

- Root reconciliation must name the selected owning Task and the stale duplicate in natural coordination messages. The
  stale Task Orchestrator must call `manage_task` action=`cancel_task` with an evidence-backed reason after live owners are
  terminal; plain prose, a Mailbox status, or a claimed freeze does not settle Task lifecycle.
- The selected owning Task must make an appropriate real decision tool call: continue through `modify_goal` or an exact
  disjoint dispatch, complete/fail when evidence warrants it, or cancel only when root reconciliation selected it as stale.
  If the root message lacks enough evidence to choose, the Orchestrator must use the existing visible decision tools rather
  than pretend that a textual pause changed engine state.
- Add the failure contract to the target package regression first. Then update README, method Skill and Orchestrator overlay,
  advance the manifest version and immutable guidance, validate the package and live projection, and send one same-Mission
  exact-model wake carrying the new public failure event. Generic OpenCorvus infrastructure remains unchanged.

### Executable root-reconciliation repair implementation

- Target-project commit `740d72b` (`dsw-33987 make CMS reconciliation executable`) advances the Expert Squad package to
  `2026.07.20.3`. README, method Skill and the Orchestrator overlay now distinguish a textual freeze from a Task lifecycle
  decision: root reconciliation names the selected owner and stale duplicate; after live owners are terminal, the stale
  Task must call the real `manage_task` action=`cancel_task`, and the selected owner must use a real continuation or
  terminal decision tool rather than ending in plain prose.
- The focused regression was written first and failed against package version `2026.07.20.2` because no prompt required
  executable reconciliation. After implementation, `bun test test/cms-java-refactor-package.test.ts` passes 10/10 with
  195 assertions. The package Skill passes `quick_validate.py`; target scoped `git diff --check` passes; historical links
  and document health pass 82/82 with 1,354 assertions.
- Live project-scoped catalog and Skill mounts resolve active profile `cms-java-refactor`, package version `2026.07.20.3`,
  ten projected agents, production Skill `cms-java-refactor-method`, and immutable workflow guidance that explicitly
  settles a stale duplicate through a terminal lifecycle decision. No core scheduler, SDK, Task schema, decision contract,
  retry path, state machine, gate or fallback changed.
- The next bounded Mailbox snapshot added `pev_f7c09c6790014dXESc2szZZ4Kk`, an `interaction.requested` item titled
  `权威合同裁决` from Phase 11. The immediately preceding independent Phase 10 fact-check also records material delete and
  shared-client drift, so the Mission is waiting at the expected cross-Task authority boundary rather than being silently
  complete. The evidence-backed reconciliation selects the earlier broad Phase 10 Task
  `tsk_f7b5a80ed001t3xRSi7FYoUnS5` as the sole dictionary product-surface owner and Phase 11 Task
  `tsk_f7b607e8e001Pa1JHaj4LtwlWo` as the stale duplicate. Phase 10 must repair the reported delete/client gaps under one
  persisted success-driven create contract; Phase 11 must terminally cancel after confirming its live owners are settled.

### Post-reconciliation Phase 10 continuation evidence

- The bounded Mailbox snapshot at the 2026-07-19T20:33:12Z heartbeat added
  `pev_f7c147d150010PwdehM7F8k6QI` from the selected Phase 10 owner. This is the first post-ruling product-path handoff and
  proves that the same owning Task resumed without creating another dictionary Phase or Task; stale Phase 11 remains
  terminal as `pev_f7c0e8c670014s1tFkE20oZZDk`.
- Goal `gol_f7b6525340017ESvCBmS5WNOcu` names the exact authoritative FlashCMS controller, shared-client, four environment
  configuration and client-test paths. The production create, update and delete actions now instantiate
  `Input_Service_DictionaryWriteApiClient`; the old `Input_Service_DictionaryWriteApi` only delegates by inheritance, so
  it no longer contains a second HTTP or encoding implementation. The handoff reports 27 tests / 153 assertions for the
  unified client plus create/update, 2 tests / 11 assertions for the delete data contract, four PHP syntax checks, forbidden
  pattern checks and `git diff --check`, all passing.
- This event repairs the previously reported shared-client drift and publishes a terminal ownership handoff. It does not
  complete the dictionary slice: sibling view, JavaScript, update and delete test differences remain outside this Goal,
  runtime configuration values remain empty, and real runtime/desktop, legacy-authority retirement and final integrity
  evidence are still outstanding. No further Mission wake is issued while the owning Task is visibly progressing.

### Recall — material cross-Goal finding did not invalidate the owning Goal

- The benchmark contract and constraints remain unchanged: exact model `hexin/gpt-5.6-sol`, formal database, bounded
  project Mailbox supervision, large Phases with many valid Goals, no log monitoring, no fallback/gate/state-machine host
  fix, and package-owned correction for CMS functional or Squad-stability defects.
- Mailbox event `pev_f7c1e4e74001keWEM5j62zTf9h` is a new independent fact-check matrix inside the selected Phase 10 Task.
  It proves that production `index.phtml` never binds `bindDelete`: the delete button still submits legacy `delid[]` form
  data while `DictionaryController::deleteAction` accepts JSON `dids`. The report labels this a material correction that
  directly refutes the claimed production batch-delete behavior. Later event `pev_f7c25f2730015oTGXlCI3rNelK`
  nevertheless marks Goal `gol_f7b652534004M8qcuFMVVegmGb` (`迁移词典选中 ID 批量软删运营流`) passed.
- This is not a generic scheduler lifecycle defect. The host faithfully persisted both visible events and the owning Task
  continued. The package guidance itself tells a verifier to classify UI or retirement gaps as cross-goal dependencies
  unless its assigned Goal owns them, but never requires a material finding that falsifies another current Goal's
  acceptance to be routed to and block or reopen that owning Goal before Task progress continues.
- Sources re-read before modification: `AGENTS.md`; this record; the Expert Squad creator Skill and complete checklist;
  `specs/README.md`; `specs/current/architecture/04-extensions.md`; the July record index; the installed package README,
  method Skill, Orchestrator, behavior-verifier and integrity-reviewer overlays; manifest; and focused package tests.
- Whole-package inventory command:
  `rg -n --hidden "fact-check|fact check|cross-goal|material|correction|invalidate|falsif|block|reopen|pass|fail|complete_goal|modify_goal" .opencorvus/expert-squads/legacy-remote/cms-java-refactor test/cms-java-refactor-package.test.ts`.
  It finds current-Goal scoping and visible cross-goal reporting, but no acceptance propagation rule. No independent Agent
  is used for this focused correction.

### Material-finding propagation repair plan

- Preserve precise Goal scope: a verifier still judges its assigned Goal only against that Goal's persisted acceptance.
  However, a material finding that directly falsifies a live or passed Goal in the same owning Task must name that Goal and
  acceptance, publish the evidence through Mailbox, and be consumed by the Orchestrator before further acceptance.
- The Orchestrator must use a real Task decision tool to modify/reopen the falsified owning Goal or fail the affected
  acceptance; it must not let the Goal remain passed, dismiss the defect as merely cross-goal, or advance final integrity.
  Ordinary future-surface observations that do not falsify a current acceptance remain non-blocking dependencies.
- Add the rejection contract to the focused package test first, then update README, method Skill, Orchestrator, behavior
  verifier, integrity reviewer and immutable workflow guidance; advance the manifest version and validate the installed
  package plus live projection. This remains Squad prompt behavior, not a host-side event matcher or lifecycle gate.

### Material-finding propagation repair implementation

- Target-project commit `8d2a128` (`dsw-33987 propagate CMS material findings`) advances the installed package to
  `2026.07.20.4`. README, method Skill, Orchestrator, behavior verifier and integrity reviewer now require a material
  cross-Goal finding to name the falsified Goal and acceptance, publish cited Mailbox evidence, and block or reopen that
  owning Goal through a real Task decision. It cannot merely remain a cross-goal dependency while the contradicted Goal
  stays passed. Observations that do not falsify current acceptance remain ordinary future dependencies.
- The focused regression was written first and failed against `2026.07.20.3` and the absent propagation language. After
  implementation, `bun test test/cms-java-refactor-package.test.ts` passes 11/11 with 219 assertions. The package Skill
  passes `quick_validate.py`, target scoped `git diff --check` passes, and historical/document health passes 82/82 with
  1,354 assertions.
- Live project-scoped catalog and Skill mounts resolve active `cms-java-refactor` version `2026.07.20.4`, ten projected
  agents, production Skill `cms-java-refactor-method`, and immutable guidance containing `material finding propagation`.
  No OpenCorvus core, scheduler, Task schema, event matcher, gate, state machine or fallback changed.

### Temporal evidence correction after the propagation repair

- A later bounded Mailbox event, `pev_f7c2838d7001dUWyBRkKKeHjvj`, independently reads the current product state and
  finds that `index.phtml` now loads and calls `DictionaryListOperations.bindDelete`, the legacy `comsub.submit/newAction`
  deletion submission is absent, `deleteAction` accepts JSON `dids`, and the controller delegates only to the unified Java
  write client. It also finds the expected loading, empty, duplicate, partial, retry and non-rollback source contracts.
- This later evidence narrows the causal claim above. The older material correction is authoritative for its earlier
  snapshot, but the subsequent `goal.passed` event cannot be classified as an erroneous pass from timestamp order alone:
  product paths could and did change between the two verification snapshots. Current source-level delete wiring is now
  passing. Real desktop/runtime evidence and independently proven no-writer ownership remain unresolved.
- Package version `2026.07.20.4` is retained as a general Squad-quality contract because the prior package text had no
  explicit propagation rule for a material finding that truly remains current at acceptance time. It must not be used as
  evidence that this already-corrected delete behavior is still failing or as a reason to repeat product edits. The active
  same-Mission wake may satisfy the correction through current verification and a real terminal decision rather than
  blindly rewriting the now-correct paths.

### Recall — retry lifecycle retained a stale projected-agent tool table

- The benchmark contract remains unchanged: supervise only through bounded project Mailbox snapshots; use the formal
  database and exact Mission model `hexin/gpt-5.6-sol`; preserve the large-Phase/many-Goal Squad shape; classify generic
  dispatch/lifecycle stability as OpenCorvus infrastructure and CMS behavior/decomposition as Expert Squad ownership; do
  not redo accepted product implementation or private-Maven probes while repairing scheduling.
- The latest bounded `GET /mailbox?view=active&limit=100` snapshot has no event newer than
  `pev_f7c34d6ab0016TWse9488ctksG`. That `task.failed` event states that every attempted
  `cms-behavior-verifier` dispatch was rejected before worker startup because the turn-owned schema retained projection
  hash `4e81e6319f64fde4c70c71f54a0b3414ecd3d7a522a7c91f7a23b10f9d00dd1a` while the active package resolved hash
  `1230781d9d5f45d1d9dacc4a65844dca7945bfef0ea3a1b2a715737254949a55`. Phase 10 is terminally failed; the four delivery
  Goals and current delete handoff remain durable; recovery must continue verifier Goal
  `gol_f7b652534005lqRvmWc5ovgh6P` rather than repeat implementation.
- Per the heartbeat's evidence boundary no database query is performed in this iteration; hidden persistence details are
  therefore unknown. Public Mailbox evidence plus source ownership is sufficient to locate the first generic lifecycle
  defect without inferring from Task titles.
- Sources re-read before modification: `AGENTS.md`; this record's current Recall/execution history; the scheduler-debug
  Skill; `orchestrator/agent.ts`, `orchestrator/loop.ts`, `orchestrator/tools.ts`, `orchestrator/dispatch-agent-tool.ts`,
  `orchestrator/task-lifecycle-tools.ts`, `engine/queue.ts`, `task-api/index.ts`, session runtime-contract/processor code and
  focused orchestrator/session tests.
- Whole-repository callpoint searches covered `createOrchestratorTools`, scheduler/worker projection resolution,
  `SessionPrompt.prompt/loop`, `runTaskLoop`, `EngineService.retryTask`, `retry_task`, projection-drift checks and
  `TOOL_RESULT_PARK_METADATA_KEY`. They prove that each genuinely new `Orchestrator.processTask` call resolves a fresh
  scheduler projection and constructs a fresh dynamic-agent tool table. Exact drift rejection inside one already-running
  tool invocation is intentional and must remain strict.
- The first inconsistent transition is instead the current wake after `retry_task`: `wakeTaskForOperatorIntent` queues a
  fresh scheduling pass, but `retry_task` returns an ordinary string rather than a park-marked tool result. The session
  processor therefore permits the same model turn to continue calling its already-captured old `dispatch_agent` schema
  before the queued retry can acquire Task-loop ownership. Repeated old-hash rejection in that interval is a consequence;
  weakening hash equality or silently swapping the captured projected agent would violate the turn-owned schema/runtime
  contract.
- No independent Agent is used for this focused infrastructure repair. No CMS keyword branch, compatibility path,
  fallback, retry counter, projection bypass, state machine or host gate is permitted.

### Retry wake-boundary repair plan

- Preserve exact per-invocation projection identity and drift rejection. Change the generic `retry_task` lifecycle result
  to carry the existing session processor's explicit park metadata after `EngineService.retryTask` has durably queued the
  retry, so the current stale wake terminates and the queued wake becomes the sole owner of a freshly resolved projection.
- Add a focused regression first that executes `manage_task action=retry_task`, proves the Task is queued for a fresh pass,
  and proves the completed tool result carries `opencorvusParkAfterToolResult=true`. Retain the existing execution-identity
  rejection test and add no projection-specific exception.
- Run the focused orchestrator test under inactivity supervision, the directly affected projection/dispatch tests,
  package tests, typecheck/document health and scoped diff checks. Commit the generic infrastructure repair separately
  with the required `dsw-33987` prefix.
- Rebuild and restart only the Codex-owned archive backend after the tested source repair, confirm formal database/project
  identity, then wake the same Mission with `hexin/gpt-5.6-sol` and active `cms-java-refactor`. Acceptance requires a new
  Mailbox verifier dispatch under the current projection and a terminal current-Goal matrix; otherwise continue root-cause
  investigation rather than declaring success.

### Independent review correction — retry acceptance must precede park

- The operator-requested independent `gpt-5.6-sol` reviewer performed a read-only review and did not delegate or modify
  files. It agreed that every genuinely new `Orchestrator.processTask` reconstructs the active projection and that the old
  wake may continue after an ordinary `retry_task` result, but rejected the first repair as incomplete.
- The review found that `wakeTaskForOperatorIntent` called `dispatchTaskLoopInBackground` and returned before
  `dispatchTaskLoop` had accepted the retry. The background wrapper logs and absorbs rejection. Parking immediately after
  this return could therefore stop the stale wake while a failed fresh-pass admission became only a log line. The first
  focused test mocked `EngineService.retryTask`, so it proved park metadata but not accepted wake ownership.
- Source reinspection confirms `dispatchTaskLoop` itself does not await Task completion: it returns `started` or `queued`
  only after validating lineage/runtime, durably enqueuing an event when ownership is live, consuming the accepted wake's
  pending wait/cron record, and attaching the loop completion owner. Awaiting this acceptance inside
  `wakeTaskForOperatorIntent` therefore does not deadlock the current Orchestrator tool; with live tool ownership it records
  a queued operator-intent event and returns, then park lets ownership completion drain exactly that event.
- The repaired plan replaces the background fire-and-forget call with awaited `dispatchTaskLoop`, propagates startup or
  pending-wait consumption failures to the `retry_task` tool, and only then emits park metadata. Tests must exercise the real
  `EngineService.retryTask` path, prove one accepted `operatorIntent=retry` dispatch, and prove a dispatch rejection cannot
  return a successful parked tool result. No new queue, retry mechanism, state branch, fallback or CMS-specific behavior is
  introduced.

### Retry projection lifecycle repair implementation

- `task-api/index.ts` now awaits the existing `dispatchTaskLoop` acceptance boundary for retry/replan operator intent
  instead of handing it to the error-absorbing background wrapper. `dispatchTaskLoop` still returns after the wake is
  accepted as `started` or durably `queued`; it does not await Task completion. Admission, lineage, pending-wait or runtime
  failure therefore remains a visible tool error rather than a false retry success.
- `retry_task` emits the existing `opencorvusParkAfterToolResult` metadata only after that acceptance succeeds. The current
  model turn then stops, releases its live tool ownership, and lets the already-accepted serial Task wake construct a new
  scheduler projection. Exact projection drift remains rejected inside the stale invocation; no captured identity is
  rewritten.
- The first focused test failed with missing park metadata before implementation. The revised tests use the real
  `EngineService.retryTask` path while mocking only queue admission, assert exact `operatorIntent=retry`, assert accepted
  retry parks, and assert admission rejection cannot produce parked success. A dispatch-agent regression separately proves
  stale tool rejection followed by fresh-tool acceptance of the current hash. Task deletion-race tests now mock the awaited
  admission boundary they are not intended to execute.
- Validation: focused retry/admission/deletion selection passes 8/8 with 38 assertions; complete
  `dispatch-agent-tool.test.ts` plus `task-message-revive.test.ts` passes 27/27 with 122 assertions; complete
  `delete-task-artifacts.test.ts` passes 12/12 with 47 assertions; OpenCorvus package TypeScript passes; scoped
  `git diff --check` passes. CMS package remains 11/11 with 219 assertions and historical/document health remains 82/82
  with 1,354 assertions.
- A full `orchestrator/tools.test.ts` run reached 125 passes and exposed four unrelated committed test-contract failures:
  three `propose_task` expectations omit the current `createSchedulerChildTask` context argument and request fields, while
  one direct-build test expects foreign visual evidence without current reference-parity authority. These failures reproduce
  without the retry test selection and do not traverse the modified lifecycle code. They are not counted as retry repair
  failures, but remain an explicit follow-up test-contract cleanup before the benchmark's final repository-wide acceptance.

### Recall — committed Orchestrator test contracts lag current APIs

- Commit `89ff667330` contains the isolated retry/projection lifecycle repair. Its focused and affected tests pass, but the
  subsequent full `orchestrator/tools.test.ts` run exposed four failures on unchanged production paths, so final benchmark
  acceptance remains open.
- Whole-file callpoint inspection shows `createSchedulerChildTask` now takes the strict child-task input plus a second
  provenance context `{ actor, sessionID }`. Three tests use `expect.objectContaining` for the first argument but omit the
  required second argument, so Bun correctly reports a call-arity mismatch even though the asserted child-task fields are
  present. The correction is to assert the real two-argument contract, not remove provenance from production.
- `composeBuildEvidencePack` now projects task attachments as binding target references only when current frontend design
  evidence grants `reference_parity` authority. The failing direct-build fixture supplies a foreign-project visual
  attachment but no design authority; current production therefore calls Build with no evidence context. The stale test's
  claim that this foreign reference is forwarded as target evidence contradicts the current single-authority frontend
  contract and project isolation. The correction is to assert no binding evidence context, not loosen production.
- This cleanup changes tests only. It introduces no fallback, compatibility branch, host gate or CMS behavior. Re-run the
  four failures first, then the complete Orchestrator tools file; any remaining production failure must be investigated
  independently rather than normalized into the fixture.

### Orchestrator test-contract cleanup implementation

- The three `propose_task` tests now assert both the strict child-task input and the real scheduler provenance context
  `{ actor: "orchestrator", sessionID }`. Production provenance, model, priority, request identity and queue fields remain
  unchanged.
- The direct-build fixture now asserts the current authority boundary: a foreign-project visual attachment without
  reference-parity design authority does not become a binding Build evidence context. Production evidence composition and
  project isolation remain unchanged.
- The four previously failing selections pass 4/4 with 18 assertions. The complete
  `packages/opencorvus/test/orchestrator/tools.test.ts` suite now passes 130/130 with 1,105 assertions, including the two new
  retry admission/park regressions. This closes the full-suite failures exposed during the retry repair without widening
  CMS-specific infrastructure behavior.

### Live retry/projection repair deployment

- The persistent archive runtime is a non-Git source snapshot based on `fde22206db`, so copying the current full
  `task-api/index.ts` initially introduced two unrelated newer call-contract changes and its own TypeScript check rejected
  them. The runtime was restored from the exact `fde22206db` Git archive and only the two tested semantic hunks were
  applied: awaited retry/replan wake admission and successful-retry park metadata. Archive TypeScript then passed.
- Under the operator's standing authorization, only the Codex-owned backend PID `29220` was stopped. The replacement PID
  is `25364`, running the same Bun serve command from
  `C:/Users/chuan/myhexin-local/opencorvus-cms-runtime-fde22206db`; Vite and Overlay were not touched. `/global/health`
  reports healthy and the unchanged formal database
  `C:/Users/chuan/.local/share/opencorvus/opencorvus.db`.
- One same-Mission wake resumed `cms-java-refactor-20260719`, existing session
  `ses_0865d37baffeG64lDgz2tb2Wd5`, with exact model `hexin/gpt-5.6-sol`, active profile `cms-java-refactor` and
  `created: false`. The visible instruction selects failed Phase 10 Task `tsk_f7b5a80ed001t3xRSi7FYoUnS5` and verifier Goal
  `gol_f7b652534005lqRvmWc5ovgh6P`, preserving completed handoffs and forbidding implementation/Maven repetition.
- The first bounded Mailbox snapshot 30 seconds later contained no event newer than the prior projection-drift Task failure
  `pev_f7c34d6ab0016TWse9488ctksG`. This is ordinary early inactivity, not proof of another stall or successful recovery.
  No second wake is issued while the same Mission may still be processing; the next heartbeat must compare for a new
  verifier dispatch/current-Goal matrix before deciding wait, retry or further infrastructure investigation.

### legacy remote convergence and continued bounded wait

- The local branch was clean but `legacy-remote/v0.0.10beta` was two commits ahead. After fetch and review, the remote inline
  retry-evidence repair was merged without conflict; the unpushed merge subject was amended to the required `dsw-33987`
  prefix. The remote increment did not overwrite the CMS retry/projection paths or record.
- Post-merge validation passes all eleven workspace typechecks and 102 focused merged-change/retry/queue/dispatch/deletion
  tests with 4,694 assertions. The formal pre-push hook then passed SDK imports, AI runtime, eleven-package typecheck, API
  route inventory, generated docs, Overlay internationalization and secret scan. legacy remote advanced from `61ffd58366` to
  merge commit `ac5d1af5ed`; no force push or hook bypass was used.
- A later bounded Mailbox snapshot still reports zero items newer than `pev_f7c34d6ab0016TWse9488ctksG` (`unread=147`,
  `active=147`). The same Mission wake has not yet emitted a visible recovery decision. This remains a wait condition for
  the next heartbeat, not permission to duplicate the wake or infer hidden session failure from silence alone.

### Phase 10 post-deployment inactivity resume

- The 2026-07-19T21:47:13Z heartbeat first re-read this Recall/execution record and then fetched one bounded active Mailbox
  page for `C:/Users/chuan/myhexin-local/cms-system-refactor`. It still contained no event newer than
  `pev_f7c34d6ab0016TWse9488ctksG`; the newest canonical evidence remained the pre-repair projection-drift failure.
- Because the post-deployment Mission wake had now produced no Mailbox activity for approximately forty minutes, the
  silence crossed the real inactivity boundary and was no longer treated as ordinary early processing. No log, database,
  process, health or frontend observation was used to manufacture that conclusion.
- Exactly one canonical `/mission/wake?directory=...` request resumed the existing Mission and root session with exact model
  `hexin/gpt-5.6-sol`, profile `cms-java-refactor`, and `created: false`. Its visible instruction retains the completed
  delivery Goals and blockers, resumes only verifier Goal `gol_f7b652534005lqRvmWc5ovgh6P` / failed Task
  `tsk_f7b5a80ed001t3xRSi7FYoUnS5`, requires the current capability projection, and forbids implementation, Phase 09 and
  Maven/private-POM repetition.
- A bounded Mailbox snapshot twelve seconds after admission still had no newer event. This is an immediate post-wake wait
  condition; a further duplicate wake is not authorized until another genuine no-activity interval or new canonical
  Mailbox evidence establishes the next action.

### Recall — Mission compaction prevents retry execution

- Two accepted same-session wakes produced real root Mission user messages, but neither reached `manage_task`, a verifier
  dispatch, or any new project Mailbox event. The bounded root-session transcript shows assistant
  `msg_f7c538601001w4DnFAQ5KfWe6R` failed because `StructuredOutput` omitted one prior blocker and 22 prior next actions;
  the later `msg_f7c5aa5da001FFjGL0BgQrBylg` failed because its enormous `StructuredOutput` tool input was invalid JSON.
- Read-only formal-database evidence confirms both `wake_reason` and overflow `compaction_request` control records were
  consumed. Both assistant messages are durably `finish=error`; the failed Phase 10 Task was never retried after
  `pev_f7c34d6ab0016TWse9488ctksG`. This classifies the current stall as generic Mission compaction infrastructure, not a
  CMS Squad functional failure and not a recurrence of projection mismatch.
- Whole-repository callpoint inspection found one owning design. `selectedHeadEvidenceRequirements` copies every array and
  every agent-specific string fact from the previous handoff; `renderRequiredEvidence` duplicates them into a second
  `<previous-handoff-required-retention>` block; `MODEL_OUTPUT_INSTRUCTIONS` demands verbatim same-field retention; and
  `validateMinimumEvidence` rejects any semantic consolidation or removal of stale/resolved facts. `buildPrompt` already
  supplies the complete prior structured handoff and correctly instructs the model to preserve still-true details, remove
  stale details and merge new facts. The additional exact-retention projection is therefore a second, contradictory source
  that makes every compaction monotonically larger and eventually prevents valid structured output.
- The repair will remove `previousHandoff` from host evidence requirements, delete the duplicate retention rendering and
  exact same-field validator, and strengthen the single model instruction around the existing prior structured anchor:
  preserve all still-applicable user requirements and acceptance criteria, replace superseded facts, fold resolved work
  into concise chronology, and keep only actionable next actions/open risks. Current source identity, instruction paths,
  exact todos, active build contracts, patch evidence, error evidence and non-empty active acceptance/context checks remain
  data-integrity validation. No fallback, retry bypass, state machine, CMS branch, host workflow gate or synthetic message
  is introduced.
- Regression scope is all `previousHandoff` callpoints in `compaction.ts`, `compaction-handoff.ts`,
  `compaction.test.ts`, and `compaction-evidence-contract.test.ts`. Replace tests that canonize verbatim accumulation with
  tests proving semantic consolidation is accepted, the prior handoff appears exactly once as the merge anchor, obsolete
  next actions need not survive, and current data-integrity requirements still reject malformed handoffs. Then run the
  focused compaction suites, package typecheck, document health, and a read-only replay of the first failed structured
  payload before deploying only the tested semantic change to the Codex-owned archive backend.

### Mission compaction convergence implementation

- The independent `gpt-5.6-sol` reviewer performed a read-only review without delegation or edits. It confirmed that the
  old protocol modeled a canonical replacement snapshot as an append-only ledger: full prior JSON was already the merge
  anchor, while the flattened manifest, verbatim-retention prompt and validator imposed a second source whose input and
  output lower bounds grew every round. It explicitly rejected array truncation, larger context, more retries, host-side
  merging and summary fallback as non-root fixes.
- Production now supplies the previous structured handoff exactly once through `<previous-structured-handoff>`. The second
  `EvidenceRequirements.previousHandoff` projection, `<previous-handoff-required-retention>` rendering and twelve-field
  exact-retention validator are deleted. The prompt defines the next handoff as one canonical replacement snapshot:
  preserve still-applicable requirements/acceptance, consolidate repetition, replace superseded facts, fold completed work
  into chronology, and remove obsolete actions/resolved risks. Schema, current source identity/base role, instruction paths,
  current todos, active build-contract IDs, patch evidence and current error evidence remain strict.
- Regression-first evidence: the two focused files initially failed exactly because the old prompt still contained the
  retention instruction and runtime requirements still carried the duplicate prior projection. After implementation they
  pass 89/89 with 243 assertions. The complete eight-file compaction/continuation/dispatch-anchor/dynamic-identity/
  predictive selection passes 182/182 with 616 assertions. OpenCorvus TypeScript passes; document health and historical
  links pass 82/82 with 1,354 assertions; `git diff --check` passes.
- The read-only replay helper was itself stale because it omitted the now-required source base role. It now requires
  explicit `SOURCE_BASE_ROLE` input rather than guessing from output or falling back. Replaying formal-database assistant
  `msg_f7c538601001w4DnFAQ5KfWe6R` with `SOURCE_BASE_ROLE=mission` changes the exact historical payload verdict from the
  prior-retention rejection to `success:true`, while malformed JSON and identity/schema mismatches remain strict failures.
- Deployment and live Mission retry remain pending. Only the Codex-owned archive backend may be rebuilt/restarted under the
  standing authorization; the primary Vite/Overlay processes remain untouched. After restart, one exact-model Mission wake
  must first prove a successful compacted Mission turn and a real current-projection verifier dispatch before any benchmark
  acceptance claim.

### Mission compaction repair deployment

- Commit `8864532e3b` (`dsw-33987 make compaction handoffs convergent`) was pushed to legacy remote `legacy-remote/v0.0.10beta` after
  the full pre-push hook passed SDK imports, AI runtime, eleven-package typecheck, API route inventory, generated docs,
  Overlay internationalization and secret scan.
- The archive runtime retained its exact `fde22206db` source baseline plus the previously deployed retry/projection hunks.
  Only the two tested compaction source changes were applied; copying current whole files was deliberately avoided. Archive
  OpenCorvus TypeScript passed before restart.
- After exact process identity verification, only Codex-owned backend PID `25364` was stopped. Replacement PID `17204`
  runs the same hidden Bun serve command from the persistent archive runtime. Vite and Overlay were not touched;
  `/global/health` reports healthy with formal database
  `C:/Users/chuan/.local/share/opencorvus/opencorvus.db`.
- Exactly one same-Mission wake was admitted with `created:false`, existing root session
  `ses_0865d37baffeG64lDgz2tb2Wd5`, active `cms-java-refactor`, and exact model `hexin/gpt-5.6-sol`. It resumes only failed
  Phase 10 verifier Goal `gol_f7b652534005lqRvmWc5ovgh6P`, forbids Phase 11/new Task/implementation/private-POM repeats,
  and requires current-projection verifier evidence in the project Mailbox.
- The first bounded Mailbox snapshot thirty seconds after admission contains no event newer than
  `pev_f7c34d6ab0016TWse9488ctksG`. Prior compaction attempts ran for several minutes, so this is an early wait condition,
  not a failure or permission to duplicate the wake. The next heartbeat must remain Mailbox-bounded until new evidence or
  a genuine inactivity interval appears.

### Recall — captured handoff was overwritten by overflow status

- After approximately seventeen minutes without Mailbox output, a bounded root-session read showed the repaired prompt did
  produce a valid `StructuredOutput` in assistant `msg_f7c8b80e7001221sWYkMcI62hz`; the tool state is `completed`, unlike
  both pre-repair failures. The assistant nevertheless persisted `finish=error` with `ContextOverflowError` and never
  reached Task retry.
- The owning transition in `SessionCompaction.process` checks `result === "compact"` before checking whether the
  `StructuredOutput` success callback already captured a valid handoff. It therefore overwrites a completed canonical
  handoff with an overflow failure when the provider's final usage asks for compaction again. The later signal describes
  the ordinary conversation turn's context pressure; it cannot invalidate the exact structured artifact already accepted
  by schema and evidence validation.
- The repair adds one explicit policy predicate: overflow is terminal only when the processor returned `compact` **and** no
  structured handoff was captured. It does not accept malformed JSON or plain text, synthesize a summary, retry around
  validation, raise a budget, or add a fallback. A regression first failed because the predicate did not exist, then passes
  both cases: captured+compact is accepted; uncaptured+compact remains a strict overflow failure.
- Read-only replay of the exact newly captured tool payload against current source returns `success:true`, with source base
  role `mission`, 173 selected-head messages, no required patch files, and the observed error evidence represented. This
  proves the rejected object itself is valid and the bug is post-capture ordering rather than missing handoff content.

### Captured-handoff ordering repair deployment

- The new regression plus the complete eight-file compaction selection passes 183/183 with 618 assertions. The one first
  full-selection failure was an isolated temporary Git-index synchronization failure while test/typecheck/docs commands ran
  concurrently; the exact original test passed alone and the entire selection then passed serially. OpenCorvus TypeScript,
  document health 82/82 with 1,354 assertions, and diff checks pass.
- Commit `324718cf34` (`dsw-33987 preserve captured compaction handoff`) was pushed to legacy remote after the full pre-push hook
  passed. Only its tested `compaction.ts` semantic hunk was applied to the archive runtime; archive TypeScript passed.
- Exact process verification preceded stopping Codex-owned PID `17204`. Replacement backend PID `1176` is healthy on the
  same port and formal database; Vite and Overlay were not touched.
- One same-Mission wake was admitted with `created:false`, exact `hexin/gpt-5.6-sol` and active `cms-java-refactor`. It
  again resumes only the existing Phase 10 verifier Goal and forbids duplicate Task/Phase/Goal, Phase 11, implementation
  repetition and private-POM probes. The next heartbeat must observe the project Mailbox; no duplicate wake is permitted
  during the compaction window.

### Recall — one streamed StructuredOutput input contains an abandoned prefix and a complete replacement object

- The next bounded project Mailbox snapshot still has no event newer than
  `pev_f7c34d6ab0016TWse9488ctksG`. Read-only formal-database evidence after the genuine inactivity interval shows a new
  Mission user message `msg_f7c9d8c3f001KLMvbS65ZfkPX2` and summary assistant
  `msg_f7c9dbca0001i1bGZGhNpbZZAL`; the assistant is terminal `finish=error` and never reached Task retry.
- Its sole persisted `StructuredOutput` part has call ID `call_AXlfHwQf5tGEvO3OMZpTdRxG`, status `error`, and a 76,041-byte
  input. This is not a single oversized/truncated JSON object. SQLite reports the first syntax error at byte 27,941; byte
  27,939 starts a second `{\"objective\":...}` object, and the suffix from that opening brace is independently valid JSON
  through its final `]}`. The stream therefore contains an abandoned incomplete first object immediately followed by one
  complete replacement object inside the same tool call. The preceding invalid attempt has the same restart signature.
- Parsing the valid suffix in host code would be a forbidden fallback that silently accepts invalid tool input. Increasing
  context/output limits or mechanically waking the Mission would also miss the observed cause. The owning model contract
  already supports a separate retry after a visible tool error, but does not tell the model that an in-progress tool input
  may never be restarted or duplicated, nor that common and mission-specific handoff fields must avoid cross-field fact
  duplication.
- Whole-repository callpoint inspection finds one production prompt owner:
  `CompactionHandoff.MODEL_OUTPUT_INSTRUCTIONS` in `packages/opencorvus/src/session/compaction-handoff.ts`, consumed only by
  `SessionCompaction.buildPrompt` in `packages/opencorvus/src/session/compaction.ts`; its prompt contract is covered by
  `packages/opencorvus/test/session/compaction.test.ts` and the compaction evidence/continuation selections. No second
  parser, suffix recovery, provider-specific CMS branch, state gate, non-streaming call, or alternate handoff source will be
  added.
- The repair will strengthen the single prompt contract: emit exactly one JSON object per `StructuredOutput` call; never
  restart or append a replacement object inside an in-progress tool input; after a returned tool error, retry only as a new
  tool call; record each fact in its most specific field and use identifiers/evidence references instead of duplicating
  prose across common and mission-specific fields. A regression must fail before the prompt change and assert these exact
  semantics. Then run the complete compaction selection, OpenCorvus TypeScript, document health, and a read-only check that
  the historical malformed suffix is valid only when separated—without teaching production to separate it. Deployment,
  backend restart and one exact-model Mission wake remain contingent on those validations.

### Streamed StructuredOutput single-object repair implementation

- The prompt regression failed first because the production contract did not state any of the four required semantics. The
  single `MODEL_OUTPUT_INSTRUCTIONS` source now tells every compaction model to emit exactly one JSON object per tool call,
  never restart or append a replacement object inside an in-progress tool input, retry a returned error only through a new
  tool call, and record each fact in its single most-specific field while using IDs/evidence references across related
  sections. The existing canonical replacement, still-applicable requirement and stale-fact consolidation rules remain.
- Production still rejects the historical malformed 76,041-byte input as invalid. Read-only SQLite analysis proves that
  only the separately selected suffix beginning two bytes before the reported parser position is valid JSON; no suffix
  extractor, concatenated-object parser, provider special case, fallback or hidden repair path was added.
- Validation passes: the regression is red-before/green-after; the complete eight-file compaction selection is 183/183
  with 622 assertions; OpenCorvus TypeScript passes; historical links and document health pass 82/82 with 1,354 assertions.
  Deployment to the persistent archive runtime, exact backend restart, commit/push, and one same-Mission wake remain next.

### Streamed StructuredOutput single-object repair deployment

- Commit `55e2ea4264` (`dsw-33987 keep streamed compaction input singular`) was pushed to legacy remote
  `legacy-remote/v0.0.10beta`. The full pre-push hook passed SDK imports, AI runtime, all eleven package typechecks, API route
  inventory, generated docs, Overlay internationalization and secret scan.
- Only the tested three-line prompt-contract hunk was applied to the persistent `fde22206db` archive runtime. Archive
  OpenCorvus TypeScript passed. Port 7878 and command-line identity both proved Codex-owned PID `1176`; only that backend
  was stopped. Replacement PID `1776` runs the same hidden Bun serve command from the archive runtime. Vite and Overlay
  were not touched; `/global/health` is healthy and reports formal database
  `C:/Users/chuan/.local/share/opencorvus/opencorvus.db`.
- Exactly one canonical Mission wake returned `created:false` for `cms-java-refactor-20260719` and existing root session
  `ses_0865d37baffeG64lDgz2tb2Wd5`, with exact model `hexin/gpt-5.6-sol` and profile `cms-java-refactor`. Its visible prompt
  resumes only Phase 10 verifier Goal `gol_f7b652534005lqRvmWc5ovgh6P`, preserves completed work/blockers and forbids new
  entities, Phase 11, implementation repetition and equivalent private-POM probes.
- The bounded project Mailbox ten seconds after admission remains unchanged at
  `pev_f7c34d6ab0016TWse9488ctksG`. This is an immediate post-wake wait condition. The next heartbeat must not duplicate the
  wake during the compaction window; it should compare for a new verifier/lifecycle event and inspect root-session terminal
  scalars only after a genuine inactivity interval.

### Live compaction and Task lifecycle recovery evidence

- After the genuine inactivity interval, the project Mailbox was still unchanged, so a bounded formal-database read checked
  only the latest root-session terminal scalars. Summary assistant `msg_f7cb72f30001xik0oDblbzzpeu` completed with
  `finish=tool-calls`, `summary=true`, and no error. The same root session then produced nine ordinary tool-call turns and
  final assistant `msg_f7cbcb1b6001c9YfHyF1yOC67A` with `finish=stop` and no error. This is the first real proof that the
  repaired single-object prompt, captured-handoff ordering and post-compaction continuation all complete together.
- The resumed Mission used real lifecycle actions rather than prose state. Phase 11 stale duplicate
  `tsk_f7b607e8e001Pa1JHaj4LtwlWo` returned `Task cancelled.` and will not restore its writers. Phase 10
  `tsk_f7b5a80ed001t3xRSi7FYoUnS5` moved from `failed` to `active`; root Orchestrator
  `ses_084a53d86ffe0wV2kQ7Z4CUsm0` reports `retry`. No Mission, Task, Phase or Goal was created.
- The Mission sent one continuation decision to Phase 10 requiring the existing verifier Goal
  `gol_f7b652534005lqRvmWc5ovgh6P`, current `cms-java-refactor` projection and exact `hexin/gpt-5.6-sol`. It requires a new
  verifier session ID/status before acceptance, then a read-only project-Mailbox terminal matrix; a pre-worker rejection
  must become a precise infrastructure blocker without mechanical retry. PHP retirement, runtime, visual and Integrity
  remain blocked until that matrix passes.
- At this observation boundary the DAG had not yet exposed a new `cms-behavior-verifier` session and the canonical project
  Mailbox still ended at the historical projection-drift failure. The correct action is bounded waiting for the now-active
  Task, not another Mission wake. The next heartbeat should look only for new worker-admission, terminal-matrix or explicit
  startup-failure Mailbox evidence before considering further intervention.

### Recall — cross-session task continuation inherits the Mission trace context

- After more than twenty minutes without a new project Mailbox event, bounded formal-database inspection of Phase 10 root
  Orchestrator `ses_084a53d86ffe0wV2kQ7Z4CUsm0` found one new assistant
  `msg_f7cbb936a0010z8JIN3UmtZBIz`. It has no persisted parts and failed before any scheduler tool with
  `UnknownError: Trace session mismatch: context=ses_0865d37baffeG64lDgz2tb2Wd5 input=ses_084a53d86ffe0wV2kQ7Z4CUsm0`.
  The context ID is the Mission root session; the explicit input is the Phase 10 Orchestrator session.
- The visible Mission transcript proves the trigger: `panel.send_task_message` succeeded for Phase 10 and synchronously
  called `EngineService.handleTaskMessage`; that path appended one real task-root message and accepted a started
  `dispatchTaskLoop` wake. `engine/queue.ts::launchTaskLoop` creates a fresh database/project identity but does not replace
  the caller's ambient `SessionContext`. On a reused Orchestrator session, `Orchestrator.processTask` selects the direct
  `SessionPrompt.loop` branch; unlike `SessionPrompt.prompt`, that branch does not establish the target session context.
  AgentTrace therefore sees the inherited Mission session and strictly rejects the target Orchestrator session ID.
- This is a generic cross-session scheduler-entry defect, not a CMS Squad error. The trace mismatch guard is correct and
  must remain strict; weakening it, clearing trace, suppressing the error, treating the message as accepted, or adding a
  Mission-specific route would hide real attribution corruption. `runWithIndependentProjectIdentity` owns only project and
  database identity and must not be expanded into a second session-context abstraction.
- Whole-repository callpoint inspection finds all `Orchestrator.processTask` entries in `orchestrator/loop.ts` and tests;
  the single direct reused-session `SessionPrompt.loop` call is in `orchestrator/agent.ts`. The existing
  `orchestrator/session-reuse.test.ts` already exercises first-prompt then direct-loop reuse and is the correct regression
  surface. The test will enter the second wake under a different ambient session and assert that the loop observes the
  selected Orchestrator session, not its caller.
- The repair will wrap the single prompt/loop execution boundary in `SessionContext.provide(agentSession, ...)`. This keeps
  both first-message and reused-session paths on the same authoritative target context and leaves task dispatch, queueing,
  trace validation and project identity unchanged. Run the regression red-before/green-after, the full session-reuse and
  affected orchestrator/queue/task-message selections, OpenCorvus TypeScript and docs health before deploying only the
  tested hunk to the Codex-owned archive backend. Then restart that backend and send one exact-model Mission wake that
  continues the already-recorded Phase 10 message without creating new entities or repeating implementation.

### Cross-session Orchestrator context repair implementation

- The real `orchestrator/session-reuse.test.ts` regression enters the second Task wake under a different ambient assistant
  session and observes the session visible inside the direct `SessionPrompt.loop` call. It failed first with the caller
  session ID, reproducing the production Mission-to-Task mismatch, then passed with the selected Orchestrator session ID.
- `Orchestrator.processTask` now wraps its single prompt/loop execution boundary in
  `SessionContext.provide(agentSession, ...)`. The existing first-message `SessionPrompt.prompt` path remains compatible
  with its nested same-session scope; the reused direct-loop path now has the same authoritative session identity. The
  strict `AgentTrace.sessionBucket` mismatch check, queue dispatch, project lease and Task message persistence are unchanged.
- The complete session-reuse file passes 3/3. All 34 queue tests and all 17 task-message revive tests pass. The exact trace
  primary-runtime test passes in isolation. OpenCorvus TypeScript passes. A five-file concurrent selection produced one
  Windows Git supervisor readiness failure which did not reproduce alone, and one existing
  `session-hard-error.test.ts` expectation (`running` versus expected `blocked`) which reproduces both with and without the
  new production hunk; neither traverses or invalidates the cross-session context assertion. The latter remains an explicit
  repository test-contract/product follow-up before final benchmark-wide acceptance, not a claimed success.

### Cross-session Orchestrator context repair deployment

- Commit `9b16a1e677` (`dsw-33987 bind cross-session orchestrator continuation`) was pushed to legacy remote after the full pre-push
  hook passed SDK imports, AI runtime, eleven-package typecheck, API routes, generated docs, Overlay internationalization
  and secret scan. Only the tested prompt/loop session-scope hunk was applied to the persistent archive runtime; archive
  OpenCorvus TypeScript passed.
- Port and process identity checks proved PID `1776` was the same Codex-owned Bun backend. Only that process was stopped;
  replacement PID `28836` is healthy on port 7878 and reports the unchanged formal database. Vite and Overlay were not
  touched.
- Exactly one same-Mission wake returned `created:false` for root session `ses_0865d37baffeG64lDgz2tb2Wd5`, exact model
  `hexin/gpt-5.6-sol` and profile `cms-java-refactor`. It identifies the already-recorded Phase 10 continuation failure,
  resumes only Task `tsk_f7b5a80ed001t3xRSi7FYoUnS5` / verifier Goal `gol_f7b652534005lqRvmWc5ovgh6P`, and forbids new
  entities, cancelled Phase 11, implementation repetition and equivalent private-POM probes.
- The bounded project Mailbox ten seconds after admission remains unchanged at the historical projection-drift failure.
  This is an immediate wait condition during the Mission's existing compaction/decision window. No duplicate wake is
  permitted until a new worker event or a genuine inactivity boundary appears.

### Recall update: durable terminal lifecycle lost after backend restart

- The benchmark contract remains unchanged: CMS only; supervise through bounded project Mailbox snapshots; use the formal
  database and exact Mission model `hexin/gpt-5.6-sol`; preserve large Phases with many Goals; do not repeat accepted
  implementation or private-Maven probes; classify scheduler/lifecycle defects as infrastructure and CMS behavior as Squad
  ownership. Full acceptance still requires the independent verifier matrix, later retirement/visual/environment phases,
  final review, and resolution of the separately recorded `session-hard-error.test.ts` repository failure.
- The next bounded Mailbox snapshot added `pev_f7ce176730012FDjIHSwc7om95`. Phase 10 reached the repaired target Orchestrator
  session and attempted the required verifier dispatch, but the `fact_check` adapter rejected the completed delete worker
  session `ses_083d6989affemPdnvdqWjutwA4` before creating a verifier: `target session is not in a terminal state
  (reason=idle)`.
- Formal-database evidence proves the target is durably terminal: latest lifecycle event
  `pev_f7c31fb46001FSpoq80ZludMFC` is `session.status {type: terminal, reason: completed}`; Goal run `09ca31a5`, terminal
  refill artifact `art_f7c3209f3001Jq0yDkre1gZHID`, Mailbox handoff `pev_f7c30c12c001R7hhPbHqpbpDk3`, and the completed
  assistant message all agree. The `idle` value came from `SessionStatus.get()`'s empty process-local map after the
  Codex-owned backend restart, not from a newer durable lifecycle transition.
- Full-repository grep found one production caller of `Session.snapshotLatestAssistant`, in
  `resolveFactCheckTargetScope`, plus the snapshot contract tests. The current snapshot requires process-memory
  `SessionStatus=terminal`; it never reconciles the durable `session.status` / `session.idle` chronology. Other engine
  views already use the intended split: process memory establishes current live ownership, while protocol events establish
  durable historical lifecycle. This is a generic restart-continuation infrastructure defect, not a CMS Squad misuse.
- Repair direction: make the snapshot resolve lifecycle from the current process latch when it owns an active/terminal
  generation, otherwise from the latest durable lifecycle event across `session.status` and `session.idle`. Accept only a
  latest `terminal/completed` status; keep streaming, retry, idle, aborted, error, missing event, incomplete message, and
  missing descriptor strict. Add restart-shaped regression coverage (durable terminal with empty process latch), plus
  newer durable-idle and current-streaming precedence cases. No fallback parser, CMS branch, weakened descriptor check, or
  synthesized terminal event is permitted.
- The first expanded fact-check selection did not reach lifecycle resolution because all five integration cases used a
  pre-existing stale fixture that omitted mandatory `dispatch_agent.use_worktree`; the production schema has required that
  explicit boolean since the July 16 dispatch contract. This reproduces in the fact-check file alone and is not caused by
  the lifecycle hunk. Update the single shared `dispatchInput` fixture to declare `use_worktree: false` (fact-check is
  read-only), then rerun the file. The concurrent scheduler-projection capture failures will be judged only by isolated
  reruns because that suite mutates shared runtime registries and the combined selection also timed out.
- Correction after the isolated rerun: four paths used the shared fixture, while the exact continuation case has one direct
  dispatch literal and also needs the same explicit `use_worktree: false`. The cache assertion also expected the obsolete
  substring `cached`, while the current production response intentionally says `adapter cache (no model call)`; tighten the
  assertion to that exact current contract. These are test-contract repairs only; no production dispatch fallback changes.
- Isolated scheduler-projection reruns still failed before either prompt spy. Temporary rethrow/task-error diagnostics
  localized the swallowed error to `TaskCreatorMetadata.parse(task.metadata)`: that file's shared `insertTask` fixture
  persisted `metadata=null`, while the authoritative task-creation contract requires an explicit creator. The diagnostic
  instrumentation was removed. Set the fixture's creator to `{actor: "user"}` and rerun the suite; this repairs stale test
  construction rather than weakening production metadata validation.
- With the creator fixture repaired, 16/17 scheduler-projection cases pass. The remaining continuation case is killed by
  Bun's fixed five-second per-test timeout while its own bounded TaskLoop wait is still active, then reports the expected
  capture as missing. Remove the mechanical from-start harness timeout for this file with `setDefaultTimeout(0)` and retain
  the operation-owned bounded wait; this follows the repository's inactivity/operation-bound timeout rule and does not
  change runtime behavior.

### Durable lifecycle repair implementation and verification

- `Session.snapshotLatestAssistant` now treats a non-idle process latch as current generation ownership. When no process
  owner exists (including after restart), it resolves the latest durable lifecycle event across `session.status` and
  `session.idle`, ordered by emitted time and sequence. Only `terminal/completed` proceeds to the unchanged completed
  assistant, parent-user, worker-descriptor and content-hash checks. Malformed durable payloads fail explicitly.
- The restart-shaped regression failed first with `finished=false/reason=idle`, then passed after the repair. Added negative
  coverage proves a newer durable idle transition rejects the old terminal response and a current streaming owner takes
  precedence over durable completion. Snapshot tests pass 11/11.
- The dynamic fact-check integration now reflects the mandatory explicit worktree decision and current cache response; all
  five real tool-path cases pass. The scheduler projection fixture now has authoritative creator metadata and no fixed
  from-start Bun timeout; all 17 cases pass, including the continuation wake at 6.86 seconds.
- The combined affected selection passes 33/33 with 258 assertions. OpenCorvus TypeScript passes. Historical docs health
  passes 21/21 with 70 assertions. `git diff --check` passes and review confirms no diagnostic rethrow code remains.

### Durable lifecycle repair deployment

- Commit `e6b927bef0` (`dsw-33987 restore durable worker terminal evidence`) was pushed to legacy remote. The full pre-push hook
  passed SDK imports, AI runtime, all eleven package typechecks, API routes, generated docs, Overlay internationalization
  and secret scan.
- Only the tested `Session.snapshotLatestAssistant` production hunk was applied to the persistent archive runtime; archive
  OpenCorvus TypeScript passed. Port/process identity proved PID `28836` was the same Codex-owned Bun backend. Only that
  process was stopped; replacement PID `20992` is healthy on port 7878 and reports the unchanged formal database.
  Vite and Overlay were not touched.
- Exactly one canonical same-Mission wake returned `created:false` for Mission `cms-java-refactor-20260719`, root session
  `ses_0865d37baffeG64lDgz2tb2Wd5`, exact model `hexin/gpt-5.6-sol` and profile `cms-java-refactor`. It resumes only existing
  Phase 10 / verifier Goal, requests one real fact-check dispatch against the durable delete handoff, and forbids new
  entities, cancelled Phase 11, implementation repetition and private-POM probes.
- The bounded Mailbox snapshot ten seconds after admission has no event newer than the prior durable-lifecycle failure
  `pev_f7ce176730012FDjIHSwc7om95`. This is an immediate post-wake wait condition; do not duplicate the wake until a new
  worker event or genuine inactivity boundary appears.

### Recall update: CMS Orchestrator ignored the current Task root message

- The benchmark contract and acceptance remain unchanged. The next bounded Mailbox snapshot added
  `pev_f7cf5c82a001xML2d4uZUWwGfA`, an `OrchestratorNoDecisionStopError`. The Phase 10 Orchestrator did not call
  `read_task_message`, `dispatch_agent`, or a lifecycle decision tool; it repeated the pre-repair `reason=idle` blocker in
  prose. Therefore this event does not exercise or disprove the deployed durable-lifecycle repair.
- Formal message chronology proves Mission did its job: it wrote current Task-root message
  `msg_f7cf597320010dIi7ctIb0MgpK` with the deployed-repair fact and exact verifier continuation; `panel.send_task_message`
  returned `Task wake dispatched`; Task `tsk_f7b5a80ed001t3xRSi7FYoUnS5` reopened active. The reused Orchestrator's new
  assistant `msg_f7cf59a06001C0S8PU3JQqE36H` retained the original parent and emitted only historical prose. Core dynamic
  context already says a current root message must be read once, and the CMS overlay already forbids prose-only lifecycle
  closure, so the infrastructure correctly exposed the violation instead of fabricating a decision.
- Responsibility is now Expert Squad stability, not host scheduling: the active package must make the current root-message
  evidence epoch dominate historical failure narrative. A prior terminal/failure statement is audit history after a new
  root message reopens the same Task; the Orchestrator must first call `read_task_message`, then use only tool results and
  current rendered state for its action. It must not claim the prior blocker is current without re-running the named
  adapter, and it must not stop in prose while a real dispatch/decision remains available.
- Before this Squad change the main agent read the complete `opencorvus-expert-squad-creator` Skill and checklist, current
  extensions architecture, specs indexes, current installed manifest/README/orchestrator overlay, and the package contract
  test. Repository-wide searches covered package identity/projection, `rootMessage`, task-message append/wake,
  `read_task_message`, no-decision handling, and the only CMS installed package. No new independent Agent was requested;
  the earlier independent review predates this failure and provides no evidence for it.
- Repair direction: update only the installed CMS package's Orchestrator overlay and package version. Add a package test
  that requires current-root-message precedence, one mandatory `read_task_message` before decision, re-execution before
  repeating a historical blocker, and a real dispatch/decision tool rather than prose. Validate through the package test
  and the real OpenCorvus Registry/Resolver path. Do not add a host gate, retry state machine, synthetic message, or fallback.

### CMS current-root-message decision epoch repair and deployment

- The installed project package now treats each current Task root message as the authoritative evidence epoch for that
  wake. When the dynamic context exposes `## Current Wake Root Message`, the Orchestrator must call
  `read_task_message` exactly once before any decision or dispatch tool, treat earlier blocker prose as audit history, and
  re-run a named repaired adapter once before claiming that its historical blocker remains. The wake must end through a
  real dispatch or lifecycle decision tool, not a prose repetition. This is model guidance inside the CMS Expert Squad;
  no host gate, state machine, synthetic message, retry loop, fallback, or relaxed no-decision detection was added.
- The package contract regression failed before the overlay change and now passes as part of 12/12 package tests with
  224 assertions. `git diff --check` passes for the three owned files. An isolated real Registry/Resolver validation,
  using a dedicated `XDG_DATA_HOME` rather than the formal database, discovers project package version
  `2026.07.20.5`, resolves it as the active `cms-java-refactor` profile with ten projected agents, and confirms that the
  scheduler prompt overlay contains the decision-epoch contract.
- The project package and its regression were committed locally as `3d50ba8` (`dsw-33987 honor current CMS task wake
  evidence`). The CMS project has no configured remote, so there is no project remote to push; the pre-existing dirty
  `repositories/flashcms` submodule and untracked `.test-tools/` validation data were not staged or modified by the commit.
- Port and command-line identity proved PID `20992` was the same Codex-owned archive Bun backend. Only that backend was
  stopped. Replacement PID `18020` runs the same serve command from the persistent `fde22206db` archive runtime, is
  healthy on `127.0.0.1:7878`, and reports the unchanged formal database. Vite and Overlay were not touched. A bounded
  project Mailbox snapshot immediately before deployment remained unchanged at
  `pev_f7cf5c82a001xML2d4uZUWwGfA`; therefore one exact-model same-Mission wake is now permitted to exercise the new
  active projection against the existing Phase 10 verifier Goal.

### Recall update: fact-check requires an ephemeral target runtime contract after restart

- The next bounded Mailbox snapshot added `pev_f7d01caef001Ts7wNCc8atGinX`. A Phase 10 Orchestrator made real tool
  decisions: it loaded the CMS method Skill, called `dispatch_agent` through the fact-check adapter, received
  `SessionRuntimeContractMissingError` for terminal target session `ses_083e0a32effeI2pUaFEoh01lCG`, and then called
  `manage_task action=fail_task`. This is no longer the prior prose-only no-decision symptom, but it did not create the
  required verifier.
- Chronology corrects the initial interpretation of that event. The Orchestrator attempt began at `1784508645405` and
  failed the Task at `1784508697307`. The exact operator wake text for package `2026.07.20.5` was not persisted to the
  Mission session until `1784508773193`, after that Task failure, because the existing Mission turn was still compacting.
  Therefore the new event cannot be claimed as full execution of the exact wake just submitted. That exact Mission input
  remains queued behind the current Mission compaction; do not submit another wake.
- Read-only database evidence nevertheless proves the adapter defect independently. Both target
  `ses_083e0a32effeI2pUaFEoh01lCG` and the later requested target `ses_083d6989affemPdnvdqWjutwA4` belong to the current
  Task/Goal, have durable `session.status terminal/completed` events, exact terminal assistant identity, and parent user
  messages that persist a `workerTurnDescriptor` ID/hash plus the projected agent/system/model/tool input. The descriptor
  lookup and hash/agent/session-kind comparisons all succeeded; rejection occurred only when
  `resolveFactCheckTargetScope` additionally called `validateSessionRuntimeContractForContinuation(...,
  requireRuntimeContract: true)` against the process-local `SessionRuntimeContractStore` Map, which is empty for
  historical workers after an authorized backend restart.
- This is a generic fact-check scheduling/persistence mismatch, not a CMS behavior or Expert Squad defect. Fact-check does
  not continue or mutate the target session; it opens a new verifier against the exact immutable terminal message. Its
  durable authority is already the task ownership, terminal snapshot, message-bound descriptor ID/hash, descriptor
  identity, target agent, and session kind checked immediately before the ephemeral runtime-contract requirement.
  Requiring a live turn runtime object makes every valid historical target unverifiable after process restart and cannot
  be repaired by another model prompt or target choice.
- Whole-repository search found the single fact-check target caller in `orchestrator/tools.ts`; other
  `validateSessionRuntimeContractForContinuation` callers operate on live continuation, reply, message-write, mailbox, or
  Task API execution boundaries and are not part of this repair. The focused regression is
  `test/fact-check/orchestrator-tool.test.ts`, whose current missing-runtime case explicitly encodes the defective rejection.
  Repair only fact-check target resolution: retain every durable ownership, terminal, message, descriptor, hash, agent and
  session-kind check; remove only the process-local runtime-contract requirement for this immutable historical target.
  Change the focused test to clear the target runtime contract, simulate a restart-shaped historical target, and require a
  real verifier dispatch/attempt instead of rejection. Do not persist executable runtime tools, reconstruct a live target
  contract, relax live continuation checks, add a fallback, or add a CMS-specific branch.

### Historical terminal fact-check target repair implementation

- The exact package `2026.07.20.5` Mission input subsequently completed its real Task wake in new Orchestrator session
  `ses_082fa33f9ffeHS5ZlstX8nkwbb`. Database parts prove the Squad repair itself works: the first scheduler tool was
  `read_task_message`, which returned current root message `msg_f7d05ca7f001OLL0lBoUsAenk4`; the Orchestrator then loaded
  the method Skill, made exactly one fact-check dispatch against requested target
  `ses_083d6989affemPdnvdqWjutwA4`, and closed through `manage_task action=fail_task` after the pre-worker error. It did not
  repeat historical prose, create an entity, switch target, redo implementation, or run a Maven/private-POM probe.
  Mailbox `pev_f7d067cca001kTJnvHMMcTJ50e` records that exact failure. Thus the Expert Squad decision-epoch repair is
  accepted; the remaining admission failure is independently generic infrastructure.
- The focused restart-shaped regression now clears only the terminal target's process-local runtime contract while
  retaining its durable Task ownership, completed lifecycle, parent user message, immutable descriptor ID/hash, assistant
  identity and content hash. It failed first with the production `SessionRuntimeContractMissingError`. The fact-check
  resolver now omits only `validateSessionRuntimeContractForContinuation` for that immutable historical target. Streaming
  and cross-Task targets remain rejected; a caller-supplied wrong target agent still fails against the durable terminal
  identity; the correct target creates one verifier attempt and returns a clean report.
- Strictness remains single-source and durable. `Session.snapshotLatestAssistant` still requires terminal/completed
  lifecycle, completed assistant, parent user message and descriptor reference. `WorkerTurnDescriptor.get` still verifies
  the descriptor belongs to that session, parses its strict payload, recomputes its SHA-256 hash, and checks the persisted
  agent index. `resolveFactCheckTargetScope` still compares the message reference hash, descriptor identity, target agent,
  session kind and current Task ownership. Live continuation/reply/message-write callers retain their runtime-contract
  validation unchanged.
- Verification passes: full dynamic fact-check integration 5/5 with 49 assertions; fact-check snapshot 11/11 with 25
  assertions; scheduler capability projection 17/17 with 189 assertions; OpenCorvus TypeScript passes. The scheduler test
  title was corrected to describe its actual durable message-bound descriptor check rather than the removed ephemeral
  runtime prerequisite. Deployment, commit/push and one post-repair same-Mission continuation remain next; do not wake
  before the tested production hunk is deployed.

### Historical terminal fact-check target repair deployment

- Commit `e776aa5f83` (`dsw-33987 admit durable fact check targets`) was pushed to legacy remote `legacy-remote/v0.0.10beta`.
  The complete pre-push hook passed SDK imports, AI runtime, all eleven package typechecks, API routes, generated docs,
  Overlay internationalization and secret scan.
- Only the tested fact-check target-resolution production hunk was applied to the persistent `fde22206db` archive
  runtime. Archive OpenCorvus TypeScript passed. Port and command-line identity proved PID `18020` was the same
  Codex-owned Bun backend; only that backend was stopped. Replacement PID `29632` is healthy on `127.0.0.1:7878` and
  reports the unchanged formal database. Vite and Overlay were not touched.
- Phase 10 remains honestly failed at Mailbox event `pev_f7d067cca001kTJnvHMMcTJ50e`; its exact failed Orchestrator
  `ses_082fa33f9ffeHS5ZlstX8nkwbb` is terminal and created no verifier. The deployed repair is a concrete new external
  input that satisfies the Mission handoff's only resume condition. Exactly one same-Mission wake may now reopen only
  Phase 10 verifier Goal `gol_f7b652534005lqRvmWc5ovgh6P` and repeat the same fact-check target
  `ses_083d6989affemPdnvdqWjutwA4`; no other entity, target, implementation or environment probe is authorized.

### Recall update: backend restart revived a superseded Orchestrator decision epoch

- The benchmark contract remains unchanged: CMS only, bounded project Mailbox supervision, formal database,
  `hexin/gpt-5.6-sol`, large Phases with many Goals, no duplicate entities or implementation/POM probes, and no acceptance
  before a new verifier plus its Goal-scoped terminal matrix. The deployed fact-check repair is still the only authorized
  continuation input.
- The next bounded Mailbox snapshot added `pev_f7d105dd2001yr5zN7h5zFzv2D`, another
  `OrchestratorNoDecisionStopError`. This is not a delayed historical event. Formal message chronology proves current
  Task-root message `msg_f7d10347c0011zDGKB4zAmcP8c` was persisted at `1784509641852`, the Task reopened and started,
  and only afterwards original Orchestrator `ses_084a53d86ffe0wV2kQ7Z4CUsm0` created assistant
  `msg_f7d1038120016nYxM0KCdxIt4X` at `1784509642770`. That turn called no tools, named stale target
  `ses_083e0a32effeI2pUaFEoh01lCG`, and repeated the old runtime-contract blocker instead of reading the current root
  message that fixed target `ses_083d6989affemPdnvdqWjutwA4`.
- The prior independent CMS route review remains valid for the package change itself: package `2026.07.20.5` is correctly
  projected and a clean decision epoch already proved it by calling `read_task_message`, the CMS Skill, one fact-check
  dispatch and a real lifecycle tool. The new evidence changes responsibility because the scheduler did not select that
  clean/latest epoch. This recurrence is generic Orchestrator session selection across backend restart, not another CMS
  behavior rule to encode in the Squad.
- Durable lifecycle evidence proves the original Orchestrator had already emitted `session.status terminal/completed` at
  `1784508697695`. The later clean Orchestrator `ses_082fa33f9ffeHS5ZlstX8nkwbb` was created at `1784508959750` and is
  also durably terminal/completed. After the authorized backend restart, `SessionStatus.get()` had an empty process-local
  map and returned its default `idle`; `orchestratorSessionForTask` sorted direct children oldest-first and selected the
  earliest apparently non-terminal session. The current wake therefore revived a superseded decision epoch and its stale
  conversation despite a newer epoch existing.
- Whole-repository grep found the production selection in `orchestrator/agent.ts`, the direct session-reuse regression in
  `test/orchestrator/session-reuse.test.ts`, and the durable lifecycle authority already implemented for fact-check
  snapshots and Task DAG projection. The architecture record for the invocation DAG explicitly names the latest durable
  `protocol_event(type=session.status)` as session-status authority. No caller justifies choosing an older Orchestrator
  epoch after a newer sibling exists.
- Repair direction: extract the existing process-owner/durable-lifecycle resolution into one strict session helper and use
  it both for immutable assistant snapshots and Orchestrator selection. Select only the newest direct Orchestrator epoch;
  reuse it only when its authoritative lifecycle is non-terminal, otherwise create a new epoch. Never fall back to an older
  sibling. Add restart-shaped coverage with an empty process latch, an older durably terminal Orchestrator, and a newer
  durably terminal Orchestrator; the next wake must create a third clean session. Also retain the ordinary single live
  session reuse case. This is lifecycle reconstruction, not a host gate, retry state machine, CMS branch, alias, or
  synthesized message.
- Validation must include red-before/green-after session-reuse coverage, snapshot lifecycle coverage, affected
  task-message continuation tests, OpenCorvus TypeScript, docs health, commit/push, archive-runtime deployment and only
  then one exact-model same-Mission continuation. The pre-existing `session-hard-error.test.ts` contract failure remains a
  separate required repository follow-up before benchmark-wide acceptance.

### Durable Orchestrator decision-epoch repair implementation and verification

- The restart-shaped regression created an older and a newer direct Orchestrator child, persisted
  `session.status terminal/completed` for both without populating the process latch, and then continued the Task. It failed
  first because `orchestratorSessionForTask` selected the older child. After the repair it creates a third clean decision
  epoch and never revives either terminal sibling.
- The process-owner/durable-event resolver previously embedded in `Session.snapshotLatestAssistant` is now the single
  `resolveSessionLifecycle` helper. A non-idle process latch remains authoritative for a current generation; otherwise the
  helper reads the latest `session.status` or `session.idle` event by emitted time and sequence and strictly parses the
  status schema. Missing evidence remains idle; malformed durable payloads still fail. The fact-check snapshot now calls
  this same helper, so the extraction introduced no second lifecycle interpretation.
- `orchestratorSessionForTask` now treats direct Orchestrator children as successive decision epochs. It examines only the
  newest child: if that epoch is authoritatively non-terminal it is reused; if terminal, a new child is created. An older
  sibling is never a fallback candidate. Task queueing, wake admission, prompt construction, no-decision detection and CMS
  projection are unchanged.
- The new regression was red before the production change and green afterward. The complete affected selection passes:
  session reuse 4/4, fact-check snapshots 11/11, and Task-message routes 27/27, totaling 42 tests and 266 assertions.
  OpenCorvus TypeScript passes. Document health plus historical link health pass 82/82 with 1,354 assertions.
  `git diff --check` passes. Review also confirmed the unrelated concurrent expert-squad/catalog/SDK modifications in the
  worktree are outside this change and must not be staged or overwritten.

### Durable Orchestrator decision-epoch repair deployment

- Commit `61774ce0db` (`dsw-33987 preserve orchestrator decision epochs`) was pushed to legacy remote
  `legacy-remote/v0.0.10beta`. The full pre-push hook passed SDK imports, AI runtime, all eleven package typechecks, API routes,
  generated docs, Overlay internationalization and secret scan.
- Only the tested lifecycle helper, fact-check snapshot refactor and Orchestrator epoch-selection hunk were applied to the
  persistent `fde22206db` archive runtime. Archive OpenCorvus TypeScript passed. Port and command-line identity proved PID
  `29632` was the same Codex-owned Bun backend; only that process was stopped. Replacement PID `13372` is healthy on
  `127.0.0.1:7878` and reports the unchanged formal database. Vite and Overlay were not touched.
- The current Phase 10 wake remains active after the prior no-decision and has created no verifier. The deployed generic
  scheduler repair is a concrete new external input: exactly one same-Mission continuation may now instruct the Mission to
  reconcile the existing active Task and send at most one current-root continuation for the unchanged verifier Goal and
  target. It must not create another Mission, Task, Phase, Plan or Goal, repeat implementation/POM/environment probes, or
  accept without the new verifier session and terminal matrix.

### Recall update: concurrent old sidecar destructively refreshed the formal database

- The first exact-model Mission continuation after deployment was rejected before Mission admission with
  `EBUSY ... rm opencorvus.db-wal`; therefore it created no Mission input, Task wake, verifier or other benchmark entity.
  The next bounded Mailbox request failed with `DatabaseUnavailableError / SQLITE_CORRUPT`; no new Mailbox chronology is
  available and no further Mission request is permitted until recovery.
- Port and health evidence attributes the destructive refresh to the user-running Overlay sidecar PID `13156` on port
  7879, not the Codex-owned archive backend. Its `/global/health` reports `databaseSchemaRefresh.reason = unexpected table
  workbench_task_note`, refresh time `2026-07-20T01:24:13.831Z`, and backup
  `opencorvus.schema-backup-2026-07-20T01-24-13.831Z-ef3929cc-4db2-42ac-bae2-a7ff641b2428.db`. The old sidecar schema
  treated a valid newer table as grounds to rebuild the shared formal database. This is a generic destructive
  cross-version database-ownership defect, not a CMS Squad issue.
- The refresh backup is intact and was opened read-only: 201 sessions, 4,484 messages, 23,399 parts, 9,930 protocol events,
  21 Tasks, and exact Mission `ses_0865d37baffeG64lDgz2tb2Wd5` plus Phase 10 Task
  `tsk_f7b5a80ed001t3xRSi7FYoUnS5`. Its SHA-256 is
  `12B82278E8923C9FEC8A9F325421550A789BF2C4BB52B0BE79B75E9C00CA8EED`.
- Two ten-hour orphan Bun test processes with dead parents were also holding the formal WAL/SHM files; they were terminated
  as abandoned Codex test tooling. Codex-owned backend PID `13372` was stopped. A restore copy attempted while the Overlay
  sidecar still held the database did not produce a valid SQLite image; current `opencorvus.db` is malformed. The verified
  backup remains unchanged and is the sole recovery source; no database file or backup was deleted.
- Recovery now requires explicitly stopping the user-running Overlay/sidecar, atomically preserving the malformed current
  DB/WAL/SHM under distinct names, copying the verified backup into the formal path, verifying hash and record counts, and
  starting only a schema-compatible backend. Rule 39 forbids stopping or restarting the user's Overlay without explicit
  authorization. Until that authorization arrives, do not retry Mailbox, Mission, backend startup or database copying.
- Infrastructure repair after data recovery must remove destructive automatic schema refresh for unexpected/mismatched
  schemas and cover concurrent old/new runtimes against one database. A process may report an incompatible schema and
  refuse startup, but must never rename, delete, replace or rebuild a user's formal database automatically. No compatibility
  fallback or silent migration is acceptable.

### Recall update: abandon the damaged database and move forward from source state

- The user explicitly directed: do not restore the database; move forward. This supersedes only the recovery procedure
  above. The malformed formal database and the verified schema backup remain untouched as incident evidence, but neither
  is an active benchmark source and no further copy, restore, migration, reset, or Mailbox request may target them.
- The durable benchmark requirements remain unchanged: CMS only; `hexin/gpt-5.6-sol`; project directory
  `C:/Users/chuan/myhexin-local/cms-system-refactor`; dev backend plus Vite; a persistent nondeleted runtime directory;
  bounded project `/mailbox` snapshots rather than log monitoring; large Phase scope with many Goals; careful separation
  of scheduler infrastructure defects from Expert Squad responsibility; tests, real acceptance evidence and independent
  delivery review before completion.
- Existing repository contents are the new Mission's implementation authority. Dictionary Phase 10 source work already
  present under `repositories/flashcms` must be inspected and continued, not recreated or discarded. The last verified
  goal ledger was 4/9 complete: unified Java write client, create UI, batch-update UI and soft-delete UI were implemented;
  the repository behavior verifier, PHP writer retirement, real desktop visual acceptance, production auth/Java/DB/Redis
  boundary and independent integrity review remained. Seed and media follow dictionary; parent-object work remains blocked
  until its Java repository is supplied.
- A new persistent OpenCorvus home will be provisioned as the sole runtime/data source for this continuation. It may be
  initialized with the existing model credential/config assets as an explicit one-time environment provision, but must
  never read or fall back to the damaged database. A new Mission identity will record that this is continuity from source
  state after database abandonment. It must validate current files before dispatching work and must not rerun the resolved
  private-POM probe, duplicate existing writers, or claim old database entities as live progress.
- The generic destructive cross-version schema-refresh defect remains an unresolved infrastructure finding. It is not a
  reason to stop the CMS continuation because the new runtime has exclusive persistent storage; it must still be repaired
  and regression-tested before benchmark-wide infrastructure acceptance. The user-running Overlay sidecar on port 7879
  remains outside this run and must not be stopped or restarted.

### Recall correction: formal global database remains the required single source

- The user clarified that “do not restore the database” meant do not restore the historical backup, not abandon the formal
  global database path. The isolated `cms-benchmark-runtime-20260720` database was an incorrect supervisor decision. It is
  retained as an audit artifact but is no longer an authorized execution source; its Mission must not be resumed.
- The required single source is the formal global data directory `C:/Users/chuan/.local/share/opencorvus`. Because the
  current formal `opencorvus.db` image was already proven malformed, the authorized forward-only operation is to preserve
  the current DB/WAL/SHM files under a distinct incident directory without restoring the historical schema backup, then let
  the current tested backend create a new database at the same formal path. No data is migrated from the isolated database.
- Dev backend, Vite and the binary UI must converge through one backend owning that formal database; two backend versions
  must not concurrently open the SQLite files. The user explicitly authorized restarting the CMS task against the global
  database. The exact model remains `hexin/gpt-5.6-sol`, the project remains
  `C:/Users/chuan/myhexin-local/cms-system-refactor`, and existing source state remains the implementation authority.

### Formal global database restart execution

- The isolated backend was stopped; Vite on port 5174 remained running. A read-only check showed the then-current formal
  database was SQLite-integrity clean but contained an old empty schema: one project, zero sessions/messages/tasks, 47
  tables and no `workbench_task_note`. It was not a source of recoverable benchmark progress.
- No historical backup was restored. The exact formal DB/WAL/SHM files were moved recoverably to
  `C:/Users/chuan/.local/share/opencorvus/forward-reset-20260720-095313/`. The DB archive is 819,200 bytes with SHA-256
  `2313CA50FFE0BA1F428DAED2269F06E7FD596667F7B91284A0BDCDD8D7486568`; the historical schema backup remains untouched.
- The tested archive backend was started without `OPENCORVUS_HOME` and now reports its database as the required formal
  `C:/Users/chuan/.local/share/opencorvus/opencorvus.db`. Port 7878 and Vite 5174 are online; no port-7879 second backend is
  listening. Project discovery returns only `cms-system-refactor` as the default project.
- Mission `cms-java-refactor-20260720` was newly created in the formal database as session
  `ses_082c44d4effenFJ2IAvVIShgGE`, fixed to `hexin/gpt-5.6-sol` and profile `cms-java-refactor`. Its initial bounded
  Mailbox snapshot is empty while Mission status is running with no Tasks yet. Future supervision must query only this
  formal-database Mission and must never resume the isolated Mission session.

### Recall update: binary schema refresh cleared the formal Mission; restart from source again

- After the binary Overlay started its own sidecar on port 7879, both it and the dev backend on port 7878 opened the same
  formal database. The binary sidecar's project-scoped routes returned `EBUSY ... rm opencorvus.db-wal`, proving it entered
  the automatic schema-refresh rotation while the dev backend held the WAL. This is the already identified generic
  infrastructure defect, not a CMS Expert Squad failure.
- The user reported the DB had been cleared and directed creation of a new Mission. A bounded runtime check now finds both
  ports 7878 and 7879 stopped. Read-only SQLite verification finds the formal DB integrity clean but empty: one project,
  zero sessions/messages/protocol events/tasks/goals, 47 tables, and no `workbench_task_note`. Mission
  `cms-java-refactor-20260720` / session `ses_082c44d4effenFJ2IAvVIShgGE` is therefore durably gone and must not be resumed.
- Continue forward from the unchanged CMS source tree; do not restore any backup. Preserve the empty incompatible formal
  DB as an incident artifact, start exactly one tested dev backend against a newly created DB at the same formal global
  path, and create a new Mission identity fixed to `hexin/gpt-5.6-sol` and `cms-java-refactor`. The Phase scope, many-Goal
  requirement, remaining dictionary acceptance surfaces, mailbox-only supervision and independent review remain unchanged.

### Formal global Mission r2 startup

- The empty binary-schema database was preserved at
  `C:/Users/chuan/.local/share/opencorvus/binary-cleared-20260720-135623/`; its DB SHA-256 is
  `C3A4678580EEA5FFA38A38A5B9351B2BC8A5636CC685C5BF3F8B89DAF5C1F302`. No historical or isolated database was restored.
- Exactly one tested dev backend now listens on port 7878 and reports
  `C:/Users/chuan/.local/share/opencorvus/opencorvus.db`; port 7879 has no listener. Vite is healthy on port 5174.
- New Mission `cms-java-refactor-20260720-r2` was created as session `ses_081e5b9e9ffeBWkUiSs5T9w54Y`, fixed to
  `hexin/gpt-5.6-sol` and profile `cms-java-refactor`. Its initial bounded Mailbox is empty and status is running with zero
  Tasks while the Mission turn begins. This r2 identity is the only authorized Mission for subsequent heartbeat checks.

### Recall update: r2 child execution chain died while the backend remained healthy

- The benchmark contract remains CMS-only, formal global database, bounded Mailbox supervision, persistent project/runtime
  directories, and exact model `hexin/gpt-5.6-sol`. The active identities remain Mission
  `cms-java-refactor-20260720-r2`, Task `tsk_f7e1d7333001TqTQE2YAt2GmZ5`, and ten broad dictionary Goals; no replacement
  Mission, Task, Phase, Plan, or Goal is authorized.
- Bounded Mailbox chronology contains one passed source-audit Goal and one failed PHP-writer-retirement Goal. Authoritative
  `protocol_event` evidence attributes the failure to `ProcessorUnsafeRetryError` after a real
  `LLMActivity idle > 180000ms`, following an internal compaction checkpoint and earlier tool execution in the same
  assistant message. The worker had reached a concrete PHPUnit failure (`Cms_Config` unavailable) and was planning the
  next test repair when its final StructuredOutput stream stalled. This is generic session retry/continuation
  infrastructure, not a CMS Squad functional decision.
- Java contract Goal session `ses_081b3d3daffeHTxzk1TEuSIYe6` remains durably `streaming` with no event after
  `1784530651654`; its persisted message contains several filesystem glob tool parts still marked running. Orchestrator
  session `ses_081e25a4effea1LyLXx8MLX36r` has been durably idle since `1784530360933` and received no consumable
  `protocol_inbox` row. The backend process and HTTP health remain alive, so the visible Idle state is a dead child/tool
  ownership chain rather than a dead server.
- The existing 2026-07-07 retry design intentionally refuses same-message retry after tool execution to prevent duplicate
  side effects. That invariant must remain strict. Recovery must create a fresh decision epoch/assistant message through
  the canonical Mission wake after clearing the dead process ownership; it must not retry inside the corrupted assistant
  message, rewrite terminal evidence, or encode a CMS-specific fallback. The deeper missing automatic parent wake and
  stale tool-settling paths remain infrastructure defects requiring regression coverage.
- Whole-repository grep covered `ProcessorUnsafeRetryError`, `withLLMActivity`, `LLMActivity idle`, compaction checkpoints,
  session lifecycle events, Goal terminal projection, Mission wake, Task message continuation, and protocol inbox. The
  relevant sources are `session/processor.ts`, `llm/activity.ts`, `session/loop.ts`, `engine/event-log.ts`,
  `engine/stage-continuation.ts`, `engine/store.ts`, `mission/session.ts`, and `server/routes/mission.ts`; focused tests live
  under `test/session`, `test/engine`, `test/mission`, and `test/orchestrator`.

### Recall update: publish source-continuation Mission with parallelism 10

- On 2026-07-21 the user explicitly requested publishing a continuation task from current progress with parallelism 10.
  The active backend on `127.0.0.1:7878` is now the user-running `opencorvus.exe` `0.0.12-beta` sidecar, not the prior
  Codex-owned dev Bun process. It reports the required formal database path and is the only listener on 7878; Vite remains
  on 5174 and no 7879 listener exists. This operation must not stop or restart either user process.
- A bounded Mailbox snapshot is empty. Read-only formal-database counts are two registered projects but zero sessions,
  Tasks, Goals and protocol events, and `/mission` returns no CMS Mission. Therefore r2 lifecycle identities no longer
  exist in the active database and cannot be resumed. Publishing a new Mission is authorized, but current disk source and
  evidence are the sole continuation authority; no historical lifecycle status may be claimed as live progress.
- The project package is present and active: `/config` reports `prompt_profile.active=cms-java-refactor`, while the exact
  shared concurrency field is currently `assistant.max_executor_groups=3`. The Overlay and server use this single field;
  the authorized update is the canonical project-scoped `PATCH /config` to 10, followed by read-back verification. Agent
  `goal_concurrency` declarations remain package capability constraints and are not rewritten to mimic project parallelism.
- Current source inspection shows main HEAD `fc37523`, dirty nested `repositories/dictionary-server` and
  `repositories/flashcms`, and dictionary evidence directories for source audit, Java contract/create/persistence/cache/
  update-delete, FlashCMS operations, single authority and repository verifier. The latest source audit records FlashCMS
  local commits plus dictionary-server contract/controller unstaged files. The new Mission must begin by reconciling these
  current files and evidence, preserve all changes, avoid private-POM re-probing, avoid duplicate writers and business-repo
  commit/push, and then continue the broad dictionary Phase before seed/media.

### Source-continuation Mission r3 publication

- Canonical project-scoped `PATCH /config` changed `assistant.max_executor_groups` from 3 to 10; immediate `GET /config`
  read-back returned 10 and retained `prompt_profile.active=cms-java-refactor`.
- New Mission `cms-java-refactor-20260721-r3` was created as `ses_07fa5e836ffeJcIUKxyVsFV2rB` with exact model
  `hexin/gpt-5.6-sol`. It wrote its source-continuation contract and current evidence notes before dispatching work.
- The Mission published exactly one active Task, `tsk_f805c604e001bWCmENPKQvtrTl`, titled
  `Phase 01: 词典写侧完整交付`. No second Mission or duplicate Task was created. Goal registration is still in the active
  Orchestrator planning turn and must remain source/evidence-driven; supervision continues through bounded Mailbox/status
  snapshots without log monitoring.
