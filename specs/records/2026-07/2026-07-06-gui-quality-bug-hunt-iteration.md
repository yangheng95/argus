# GUI Quality Bug Hunt Iteration

Date: 2026-07-06
Status: Active iteration record
Owner: Codex

Supersession note: Direct-child package-layout mentions in this audit record are historical evidence or defect descriptions. Current project and repository package roots are `.opencorvus/expert-squads/<namespace>/<id>/`, as recorded by `2026-07-06-expert-squad-namespaced-source-layout.md`.

## Glossary

- API: Application Programming Interface.
- E2E: End-to-End.
- GUI: Graphical User Interface.
- ID: Identifier.
- MCP: Model Context Protocol.
- SDK: Software Development Kit.
- UI: User Interface.

## Recall

### User Request

The user set the active goal to act as a professional GUI testing engineer, lead independent agents as colleagues, scan the project for bugs and risks, and self-iterate unattended. Every iteration must use independent agents to discover high-confidence new issue locations. The scope includes, but is not limited to, algorithm stability, UI/UX style issues, dual-source issues, and built-in/external expert-squad bugs and weaknesses. The process should continue until no new issue location can be found.

### Acceptance Criteria

- Each iteration includes independent-agent review for high-confidence new issues.
- Only evidence-backed, high-confidence findings are accepted for repair.
- Fixes must address root causes without fallback, compatibility aliases, gates, hidden routing, UI-only filtering, or duplicate active state.
- Expert-squad identity remains manifest `id`; namespace is source and install partition, not active identity.
- `prompt_profile.active` remains the only active expert-squad selection source.
- `PromptProfileResolver` remains the single runtime projection surface for catalog, scheduler capability, worker capability, visible selector skills, skills, package tools, scoped MCP providers, and skill mounts.
- Runtime built-in expert-squad packages remain limited to `general`; non-general packages are clear-text project packages released from payloads and discovered through the normal registry/catalog/resolver path.
- Any code change must include focused tests. Frontend/GUI changes additionally require real rendered-page screenshot review without restarting or refreshing a user-owned running OpenCorvus/overlay process unless explicitly authorized.
- Benchmark/test timeouts must be inactivity-based when a benchmark loop is introduced; do not rely on a blind wall-clock timer from process start.
- After tests pass, perform a second review before treating the iteration as accepted.

### Hard Constraints

- `AGENTS.md` forbids fallback/compatibility logic, double-source designs, broad git reset, hidden/synthetic messages, and package-local specs outside root `specs/`.
- Dead, obsolete, or meaningless code must be reported to the user before deletion.
- The current worktree has substantial pre-existing uncommitted changes. They must not be reverted or overwritten. Any repair must work with those changes.
- Do not create new git worktrees without explicit user authorization.
- Do not restart, kill, refresh, or otherwise interfere with currently running OpenCorvus/overlay processes without explicit user authorization.
- Commit subjects for this delivery line must use the `dsw-33987` prefix when committing is reached.

### Sources Read

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/benchmark-debug-template/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-06-dynamic-expert-agent-instance-review-plan.md`

### Repository State Evidence

- `git status --short --branch` showed the branch is `v0.0.2beta...myhexin/v0.0.2beta` with substantial existing uncommitted changes, including deleted old flat `.opencorvus/expert-squads/<id>` package files, new `.opencorvus/expert-squads/builtin/**` and `.opencorvus/expert-squads/wujiang/**` package sources, and changes across expert-squad registry/manager/resolver/routes/tests/overlay SDK/specs.
- `git remote -v` confirmed the git-cc remote is `myhexin` at `https://git-cc.myhexin.com:6443/yangheng/opencorvus.git`.
- `git diff --stat` showed the current tree has 128 changed files with package-source relocation and expert-squad runtime changes. This record does not claim ownership of those existing changes.

### Repository Search Evidence

- `rg -n "ExpertSquadRegistry|ExpertSquadPackageManager|PromptProfileResolver|expert-squads|expert-squad\\.jsonc|prompt_profile\\.active|select_expert_squad|active_skill_projection|capability_projection|active_agent_projection|virtual_agents" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test specs/current specs/records`
  - The result spans registry, resolver, package manager, server routes, orchestrator selection, runner prompt composition, overlay service contracts, SDK/OpenAPI, tests, and current/historical specs.
- `rg -n "loadEmbeddedPackage|EmbeddedPackageSource|renderSelectorSkillMarkdown|discover\\(|loadPackage\\(|loadSourcePackage\\(|importDirectory\\(|importArchive\\(|exportArchive\\(|payload|seed|release|virtual-agents|namespace" packages/opencorvus/src packages/opencorvus/test packages/opencorvus/script packages/overlay/src specs/current specs/records`
  - The result was very large, confirming that payload, namespace, release, and package discovery changes must be scoped through registry/manager/resolver/tests rather than a single call site.
- `rg --files .opencorvus/expert-squads packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad packages/opencorvus/test/server packages/overlay/test | Sort-Object`
  - Current package sources are now under `.opencorvus/expert-squads/builtin/<id>` and `.opencorvus/expert-squads/wujiang/opentest`; runtime built-in source remains `packages/opencorvus/src/expert-squad/builtin/general`.
- `rg -n "TODO|FIXME|fallback|compat|legacy|alias|best[- ]effort|default|try.*catch|catch \\(|existsSync|overwrite|replace|namespace|virtual_agents|active_agent_projection|PromptProfile\\.builtIns|builtIns" packages/opencorvus/src/expert-squad packages/opencorvus/script/generate-expert-squad-payload.ts packages/opencorvus/test/expert-squad packages/opencorvus/test/server/expert-squad-routes.test.ts packages/overlay/src/services/expert-squad.ts`
  - Initial flags include namespace handling in generator/manager/registry/resolver, import/export `replace`, active-agent projection route tests, and built-in boundary tests. These are investigation leads, not accepted findings yet.

### Independent Agent Feedback

First iteration agents were launched on 2026-07-06:

- Curie: read-only backend projection audit over registry, resolver, catalog, routes, and skill mounts.
- James: read-only payload generation/package manager/namespaced source layout audit.
- Parfit: read-only overlay GUI and expert-squad UI/UX audit.
- Archimedes: read-only tests/contracts/docs health audit.

Accepted high-confidence findings from the first iteration:

- Curie found that virtual-agent package resources are validated and fingerprinted from `virtual-agents/<role>/**`, but runtime tool and MCP materialization still resolves package tool and MCP server refs from `agents/<role>/**`. This is accepted as a root-cause bug because registry collection, architecture docs, and resolver digest paths already agree on the virtual-agent root while runtime execution does not.
- Curie found that `default_mcp_server_refs` is accepted and exposed as a public projection field but has no runtime consumer. This is accepted as a design-contract bug to resolve by rejecting non-empty `default_mcp_server_refs` until server-level default MCP expansion has a concrete implementation.
- James found that `PromptProfileResolver` calls `releasePayloadPackages()` from catalog/definition/validation paths. This is accepted as a root-cause rule violation because read/query paths can mutate `.opencorvus/expert-squads/<namespace>/<id>/`, turning payload release into hidden provisioning.
- James found that `build.local.ts` can compile without regenerating `payload.ts`. This is accepted as a build reproducibility bug because `build.ts` already regenerates payloads before compile, while `build.local.ts` remains a documented compile entrypoint.
- James and Archimedes both found that overlay tests and fixtures still use direct-child `.opencorvus/expert-squads/<id>` package roots or omit `source.namespace`. This is accepted as a mocked-contract bug because the service type already requires namespaced project package sources.
- Parfit found that the settings UI displays `session_override: null` as inherited from project but provides no action to clear an existing session override. This is accepted as a GUI workflow bug because the only available session action writes a concrete expert-squad ID.
- Parfit found that catalog route error responses are under-described in the route contract. This is accepted for route-contract repair after the read-path mutation fix, because catalog can surface explicit errors without changing active selection semantics.
- Archimedes found that route import/export tests are still exposed to Bun's default wall-clock timeout and that the route round-trip does not assert namespaced `targetRoot`. This is accepted as a validation-stability bug.
- Archimedes found that implemented July expert-squad records still contain old direct-child path assertions without supersession notes. This is accepted as a docs-health bug to repair with explicit supersession text and a health check.

## Benchmark Definition

### Task Definition

Run iterative, evidence-backed quality audit and repair across OpenCorvus expert-squad and GUI-related surfaces, using independent agents each iteration to discover new high-confidence issue locations.

### Input

- Current working tree at `C:/Users/chuan/myhexin-local/opecorvus`.
- Current architecture and July 2026 records under `specs/`.
- Expert-squad packages under `.opencorvus/expert-squads/**`.
- Runtime, route, SDK, overlay, and test sources under `packages/**`.

### Output

- A dated audit record with Recall, independent-agent feedback, accepted findings, repairs, tests, and second-review notes.
- Scoped code/test/doc repairs for accepted high-confidence findings.
- Validation evidence for focused tests, docs health checks when specs change, typecheck when TypeScript contracts change, `git diff --check`, and GUI screenshot review when GUI code changes.

### Timeout Strategy

Focused test or benchmark commands should use an inactivity-based wrapper when they are long running. Short deterministic `bun test` and `git diff --check` commands can run directly; if a command stalls because tooling is broken, repair the tooling before continuing.

### First Iteration Candidate Validation Commands

- `bun test packages/opencorvus/test/expert-squad/registry.test.ts`
- `bun test packages/opencorvus/test/expert-squad/package-manager.test.ts`
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`
- `bun test packages/opencorvus/test/expert-squad/payload-generation.test.ts`
- `bun test packages/opencorvus/test/server/expert-squad-routes.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check`

## Iteration Log

### Iteration 1

Status: Repair in progress.

Known current leads before independent-agent returns:

- Namespaced source layout changed the canonical package path to `.opencorvus/expert-squads/<namespace>/<id>`, so every direct `<id>` assumption must be audited.
- Payload generation now derives `namespace` and rejects direct package roots; payload release must not overwrite or collide across namespaces.
- Catalog now exposes `active_agent_projection`; overlay service, OpenAPI, SDK, and route tests must agree.
- The current worktree includes old flat package deletions and new namespaced package additions. These may be intentional architecture work, not issues by themselves.

Accepted findings:

- GUI-01: session expert-squad override cannot be cleared back to project inheritance from the settings panel.
- GUI-02: overlay mocked catalog/import fixtures do not model namespaced project-package source contracts.
- CORE-01: resolver read/query paths auto-release payload packages, mutating projects during catalog/definition/profile validation.
- CORE-02: virtual-agent package tools and MCP definitions are discovered under `virtual-agents/<role>` but runtime loaders still read `agents/<role>`.
- CORE-03: `default_mcp_server_refs` is accepted without runtime semantics.
- BUILD-01: `build.local.ts` lacks the payload generation step used by `build.ts`.
- TEST-01: import/export route validation is vulnerable to wall-clock timeout and lacks namespaced round-trip assertions.
- DOC-01: implemented July expert-squad records need supersession notes or corrected namespaced paths.

Repairs: pending.

Validation: pending.

Second review: pending.

### Iteration 3

Status: Repaired and validated; fourth independent-agent scan pending.

Recall update:

- Current goal remains iterative GUI and expert-squad quality repair with independent agents until no new high-confidence issue location remains.
- Third-iteration independent agents were launched after focused and broad validation of the first two iterations.
- `rg -n "pendingExpertSquadCatalogLoad|markExpertSquadCatalogStale|loadExpertSquadCatalog|sanitizeProjectEditor|expert-squads/<id>|expert-squads/software-testing|releasePayloadPackages|ExpertSquadRegistry.discover\\(" packages/overlay/src packages/overlay/test packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad specs/records/2026-07 packages/opencorvus/test/script` was run before new edits. It showed the overlay catalog cache call sites, the project-editor sanitizer tests, release payload's `discover()` dependency, and stale direct-child doc references across July records and the July README.
- Focused validation before this iteration included `PromptProfileResolver` 73/73 passing, expert-squad routes 8/8 passing, package-manager 31/31 passing, overlay expert-squad unit surfaces 28/28 passing, docs health 48/48 passing, historical docs 19/19 passing, overlay browser runner 2/2 passing with reviewed screenshots, opencorvus/overlay/SDK typechecks passing, `api:routes-check` passing, and `git diff --check` passing.

Accepted findings:

- GUI-03: `pendingExpertSquadCatalogLoad` is keyed only by request path. `markExpertSquadCatalogStale()` increments the UI refresh token but does not invalidate an in-flight service promise, so a post-write refresh can reuse a pre-write catalog for the same scope.
- GUI-04: `expert-squad-panel` browser fixture always returns the original catalog after project activation and only checks the PATCH body, so the GUI test would pass even if refreshed visible project/effective active state stayed stale.
- GUI-05: `sanitizeProjectEditor()` silently normalizes invalid project editor IDs to `vscode`, unlike executor settings which reject invalid persisted values. This is accepted as a fallback/hidden normalization issue to repair in overlay settings parsing.
- DOC-02: the stale-layout health check scans only `2026-07-06-*` records and misses earlier July records and the July README that still publish `.opencorvus/expert-squads/<id>` as a current layout.
- CORE-06: explicit `releasePayloadPackages()` calls `ExpertSquadRegistry.discover()` before installing payload packages. A project with stale direct-child package roots therefore cannot use the explicit release route to provision current namespaced payload packages. The fix must not load or accept stale direct-child packages as runtime packages; it should only isolate payload release's existing-package inventory from invalid roots.
- CORE-07: scoped prompt/resource MCP paths still require generic `create()` to successfully `listTools()`. Valid prompt-only or resource-only MCP servers can fail before prompt/resource capability validation runs.
- CORE-08: scheduler/worker projection hashes include default MCP refs and provider names but omit the resolved default MCP server config. Changing a referenced default MCP command, URL, headers, or environment changes runtime behavior without changing the capability hash.
- TEST-04: MCP scoped tool changes require the MCP lifecycle static test to track the connection record shape, and MCP-specific tests must be re-run after repair.
- TEST-05: MCP top-level mock tests for request headers and OAuth browser launch polluted later MCP serve tests through Bun module-cache and mock state. The failure signature was `setNotificationHandler` / `listTools` missing on the cached SDK client in `serve.test.ts`. The repair must isolate those mock-heavy files in separate Bun processes instead of weakening MCP serve assertions.
- TEST-06: `prompt-profile-resolver.test.ts` starts scoped MCP stdio child processes. Running those resolver cases concurrently lets Bun's dangling-process cleanup close still-active scoped MCP transports, producing `Connection closed` failures unrelated to resolver semantics. These cases need serial scheduling rather than fallback retries or ignored errors.

Repairs:

- `packages/overlay/src/services/expert-squad.ts` now invalidates the in-flight catalog promise when `markExpertSquadCatalogStale()` is called, so a post-write refresh cannot reuse a pre-write catalog for the same request path.
- `packages/overlay/test/browser/expert-squad-panel.test.ts` now updates the fixture catalog after project activation and asserts visible project active, effective active, and projection state. The GUI screenshots were reviewed at `packages/overlay/.scratch/expert-squad-settings-panel.png`, `packages/overlay/.scratch/expert-squad-session-clear-before.png`, and `packages/overlay/.scratch/expert-squad-session-clear-after.png`.
- `packages/overlay/src/store/settings.ts` now rejects invalid persisted project editor IDs instead of silently normalizing them to `vscode`; blank values still resolve to the documented default.
- `packages/opencorvus/test/script/document-health.test.ts` now scans all July records and the July README for unsuperseded direct-child expert-squad layout assertions.
- `packages/opencorvus/src/expert-squad/manager.ts` now inventories existing namespaced payload packages for explicit release without calling runtime `ExpertSquadRegistry.discover()` first, so stale direct-child roots do not block explicit provisioning while still remaining invalid for runtime discovery.
- `packages/opencorvus/src/mcp/index.ts` now allows scoped prompt/resource paths to create an MCP connection without generic tool-list verification and validates prompt/resource capabilities on their actual paths.
- `packages/opencorvus/src/expert-squad/catalog-profile.ts` and `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts` now include resolved default MCP server config in scheduler and worker projection hashes.
- `packages/opencorvus/test/mcp/headers.test.ts` and `packages/opencorvus/test/mcp/oauth-browser.test.ts` now wrap isolated test files in separate Bun processes with temporary OpenCorvus home paths, preventing SDK client mocks from leaking into `serve.test.ts`.
- `packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts` now schedules resolver cases serially to keep scoped MCP stdio transport lifetime deterministic.
- `packages/sdk/openapi.json` and `packages/sdk/js/src/gen/types.gen.ts` were regenerated after the MCP timeout description changed.

Validation:

- `bun test packages/opencorvus/test/mcp` passed: 74 pass, 0 fail.
- `bun test packages/opencorvus/test/mcp/oauth-browser.test.ts packages/opencorvus/test/mcp/headers.test.ts packages/opencorvus/test/mcp/serve.test.ts` passed: 16 pass, 0 fail.
- `bun test packages/opencorvus/test/server/mcp-routes.test.ts packages/opencorvus/test/mcp/serve.test.ts` passed: 23 pass, 0 fail.
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts` passed after serializing resolver cases: 75 pass, 0 fail.
- `bun test packages/opencorvus/test/server/expert-squad-routes.test.ts` passed: 8 pass, 0 fail.
- `bun test packages/opencorvus/test/expert-squad/package-manager.test.ts` passed: 32 pass, 0 fail.
- `bun test packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/historical-docs-links.test.ts` passed: 67 pass, 0 fail.
- `bun test packages/overlay/test/expert-squad-scope.test.ts packages/overlay/test/executor-settings.test.ts packages/overlay/test/expert-squad-lifecycle-service.test.ts packages/overlay/test/expert-squad-settings-surface.test.ts` passed: 39 pass, 0 fail.
- `cd packages/overlay; node test/browser-runner.mjs test/browser/expert-squad-panel.test.ts` passed: 2 pass, 0 fail, with screenshots reviewed.
- `bun run --cwd packages/opencorvus typecheck` passed.
- `bun run --cwd packages/overlay typecheck` passed.
- `bun run --cwd packages/sdk/js typecheck` passed.
- `bun run api:routes-check` passed after SDK generation: 6 route-inventory rules clean across 29 files.
- `git diff --check` passed.

Second review:

- The third-iteration repairs use the existing registry, manager, resolver, service, and test-runner surfaces. No fallback, compatibility alias, gate, hidden active state, or UI-only filter was added.
- GUI screenshots were inspected after the browser fixture repair and showed the expected active/inherited expert-squad states without overlap or stale visible catalog state.
- Fourth independent-agent iteration is still required before closing the active goal, because the user requires a fresh independent scan every iteration until no new issue location remains.

### Iteration 5

Status: Repaired and validated; sixth independent-agent scan launched.

Recall update:

- The current goal remains unchanged: keep using independent agents to find high-confidence new issue locations and repair accepted root causes until no new location is found.
- Before this repair pass, the Recall block in this file was re-read, `AGENTS.md` constraints remained active, and `git status --short` confirmed an untracked July planning draft must not be edited or staged.
- Repository searches covered `Ripgrep.files`, `Process.spawn`, `runIsolatedBunTest`, `active_agent_projection`, `activateProjectExpertSquad`, `refreshCatalog`, `ExpertSquadCatalogSchema`, MCP projection refs, and overlay expert-squad browser fixtures.

Accepted findings:

- TEST-07: `Ripgrep.files()` did not terminate the `rg` child when async iteration stopped early. `ls` and `glob` can break after a limit, so the child could continue scanning after the caller had returned.
- TEST-08: `runIsolatedBunTest()` used an inactivity timer but only sent one termination signal and then awaited process exit without a bounded SIGKILL escalation path.
- TEST-09: `runIsolatedBunTest()` parsed the first `N pass` / any `0 fail` text from stdout/stderr, so a test file could spoof the summary by printing fake pass/fail lines.
- CORE-09: catalog `active_agent_projection` exposed only package skill/tool/server refs, while worker capability already resolves default and package MCP tool/prompt/resource refs. This truncated DTO made runtime projection and catalog projection disagree.
- GUI-06: `ExpertSquadPanel` project/session expert-squad actions captured one directory for the write but recomputed current scope for the post-write refresh. A slow write followed by a scope switch could refresh or show notice against the wrong current scope.
- GUI-07: the session-clear browser fixture set `active_skill_projection.projected_agent_ids` but did not provide matching `virtual_agents`, allowing a screenshot with `1 agents` in the header and an empty active-agent projection section.

Repairs:

- `packages/opencorvus/src/file/ripgrep.ts` now wraps `Ripgrep.files()` streaming in `try/finally` and terminates unfinished children with SIGTERM followed by SIGKILL escalation.
- `packages/opencorvus/test/harness/isolated-bun-runner.ts` now escalates timed-out isolated Bun processes from SIGTERM to SIGKILL, rejects if the process still does not exit, and parses the nearest Bun summary block before the final `Ran ...` line.
- New focused fixtures cover `rg` early-stop cleanup, SIGTERM-ignoring isolated tests, and spoofed `99 pass` output.
- `packages/opencorvus/src/expert-squad/catalog.ts` and `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts` now include default/package MCP tool, prompt, and resource refs in active-agent projection using the existing `effectivePackageMcpRefs()` path.
- `packages/overlay/src/services/expert-squad.ts` now passes the existing config ownership guard through project expert-squad activation.
- `packages/overlay/src/components/settings/ExpertSquadPanel.tsx` now binds action refreshes to captured catalog scope identity rather than the refresh-token-bearing request key, so legitimate post-write refreshes in the same scope still occur while stale cross-scope responses are ignored.
- `packages/overlay/test/browser/expert-squad-panel.test.ts` now gives session-clear fixtures coherent targets and virtual agents, and asserts active-agent projection contents after clearing a session override.
- `packages/sdk/openapi.json` and generated SDK files were regenerated after the active-agent schema change.

Validation:

- `bun test packages/opencorvus/test/harness/isolated-bun-runner.test.ts` passed: 3 pass, 0 fail at the time of the iteration; the later test-architecture reorganization expanded the harness self-test suite to 6 pass.
- `bun test packages/opencorvus/test/file/ripgrep.test.ts` passed: 8 pass, 0 fail.
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --test-name-pattern "catalog active agent projection exposes|catalog active skill projection follows"` passed: 2 pass, 0 fail.
- `bun test packages/overlay/test/expert-squad-scope.test.ts` passed: 13 pass, 0 fail.
- `bun run --cwd packages/overlay typecheck` passed.
- `bun run --cwd packages/opencorvus typecheck` passed.
- `bun test packages/opencorvus/test/server/expert-squad-routes.test.ts` passed: 1 wrapper pass, 0 fail, 24 expect calls.
- `bun run --cwd packages/sdk/js build` regenerated OpenAPI and SDK artifacts.
- `bun run api:routes-check` passed: 6 route-inventory rules clean across 29 files.
- `bun run --cwd packages/sdk/js typecheck` passed.
- `cd packages/overlay; node test/browser-runner.mjs test/browser/expert-squad-panel.test.ts` passed: 2 pass, 0 fail.

GUI screenshot review:

- `packages/overlay/.scratch/expert-squad-settings-panel.png` showed the active frontend replica projection with the build virtual agent and `4 MCP refs`, without text overlap.
- `packages/overlay/.scratch/expert-squad-session-clear-before.png` showed backend as the session override with a matching backend virtual-agent projection.
- `packages/overlay/.scratch/expert-squad-session-clear-after.png` showed session override cleared to project inheritance, active frontend replica projection, one virtual agent, one target agent, and `2 MCP refs`; the prior empty active-agent projection issue was gone.

Second review:

- The repairs reuse existing projection, config ownership, process lifecycle, and browser-test surfaces. No fallback, compatibility alias, gate, hidden active state, or UI-only filtering was added.
- The initial request-key ownership patch was rejected by browser testing because `markExpertSquadCatalogStale()` legitimately changes the refresh token for the same scope. The final implementation compares catalog scope identity instead, which addresses the root ownership problem without suppressing valid refreshes.

### Iteration 6

Status: Independent-agent scan in progress.

Agents launched:

- Goodall: backend/API expert-squad projection audit.
- Raman: GUI/UX and browser-test audit.
- Lorentz: tooling/process lifecycle audit.
- Euclid: docs/spec/API-governance audit.

Scope:

- All four agents are read-only, forbidden from editing files or spawning sub-agents, and asked to report only high-confidence new issue locations with file/line evidence. The docs agent was explicitly told that an untracked July planning draft must not be edited or staged.

### Iteration 7

Status: Repaired and validated; eighth independent-agent scan launched.

Accepted findings:

- CORE-10: active-agent catalog projection was manually derived from manifest refs and omitted default skill/tool/MCP refs that worker capability actually receives.
- CORE-11: project catalog and selector projection used different load paths after full package validation changes, so inactive invalid packages could be accepted by one surface and rejected by another.
- GUI-08: the expert-squad browser fixture could report projection counts from old profile-shaped fields that were not present in the catalog squads.

Repairs:

- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts` now derives active-agent projection from worker capability with `resolveWorkerCapabilityForActive()`.
- `packages/opencorvus/src/expert-squad/catalog.ts`, `packages/overlay/src/services/expert-squad.ts`, and `packages/overlay/src/components/settings/ExpertSquadPanel.tsx` now expose/count default and package skill/tool/MCP refs consistently.
- Project catalog and selector paths now full-load project packages with config-backed load options, keeping active and inactive package validation on the same authority.
- `packages/overlay/test/browser/expert-squad-fixture.ts` and `packages/overlay/test/browser/expert-squad-panel.test.ts` now derive active projections from the same squad fixture data the UI renders.

Validation:

- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --test-name-pattern "catalog active agent projection exposes|general catalog and selector projection reject"` passed.
- `bun test packages/opencorvus/test/server/expert-squad-routes.test.ts` passed.
- `bun test packages/overlay/test/expert-squad-scope.test.ts` passed.
- `cd packages/overlay; node test/browser-runner.mjs test/browser/expert-squad-panel.test.ts` passed and screenshots were reviewed, including `packages/overlay/.scratch/expert-squad-settings-activated-backend.png`.

### Iteration 8

Status: Repaired and validated; ninth independent-agent scan launched.

Accepted findings:

- CORE-12: `releasePayloadPackages()` used a lock-external existing-package snapshot inside the per-ID install lock, so a concurrent import could create duplicate manifest IDs across namespaces.
- CORE-13: public project expert-squad catalog DTOs leaked raw package prompt overlay text after catalog validation moved to full package loads.
- GUI-09: `BrowserPreviewPanel` could display passed persisted evidence while the capture image request failed, hiding the broken visual evidence path.
- GUI-10: several browser tests still passed legacy `defaultProfile` / `profiles` fields into `expertSquadCatalogFixture()`, silently creating impossible active catalog states.
- LIFE-01: `jsonLines()` and JSON-RPC transport used raw `proc.kill("SIGTERM")`, bypassing `Process.spawn` SIGKILL escalation for children that ignore SIGTERM.
- LIFE-02: Windows process-supervisor helper startup failure could leave the helper request temp directory behind when no `pid.txt` was written.
- LIFE-03: `audit-calculator.ts` killed only the shell on inactivity and sent preview cleanup kills without awaiting child close.
- SDK-02: SDK build wrote `src/defaults.ts` and root `openapi.json` before generation, formatting, and typecheck completed, allowing split-version generated artifacts on later failure.

Repairs:

- `packages/opencorvus/src/expert-squad/manager.ts` now recomputes payload existing-package inventory inside the per-ID install lock and skips a same-ID package that appears concurrently.
- `packages/opencorvus/src/expert-squad/catalog-profile.ts` now keeps catalog prompt metadata public but no longer copies raw prompt overlay text into `profile.agents`.
- `packages/overlay/src/components/BrowserPreviewPanel.tsx` now represents capture image load failure as a scoped failed image result, marks the evidence card/status failed, and renders the error text.
- `packages/overlay/test/browser/expert-squad-fixture.ts` now rejects unsupported fixture fields; browser fixtures were migrated to `squads` / `defaultSquad`.
- `packages/opencorvus/src/util/process.ts` exposes `Child.terminate()` as the single SIGTERM/SIGKILL escalation path; `external-process.ts` and JSON-RPC transport use it.
- `packages/opencorvus/src/shell/process-supervisor.ts` disposes the helper and removes the request directory when Windows helper startup fails before PID publication.
- `packages/opencorvus/script/benchmark/audit-calculator.ts` now launches shell children detached on POSIX and uses an awaited `terminateChildProcessTree()` helper for command inactivity and preview cleanup.
- `packages/sdk/js/script/build.ts` now stages OpenAPI, defaults, and `src/gen` under `.tmp-sdk-build`, runs Prettier and `tsc --project` against the staged package, and only writes real generated outputs after validation succeeds.

Validation:

- `bun test packages/opencorvus/test/expert-squad/package-manager.test.ts --test-name-pattern "payload release rechecks|payload release skips an existing package"` passed.
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --test-name-pattern "loads project package profiles into the catalog"` passed.
- `cd packages/overlay; node test/browser-runner.mjs test/browser/browser-preview-evidence.test.ts` passed after screenshot capture.
- Screenshot reviewed: `packages/overlay/.scratch/browser-preview-tablet-capture-image-error.png` shows the tablet evidence card marked failed with the capture-image 404 text visible and no notification overlap.
- `bun test packages/opencorvus/test/util/process.test.ts packages/opencorvus/test/executor/external-process-leak.test.ts packages/opencorvus/test/executor/json-rpc.test.ts` passed.
- `bun test packages/opencorvus/test/shell.test.ts --test-name-pattern "windows helper"` passed.
- `bun test packages/opencorvus/test/benchmark/audit-calculator.test.ts` passed.
- `bun test packages/opencorvus/test/script/sdk-build-format-contract.test.ts --test-name-pattern "SDK build resolves|SDK build uses the registered root OpenAPI|SDK build validates staged|SDK build writes generated files|typecheck workflow"` passed.
- `bun run --cwd packages/sdk/js build` passed; `.tmp-sdk-build` and `packages/sdk/js/openapi.json` were absent after completion.

Second review:

- The first audit-calculator repair briefly introduced direct `child.kill()` fallback inside POSIX process-group failure handling. The contract test caught it; the final script now treats POSIX process-group signal failure as a visible error.
- Browser Preview visual QA found fixture runtime/orderKey notifications contaminating the first screenshot; fixtures were corrected and the screenshot was re-captured cleanly.

### Iteration 9

Status: Repaired and validated; tenth independent-agent scan required before closure.

Agents launched:

- Peirce: backend/expert-squad package, payload, registry, catalog, resolver audit.
- Turing: GUI/browser/visual QA and browser fixture audit.
- Kuhn: lifecycle/tooling/process/inactivity audit.
- Singer: SDK/OpenAPI/generated-artifacts/docs contract audit.

Scope:

- All four agents are read-only, forbidden from editing files or spawning sub-agents, and asked to report only high-confidence new issue locations that are not repeats of the repaired Iteration 7 and Iteration 8 findings.

Agent feedback:

- Peirce found no new high-confidence backend or expert-squad package/projection issue beyond the repaired earlier iterations.
- Turing reported two GUI/browser issues: a schema-valid failed browser-preview verification without persisted evidence crashed the panel, and expert-squad catalog-load failure hid scope/status/recovery controls behind the successful-catalog body.
- Kuhn reported two lifecycle/tooling issues: overlay browser sidecar launch failure could leave the sidecar process running, and the isolated Bun runner could return while inherited-stream descendants survived after the root process exited.
- Singer reported two OpenAPI/SDK contract issues: workflow CLI OpenAPI output could diverge from direct generation because bus-event union order followed registry insertion/import order, and the tracked SDK OpenAPI artifact used a separate raw JSON generation path rather than the canonical route-check serializer.

Accepted findings:

- GUI-11: `BrowserPreviewPanel` treated a failed verification response without an evidence ID as impossible and threw before it could render the failed state.
- GUI-12: `ExpertSquadPanel` put directory/scope/active status and import recovery actions inside the successful catalog branch, so a catalog 500 left the user with only a generic empty/error path and a duplicate global runtime toast.
- LIFE-04: `OverlayBrowserSidecar.start()` did not terminate the sidecar if browser launch RPC failed after sidecar startup.
- LIFE-05: `runIsolatedBunTest()` could skip process-tree cleanup when the root Bun process had already exited but inherited stdio kept descendants alive.
- SDK-03: OpenAPI `BusEvent` schema order depended on event registry insertion order, so CLI and direct generation could produce different canonical text from the same schema set.
- SDK-04: `packages/sdk/openapi.json` was generated through a raw `JSON.stringify()` path rather than the canonical OpenAPI serializer used by route checking.

Repairs:

- `packages/overlay/src/components/BrowserPreviewPanel.tsx` now renders legal failed verification results without persisted evidence IDs, keeps passed-without-ID as an error, and only loads capture resources for real persisted evidence IDs.
- `packages/overlay/src/components/settings/ExpertSquadPanel.tsx`, `packages/overlay/src/main.tsx`, and overlay i18n/styles now keep directory/scope/project/session/effective/selected status and import actions visible when catalog loading fails, while handling the composer-selector background failure locally instead of raising a duplicate global toast.
- `packages/overlay/test/launch.ts` now terminates the sidecar when browser launch RPC fails and reports both launch and cleanup failures with an aggregate error if cleanup also fails.
- `packages/opencorvus/test/harness/isolated-bun-runner.ts` now requires process-tree settle when streams fail after root exit, so inherited-stream descendants still receive the established termination path.
- `packages/opencorvus/src/bus/bus-event.ts` now sorts registered event payload schemas before building the discriminated union.
- `packages/opencorvus/src/cli/cmd/generate.ts`, `packages/opencorvus/script/generate-openapi.ts`, and `packages/opencorvus/script/check/routes.ts` now share a canonical OpenAPI serializer with stable object keys and a trailing newline.
- `packages/sdk/openapi.json`, `packages/sdk/js/src/gen/sdk.gen.ts`, and `packages/sdk/js/src/gen/types.gen.ts` were regenerated through the SDK build after canonicalization.

Validation:

- `bun run --cwd packages/overlay typecheck` passed.
- `bun run --cwd packages/opencorvus typecheck` passed.
- `bun run --cwd packages/sdk/js typecheck` passed.
- `node test/browser-runner.mjs test/browser/browser-preview-evidence.test.ts test/browser/expert-squad-panel.test.ts` passed: 5 pass, 0 fail. Screenshots reviewed: `packages/overlay/.scratch/browser-preview-failed-verification-no-evidence-id.png` and `packages/overlay/.scratch/expert-squad-catalog-error-recovery.png`.
- `bun test packages/opencorvus/test/harness/isolated-bun-runner.test.ts packages/overlay/test/browser-error-collector.test.ts packages/opencorvus/test/script/routes-check-openapi.test.ts` passed: 32 pass, 0 fail.
- `bun test packages/opencorvus/test/script/sdk-build-format-contract.test.ts` passed: 12 pass, 0 fail.
- `bun run api:routes-check` passed.
- `bun test packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/historical-docs-links.test.ts` passed: 69 pass, 0 fail.
- Focused regression checks passed for payload release concurrency, prompt-profile resolver catalog/projection isolation, process termination paths, and benchmark audit cleanup.
- `git diff --check` passed.
- `rg -n -- "--warning" packages/overlay/src/styles packages/overlay/src` found only the historical design-language comment and no new retired warning-token use.

Second review:

- The browser-preview repair does not synthesize an evidence ID and still rejects passed responses without persisted evidence, preserving the evidence contract.
- The expert-squad recovery UI uses the existing settings/catalog surfaces and keeps `prompt_profile.active` as the only active selection source; it adds no second active state, catalog fallback, UI-only filter, or compatibility alias.
- The sidecar and isolated-runner repairs reuse the existing lifecycle termination boundaries rather than adding a parallel process killer.
- The OpenAPI canonicalization keeps one serializer for CLI, generator script, route check, and tracked SDK artifact; CLI/direct/tracked text now match with a final newline.
- The untracked July planning draft remains excluded from this iteration's planned staging.

### Iteration 10

Status: Repaired and validated; eleventh independent-agent scan required before closure.

Agents launched:

- Leibniz: backend/expert-squad package, payload, registry, catalog, resolver audit.
- Hume: GUI/browser/visual QA and browser fixture audit.
- Copernicus: lifecycle/tooling/process/inactivity audit.
- Hubble: SDK/OpenAPI/generated-artifacts/docs contract audit.

Scope:

- All four agents are read-only, forbidden from editing files or spawning sub-agents, and asked to report only high-confidence new issue locations that are not repeats of the repaired Iterations 7, 8, and 9 findings.

Agent feedback:

- Leibniz reported one backend write-path issue: `/global/config` can persist an unknown or project-package-only `prompt_profile.active` without the resolver validation used by project/session write paths.
- Hume reported one GUI/fixture issue: Expert Squad settings still renders prompt guidance from `squad.agents`, while the real catalog intentionally returns `agents: {}` after raw prompt overlay redaction; browser fixtures fabricate that impossible DTO.
- Copernicus reported four lifecycle/tooling issues: overlay benchmark main waits ignore `--idle-timeout-ms`, overlay browser runner has no inactivity monitor, VS Code extension sidecar startup timeout kills only the direct child without waiting for owned cleanup, and JSON-RPC stdout EOF can mark the transport closed without terminating a still-running child.
- Hubble reported one docs-contract issue: the July README links two untracked spec records, and the docs link test checks `fs.existsSync` rather than trackedness, so a partial commit can publish broken committed links.

Accepted findings:

- CORE-14: `/global/config` is a second writer into `prompt_profile.active` but validates only shape through `Config.Info`; global active selection must reject unknown IDs and project-package-only IDs before persistence.
- GUI-13: Expert Squad settings has a public DTO/UI split: catalog summaries intentionally redact raw prompt overlays to `agents: {}`, but the UI and browser fixture still derive visible guidance and counts from that redacted field.
- LIFE-06: `overlay-web-benchmark.ts` parses `--idle-timeout-ms` but `waitForFinal()` and `waitForArchitectBoard()` do not use it to fail after a true absence of progress/activity.
- LIFE-07: `packages/overlay/test/browser-runner.mjs` delegates to `node --test` with inherited stdio and no runner-owned output inactivity monitor or cleanup path.
- LIFE-08: VS Code extension sidecar startup timeout calls only `child.kill()` before rejecting; before handshake there is no `stop()` path, no exit wait, and no escalation ownership.
- LIFE-09: JSON-RPC stdout EOF marks the transport closed and fails pending calls, but later `close()` returns early without terminating a live child process.
- DOC-03: monthly record README links can point at worktree-only spec files; the existing historical link test treats untracked files as valid because it resolves with `fs.existsSync`.

Repair plan:

- Validate global `prompt_profile.active` through `PromptProfileResolver.assertKnownProfileID` before `Config.updateGlobal()`, with no project directory so only runtime built-ins such as `general` are valid globally.
- Remove public prompt-guidance rendering and fixture fabrication from Expert Squad settings, relying on README, selector, virtual-agent summaries, and capability projection as the visible catalog contract.
- Add true progress-activity checks to the overlay benchmark waits using the parsed idle timeout; progress signature/status changes reset the timer, heartbeat logging does not.
- Add a Node browser-runner inactivity monitor keyed to child stdout/stderr output and terminate the child on quiet hangs.
- Add pre-handshake sidecar cleanup that waits for exit and escalates after startup inactivity failure.
- Make JSON-RPC reader EOF call the same termination path used by request inactivity and explicit close.
- Extend docs health to reject monthly README links to untracked monthly record files, and ensure the two linked July records are tracked before commit.

Validation-discovered finding:

- PAYLOAD-01: `payload.ts` imported executable package `.ts` sources with `with { type: "text" }` using the same module specifier later used by ordinary dynamic imports. In a shared Bun test process, loading `payloadPackageSources` could poison the module cache so `opentest-protocol-engine.ts` imported as code no longer exposed `parseProtocolContract`.

Repairs:

- `packages/opencorvus/src/server/routes/global.ts` now validates global `prompt_profile.active` through `PromptProfileResolver.assertKnownProfileID()` before persistence. Because global config has no project directory, non-general project-package IDs are rejected globally.
- `packages/overlay/src/components/settings/ExpertSquadPanel.tsx`, `packages/overlay/test/browser/expert-squad-fixture.ts`, and related browser tests now remove public rendering and fixture fabrication of redacted `squad.agents` prompt overlay text. The UI presents README, selector guidance, virtual agents, active-agent projection, and capability projection as the catalog surface.
- `packages/opencorvus/script/benchmark/overlay-web-benchmark.ts` now checks parsed idle timeout in both final-status and architect-board waits using benchmark activity, not heartbeat logging.
- `packages/overlay/test/browser-runner.mjs` now owns child stdout/stderr pipes, resets an inactivity timer on output, and terminates the child tree on quiet hangs.
- `packages/vscode-extension/src/sidecar/manager.ts` now terminates and waits for pre-handshake sidecar startup processes, escalating through the owned process tree before rejecting handshake inactivity.
- `packages/opencorvus/src/executor/protocol/json-rpc.ts` now terminates a live child when stdout closes before process exit.
- `packages/opencorvus/src/file/watcher.ts` now attaches and removes a native watcher error listener so temp-project watcher errors are logged instead of becoming unhandled process errors during disposal.
- Superseded by Iteration 13 validation: the earlier query-suffixed payload text import approach was proven incompatible with the real overlay-server `Bun.build({ compile })` packaging path. The current accepted payload import contract uses Bun's native `with { type: "text" }` imports without a query module or custom build plugin.
- `packages/opencorvus/test/script/document-health.test.ts` now rejects monthly README links that target untracked monthly record files; the two linked July records were added to the index and remain outside the untracked July planning draft.

Validation:

- `bun test packages/opencorvus/test/server/global-config-routes.test.ts packages/opencorvus/test/executor/json-rpc.test.ts packages/opencorvus/test/benchmark/bench-script-cleanup.test.ts packages/opencorvus/test/file/watcher-bootstrap.test.ts packages/overlay/test/browser-test-runner.test.ts packages/vscode-extension/test/sidecar-manager.test.ts` passed: 41 pass, 0 fail.
- `cd packages/overlay; node test/browser-runner.mjs test/browser/expert-squad-panel.test.ts test/browser/launch-sidecar.test.ts` passed: 4 pass, 0 fail.
- Screenshots reviewed: `packages/overlay/.scratch/expert-squad-settings-panel.png`, `packages/overlay/.scratch/expert-squad-settings-capability-projection.png`, and `packages/overlay/.scratch/expert-squad-catalog-error-recovery.png`. The UI showed active projection and capability projection without raw `Agent Guidance` prompt text, overlap, or blank recovery state.
- `bun test packages/opencorvus/test/expert-squad/registry.test.ts packages/opencorvus/test/expert-squad/package-manager.test.ts packages/opencorvus/test/expert-squad/payload-generation.test.ts packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts packages/opencorvus/test/expert-squad/prompt-profile-resolver-mcp-execution.test.ts packages/opencorvus/test/server/expert-squad-routes.test.ts` passed: 175 pass, 4 skip, 0 fail.
- `bun test packages/opencorvus/test/expert-squad/package-manager.test.ts packages/opencorvus/test/expert-squad/registry.test.ts --test-name-pattern "opentest OpenTest protocol engine parses|payload package sources match current repository expert-squad packages|opentest payload exposes one external|payload source loading does not shadow"` passed: 4 pass, 0 fail.
- `bun test packages/opencorvus/test/expert-squad/payload-generation.test.ts` passed: 2 pass, 0 fail.
- `bun run --cwd packages/opencorvus typecheck`, `bun run --cwd packages/overlay typecheck`, `bun run --cwd packages/sdk/js typecheck`, and `bun run --cwd packages/vscode-extension typecheck` passed.
- `bun run --cwd packages/sdk/js build` passed.
- `bun test packages/opencorvus/test/script/sdk-build-format-contract.test.ts packages/opencorvus/test/script/routes-check-openapi.test.ts` passed: 20 pass, 0 fail.
- `bun run api:routes-check` passed.
- `bun test packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/historical-docs-links.test.ts` passed: 70 pass, 0 fail.
- `git diff --check` passed.

Second review:

- The global config repair does not add a fallback profile or second active expert-squad source; it rejects invalid data before persistence using the existing resolver authority.
- The Expert Squad UI now matches the backend redaction contract. Public catalog DTOs still redact raw prompt overlays; browser fixtures now model that production shape instead of fabricating impossible guidance fields.
- The inactivity and process-lifecycle repairs use owned process boundaries and explicit termination paths; they do not add wall-clock-from-start timeouts, hidden gates, or parallel process supervisors.
- The payload text import repair fixes the generator rather than hand-editing the generated module. The new query is a module identity separator for Bun and TypeScript, not an alternate package source.
- The docs tracked-link check uses `git ls-files` as the committed-doc authority. The untracked July planning draft remains excluded from this delivery.

### Iteration 11

Status: Independent-agent scan in progress.

Agents launched:

- Bernoulli: backend/expert-squad package identity, payload release, registry/catalog/resolver/global config audit.
- Epicurus: overlay GUI/browser behavior, ExpertSquadPanel, BrowserPreviewPanel, browser-runner fixtures/tests audit.
- Dewey: process lifecycle, inactivity timeout, JSON-RPC, sidecars, isolated runners, watcher cleanup, benchmark scripts audit.
- Sagan: SDK/OpenAPI/generated artifacts/docs/spec health and trackedness audit.

Scope:

- All four agents are read-only, forbidden from editing files, spawning sub-agents, staging, committing, pushing, creating worktrees, or touching user-owned OpenCorvus/overlay processes. They were asked to report only high-confidence new issue locations that are not repeats of the repaired Iterations 7, 8, 9, 10, or PAYLOAD-01.

Agent feedback:

- Bernoulli reported one backend atomicity issue: `select_expert_squad` writes the root session overlay and decision-log success evidence before `dispatchTaskLoop()` can return `ignored`, leaving persisted active-squad state after a failed continuation wake.
- Epicurus reported two Browser Preview issues: the panel keys loaded targets and target-load errors only by `taskID`, not the task directory, and non-native hosts can show a native-command error instead of the evidence-missing/capture state when a ready target has no persisted evidence.
- Dewey reported six lifecycle/tooling issues: overlay benchmark signal shutdown can bypass normal cleanup, overlay benchmark orphan cleanup is POSIX-only and swallowed, VS Code sidecar post-handshake stop kills only the direct child and resolves immediately, Browser Node executor inactivity cleanup can wait forever after failed termination, mission benchmark failure cleanup does not cancel active prompt/process ownership, and Parcel watcher subscribe timeout can leak a late native subscription.
- Sagan reported one delivery-integrity issue: staged monthly records referred to an untracked draft path, so committed records could depend on a worktree-only source.

Accepted findings:

- CORE-15: `select_expert_squad` must be atomic with respect to accepted continuation wake scheduling. If the wake is rejected, the tool must not leave `prompt_profile.active` or success decision-log evidence behind.
- GUI-14: `BrowserPreviewPanel` must scope target loads and load errors by both task ID and directory, because the same task ID string can exist under a different project namespace.
- GUI-15: Browser Preview native live-surface activation must require native surface capability. A host without native browser-preview commands should show the evidence-missing/capture state, not a native-command error.
- LIFE-10: VS Code sidecar post-handshake shutdown must use the owned process-tree termination path and wait for exit after shutdown grace expires.
- LIFE-11: Browser Node executor inactivity timeout must have a bounded post-timeout cleanup path; child-tree termination failure cannot leave the caller awaiting process exit forever.
- LIFE-12: Parcel watcher subscribe timeout must clean up a subscription that resolves after the timeout.
- DOC-04: Permanent monthly records must not cite the untracked July planning draft as required source evidence while that file remains outside git.

Tracked but not repaired in this slice:

- Dewey's overlay benchmark signal/orphan and mission benchmark active-prompt cleanup findings require broader benchmark-runner ownership analysis than the Browser Preview/sidecar repairs below. They remain recorded for the next iteration instead of being hidden as accepted variance.

Repair plan:

- Move `select_expert_squad` decision-log success append after accepted dispatch and restore the previous root overlay if `dispatchTaskLoop()` returns `ignored`; regression-test the ignored path against both overlay and decision log.
- Add a scoped target type in `BrowserPreviewPanel` so resolved targets and load errors carry `{ taskID, directory }`; suppress native-surface scopes when `browserPreviewNativeSurfaceAvailable()` is false; add browser/static tests.
- Reuse the VS Code sidecar startup termination helpers for post-handshake `stop()` timeout and wait for process exit before resolving.
- Bound Browser Node executor timeout cleanup with an explicit cleanup timeout and reject the run if process-tree termination does not complete.
- Attach a late-resolution cleanup handler to Parcel watcher subscription promises that time out.
- Remove untracked-draft path citations from the staged monthly records and keep the untracked July planning draft excluded from staging.

Repairs:

- `packages/opencorvus/src/orchestrator/tools.ts` now computes the selected scheduler capability from the preview config, writes the root overlay, dispatches the continuation wake, and appends success decision-log evidence only after the wake is accepted. If dispatch returns `ignored`, it restores the previous `prompt_profile.active` before throwing.
- `packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts` now explicitly installs the `frontend-replica` project package in selection tests and covers the ignored-dispatch rollback path.
- `packages/overlay/src/components/BrowserPreviewPanel.tsx` now carries the task directory on loaded targets and load errors, clears stale errors on task-scope changes, and suppresses native live-surface scopes when native browser-preview commands are unavailable.
- `packages/overlay/test/browser-preview-panel.test.ts` pins the task+directory scoping and native-capability contract. Existing Browser Preview browser tests were rerun against the real page and screenshots.
- `packages/vscode-extension/src/sidecar/manager.ts` now reuses the owned process-tree cleanup path for post-handshake `stop()` after shutdown grace expires, waits for exit, and throws if cleanup does not settle. `packages/vscode-extension/test/fixtures/fake-sidecar.mjs` can now simulate an unresponsive `/shutdown`.
- `packages/opencorvus/src/browser/runtime/node-executor.ts` now bounds child-process cleanup after inactivity timeout or abort and rejects the caller when termination does not settle.
- `packages/opencorvus/src/file/watcher.ts` now unsubscribes a Parcel watcher subscription that resolves after `SUBSCRIBE_TIMEOUT_MS`; `packages/opencorvus/test/file/watcher-bootstrap.test.ts` pins the cleanup contract.
- Staged monthly records and this bug-hunt record now refer to the untracked July planning draft only as non-delivery background notes, not as a committed path dependency.

Validation:

- `bun test packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts --test-name-pattern "select_expert_squad"` passed: 3 pass, 0 fail.
- `bun test packages/opencorvus/test/browser/node-executor.test.ts packages/opencorvus/test/file/watcher-bootstrap.test.ts packages/vscode-extension/test/sidecar-manager.test.ts` passed: 15 pass, 0 fail.
- `bun test packages/overlay/test/browser-preview-panel.test.ts` passed: 2 pass, 0 fail.
- `bun run --cwd packages/opencorvus typecheck`, `bun run --cwd packages/overlay typecheck`, and `bun run --cwd packages/vscode-extension typecheck` passed.
- `cd packages/overlay; node test/browser-runner.mjs test/browser/browser-preview-evidence.test.ts` passed: 2 pass, 0 fail.
- Screenshots reviewed: `packages/overlay/.scratch/browser-preview-persisted-evidence-no-live.png`, `packages/overlay/.scratch/browser-preview-failed-verification-no-evidence-id.png`, and `packages/overlay/.scratch/browser-preview-tablet-capture-image-error.png`. The panel rendered evidence/capture states without a native live surface or native unsupported error.
- `bun test packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/historical-docs-links.test.ts` passed: 70 pass, 0 fail.
- `git diff --check` passed.
- A scan for the untracked July planning draft path across delivery records returned no matches.

Second review:

- The expert-squad selection repair keeps `prompt_profile.active` as the only active source and does not add a dispatch gate, fallback profile, or second selection state.
- Browser Preview scope is keyed by backend task evidence and directory. The UI does not infer preview targets or switch to iframe/live routes when native preview is unavailable.
- Sidecar and Browser Node cleanup use owned process boundaries with bounded exit waits; cleanup failure is surfaced instead of swallowed.
- Parcel watcher late cleanup keeps one subscription authority and does not add a parallel watcher source.
- The untracked July planning draft remains outside staging; committed records no longer depend on its path.

### Iteration 12

Status: Independent-agent scan in progress.

Agents launched:

- Archimedes: backend/expert-squad package identity, resolver/catalog/manager/payload, active profile writes, projection single-source audit.
- McClintock: GUI/browser behavior, BrowserPreviewPanel/ExpertSquadPanel, visual evidence, focus/keyboard, UI double-source audit.
- Galileo: process lifecycle, inactivity timeouts, benchmark scripts, child tree ownership, watcher cleanup audit.
- Laplace: docs/spec health, generated artifacts, OpenAPI/SDK contracts, staging integrity audit.

Scope:

- All four agents are read-only, forbidden from editing files, spawning sub-agents, staging, committing, pushing, creating worktrees, or touching user-owned OpenCorvus/overlay processes. They were asked to report only high-confidence new issue locations that are not repeats of the repaired Iterations 7-11 or PAYLOAD-01.

Agent feedback:

- Archimedes found no new high-confidence backend/expert-squad package/projection issue.
- McClintock reported one GUI/native-preview issue: Back/Forward/Reload can be clicked while a new native preview sync is still pending, but the native navigation command carries only `{ action }` and targets the singleton native webview. During task/target switches, navigation can therefore apply to the previous synchronized page.
- Galileo reported three lifecycle/tooling issues: Windows `Shell.run` can silently downgrade to root-process-only cleanup when the process supervisor helper is missing; the acceptance inactivity runner can orphan children on Windows by sending root SIGTERM before `taskkill /T`; mission benchmark and shared benchmark env cleanup swallow disposal/server/temp cleanup failures before exit.
- Laplace reported two docs/staging integrity issues: four tracked July records still cite the untracked July planning draft by path, and the staged index still contains stale snapshots of the two newly added July records that reintroduce the same path citation.

Accepted findings:

- GUI-16: Browser Preview native navigation must be bound to the latest successful native sync key. Navigation buttons cannot be enabled, and `navigateNativePreview()` cannot send native commands, until the current scope and bounds have been synchronized.
- LIFE-13: Windows `Shell.run` foreground commands must not silently downgrade to root-only cleanup when helper process-tree ownership is unavailable.
- LIFE-14: Windows acceptance inactivity cleanup must terminate the process tree before the root can exit and make descendants unreachable, and cleanup errors must be surfaced.
- LIFE-15: Benchmark cleanup failures must be visible and must affect process exit rather than being swallowed before `process.exit(finalExitCode)`.
- DOC-05: Tracked historical/spec records must not cite an untracked local draft path; docs health must reject such citations for tracked records, not merely check `fs.existsSync` in a dirty worktree.
- DOC-06: The final index must not retain stale staged snapshots of modified spec records. Re-staging changed records is required before commit.

Repair plan:

- Track the current native preview sync key separately from the requested scope/bounds key; enable and execute navigation only when the current scope key matches the last successful sync key.
- Update Browser Preview panel tests to pin the synchronized-navigation precondition.
- Remove root-only Windows process-supervisor downgrade for `Shell.run` foreground cleanup and update tests that previously locked in fallback behavior.
- Rework Windows acceptance inactivity cleanup to use awaited task-tree termination directly on inactivity, with cleanup errors reported instead of dropped.
- Replace swallowed benchmark cleanup catches with an explicit cleanup-error collector that sets a failing exit code and reports the failures.
- Replace untracked-draft path references in the four tracked July records with natural-language background notes, and add a docs-health regression that scans tracked spec records for the untracked draft path.
- Re-stage the two newly added July records after worktree fixes so the index matches the committed source text.

Repairs:

- `packages/overlay/src/components/BrowserPreviewPanel.tsx` now computes a current native preview sync key from scope and bounds, exposes `nativePreviewNavigationReady`, disables Back/Forward/Reload until the key matches the last successful sync, and rechecks that readiness before sending native navigation.
- `packages/overlay/test/browser-preview-panel.test.ts` now pins the synchronized-navigation contract.
- `packages/opencorvus/src/shell/process-supervisor.ts` no longer has the helper-missing `spawnWindowsManagedShell` root-only path, and `packages/opencorvus/src/shell/shell.ts` requires process-tree cleanup for foreground `Shell.run()`.
- `packages/opencorvus/test/shell.test.ts` now rejects helper-missing foreground shell commands and asserts the root-only downgrade function stays absent.
- `packages/opencorvus/src/acceptance/checks/inactivity-timeout-process.ts` now uses Windows task-tree termination directly on inactivity and reports timeout cleanup errors in stderr.
- `packages/opencorvus/test/acceptance/inactivity-timeout-process.test.ts` now pins the Windows cleanup order and cleanup-error reporting contract.
- `packages/opencorvus/script/benchmark/mission-benchmark.ts` and `packages/opencorvus/script/benchmark/env.ts` now surface cleanup failures instead of swallowing them; cleanup failure forces a non-zero mission benchmark exit.
- `packages/opencorvus/script/benchmark/overlay-web-benchmark.ts` now lets signal handlers call the same `runBenchmarkCleanup()` used by normal finalization, removes the unhandled-rejection shutdown path, uses `ProcessSupervisor.disposeLiveProcessesUnder(temp.dir)` for orphan cleanup, and marks cleanup failures as benchmark failures.
- `packages/opencorvus/test/benchmark/mission-benchmark.test.ts` and `packages/opencorvus/test/benchmark/bench-script-cleanup.test.ts` now pin benchmark cleanup failure visibility and supervised orphan disposal.
- Four tracked July records no longer cite the untracked July planning draft by path. `packages/opencorvus/test/script/document-health.test.ts` now scans tracked spec records for that untracked draft path/name.

Validation:

- `bun test packages/overlay/test/browser-preview-panel.test.ts` passed: 2 pass, 0 fail.
- `bun run --cwd packages/overlay typecheck`, `bun run --cwd packages/opencorvus typecheck`, and `bun run --cwd packages/vscode-extension typecheck` passed.
- `bun test packages/opencorvus/test/shell.test.ts packages/opencorvus/test/acceptance/inactivity-timeout-process.test.ts packages/opencorvus/test/benchmark/mission-benchmark.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/historical-docs-links.test.ts` passed after the pathspec text adjustment: 111 pass, 0 fail.
- `bun test packages/opencorvus/test/benchmark/bench-script-cleanup.test.ts packages/opencorvus/test/benchmark/mission-benchmark.test.ts` passed: 46 pass, 0 fail.
- `cd packages/overlay; node test/browser-runner.mjs test/browser/browser-preview-evidence.test.ts` passed: 2 pass, 0 fail.
- Screenshots reviewed again: `packages/overlay/.scratch/browser-preview-persisted-evidence-no-live.png` and `packages/overlay/.scratch/browser-preview-failed-verification-no-evidence-id.png`; evidence/capture UI remained visually correct and non-overlapping.
- `git diff --check` passed.

Second review:

- GUI-16 uses the already existing native scope and bounds as the synchronization authority; it does not introduce a second native webview state or an iframe/live route.
- LIFE-13 removes the helper-missing root-only cleanup path rather than adding another fallback. Windows foreground shell cleanup now requires the same process-tree owner as background launch.
- LIFE-14 terminates the Windows process tree before root-only signals can orphan inherited-stdio children.
- LIFE-15 makes cleanup failures visible and non-zero; benchmark cleanup no longer hides failures behind best-effort catches or POSIX-only `pkill`.
- DOC-05 is enforced against tracked spec records, so a dirty worktree-only draft cannot satisfy committed docs.

### Iteration 13

Status: Independent-agent scan in progress.

Agents launched:

- Heisenberg: backend/expert-squad package identity, resolver/catalog/manager/payload, active profile writes, projection single-source, orchestrator tool atomicity audit.
- Faraday: GUI/browser behavior, BrowserPreviewPanel/ExpertSquadPanel, visual evidence, focus/keyboard, native preview state, UI double-source audit.
- Planck: process lifecycle, inactivity timeouts, benchmark scripts, child tree ownership, watcher cleanup, swallowed cleanup errors audit.
- Noether: docs/spec health, generated artifacts, OpenAPI/SDK contracts, stale references, staging integrity audit.

Scope:

- Start another read-only independent-agent scan after closing Iteration 12 agents. The next scan must look only for high-confidence new issue locations that are not repeats of repaired Iterations 7-12, PAYLOAD-01, or the formerly tracked overlay benchmark signal/orphan cleanup issue.

Agent feedback:

- Heisenberg reported three profile-write atomicity issues: `select_expert_squad` restores only on `dispatchTaskLoop()` returning `ignored`, not when dispatch throws; task follow-up `promptProfile` writes happen before attachment persistence and `continueTaskMessage`; Mission wake writes `prompt_profile.active` before `SessionWake.wake()`.
- Faraday reported three Browser Preview scope issues: native preview sync sends only URL and bounds to the singleton native webview, so same-URL different-scope previews can preserve old native state; successful persisted evidence image loads are not directory-scoped; candidate selection late responses refresh or show errors without checking the captured directory.
- Planck reported three lifecycle issues: `ProcessSupervisor.disposeLiveProcessesUnder()` misses descendants after the root shell exits because live handles unregister on root exit; `Shell.run()` timeout/abort cleanup errors are fired-and-forgotten and can leave the caller waiting forever; Browser MCP node launcher termination waits are unbounded.
- Noether reported two delivery/generated-artifact issues: OpenTest manifest/payload references new virtual-agent directories that are still untracked unless explicitly staged; `packages/opencorvus/src/expert-squad/payload.ts` is generated by the build but absent from the central generated-artifact registry.

Accepted findings:

- CORE-16: `select_expert_squad` must restore the previous active profile on both ignored and thrown continuation dispatch failures.
- CORE-17: task follow-up and Mission wake `promptProfile` writes must be atomic with durable message/wake creation; failed persistence or wake scheduling must not leave active profile changed without evidence.
- GUI-17: native browser-preview sync must carry scope identity to the host/native layer so same-URL different-scope previews cannot reuse stale singleton webview state.
- GUI-18: successful capture-image object URLs must be scoped by task ID, directory, evidence ID, and viewport.
- GUI-19: candidate selection late success/error handling must validate the captured task+directory scope before refetching or rendering an error.
- LIFE-16: supervised shell handles must remain available for directory cleanup until explicit disposal, so descendants can be cleaned even after the shell root exits.
- LIFE-17: `Shell.run()` timeout/abort cleanup failures must be observed and must bound the result instead of waiting forever on `supervisor.exited`.
- LIFE-18: Browser MCP node launcher termination waits must have bounded post-signal cleanup on Windows and POSIX.
- DOC-07: generated expert-squad payload must be listed in the central generated-artifact registry.
- DOC-08: OpenTest virtual-agent directories referenced by manifest and generated payload must be staged with the delivery.

Repair plan:

- Extend profile-write rollback handling around thrown dispatch/wake/persistence paths and add focused regression tests for thrown dispatch plus task/Mission write failures where practical.
- Add native preview `scopeKey` to overlay service/protocol/Tauri sync command and force native webview navigation/reload when the scope key changes even if the URL is identical.
- Add directory guards to `currentCaptureImage()` and candidate selection success/error paths; extend Browser Preview panel contract tests.
- Keep `ProcessSupervisor` handles registered until explicit `dispose()`, and make `Shell.run()` timeout/abort race cleanup failures against process exit with visible stderr.
- Bound Browser MCP node-launcher cleanup waits and test the static contract.
- Add payload to `script/generated-artifacts.ts` and update generated-artifact tests.
- Stage OpenTest virtual-agent directories and re-stage modified records before commit.

Toolchain blocker discovered during validation:

- The first Tauri `cargo check` attempt failed before Rust compilation because `packages/opencorvus/dist/opencorvus-overlay-server-windows-x64/.opencorvus-overlay-payload.stamp` was missing. This was a valid build precondition failure from `packages/overlay/src-tauri/build.rs`, not an acceptable skipped check.
- Running the canonical `bun run build --overlay-server --single` command then exposed the earlier payload query-import bug: generated `payload.ts` imports such as `*.md?opencorvus-payload-text` were accepted by direct Bun runtime import probes but rejected by the real compiled overlay-server `Bun.build()` path.
- After removing the query-import/plugin path, the real overlay-server build exposed a second Windows packaging issue: recursive `fs.promises.cp` failed while copying `chromium-bidi` from Bun's package store even though the source file existed. The repair replaces that recursive copy dependency with explicit traversal and `copyFile`.

Repairs:

- `packages/opencorvus/src/orchestrator/tools.ts` now restores the previous `prompt_profile.active` when `select_expert_squad` continuation dispatch either returns `ignored` or throws.
- `packages/opencorvus/src/task-api/index.ts` and `packages/opencorvus/src/server/routes/mission.ts` now roll back temporary `promptProfile` activation when durable task follow-up or Mission wake creation fails.
- `packages/transport-protocol/src/index.ts`, `packages/overlay/src/services/browser-preview-native.ts`, `packages/overlay/src/services/tauri-transport.ts`, `packages/overlay/src/components/BrowserPreviewPanel.tsx`, and `packages/overlay/src-tauri/src/main.rs` now carry native Browser Preview `scopeKey` through the host boundary and reset the singleton native webview when the scope changes.
- `BrowserPreviewPanel` now scopes capture image reuse and candidate-selection late success/error handling by both task ID and directory.
- `ProcessSupervisor` keeps live shell handles registered until explicit disposal, and `Shell.run()` observes and bounds timeout/abort cleanup failures instead of firing termination and waiting indefinitely.
- `packages/opencorvus/src/mcp/browser/node-launcher.ts` now bounds post-signal child cleanup on Windows and POSIX.
- `script/generated-artifacts.ts` now lists `packages/opencorvus/src/expert-squad/payload.ts`.
- `packages/opencorvus/script/generate-expert-squad-payload.ts` now emits native text imports without `?opencorvus-payload-text`, the obsolete custom payload text plugin and query declaration were removed, and `packages/opencorvus/src/expert-squad/payload.ts` was regenerated from the repository package sources.
- `packages/opencorvus/script/build-runtime-node-modules.ts` now copies runtime package trees via explicit directory traversal and `copyFile`, preserving the existing exclusion of nested `node_modules` without relying on Bun's recursive `fs.cp`.

Validation:

- `bun test packages/transport-protocol/test/contract.test.ts packages/overlay/test/browser-preview-panel.test.ts packages/opencorvus/test/shell.test.ts packages/opencorvus/test/mcp/browser-node-launcher.test.ts packages/opencorvus/test/script/sdk-build-format-contract.test.ts packages/opencorvus/test/script/document-health.test.ts` passed: 116 pass, 0 fail.
- `bun test packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts --test-name-pattern "select_expert_squad"` passed: 4 pass, 0 fail, 5 filtered.
- `bun test packages/opencorvus/test/engine/task-message-revive.test.ts` passed: 17 pass, 0 fail.
- `bun test packages/opencorvus/test/mission/wake-route.test.ts` passed: 21 pass, 0 fail.
- `bun test packages/opencorvus/test/expert-squad/payload-generation.test.ts packages/opencorvus/test/script/build-artifact.test.ts` passed after the packaging repair: 42 pass, 0 fail.
- `bun run build --overlay-server --single` passed and produced `packages/opencorvus/dist/opencorvus-overlay-server-windows-x64/.opencorvus-overlay-payload.stamp` with 12073 payload files and SHA-256 `58a9eaf2b993d332fcb501b6babd7194f99e354995cec386a6cab995c81b023e`.
- `cargo check --manifest-path packages/overlay/src-tauri/Cargo.toml` passed after the overlay-server artifact was regenerated.
- `cd packages/overlay; node test/browser-runner.mjs test/browser/browser-preview-evidence.test.ts` passed: 2 pass, 0 fail.
- Browser screenshots reviewed: `packages/overlay/.scratch/browser-preview-persisted-evidence-no-live.png`, `packages/overlay/.scratch/browser-preview-failed-verification-no-evidence-id.png`, `packages/overlay/.scratch/browser-preview-tablet-capture-image-error.png`, `packages/overlay/.scratch/browser-preview-evidence-previewable-image.png`, and `packages/overlay/.scratch/browser-preview-candidate-trigger-focus-visible.png`.
- `bun run --cwd packages/opencorvus typecheck`, `bun run --cwd packages/overlay typecheck`, and `bun run --cwd packages/transport-protocol typecheck` passed.

Second review:

- The `prompt_profile.active` repairs keep one active expert-squad source and do not add a fallback profile, second active field, or host-side gate.
- Native Browser Preview scope now travels through the same transport command that mutates the native webview, so same-URL different-project previews cannot reuse stale singleton state.
- Capture-image and candidate-selection guards use task ID plus directory, matching the backend evidence namespace instead of UI-only task labels.
- Process cleanup failures are surfaced and bounded through the owning process APIs.
- The payload packaging repair removes the query/plugin dual path and proves the checked-in generated payload can be resolved by `Bun.build`.
- The runtime package copy repair keeps one package tree source and replaces a flaky recursive copy primitive with explicit copy semantics; it does not introduce a second package manifest or fallback source.

### Iteration 14

Status: Repairs implemented; validation complete; next independent-agent scan pending.

Recall update:

- User asked why the packaging issue did not exist before. Current evidence shows it came from Iteration 13's generated expert-squad payload registry change: direct Bun import probes accepted `*.md?opencorvus-payload-text`, but the real compiled overlay-server `Bun.build({ compile: true })` path rejected the generated query imports. The follow-on Windows `fs.promises.cp` failure was a latent packaging fragility exposed only after the payload import failure was fixed.
- Before continuing after compaction, the active goal was re-read, `AGENTS.md`, the expert-squad checklist, `specs/README.md`, `specs/current/architecture/04-extensions.md`, `specs/records/2026-07/README.md`, and this Recall record were re-read.
- Repository searches covered `ProcessSupervisor`, `BrowserPreviewPanel`, `IntentBundle.write`, `persistQueuedTask`, `writeOverlayPayloadStamp`, `fs.promises.cp`, generated payload imports, and Iteration 13 packaging notes.
- Hard constraints remained active: no fallback or dual-source behavior, no process interference with user-owned OpenCorvus or overlay windows, Node-based Playwright for browser tests, real overlay-server build validation for packaging, and visible screenshot review for Browser Preview changes.

Agent feedback:

- Ptolemy reported that `POST /task` wrote `prompt_profile.active` into the root session before durable task materialization, so an intent-bundle or queue persistence failure could leave an active expert squad without a task row.
- Feynman reported that `BrowserPreviewPanel` accepted a stale persisted evidence object after `latestEvidenceIDs` changed because it checked task, target, and viewport but not `evidence.id === latestEvidenceScope().evidenceID`.
- Huygens reported three lifecycle/build issues: direct `ProcessSupervisor` callers still bypassed bounded cleanup, snapshot and rewind benchmarks swallowed `Instance.disposeAll()` cleanup failures, and `build.local.ts` lacked the overlay payload stamp required by Tauri.
- Mencius found no additional high-confidence payload/OpenAPI/docs issue after the Iteration 13 repairs.

Accepted findings:

- CORE-18: `POST /task` must not write root-session model/profile/permission overlays until after the task row has been durably queued.
- GUI-20: Browser Preview persisted evidence rendering must be scoped to the target's current `latestEvidenceIDs[viewport]` value, not only task/target/viewport labels.
- LIFE-19: direct `ProcessSupervisor` foreground cleanup callers must use bounded terminate/dispose helpers and preserve cleanup failures.
- LIFE-20: snapshot and rewind benchmark cleanup failures must affect the final benchmark result instead of being swallowed.
- BUILD-02: every supported overlay-server compile entrypoint must use the same payload stamp writer as the canonical build.
- TEST-01: Bash truncation tests must create a real task row before exercising runtime-scoped output persistence.
- TEST-02: `task-create-route` temporary directories must be deleted only after instance/database/watcher cleanup on Windows.

Repairs:

- `packages/opencorvus/src/task-api/index.ts` now validates requested prompt profiles before writes, but defers root-session config overlay and permission writes until after `persistQueuedTask()` succeeds.
- `packages/opencorvus/test/server/task-create-route.test.ts` adds an intent-bundle failure regression proving no task row and no prompt-profile overlay are written, plus a suite-local tempdir wrapper that disposes the instance/database before deleting Windows temp project directories.
- `packages/overlay/src/components/BrowserPreviewPanel.tsx` now rejects persisted evidence whose ID no longer matches the current target viewport's latest evidence ID.
- `packages/overlay/test/browser/browser-preview-evidence.test.ts` adds a refreshed mobile evidence case proving the old image and status disappear while the new evidence request is pending, then renders `browser-preview-refreshed-evidence-id.png`.
- `packages/opencorvus/src/shell/process-supervisor.ts` now exposes bounded `terminateAndWaitForExit()` and `disposeAndWaitForExit()` helpers. `shell.ts`, `tool/bash.ts`, `session/shell-exec.ts`, and `orchestrator/tools.ts` use those helpers instead of fire-and-forget termination/disposal.
- `packages/opencorvus/test/runtime/promise-boundaries.test.ts` pins the direct supervisor call-site contract.
- `packages/opencorvus/script/benchmark/snapshot-benchmark.ts` and `packages/opencorvus/script/benchmark/rewind-checkpoint-benchmark.ts` surface `Instance.disposeAll()` cleanup failures as non-zero benchmark results.
- `packages/opencorvus/test/benchmark/bench-script-cleanup.test.ts` pins snapshot/rewind cleanup failure visibility.
- `packages/opencorvus/script/build-overlay-payload-stamp.ts` owns the overlay payload stamp writer. `build.ts` and `build.local.ts` both import it, and `packages/opencorvus/test/script/build-artifact.test.ts` asserts no local duplicate writer exists.
- `packages/opencorvus/test/tool/bash.test.ts` now seeds real task rows for truncated Bash output tests, matching `Truncate.output()` runtime-scoped persistence.

Validation:

- `bun test packages/opencorvus/test/shell.test.ts packages/opencorvus/test/runtime/promise-boundaries.test.ts` passed: 22 pass, 0 fail.
- `bun test packages/opencorvus/test/tool/bash.test.ts` passed after the runtime-task fixture repair: 32 pass, 0 fail.
- `bun test packages/opencorvus/test/server/task-create-route.test.ts` passed after the tempdir cleanup-order repair: 11 pass, 0 fail.
- `bun test packages/opencorvus/test/script/build-artifact.test.ts packages/opencorvus/test/benchmark/bench-script-cleanup.test.ts` passed: 68 pass, 0 fail.
- `bun test packages/opencorvus/test/expert-squad/payload-generation.test.ts` passed: 3 pass, 0 fail.
- `bun test packages/opencorvus/test/script/sdk-build-format-contract.test.ts packages/opencorvus/test/script/routes-check-openapi.test.ts` passed: 20 pass, 0 fail.
- `bun test packages/overlay/test/browser-preview-panel.test.ts` passed: 2 pass, 0 fail.
- `cd packages/overlay; node test/browser-runner.mjs test/browser/browser-preview-evidence.test.ts` passed: 2 pass, 0 fail.
- Screenshots reviewed: `packages/overlay/.scratch/browser-preview-refreshed-evidence-id.png`, `packages/overlay/.scratch/browser-preview-persisted-evidence-no-live.png`, and `packages/overlay/.scratch/browser-preview-evidence-previewable-image.png`; refreshed evidence replaced the stale mobile evidence and the panel remained non-overlapping.
- `bun run --cwd packages/opencorvus typecheck`, `bun run --cwd packages/overlay typecheck`, and `bun run --cwd packages/transport-protocol typecheck` passed.
- `bun ./script/generated-artifacts.ts --print` passed and still lists `packages/opencorvus/src/expert-squad/payload.ts`.
- `bun run build --overlay-server --single` passed and produced `packages/opencorvus/dist/opencorvus-overlay-server-windows-x64/.opencorvus-overlay-payload.stamp` with 12073 payload files and SHA-256 `839f76fe7b2a74982855ef865a7de204317491e5274eaaf83a784f1fcd9a3517`.
- `cargo check --manifest-path packages/overlay/src-tauri/Cargo.toml` passed after the overlay-server build.
- The build refreshed `packages/opencorvus/src/provider/models-snapshot.ts`; the diff was unrelated live provider snapshot churn and was precisely restored from HEAD after inspection.

Second review:

- CORE-18 keeps `prompt_profile.active` as the only active source and moves writes later; it does not introduce a rollback fallback or second session-shadow active field.
- GUI-20 compares the rendered evidence ID against the same `latestEvidenceScope()` that drives the resource fetch, so it removes a stale UI source instead of adding another cache.
- LIFE-19 centralizes cleanup waits inside `ProcessSupervisor` and preserves primary errors while surfacing cleanup failures.
- LIFE-20 makes benchmark cleanup evidence visible and failing, matching the no-hidden-cleanup rule.
- BUILD-02 makes the stamp writer a shared build script module; `build.ts` and `build.local.ts` no longer contain duplicate local stamp logic.
- TEST-01 and TEST-02 are test harness repairs required to verify the real runtime contracts on Windows, not production fallbacks.

### Iteration 15

Status: Independent-agent findings accepted; repairs validated locally, next no-new-issue scan pending.

Recall update:

- Iteration 15 was launched after Iteration 14 validation completed. Four read-only agents audited backend expert-squad atomicity, Browser Preview and Expert Squad GUI state, lifecycle/tooling cleanup, and packaging/generated-artifact delivery integrity.
- All agents were instructed not to edit files, stage/commit/push, create worktrees, interfere with running OpenCorvus or overlay processes, or spawn subagents.
- Repository searches and file reads covered `releasePayloadPackages`, direct-child package roots, `BrowserPreviewPanel` verification/evidence state, `ExpertSquadPanel` scope/busy state, `audit-calculator`, `browser-runner.mjs`, Browser MCP sessions, LSP custom spawn, generated artifacts, untracked OpenTest virtual agents, and isolated test harness files.

Agent feedback:

- Bernoulli found that `releasePayloadPackages()` silently skips old direct-child expert-squad roots and still installs namespaced payload packages, leaving an invalid direct-child root plus a new namespaced root for the same manifest identity.
- Leibniz found four GUI state issues: repeated capture can show stale verification evidence while a new same-target capture is pending; missing persisted evidence artifacts fall into a generic empty state; Expert Squad settings labels pending task/session scope as Project and empty; Expert Squad action busy state is not scoped across scope changes.
- James found lifecycle issues in Browser MCP expired-session cleanup, `audit-calculator` inactivity cleanup, `audit-calculator` final cleanup, overlay browser runner inactivity cleanup, and custom configured LSP process ownership.
- Galileo found delivery integrity issues: the new overlay payload stamp helper is untracked, OpenTest virtual-agent files imported by generated payload are untracked, staged isolated-test records/wrappers depend on untracked harness files, and `models-snapshot.ts` is a tracked generated build output missing from the generated-artifacts registry.

Accepted findings:

- CORE-19: payload release must reject old direct-child package roots before mutating namespaced payload directories.
- GUI-21: repeated capture must scope verification results by request token so old evidence disappears while the new same-target capture is pending.
- GUI-22: missing latest persisted evidence must render an explicit evidence-load error, not a generic capture-empty state.
- GUI-23: Expert Squad pending task/session scope must render a pending state, not Project scope or no-squads empty state.
- GUI-24: Expert Squad busy/action state must be scoped to the catalog scope identity so stale actions from another scope cannot disable the current scope.
- LIFE-21: Browser MCP expired-session cleanup must not log success after failed `destroySession`, and failed cleanup must remain visible.
- LIFE-22: `audit-calculator` child command inactivity cleanup must resolve with a bounded nonzero result if process-tree termination fails or does not exit.
- LIFE-23: `audit-calculator` browser/preview cleanup failures must be recorded and must make the audit exit nonzero.
- LIFE-24: overlay browser runner inactivity cleanup must wait for child exit and force a bounded nonzero exit if cleanup does not settle.
- LIFE-25: custom configured LSP servers must use the same owned process-tree cleanup contract as built-in LSP servers.
- DOC-09: generated-artifact registry must include `packages/opencorvus/src/provider/models-snapshot.ts`.
- DOC-10: all files imported by generated payloads, shared build helpers, and staged isolated-test wrappers must be tracked or staged before delivery.

Repair plan:

- Replace the direct-child skip in `releaseExistingPackageMap()` with the same hard error as registry discovery, and update package-manager tests to assert no namespaced target is created.
- Scope `currentVerificationRequest()` to the latest verification token, render latest-evidence load errors explicitly, and add browser screenshot tests for repeated capture and missing evidence.
- Add pending-scope UI state and scope-keyed busy handling in `ExpertSquadPanel`, with browser/static tests.
- Make Browser MCP cleanup log failures only as failures.
- Rework `audit-calculator` process cleanup and final cleanup into visible cleanup errors that affect report totals and exit code; add focused source/behavior tests.
- Rework overlay browser runner inactivity cleanup to wait for child exit and exit bounded nonzero on cleanup failure; add runner tests.
- Route custom LSP config spawns through the owned stdio process helper or equivalent cleanup path; add lifecycle tests.
- Add `models-snapshot.ts` to `script/generated-artifacts.ts`.
- Stage the new payload stamp helper, OpenTest virtual-agent files, isolated test harness files, and related new tests while still excluding the untracked July planning draft.

### Iteration 16

Status: Independent-agent findings accepted; repairs implemented; final full verification pending.

Recall update:

- Iteration 16 was launched after Iteration 15 validation and real overlay-server packaging passed. Four read-only agents audited packaging/generated-artifact producers, Browser Preview and Expert Squad GUI state, expert-squad catalog/projection isolation, and process lifecycle cleanup.
- All agents were instructed not to edit files, stage/commit/push, create worktrees, interfere with running OpenCorvus or overlay processes, or spawn subagents.
- Repository searches and file reads covered `BrowserPreviewPanel` persisted evidence loading, `prompt-profile-resolver` catalog/selector package loading, root `script/generate.ts`, `script/generated-artifacts.ts`, LSP `spawnStdio`, MCP local stdio transport close handling, and `ProcessSupervisor` cleanup helpers.

Agent feedback:

- Jason found that Browser Preview suppresses native preview while persisted evidence is loading, but falls through to the generic capture prompt instead of showing a persisted-evidence loading state.
- Arendt found that expert-squad catalog and selector projection still full-load every project package, so inactive package skills/tools/MCP parse failures can break general catalog and selector surfaces.
- Nietzsche found that LSP `spawnStdio()` still performs root-only Windows cleanup and local MCP stdio transport close can leak subprocess trees.
- Ampere found that `packages/opencorvus/src/expert-squad/payload.ts` and `packages/opencorvus/src/provider/models-snapshot.ts` are registered generated artifacts, but root `script/generate.ts` does not call their producers.

Accepted findings:

- GUI-25: Browser Preview must render a specific persisted-evidence loading state while latest evidence is loading; it must not show the capture-empty prompt for known pending evidence.
- CORE-20: catalog and selector projection must use catalog/discovery package metadata for inactive packages and reserve full package loading for the active runtime package.
- LIFE-26: LSP stdio and local MCP stdio cleanup must terminate owned process trees, including Windows descendants, instead of root-only process shutdown.
- DOC-11: the central generation script must invoke every checked-in generated-artifact producer registered in `script/generated-artifacts.ts`.

Repair plan:

- Add `currentLatestEvidenceLoading()` and render it in Browser Preview status/body before the capture-empty branch; extend browser evidence tests and screenshot review.
- Replace inactive catalog loading with `ExpertSquadRegistry.loadCatalogPackage()` and selector loading with `discoverProjectPackages()` plus `readSelectorInstructions()`.
- Export a shared `ProcessSupervisor.terminateProcessTree()` helper and call it from LSP stdio disposal and MCP transport close before SDK/root-only close paths.
- Add a shared OpenCorvus generated build-artifact producer used by `build.ts`, `build.local.ts`, and root `script/generate.ts`; update static tests to pin the producer call.

### Iteration 17

Status: Independent-agent findings accepted; repairs implemented; final full verification pending.

Recall update:

- Iteration 17 was launched after Iteration 16 repairs passed payload/model snapshot tests, `bun ./script/generate.ts`, real `bun run build --overlay-server --single`, opencorvus/overlay typecheck, Rust `cargo check`, browser evidence screenshots, and `git diff --check`.
- Four read-only agents audited packaging/generated-artifact checks, Browser Preview and overlay browser runner UX/lifecycle, expert-squad discovery/release isolation, and process lifecycle cleanup.
- All agents were instructed not to edit files, stage/commit/push, create worktrees, interfere with running OpenCorvus or overlay processes, or spawn subagents.
- Repository searches and file reads covered `BrowserPreviewPanel`, `browser-runner.mjs`, `script/generate.ts`, `.github/workflows/typecheck.yml`, `script/generated-artifacts.ts`, `ExpertSquadPackageManager.releasePayloadPackages()`, `ProcessSupervisor`, MCP stdio close handling, and executor JSON-RPC process cleanup.
- A combined targeted regression run exposed the MCP stdio close bug in practice: scoped MCP prompt/resource tests timed out at 5 seconds and then reported `MCP stdio process ... did not close after transport cleanup` after the process had already been signaled. The hung verification command was identified by command line and terminated as the owning test process only.

Agent feedback:

- Beauvoir found that Browser Preview manual recapture displays the old persisted evidence in the main stage while the status row says the new capture is loading.
- Beauvoir also found that the overlay browser runner exits on the root test process `exit` event, bypassing `close` and descendant cleanup when inherited stdio remains open.
- Ramanujan found that the PR generated-artifacts validation only diffs known generated paths, so it misses untracked generated files and generator writes outside the generated-artifact registry even though `script/generated-artifacts.ts --check-worktree` already implements that integrity check.
- Dalton found that `release-payload` full-loads every already-installed package to build its skip map, so an unrelated inactive package with a broken MCP definition blocks payload release before the target package loop.
- Gibbs found that MCP stdio close treats signal-exited child processes as still running because it checks `exitCode` but not `signalCode`.
- Gibbs also found that executor JSON-RPC transport cleanup still kills only the root process, leaving descendants alive after early break, inactivity timeout, or transport close.

Accepted findings:

- GUI-26: Browser Preview manual recapture must hide old persisted evidence and render a capture-loading stage while the new verification request is pending.
- LIFE-27: overlay browser runner success must be bounded by the child process `close` event and cleanup must still run if descendants keep stdio open after the root test process exits.
- DOC-12: CI generated-artifact validation must use the existing generated-artifacts worktree checker so untracked generated files and non-generated output drift cannot pass.
- CORE-21: payload release must build the existing-package map from discovery/catalog metadata only and must not parse inactive package skills/tools/MCP definitions.
- LIFE-28: MCP stdio close must treat either `exitCode` or `signalCode` as terminal and must not wait on an already-closed child process.
- LIFE-29: executor JSON-RPC process cleanup must use the shared process-tree cleanup contract instead of root-only `proc.kill()`.

Repair plan:

- Add a capture-loading stage that takes priority over `renderedEvidence()` while `currentVerificationLoading()` is true, and extend Browser Preview evidence tests with a persisted-evidence recapture delay plus screenshot review.
- Rework `browser-runner.mjs` to report root `exit` status only after `close`, keep inactivity cleanup active until close, and add runner tests for the exit-vs-close contract.
- Replace the PR workflow's generated-path-only diff with `bun ./script/generated-artifacts.ts --check-worktree`, and update CI contract tests accordingly.
- Replace `releaseExistingPackageMap()` full package loading with discovery/catalog metadata loading; add package-manager and route regressions proving broken inactive MCP definitions do not block release.
- Fix MCP stdio terminal-state detection to include `signalCode`, and keep process/stream waits from subscribing after terminal close state has already been reached.
- Route executor `Process.spawn()` cleanup through `ProcessSupervisor.terminateProcessTree()` and add focused tests that descendants are not intentionally left outside cleanup.

### Iteration 18

Status: Independent-agent findings accepted; repairs validated, final no-new-issue scan pending.

Recall update:

- Iteration 18 was launched after Iteration 17 repairs passed targeted MCP/executor/process tests, payload release package/route tests, resolver/config tests, root `bun ./script/generate.ts`, real `bun run build --overlay-server --single`, `cargo check`, opencorvus/overlay/transport typecheck, real Browser Preview evidence screenshots, `api:routes-check`, `docs:check`, root `bun typecheck`, and `git diff --check`.
- Four read-only agents audited packaging/generated-artifact delivery, Browser Preview and overlay runner GUI/lifecycle, expert-squad release isolation, and cleanup boundedness after the Iteration 17 fixes.
- All agents were instructed not to edit files, stage/commit/push, create worktrees, interfere with running OpenCorvus or overlay processes, or spawn subagents.
- Repository searches and file reads covered `script/generate.ts`, `script/generated-artifacts.ts`, OpenCorvus generated build helpers, `BrowserPreviewPanel`, `browser-runner.mjs`, `ExpertSquadPackageManager.releasePayloadPackages()`, `Process.spawn()`, JSON-RPC transport cleanup, `jsonLines()`, and `ProcessSupervisor`.

Agent feedback:

- Raman found that `generate-build-artifacts.ts` and `build-overlay-payload-stamp.ts` were still untracked even though tracked scripts/tests import them, so a commit that omitted them would break generate/build/package on a clean checkout.
- Huygens found that saved-evidence refresh loading left Capture enabled and the stage prioritized saved-evidence loading over capture loading, allowing conflicting pending states.
- Huygens also found that the overlay browser runner close/inactivity behavior still lacked process-level tests; only static source assertions covered the new cleanup semantics.
- Halley found that `releasePayloadPackages()` used raw `payloadPackageSources[].id` for the existing-package skip before validating the embedded manifest identity, leaving a dual-source identity gap on the no-overwrite path.
- Hooke found that `Process.run()` abort and JSON-RPC/jsonLines explicit cleanup could swallow `terminateProcessTree()` failures and then wait on `proc.exited` without a bounded visible failure.
- Hooke also flagged a POSIX process-tree race where `killIfRunning()` checked liveness before sending a signal; the stale-PID `ESRCH` path could make cleanup fail on a process that had already exited.

Accepted findings:

- DOC-13: generated build helper files imported by tracked scripts must be part of the delivered git change set.
- GUI-27: Browser Preview must treat latest-evidence loading as a capture-blocking state and must not allow simultaneous saved-evidence-loading and capture-loading actions.
- LIFE-30: overlay browser runner cleanup must have process-level regression coverage for inactivity cleanup; POSIX close-after-root-exit behavior is covered by a POSIX-only fixture because Windows does not reliably preserve inherited stdio ownership in that scenario.
- CORE-22: payload release must validate embedded payload manifest identity before deciding an existing package can be skipped.
- LIFE-31: process-tree cleanup failure must become a bounded visible error for `Process.run()`, JSON-RPC close, and `jsonLines()` early break instead of being swallowed while waiting for natural process exit.
- LIFE-32: POSIX process-tree signal cleanup must tolerate stale PIDs that disappear between discovery and signal delivery.

Repair summary:

- Added `OPENCORVUS_BUILD_ARTIFACT_PATHS` to root `script/generate.ts` canonical text exclusions so OpenCorvus-generated `payload.ts` and `models-snapshot.ts` are no longer reformatted by the root generator after their canonical producer writes them.
- Disabled Browser Preview Capture while `currentLatestEvidenceLoading()` is true and gave `currentVerificationLoading()` stage priority over saved-evidence loading; extended the real Browser Preview evidence test and screenshot review.
- Added overlay browser runner process-level tests for silent-root inactivity cleanup and POSIX inherited-stdio descendant cleanup after root exit.
- Changed `releasePayloadPackages()` to call `validatePayloadPackageSource()` before skip decisions and added a package-manager regression that forces embedded identity validation failure before skip.
- Made `Process.spawn()` reject `exited` on tree-cleanup failure, made `jsonLines()` and JSON-RPC cleanup wait through `ProcessSupervisor.awaitWithTimeout()`, and added focused cleanup-failure regressions.
- Reworked POSIX `killIfRunning()` to send directly and ignore `ESRCH`, with a boundary assertion preventing the liveness-check race from returning.

Validation:

- `bun test packages/opencorvus/test/runtime/promise-boundaries.test.ts packages/opencorvus/test/util/process.test.ts packages/opencorvus/test/executor/json-rpc.test.ts packages/opencorvus/test/executor/external-process-leak.test.ts --timeout 30000 --test-name-pattern "cleanup failure|abort surfaces|close surfaces|jsonLines surfaces|background finally"` passed.
- `bun test packages/overlay/test/browser-test-runner.test.ts packages/overlay/test/browser-preview-panel.test.ts --timeout 60000` passed.
- `node test/browser-runner.mjs test/browser/browser-preview-evidence.test.ts` passed and refreshed Browser Preview screenshots.
- `bun test packages/opencorvus/test/expert-squad/package-manager.test.ts --timeout 30000 --test-name-pattern "payload release"` passed.
- Screenshot review of `packages/overlay/.scratch/browser-preview-persisted-evidence-loading.png` confirmed Capture is disabled during saved-evidence loading and no stale evidence is visible.

Remaining follow-up:

- Before final commit, stage `packages/opencorvus/script/generate-build-artifacts.ts` and `packages/opencorvus/script/build-overlay-payload-stamp.ts` and verify `git ls-files --error-unmatch` succeeds for both. Keep the untracked July planning draft excluded from staging.
- Run a final independent-agent scan after full validation; if no new high-confidence issue locations are found, close the goal.

### Iteration 19

Status: Independent-agent findings accepted; repairs validated locally, staged-index trackedness verification and final no-new-issue scan pending.

Recall update:

- Iteration 19 was launched after Iteration 18 repairs passed targeted process cleanup tests, overlay browser runner tests, real Browser Preview evidence screenshots, package-manager payload tests, root generation, overlay-server packaging, typecheck, route/docs checks, and `git diff --check`.
- Four read-only agents audited packaging/generated-artifact delivery, Browser Preview GUI state, expert-squad payload/projection isolation, and process lifecycle cleanup. They were instructed not to edit files, stage/commit/push, create worktrees, interfere with running OpenCorvus or overlay processes, or spawn subagents.
- Repository searches and file reads covered generated build helper imports, OpenTest virtual-agent payload files, `BrowserPreviewPanel` verification/evidence state, `browser-preview-evidence.test.ts`, `Process.spawn()`, `jsonLines()`, JSON-RPC transport cleanup, and process-tree close boundaries.

Agent feedback:

- Descartes found that `generate-build-artifacts.ts`, `build-overlay-payload-stamp.ts`, and OpenTest virtual-agent files imported by the generated payload were still untracked, so a clean checkout could fail generate/build/package even when the current workspace passed.
- Carson found that saved-evidence refresh after a failed capture did not clear the completed `verificationRequest`, so the stale verification result could keep the main Browser Preview stage while a new persisted evidence load was pending.
- Nash found no new high-confidence expert-squad package isolation issue after the Iteration 18 payload validation changes.
- Parfit found that cleanup failure after the root process had exited but before `close` was still not fully covered for owned process utilities and JSON-lines readers.

Accepted findings:

- DOC-14: generated build helpers and every expert-squad payload source file must be verified as git-index delivery inputs before commit.
- GUI-28: Browser Preview saved-evidence refresh must clear stale verification state before refetching target/evidence.
- LIFE-33: process cleanup failure after root exit but before `close` must surface as a bounded visible failure.
- LIFE-34: JSON-lines cleanup failure must not be hidden by an unconditional stderr drain when the child process remains alive.

Repair summary:

- Added git-index trackedness tests for the shared generated build helper modules and for every file discovered by `discoverExpertSquadPayloadPackages()`.
- Changed Browser Preview refresh to clear `verificationRequest` before bumping the refresh token, and added a real browser regression that refreshes saved mobile evidence after a failed capture while the new evidence request is intentionally pending.
- Added POSIX root-exited-before-close cleanup regressions for `Process.run()` abort and JSON-lines early break.
- Replaced `jsonLines()` with an explicit `AsyncIterableIterator` so early `for await` break invokes an owned `return()` cleanup path, and made cleanup failure surface before stderr draining.
- Added static promise-boundary assertions preventing `jsonLines()` from regressing to an implicit async generator.

Validation:

- `node test/browser-runner.mjs test/browser/browser-preview-evidence.test.ts` passed and refreshed `packages/overlay/.scratch/browser-preview-post-capture-evidence-refresh.png`.
- Visual review of `packages/overlay/.scratch/browser-preview-post-capture-evidence-refresh.png` confirmed the refreshed evidence replaced the stale failed verification stage, Capture was re-enabled only after loading settled, and the panel had no incoherent overlap.
- `bun test packages/overlay/test/browser-test-runner.test.ts packages/overlay/test/browser-preview-panel.test.ts --timeout 60000` passed.
- `bun test packages/opencorvus/test/runtime/promise-boundaries.test.ts packages/opencorvus/test/util/process.test.ts packages/opencorvus/test/executor/json-rpc.test.ts packages/opencorvus/test/executor/external-process-leak.test.ts --timeout 30000 --test-name-pattern "cleanup failure|abort surfaces|close surfaces|jsonLines surfaces|background finally|kills the subprocess"` passed.
- `bun test packages/opencorvus/test/expert-squad/payload-generation.test.ts --timeout 60000 --test-name-pattern "checked-in payload module|payload TypeScript sources|payload text imports"` passed.
- `bun test packages/opencorvus/test/script/build-artifact.test.ts --timeout 60000 --test-name-pattern "supported compile build scripts|overlay-server build emits a single payload stamp"` passed.
- `bun run --cwd packages/opencorvus typecheck`, `bun run --cwd packages/overlay typecheck`, and `bun run --cwd packages/transport-protocol typecheck` passed.

Remaining follow-up:

- Stage the intended delivery set while excluding the untracked July planning draft, then run the new git-index trackedness tests.
- Run root generation, full targeted validation, final independent-agent scan, commit, and push to `myhexin`.

### Iteration 20

Status: Independent-agent findings accepted; repairs validated locally, staged-index trackedness verification and another no-new-issue scan pending.

Recall update:

- Iteration 20 was launched after Iteration 19 repairs passed process cleanup tests, overlay runner static/process tests, real Browser Preview evidence screenshots, payload generation/build helper tests, typecheck, root generation, payload release package/route tests, route/docs checks, and overlay-server build.
- Four read-only agents audited packaging/generated delivery, Browser Preview GUI state, expert-squad isolation, and lifecycle cleanup. They were instructed not to edit files, stage/commit/push, create worktrees, interfere with running OpenCorvus or overlay processes, or spawn subagents.
- Repository searches and file reads covered `BrowserPreviewPanel`, `main.tsx` refreshKey binding, browser evidence tests, native preview browser tests, `Process.spawn`, `jsonLines`, JSON-RPC transport cleanup, Browser MCP node launcher, and overlay `browser-runner.mjs`.

Agent feedback:

- Planck repeated DOC-14: generated build helper modules and OpenTest virtual-agent payload source files were still untracked before staging. This remains a staging/verification item, not a code-path gap after the trackedness tests were added.
- Banach found three Browser Preview state issues: board-driven `refreshKey` updates could leave same-target verification evidence active over newer latest evidence; the refresh button could clear verification during an in-flight capture/loading state; native preview errors rendered before capture loading.
- Herschel found no new high-confidence expert-squad isolation issue.
- Helmholtz found three lifecycle issues: `Process.spawn()` still advertised a `kill` option that abort swallowed when non-SIGTERM; Browser MCP stdio launcher logged stdin-close cleanup failure without settling nonzero; overlay browser runner recorded `childClosed` after the `finished` check, so close/inactivity races could report false cleanup failure.

Accepted findings:

- GUI-29: verification results must be scoped to the same `refreshKey` that produced the target, so board refreshes cannot leave old verification evidence over new latest evidence.
- GUI-30: Browser Preview refresh must be disabled while target transition, capture, or latest-evidence loading is pending.
- GUI-31: capture loading must take priority over stale native preview errors, and capture must clear native preview error state.
- LIFE-35: `Process.spawn()` must not expose unsupported `kill`/`timeout` cleanup options after cleanup ownership moved to `ProcessSupervisor`.
- LIFE-36: Browser MCP stdin-close cleanup failure must settle the launcher as a visible nonzero exit.
- LIFE-37: overlay browser runner must record `close` before checking `finished` so cleanup waits observe a durable close state.

Repair summary:

- Added `refreshKey` to `BrowserPreviewVerificationRequest` and rejected verification results whose request key no longer matches `props.refreshKey()`.
- Added a single `previewActionPending()` computed state and disabled refresh while target transition, verification loading, or latest-evidence loading is active.
- Made `captureEvidence()` clear `nativePreviewError`, prevented native preview scope while a verification request exists, and moved capture/latest-evidence loading before native error in the stage.
- Extended real Browser Preview evidence tests to assert refresh is disabled while same-target recapture is pending.
- Extended the native Browser Preview browser test to force a native navigation error, click Capture, screenshot the capture-loading state, and verify native error no longer owns the stage.
- Removed unsupported `kill` and `timeout` options from `Process.Options` and `Process.run()` forwarding, leaving process-tree cleanup ownership in `ProcessSupervisor`.
- Changed Browser MCP node launcher stdin-close cleanup failure to set `process.exitCode = 1` and exit nonzero.
- Moved overlay browser runner `childClosed = true` before the `finished` guard in the `close` handler and pinned it in runner tests.

Validation:

- `bun test packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/browser-test-runner.test.ts --timeout 60000` passed.
- `bun test packages/opencorvus/test/util/process.test.ts packages/opencorvus/test/runtime/promise-boundaries.test.ts packages/opencorvus/test/mcp/browser-node-launcher.test.ts --timeout 30000 --test-name-pattern "abort|terminate|background finally|signal and stdin|spawns node sidecar"` passed.
- `bun run --cwd packages/overlay typecheck` and `bun run --cwd packages/opencorvus typecheck` passed.
- `node test/browser-runner.mjs test/browser/browser-preview-evidence.test.ts` passed.
- `node test/browser-runner.mjs test/browser/browser-preview-live-input-batch.test.ts` passed.
- Visual review of `packages/overlay/.scratch/browser-preview-native-error-capture-loading.png` confirmed capture loading replaces the native error and the action controls remain non-overlapping.
- Visual review of `packages/overlay/.scratch/browser-preview-post-capture-evidence-refresh.png` confirmed refreshed saved evidence replaces stale verification evidence.
- Visual review of `packages/overlay/.scratch/browser-preview-persisted-recapture-loading.png` confirmed refresh and capture controls are disabled while recapture loading owns the stage.

Remaining follow-up:

- Rerun root generation, full targeted validation, and overlay-server build after Iteration 20 changes.
- Stage the intended delivery set while excluding the untracked July planning draft, then run git-index trackedness tests.
- Launch another independent-agent scan after staging/validation; only close the goal if no new high-confidence issue locations remain.

### Iteration 21

Status: Independent-agent findings accepted; narrow repairs validated, full validation and another no-new-issue scan pending.

Recall update:

- Iteration 21 was launched after Iteration 20 repairs passed targeted process cleanup tests, Browser Preview real browser tests and screenshot review, root generation, overlay-server build, Rust `cargo check`, route/docs checks, root `bun typecheck`, staged git-index trackedness tests, and `git diff --check`.
- Four read-only agents audited packaging/generated delivery, Browser Preview GUI evidence state, expert-squad projection isolation, and lifecycle cleanup. They were instructed not to edit files, stage/commit/push, create worktrees, interfere with running OpenCorvus or overlay processes, or spawn subagents.
- Repository searches and file reads covered staged helper modules and payload imports, `browser-preview-evidence.test.ts`, `Process.spawn()`, `ProcessSupervisor`, JSON-lines/JSON-RPC cleanup, overlay `launch.ts`, expert-squad manager/registry/resolver/catalog surfaces, and staged git-index delivery inputs.

Agent feedback:

- Linnaeus found no new high-confidence packaging or clean-checkout issue after staged helper modules, payload imports, and `git diff --cached --check` were verified.
- Darwin found that the persisted-evidence recapture browser test queried `.browser-preview-evidence-status` inside `.browser-preview-stage`, but the loading status is rendered in the command surface; the test could pass without observing the loading state it intended to guard.
- Pasteur found no new high-confidence expert-squad projection or catalog issue after the staged active/inactive isolation changes.
- Turing found that POSIX `Process.spawn()` cleanup still relied on root-PID descendant discovery, so a root process that exited after spawning an inherited-stdio descendant could leave the descendant reparented outside cleanup.
- Turing also found that overlay browser sidecar cleanup killed the Windows process tree only for `SIGKILL`; `SIGTERM` used root-only `child.kill()`, allowing descendants to remain after root exit.

Accepted findings:

- GUI-32: Browser Preview persisted-evidence recapture tests must observe the actual loading status surface and assert the loading copy, not only absence of stale evidence.
- LIFE-38: POSIX `Process.spawn()` and `Process.run()` must own a process group and terminate that group on abort or explicit terminate, so inherited-stdio descendants are cleaned even after the root exits.
- LIFE-39: JSON-lines/JSON-RPC cleanup regressions must follow the platform cleanup entry point and include a real root-exit descendant cleanup path.
- LIFE-40: overlay browser sidecar cleanup must own the full tree on Windows and must not fall back to root-only kill on unexpected POSIX process-group signal errors.

Repair summary:

- Updated the Browser Preview recapture test to query `.browser-preview-evidence-status` from the document surface and require `Loading saved evidence` while capture is disabled and stale evidence is absent.
- Added exported `ProcessSupervisor.terminateProcessGroup()` with POSIX process-group escalation and routed non-Windows `Process.spawn()` cleanup through it after launching owned processes detached.
- Added real POSIX regressions for `Process.run()` and JSON-lines root-exit inherited-stdio descendants, and changed cleanup-failure spies to target `terminateProcessTree()` on Windows and `terminateProcessGroup()` on POSIX.
- Changed overlay browser sidecar cleanup to use `taskkill /T /F` for every Windows signal path and to throw unexpected POSIX group-signal errors instead of silently degrading to root-only kill.

Validation so far:

- `bun test packages/opencorvus/test/util/process.test.ts packages/opencorvus/test/runtime/promise-boundaries.test.ts packages/opencorvus/test/executor/external-process-leak.test.ts packages/opencorvus/test/executor/json-rpc.test.ts --timeout 30000` passed.
- `node test/browser-runner.mjs test/browser/launch-sidecar.test.ts` passed.
- `node test/browser-runner.mjs test/browser/browser-preview-evidence.test.ts` passed.
- Visual review of `packages/overlay/.scratch/browser-preview-post-capture-evidence-refresh.png`, `packages/overlay/.scratch/browser-preview-persisted-recapture-loading.png`, and `packages/overlay/.scratch/browser-preview-persisted-evidence-no-live.png` confirmed loading/evidence states are coherent and controls do not overlap.

Remaining follow-up:

- Run root generation, overlay/unit typechecks, route/docs checks, overlay-server build, Rust `cargo check`, and staged git-index trackedness tests after Iteration 21 repairs.
- Restage the Iteration 21 repair files while continuing to exclude the untracked July planning draft.
- Launch another independent-agent scan after validation; only commit and push if no new high-confidence issue locations remain.

### Iteration 22

Status: Independent-agent findings accepted; repairs implemented; final full verification pending.

Recall update:

- Iteration 22 was launched after Iteration 21 narrow repairs passed process cleanup tests, Browser Preview browser tests and screenshot review, root generation, overlay/opencorvus typechecks, route/docs checks, overlay-server build, Rust `cargo check`, whitespace checks, and staged git-index trackedness tests.
- Four read-only agents audited packaging/generated delivery, Browser Preview GUI state, expert-squad isolation, and lifecycle cleanup. They were instructed not to edit files, stage/commit/push, create worktrees, interfere with running OpenCorvus or overlay processes, or spawn subagents.
- Repository searches and file reads covered untracked OpenTest visual-qa/runner files, generated payload imports, Browser Preview native screenshot tests, process supervisor/group cleanup, Browser MCP node launcher, overlay browser sidecar launcher, and overlay RPC inactivity handling.

Agent feedback:

- Godel found that OpenTest `visual-qa` and `opentest-runner` files are referenced by the manifest and generated payload but remain untracked, so clean checkout/package delivery would miss payload inputs.
- Harvey found that the native Browser Preview visual check samples the whole panel, so toolbar pixels make the test pass even when `[data-ui="browser-preview-native-surface"]` is blank white.
- Avicenna found no new high-confidence expert-squad isolation issue after Iteration 21.
- Plato found three lifecycle issues: POSIX sidecar cleanup waits only for root exit and can miss process-group descendants that ignore SIGTERM, `Process.spawn().terminate()` skips group cleanup after root close, and overlay RPC inactivity resets only on complete stdout lines instead of stdout byte activity.

Accepted findings:

- DOC-15: every OpenTest visual-qa/runner source referenced by manifest or generated payload must be tracked and staged with the record that introduced it.
- GUI-33: native Browser Preview visual proof must inspect the actual native surface/evidence, not the full panel chrome.
- LIFE-41: sidecar cleanup must wait for owned POSIX process groups, not root child exit only, before treating cleanup as complete.
- LIFE-42: `Process.spawn().terminate()` must retain owned group cleanup even after the root close event, covering ignored-stdio daemon descendants.
- LIFE-43: overlay browser RPC inactivity must reset on stdout byte activity, not only complete JSON-line messages.
- LIFE-44: the OpenTest runner tool must use the same process-tree/process-group ownership principle as the runtime process helpers.

Repair plan:

- Stage the OpenTest visual-qa/runner source files and registration record, regenerate payload, then run full payload generation/trackedness tests.
- Rework OpenTest runner termination to launch a process group on POSIX, use Windows `taskkill /T /F`, reset no-activity timeout on stdout/stderr bytes, and pin the behavior in package payload tests.
- Rework `Process.spawn()` termination so explicit cleanup is not short-circuited by root close before group cleanup has run; add ignored-stdio descendant regressions for `Process.run()` and JSON-lines.
- Add process-group cleanup helpers to Browser MCP node launcher and overlay browser launcher tests, and reset overlay RPC inactivity on every stdout data chunk.
- Tighten native Browser Preview visual test to validate the native surface area instead of full-panel color range, then rerun and inspect screenshots.

Repair summary:

- Staged the OpenTest `opentest-runner`, `visual-qa` prompt/skill, and the visual QA runner registration record that were already referenced by the OpenTest manifest and generated payload.
- Regenerated `packages/opencorvus/src/expert-squad/payload.ts` from repository package sources and verified payload equality plus git-index trackedness.
- Changed OpenTest runner process ownership to POSIX process groups and Windows `taskkill /T /F`, with no-activity timeout reset on stdout/stderr byte chunks and post-run cleanup of residual POSIX group descendants.
- Changed `Process.run()` to perform owned POSIX group cleanup after root close and added ignored-stdio descendant regressions for `Process.run()` and JSON-lines.
- Changed Browser MCP node launcher and overlay browser sidecar cleanup to wait for process-group/tree exit instead of treating root exit as full cleanup.
- Changed overlay browser RPC inactivity to refresh on stdout data chunks before JSON-line parsing.
- Replaced the native Browser Preview full-panel color-range proof with a native-surface crop and host-side sync command evidence.

Validation:

- `bun test packages/opencorvus/test/util/process.test.ts packages/opencorvus/test/executor/external-process-leak.test.ts packages/opencorvus/test/executor/json-rpc.test.ts packages/opencorvus/test/runtime/promise-boundaries.test.ts packages/opencorvus/test/mcp/browser-node-launcher.test.ts --timeout 30000` passed.
- `bun test packages/opencorvus/test/expert-squad/payload-generation.test.ts packages/opencorvus/test/expert-squad/package-manager.test.ts --timeout 60000 --test-name-pattern "payload|opentest|OpenTest"` passed.
- `bun test packages/opencorvus/test/expert-squad/payload-generation.test.ts --timeout 60000` passed after restaging the regenerated payload.
- `node test/browser-runner.mjs test/browser/launch-sidecar.test.ts` and `node test/browser-runner.mjs test/browser/browser-preview-live-input-batch.test.ts` passed.
- Screenshot review of `packages/overlay/.scratch/browser-preview-native-surface.png` and `packages/overlay/.scratch/browser-preview-native-surface-crop.png` confirmed the browser runner screenshot is a blank native surface placeholder; the test now uses it only for layout/crop evidence and relies on the native sync command payload for host rendering evidence.
- `git diff --check`, `git diff --cached --check`, and staged git-index trackedness tests passed.
- `bun run --cwd packages/opencorvus typecheck`, `bun run --cwd packages/overlay typecheck`, `bun typecheck`, `bun run api:routes-check`, and `bun run docs:check` passed.
- `bun ./script/generate.ts` failed twice only while fetching `https://models.dev/api.json` with `ConnectionRefused`; rerunning the same generator with explicit `OPENCORVUS_DISABLE_MODELS_FETCH=true` passed and produced no unstaged generated-artifact drift.
- `bun run build --overlay-server --single` passed with explicit `OPENCORVUS_DISABLE_MODELS_FETCH=true` because `models.dev` remained unreachable.
- `cargo check --manifest-path packages/overlay/src-tauri/Cargo.toml` passed.

Remaining follow-up:

- Launch another independent-agent scan after the Iteration 22 repairs. If it finds no new high-confidence issue locations, run final staged checks, commit with `dsw-33987`, and push to `myhexin`.

### Iteration 23

Status: Independent-agent findings accepted; repairs in progress.

Recall update:

- Iteration 23 was launched after Iteration 22 repairs passed payload generation/trackedness, process cleanup tests, Browser Preview browser tests and screenshot review, package/opencorvus/overlay/root typechecks, route/docs checks, overlay-server build, Rust `cargo check`, and docs link health.
- Four read-only agents audited packaging/generated delivery, Browser Preview GUI state, expert-squad isolation, and lifecycle cleanup. They were instructed not to edit files, stage/commit/push, create worktrees, interfere with running OpenCorvus or overlay processes, or spawn subagents.
- Repository searches and file reads covered staged OpenTest manifest/payload/files, BrowserPreviewPanel refreshKey flow, board refresh updates, local CLI speech-to-text provider, expert-squad resolver/registry/tool projection, and current staged diffs.

Agent feedback:

- Volta found that staged OpenTest delivery is internally inconsistent: payload and new files include `opentest-runner` and `visual-qa`, but the staged manifest does not register them, so clean checkout would carry unreachable resources.
- Lorentz found that pending Browser Preview capture can be invalidated by normal board refresh because `refreshKey` includes `boardStore.boardUpdatedAt`, and board polling updates that key even when the target does not semantically change.
- Kierkegaard found no new high-confidence expert-squad isolation issue beyond the OpenTest staged delivery inconsistency.
- Copernicus found that `LocalCLIProvider.transcribe()` in `channel-runtime` uses raw `Bun.spawn`, kills only the root process on timeout, and then awaits `proc.exited` without a bounded wait or tree/group cleanup.

Accepted findings:

- DOC-16: OpenTest manifest, prompts, route/resolver/skill tests, payload, and package files must be staged as one coherent registration surface.
- GUI-34: Browser Preview pending capture freshness must be scoped to target identity, not ordinary board refresh timestamps.
- LIFE-45: local-cli speech-to-text execution must use bounded no-activity/timeout cleanup with process-tree/process-group ownership, not root-only kill plus unbounded wait.

Repair plan:

- Stage the OpenTest registration files and tests that already register `visual-qa` and `opentest/shared/opentest-runner`, regenerate payload, then run registry/resolver/route/skill/payload tests.
- Replace Browser Preview verification invalidation with a semantic target key and extend the browser evidence test to refresh the board while capture is pending.
- Rework `LocalCLIProvider` subprocess cleanup to use Node process spawning, POSIX process groups, Windows `taskkill /T /F`, bounded escalation, and regression tests in `channel-runtime`.

Implemented repairs:

- Re-generated and staged the OpenTest payload after staging the matching `visual-qa` virtual agent, `opentest/shared/opentest-runner`, manifest, README, selector, role prompts, resolver, registry, route, skill, payload, and package-manager tests as one coherent registration surface.
- Changed Browser Preview verification freshness from the outer board/link refresh key to a semantic target key containing target id, URL, and viewport dimensions. The resource load can still refetch on board refresh, but an unchanged target no longer invalidates a pending capture.
- Extended the real Browser Preview browser test to call `loadBoard({ sync: true })` while same-target recapture is pending and assert the capture-loading stage, disabled saved-evidence refresh, and hidden stale image survive that board refresh.
- Reworked `LocalCLIProvider` to spawn via Node with a POSIX process group or Windows process-tree termination, bounded termination escalation, recursive temporary directory cleanup, and regression coverage for temp cleanup plus ignored-stdio descendant cleanup.

Validation so far:

- `bun test packages/channel-runtime/test/local-cli-stt.test.ts --timeout 30000` passed.
- `bun run --cwd packages/channel-runtime typecheck` passed.
- `bun packages/opencorvus/script/generate-expert-squad-payload.ts` regenerated `packages/opencorvus/src/expert-squad/payload.ts`.
- `bun test packages/opencorvus/test/expert-squad/registry.test.ts packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts packages/opencorvus/test/server/expert-squad-routes.test.ts packages/opencorvus/test/server/skill-routes.test.ts --timeout 60000 --test-name-pattern "opentest|OpenTest|visual-qa|opentest-runner"` passed for the matched resolver, registry, and skill cases.
- `powershell -NoProfile -Command '$env:OPENCORVUS_EXPERT_SQUAD_ROUTES_ISOLATED_CASES="1"; bun test packages/opencorvus/test/server/expert-squad-routes.test.ts --timeout 60000 --test-name-pattern "GET /expert-squad/catalog returns active opentest virtual agent projection only from resolver output"'` passed.
- `bun test packages/opencorvus/test/expert-squad/payload-generation.test.ts packages/opencorvus/test/expert-squad/package-manager.test.ts --timeout 60000 --test-name-pattern "payload|opentest|OpenTest"` passed.
- `node test/browser-runner.mjs test/browser/browser-preview-evidence.test.ts` passed and refreshed Browser Preview screenshots.
- Visual review of `packages/overlay/.scratch/browser-preview-persisted-recapture-loading.png` confirmed the pending recapture stage hides old evidence and keeps Capture/refresh disabled; `packages/overlay/.scratch/browser-preview-evidence-previewable-image.png` confirmed completed evidence still renders.
- `bun test packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/browser-test-runner.test.ts --timeout 60000` passed after updating the component contract assertions to the semantic target-key behavior.

### Iteration 24

Status: Independent-agent findings accepted; repairs in progress.

Recall update:

- Iteration 24 was launched after Iteration 23 repairs passed focused OpenTest payload/resolver/route/skill tests, Browser Preview real browser tests with screenshot review, local-cli process cleanup tests, package and root typechecks, route/docs checks, docs link health, Rust `cargo check`, whitespace checks, generator validation using local models snapshot, and overlay-server build using local models snapshot.
- Four read-only agents audited packaging/generated delivery, Browser Preview GUI state, expert-squad projection isolation, and lifecycle/tooling cleanup. They were instructed not to edit files, stage/commit/push, create worktrees, interfere with running OpenCorvus or overlay processes, or spawn subagents.
- Repository searches and file reads covered SDK server lifecycle, SDK close callers, Browser Preview target-loading state, monthly spec README trackedness, document-health tracked-link tests, and expert-squad resolver/catalog/skill/MCP projection.

Agent feedback:

- Peirce found that `specs/records/2026-07/README.md` links to `2026-07-07-frontend-tool-portability-boundary.md` while that target is untracked, making `document-health.test.ts` fail for tracked monthly README target links.
- Archimedes found that Browser Preview disables refresh during `target.loading` through `previewActionPending()`, but the Capture button only checks `readyTarget`, `currentVerificationLoading()`, and `currentLatestEvidenceLoading()`, so a user can click Capture against the stale previous target while the panel visibly refetches the target.
- Lovelace found no new high-confidence expert-squad projection/isolation issue after the OpenTest registration fixes.
- Cicero found that `packages/sdk/js/src/server.ts` starts `opencorvus serve` with raw `spawn()` and `stopProcess()` only kills the root process, so timeout, abort, and close can leave descendants behind.

Accepted findings:

- DOC-17: Monthly record README links must target tracked record files; the frontend tool portability record cannot remain worktree-only once indexed.
- GUI-35: Browser Preview Capture must be disabled for the full preview action pending state, including target refetch/loading, not only capture/latest-evidence loading.
- LIFE-46: SDK `createOpenCorvusServer()` must own and terminate the launched process tree/group on timeout, abort, and close.

Repair plan:

- Stage `specs/records/2026-07/2026-07-07-frontend-tool-portability-boundary.md` with the README link and rerun the document-health tracked-link test.
- Change Browser Preview Capture disablement to use `previewActionPending()` and add a real browser regression that holds target refetch pending, asserts Capture is disabled in the loading state, then releases the target and verifies capture works only afterward.
- Rework SDK server startup to spawn a POSIX process group or Windows process tree owner, make `close()` async so cleanup failures are observable, update SDK internal callers/docs/examples/scripts to await it, and add tests for ignored-stdio descendant cleanup on timeout.

Implemented repairs:

- Staged `specs/records/2026-07/2026-07-07-frontend-tool-portability-boundary.md` with the monthly README link so the indexed docs target is part of the delivery.
- Changed Browser Preview Capture disablement to `previewActionPending()`, aligning Capture with the same target-loading state that already disables refresh and owns the loading stage.
- Extended the real Browser Preview evidence test to hold the next target response pending after a successful capture, assert the target-loading stage keeps Capture disabled without submitting a new capture body, write `packages/overlay/.scratch/browser-preview-target-refetch-loading.png`, release the target, and then continue the existing capture workflow.
- Changed SDK `createOpenCorvusServer()` to spawn a POSIX process group or Windows process tree owner, terminate that owner on startup timeout, abort, and close, and expose `close(): Promise<void>` so cleanup errors are not silently dropped.
- Updated `createOpenCorvus()` initGit failure cleanup, `script/duplicate-pr.ts`, SDK example, English/Chinese SDK docs, and the SDK contract test to await the async server close.
- Extended SDK server tests to cover root timeout cleanup, ignored-stdio descendant cleanup on startup timeout, and ignored-stdio descendant cleanup on successful startup followed by `close()`.

Validation so far:

- `bun test packages/sdk/js/test/server.test.ts --timeout 30000` passed.
- `bun run --cwd packages/sdk/js typecheck` passed.
- `bun test packages/opencorvus/test/script/sdk-open-corvus-client-contract.test.ts --timeout 30000` passed.
- `bun test packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/browser-test-runner.test.ts --timeout 60000` passed.
- `node test/browser-runner.mjs test/browser/browser-preview-evidence.test.ts` passed after generating the target-refetch loading screenshot.
- Visual review of `packages/overlay/.scratch/browser-preview-target-refetch-loading.png` confirmed the stage shows `Resolving preview target` and the Capture button is disabled during target refetch.
- `bun test packages/opencorvus/test/script/document-health.test.ts --timeout 30000 --test-name-pattern "monthly record README links target tracked record files"` passed after staging the linked frontend portability record.
- `bun run --cwd packages/opencorvus typecheck`, `bun run --cwd packages/overlay typecheck`, `bun run --cwd packages/sdk/js typecheck`, `bun typecheck`, `bun run api:routes-check`, and `bun run docs:check` passed.
- `cargo check --manifest-path packages/overlay/src-tauri/Cargo.toml` passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts --timeout 60000` passed after replacing a concrete untracked planning-draft filename reference with natural language.
- `git diff --check` and `git diff --cached --check` passed.
- `bun ./script/generate.ts` still failed only at external `https://models.dev/api.json` with `ConnectionRefused`; rerunning with explicit `OPENCORVUS_DISABLE_MODELS_FETCH=true` passed and left no unstaged generated-artifact drift.
- `powershell -NoProfile -Command '$env:OPENCORVUS_DISABLE_MODELS_FETCH="true"; bun run --cwd packages/opencorvus build --overlay-server --single'` passed.

### Iteration 25

Status: Independent-agent findings accepted; repairs in progress.

Recall update:

- Iteration 25 was launched after Iteration 24 passed focused SDK lifecycle tests, Browser Preview unit and real browser tests with screenshot review, document-health tracked-link validation, package/root typechecks, route/docs checks, Rust `cargo check`, whitespace checks, generator validation with `OPENCORVUS_DISABLE_MODELS_FETCH=true`, and overlay-server build with the same local models snapshot setting.
- Four read-only agents audited SDK packaging/generated delivery, Browser Preview GUI state, VS Code extension E2E lifecycle cleanup, and expert-squad package tool projection/cache correctness. They were instructed not to edit files, stage/commit/push, create worktrees, interfere with running OpenCorvus or overlay processes, or spawn subagents.
- The user asked why the packaging problem appeared now when it was not seen before. Root diagnosis: the SDK package publish contract already points exports/types/files to `dist`, while the SDK build script only refreshed source/generated files and removed package `dist`; prior source/typecheck validation did not exercise the clean package publish surface.

Repository search evidence:

- `rg -n "dist|bun pm pack|npm publish|script/build|createOpenCorvusServer|server\\.close|package\\.json" packages/sdk/js packages/opencorvus/test/script packages/web/src/content/docs script -g "*.ts" -g "*.mdx" -g "package.json"` showed `packages/sdk/js/package.json` exports `./dist/*.d.ts` and publishes only `dist`, `packages/sdk/js/script/build.ts` removes `dist`, and `packages/sdk/js/script/publish.ts` mutates package exports then runs `bun pm pack` without rebuilding first.
- `rg -n "browserPreviewTargetKey|previewActionPending|browser-preview-candidate-trigger|SelectControl|target\\.loading|capture" packages/overlay/src/components/BrowserPreviewPanel.tsx packages/overlay/test -g "*.ts" -g "*.tsx"` showed Capture and Refresh now use `previewActionPending()`, but the candidate `SelectControl` still only disables when there is one or fewer candidates.
- `rg -n "projectedPackageResourceFingerprint|packageToolCandidatePaths|packageTextFileDigest|bundlePackageTool|package_tool|packageTool|resolvePackageToolFile|opentest-contract|opentest-protocol-engine" packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad .opencorvus/expert-squads/wujiang/opentest -g "*.ts" -g "*.jsonc" -g "*.json"` showed `projectedPackageResourceFingerprint()` hashes only package tool entry candidate files, while OpenTest package tools import `../protocol-engine/opentest-contract.json` and `../protocol-engine/opentest-protocol-engine`.
- `rg -n "runVsCodeCli|spawn\\(|child\\.kill|SIGTERM|timeout|visual|taskkill|process tree|process group" packages/vscode-extension/script packages/vscode-extension/test packages/vscode-extension/package.json -g "*.ts" -g "package.json"` showed `runVsCodeCli()` launches VS Code through a wrapper process and still terminates timeout and visual-capture failure paths with root-only `child.kill("SIGTERM")`.

Agent feedback:

- Sagan found that `@opencorvus-ai/sdk` publishes `dist` but `packages/sdk/js/script/build.ts` deletes `dist` and never copies the temporary TypeScript compiler output back into the package; `script/publish.ts` then packs whatever package state exists without rebuilding.
- Dewey found that Browser Preview candidate selection remains enabled during target refetch because `currentTarget()` still returns the previous target while `target.loading` is true and the candidate dropdown does not use `previewActionPending()`.
- Boole found that VS Code extension E2E timeout and visual-capture failure paths kill only the root wrapper process, which can leak the VS Code extension host or descendants.
- Rawls found that expert-squad package tool projection and bundle cache keys ignore transitive package-local imports. OpenTest tool behavior can change when `protocol-engine/opentest-contract.json` or `protocol-engine/opentest-protocol-engine.ts` changes, but the current projection hash and bundle cache can remain unchanged.

Accepted findings:

- BUILD-18: SDK build/publish must produce the `dist` tree that the SDK package manifest exports and publishes; deleting `dist` on success is a packaging contract bug.
- GUI-36: Browser Preview candidate target changes must be disabled for the same preview action pending state as Capture and Refresh, including target refetch.
- LIFE-47: VS Code extension E2E runner must terminate the launched process tree/group on timeout and visual-capture failure, not only the wrapper root process.
- PROJ-18: Package tool projection fingerprints and bundle cache keys must include package-local transitive source content, not only the entry tool source.

Repair plan:

- Copy the SDK transaction build output into package `dist`, make SDK publish run the SDK build before packing, and add static/dynamic tests proving the published surface cannot point at a missing `dist`.
- Disable Browser Preview candidate `SelectControl` while `previewActionPending()` is true, extend the static component contract, and extend the real browser target-refetch test to assert the candidate control is disabled in the loading screenshot.
- Add a VS Code E2E process-tree cleanup helper with POSIX process-group and Windows `taskkill /T /F` ownership, route `runVsCodeCli()` timeout and visual-failure paths through it, and add ignored-stdio descendant regression coverage.
- Add a package-local source-tree digest for projected package tool refs, include it in projection fingerprints and bundle cache keys, and add resolver coverage that mutating OpenTest protocol-engine sources changes the active projection hash.

Implemented repairs:

- Changed the SDK build script to copy the transaction TypeScript compiler output from `.tmp-sdk-build/dist` into package `dist` through the same atomic directory replacement helper used for generated SDK sources, instead of deleting `dist`.
- Changed SDK publish to run `bun run build` before `bun pm pack` and to restore the original `package.json` in `finally` after temporarily transforming exports for npm publication.
- Added SDK build contract coverage that ties `packages/sdk/js/package.json` `files: ["dist"]` and `exports.*.types` to the build script's `targetRelative: "dist"` output and publish's build-before-pack behavior.
- Changed Browser Preview candidate target selection to disable while `previewActionPending()` is true, matching Capture and Refresh during target refetch.
- Extended the Browser Preview static contract and real browser evidence test so the target-refetch loading state asserts both Capture and candidate selection are disabled; refreshed `packages/overlay/.scratch/browser-preview-target-refetch-loading.png` and visually reviewed it.
- Added `packages/vscode-extension/script/process-tree.ts` and routed VS Code E2E timeout/visual-failure cleanup through owned process-tree termination. Windows uses `taskkill /T /F`; non-Windows uses the owned process group with SIGTERM then SIGKILL.
- Added VS Code E2E process cleanup regression coverage for ignored-stdio descendants plus a static guard against returning to `child.kill("SIGTERM")`.
- Added package source tree hashing for expert-squad package tools, included it in projection package tool digests and Bun bundle cache keys, and extended the resolver hash test to mutate OpenTest `protocol-engine/opentest-contract.json`.

Validation so far:

- `bun test packages/opencorvus/test/script/sdk-build-format-contract.test.ts --timeout 30000 --test-name-pattern "SDK build materializes"` passed.
- `bun run --cwd packages/sdk/js build` passed and materialized `packages/sdk/js/dist/{index,client,server,defaults}.{js,d.ts}` plus `dist/gen/**`.
- `bun test packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/browser-test-runner.test.ts --timeout 60000` passed.
- `node test/browser-runner.mjs test/browser/browser-preview-evidence.test.ts` passed.
- Visual review of `packages/overlay/.scratch/browser-preview-target-refetch-loading.png` confirmed `Resolving preview target`, disabled Capture, disabled target candidate control, and no layout overlap.
- `bun test packages/vscode-extension/test/e2e-process.test.ts --timeout 30000` passed.
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --timeout 30000 --test-name-pattern "active virtual worker projection hash follows virtual prompt and package resource content"` passed.
- `bun test packages/opencorvus/test/script/sdk-build-format-contract.test.ts packages/opencorvus/test/script/sdk-open-corvus-client-contract.test.ts --timeout 30000` passed.
- `bun run --cwd packages/sdk/js typecheck` passed.
- `bun test packages/vscode-extension/test/e2e-process.test.ts packages/vscode-extension/test/sidecar-manager.test.ts --timeout 30000` passed.
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --timeout 60000 --test-name-pattern "opentest|active virtual worker projection hash"` passed.
- `bun run --cwd packages/opencorvus typecheck`, `bun run --cwd packages/overlay typecheck`, and `bun run --cwd packages/vscode-extension typecheck` passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts --timeout 60000` passed.
- `powershell -NoProfile -Command '$env:OPENCORVUS_DISABLE_MODELS_FETCH="true"; bun ./script/generate.ts'` passed and reported generated SDK files unchanged.
- `bun typecheck`, `bun run api:routes-check`, and `bun run docs:check` passed.
- `git diff --check` and `git diff --cached --check` passed.
- `bun pm pack --dry-run` in `packages/sdk/js` passed and listed 39 packed files under `dist` without leaving a tarball.
- `powershell -NoProfile -Command '$env:OPENCORVUS_DISABLE_MODELS_FETCH="true"; bun run --cwd packages/opencorvus build --overlay-server --single'` passed.
- `git diff --name-only -- <Iteration 25 touched files>` returned empty after staging, confirming root generation and build did not leave unstaged drift in the touched files.

### Iteration 26

Status: Independent-agent findings accepted; repairs in progress.

Recall update:

- Iteration 26 was launched after Iteration 25 repairs passed SDK packaging dry-run, Browser Preview real screenshot review, VS Code E2E process cleanup tests, expert-squad projection hash tests, package/root typechecks, route/docs checks, generator validation with `OPENCORVUS_DISABLE_MODELS_FETCH=true`, whitespace checks, and overlay-server build.
- Four read-only agents were launched for SDK/package delivery, Browser Preview GUI, lifecycle/tooling cleanup, and expert-squad projection isolation. They were instructed not to edit files, stage/commit/push, create worktrees, interfere with running OpenCorvus/overlay processes, or spawn subagents.

Agent feedback:

- Chandrasekhar found that SDK `publish.ts` still recursively transforms every string leaf under `exports`. The package manifest already uses conditional export objects with `types`, `import`, and `default`, so the publish transform corrupts `types: "./dist/index.d.ts"` into nested `{ import: "./dist/index.d.js", types: "./dist/index.d.d.ts" }` objects.
- Newton found that Browser Preview viewport segmented controls remain enabled during `target.loading`. Because `latestEvidenceScope()` can still read the previous target through `currentTarget()`, switching viewports during target refetch can start stale persisted-evidence loads from the old target.
- Carver found that package MCP projection hashes only the MCP JSON/JSONC definition file. MCP-only packages that launch package-local implementation files do not include those implementation files in the projection hash because the full package source-tree digest is currently tied only to `package_tool_refs`.
- Einstein found that SDK server startup still has a pre-startup root-exit rejection path that calls `failStartup()` without first cleaning the owned process tree, VS Code E2E visual readiness uses a wall-clock timeout instead of a no-activity timeout reset by event-log progress, and LocalCLI / OpenTest runner cleanup still has Windows root-exit descendant gaps.

Accepted findings:

- BUILD-19: SDK publish manifest transform must preserve conditional export map shape and only rewrite condition target strings to the publish `dist` surface. Producing nested condition objects immediately before `bun pm pack` corrupts the package manifest even though `dist` files now exist.
- GUI-37: Browser Preview viewport controls must be disabled or inert during `previewActionPending()`, including target refetch, so viewport changes cannot trigger old-target evidence loads while the authoritative target is pending.
- PROJ-19: Package MCP projection fingerprints must include package-local implementation sources, not just the MCP definition file, when MCP refs are active.
- LIFE-48: SDK `createOpenCorvusServer()` must terminate the owned process tree/group before rejecting startup when the root process exits before the server reports readiness.
- LIFE-49: VS Code E2E visual event waiting must use an inactivity timeout based on event-log/file progress, not a fixed wall-clock deadline from wait start.
- LIFE-50: LocalCLI speech-to-text and the OpenTest runner must clean Windows descendants after the root process exits; successful root exit cannot make ignored-stdio descendants unreachable or silently skipped.

Repair plan:

- Extract the publish manifest transform into a pure helper that rewrites conditional export target strings by condition name instead of recursively transforming every string leaf.
- Update `publish.ts` to build the transformed package JSON through that helper.
- Add a publish contract test using the real SDK package manifest that asserts every published export condition remains a string, `types` ends in `.d.ts`, and `import` / `default` point to `.js` under `dist`.
- Disable Browser Preview viewport segmented controls while `previewActionPending()` is true and extend the real persisted-evidence browser test so target refetch keeps viewport controls disabled and avoids stale evidence loading.
- Include the package source-tree digest when package MCP refs are active and add resolver coverage that mutating a package-local MCP implementation file changes the active projection hash without touching the MCP JSONC definition.
- Audit SDK server startup exit handling and add a root-exit-before-ready regression test that proves cleanup is invoked before startup rejection.
- Extract or harden the VS Code E2E event-log wait loop so file/event activity resets the inactivity timer, with focused unit coverage for progress followed by silence.
- Extend process cleanup support and tests for LocalCLI speech-to-text and OpenTest runner Windows-style root-exit descendants, without adding root-only fallback cleanup.

Implemented repairs so far:

- Added `packages/sdk/js/script/publish-manifest.ts` with a pure `buildPublishPackageJson()` transform that preserves conditional export objects and rewrites only supported string condition targets.
- Updated SDK `publish.ts` to use `buildPublishPackageJson()` after the pre-pack build.
- Added SDK publish manifest contract coverage in `sdk-build-format-contract.test.ts`.
- Disabled Browser Preview viewport options while preview actions are pending and added primitive disabled styling for the segmented tab control.
- Extended Browser Preview panel/static and real browser evidence tests so target refetch keeps viewport controls disabled until the authoritative target settles.
- Included the full package source-tree digest in active package MCP fingerprints and added MCP-only projection hash coverage using a package-local MCP implementation file outside the MCP definition directory.
- Updated SDK server startup failure handling so parse failure, abort, and root pre-startup exit paths terminate the owned process tree/group before rejecting startup.
- Replaced SDK, LocalCLI, and OpenTest runner Windows root-exit cleanup with a `ParentProcessId` descendant scan through `Get-CimInstance Win32_Process`, so cleanup still sees descendants after the root process has exited.
- Updated LocalCLI and OpenTest runner completion paths to invoke cleanup after successful root exit as well as timeout/abort, matching the POSIX process-group cleanup contract.
- Extracted VS Code E2E event-log reading/waiting into `e2e-event-log.ts` and changed visual readiness waiting to reset the inactivity timer on event-log file progress.
- Regenerated `packages/opencorvus/src/expert-squad/payload.ts` from the updated OpenTest package runner source.

Validation so far:

- `bun test packages/opencorvus/test/script/sdk-build-format-contract.test.ts --timeout 30000 --test-name-pattern "SDK publish manifest transform"` passed.
- `bun test packages/overlay/test/tabs-primitive.test.ts packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/browser-test-runner.test.ts --timeout 60000` passed.
- `node test/browser-runner.mjs test/browser/browser-preview-evidence.test.ts` passed after the target-refetch viewport-disabled assertion was added; `packages/overlay/.scratch/browser-preview-target-refetch-loading.png` was visually reviewed and showed viewport/candidate/capture controls disabled during loading without overlap.
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --timeout 60000 --test-name-pattern "MCP-only package projection hash"` passed.
- `bun test packages/vscode-extension/test/e2e-process.test.ts --timeout 30000` passed.
- `bun test packages/sdk/js/test/server.test.ts --timeout 30000` passed.
- `bun test packages/channel-runtime/test/local-cli-stt.test.ts --timeout 30000` passed.
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --timeout 120000 --test-name-pattern "projects repository opentest selector"` passed.
- `bun test packages/opencorvus/test/expert-squad/package-manager.test.ts --timeout 60000 --test-name-pattern "opentest payload exposes"` passed.
- `bun run --cwd packages/sdk/js typecheck`, `bun run --cwd packages/channel-runtime typecheck`, `bun run --cwd packages/vscode-extension typecheck`, and `bun run --cwd packages/opencorvus typecheck` passed.
- `bun typecheck`, `bun run api:routes-check`, and `bun run docs:check` passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts --timeout 60000` passed.
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --timeout 180000` passed with 77 passing tests and 4 environment-gated skips.
- `bun test packages/opencorvus/test/script/sdk-build-format-contract.test.ts packages/sdk/js/test/server.test.ts packages/channel-runtime/test/local-cli-stt.test.ts packages/vscode-extension/test/e2e-process.test.ts packages/opencorvus/test/expert-squad/package-manager.test.ts --timeout 120000` passed.
- `node test/browser-runner.mjs test/browser/browser-preview-evidence.test.ts` passed again after lifecycle repairs.
- `bun pm pack --dry-run` in `packages/sdk/js` passed, listed 39 `dist` files, and left no `.tgz` in the package directory.
- `powershell -NoProfile -Command '$env:OPENCORVUS_DISABLE_MODELS_FETCH="true"; bun run --cwd packages/opencorvus build --overlay-server --single'` passed.
- `git diff --check` and `git diff --cached --check` passed.

### Iteration 27

Status: Independent-agent findings accepted; repairs in progress.

Recall update:

- Iteration 27 was launched after Iteration 26 repairs passed focused SDK publish manifest, Browser Preview panel/browser, MCP-only projection hash, VS Code E2E event-log, SDK server, LocalCLI, OpenTest payload, package/root typecheck, route/docs, historical-docs/document-health, full prompt-profile-resolver, SDK package dry-run, overlay-server build, and whitespace checks.
- Four read-only agents were launched for SDK/package delivery, Browser Preview GUI, lifecycle/process cleanup, and expert-squad projection/catalog isolation. They were instructed not to edit files, stage/commit/push, create worktrees, touch running OpenCorvus/overlay processes, or spawn subagents.
- Full-grep evidence before edits:
  - SDK publish/runtime authority: `@opencorvus-ai/transport-protocol`, `routeRequiresProjectDirectory`, `workspace:*`, `buildPublishPackageJson`, and `directoryScopedFetch` were searched across `packages/sdk/js`, `packages/transport-protocol`, `packages/opencorvus`, `packages/overlay`, and `packages/vscode-extension`.
  - Browser Preview retry/native scope: `targetLoadError`, `currentTargetError`, `target.loading`, `navigateNativePreview`, `nativePreviewError`, and `Resolving preview target` were searched across the component and Browser Preview tests.
  - Catalog projection hash: `catalogSummaryFromPackage`, `projection_hash`, `resourceFingerprint`, `projectionHash`, `packageSourceTreeDigest`, and `catalog(` were searched across catalog/resolver source, resolver tests, and the overlay ExpertSquad panel.
  - Lifecycle cleanup: `stopServerWithTimeout`, `restartServer`, `db/reset`, `benchmark-100-rounds`, `remove(`, `spawnPrepared`, `OPENCORVUS_PTY_NODE`, `proc.kill(`, `Bun.spawn`, and `terminateOwnedProcessTree` were searched across server, CLI, PTY, VS Code scripts, and tests.

Agent feedback:

- Bohr found that the SDK publish manifest still keeps `@opencorvus-ai/transport-protocol: "workspace:*"` and `dist/client.js` still imports the private workspace package. BUILD-18/19 fixed missing `dist` and export shape, but not the publish tarball runtime dependency surface.
- Bacon found that Browser Preview Refresh starts a target refetch while stale `targetLoadError` remains visible, and native Back/Forward/Reload rejection writes `nativePreviewError` without checking that the native scope that issued the command is still current.
- Hypatia found that active scheduler/worker projections include package README/selector/skill/tool/MCP resource fingerprints, but catalog squad `projection_hash` still uses a weaker summary path and is user-visible in the ExpertSquad panel.
- Euclid found that server restart/db-reset can return success before proving the replacement process survives fixed-port startup, `stopServerWithTimeout()` resolves after stop failures and timeout, VS Code 100-round benchmark cleanup is root-only and has unbounded post-timeout waits, PTY removal marks sessions exited before process-tree cleanup is proven, and PTY bridge spawn errors can leave a running ghost session with `pid: 0`.

Accepted findings:

- BUILD-20: Published SDK output must not contain private workspace runtime imports or `workspace:*` dependencies. The public SDK package must be self-contained with respect to OpenCorvus internal packages.
- GUI-38: Browser Preview target retry must clear same-scope target load errors before refetch and render loading while the authoritative target request is pending.
- GUI-39: Browser Preview native navigation errors must be scoped to the native surface key that issued the command; delayed failures from an old scope must not overwrite the newer view.
- PROJ-20: Catalog squad `projection_hash` must use the same package resource fingerprint semantics as the active resolver path; UI-visible catalog hashes cannot be a second weaker source of truth.
- LIFE-51: Server restart and DB reset must not report restart success before the replacement child has proven startup readiness or failed observably.
- LIFE-52: `stopServerWithTimeout()` must reject on stop failures and timeout; callers must not treat an unproven stop as successful.
- LIFE-53: VS Code 100-round benchmark process cleanup must use bounded owned process-tree termination, not root-only kill plus unbounded collector awaits.
- LIFE-54: PTY remove/dispose must not mark sessions exited or null process handles before process-tree cleanup has completed or failed.
- LIFE-55: PTY bridge spawn errors must reject PTY creation instead of returning a ghost running session.
- LIFE-56: Iteration 26 LocalCLI cleanup introduced a regression where the command timeout could fire during successful Windows descendant cleanup; completion must clear the command timeout before post-completion cleanup.

Repair plan:

- Clear LocalCLI command timeout immediately after command completion, before post-completion process-tree cleanup.
- Make the SDK build materialize a publish-safe generated protocol module from the existing transport-protocol route policy source and rewrite SDK imports to that generated module in the built/published surface, while keeping source route authority in the private protocol package.
- Remove the private transport-protocol dependency from the SDK publish manifest and add tests that the transformed manifest has no `workspace:*` runtime dependencies and `dist/client.js` has no `@opencorvus-ai/transport-protocol` import after build.
- Clear `targetLoadError` on Browser Preview refresh and prefer loading over stale load error while `target.loading` is true.
- Capture the native preview scope key when issuing Back/Forward/Reload and write navigation errors only if that key still matches the current native scope.
- Route catalog squad hash construction through the resolver resource fingerprint path, with a regression test mutating selector/package implementation content and asserting catalog `projection_hash` changes.
- Change server restart to wait for the replacement child readiness signal or failure before returning restart success, and make DB reset surface restart failure rather than reporting `restarting: true` unconditionally.
- Change stop helper semantics to reject on stop failure or timeout and update callers/tests accordingly.
- Reuse the VS Code process-tree helper in the 100-round benchmark and bound post-timeout process/collector settlement.
- Harden PTY host process abstraction so remove/dispose awaits cleanup completion before marking exit, and bridge spawn errors reject creation.

Implemented repairs so far:

- Cleared the LocalCLI command timeout immediately after command completion so successful Windows descendant cleanup cannot flip `timedOut` after the command has already exited.
- Added SDK `src/route-policy.ts`, generated from the existing `packages/transport-protocol/src/index.ts` server route directory policy block during `packages/sdk/js/script/build.ts`.
- Changed SDK `client.ts` to import `routeRequiresProjectDirectory` from the SDK-owned generated route policy module and removed the private `@opencorvus-ai/transport-protocol` runtime dependency from the SDK package manifest.
- Extended SDK publish/build contract tests to assert route-policy generation is registered, published dependencies contain no `workspace:*`, and the published client export points at `dist/client.js`.
- Cleared Browser Preview target load errors on Refresh, hid stale target load errors while `target.loading` is true, and scoped native navigation rejection handling to the native sync key that issued the navigation command.
- Routed catalog summary projection hashes through the resolver package resource fingerprint path, including README, selector, package skills, package tools, and package MCP implementation source fingerprints.
- Changed `stopServerWithTimeout()` to reject on stop failures and timeout instead of resolving after logging.
- Changed `/restart` and `/global/db/reset` to await restart child startup grace and surface early replacement-child exit as 503 instead of reporting successful restart.
- Reused the VS Code E2E owned process-tree helper in `benchmark-100-rounds.ts` and replaced root-only `proc.kill()` plus unbounded collector waits with bounded process-tree termination.
- Hardened VS Code process-tree cleanup on Windows to enumerate `ParentProcessId` descendants through `Get-CimInstance Win32_Process` and tolerate processes that naturally exit before `Stop-Process`.
- Changed PTY host process kill to be awaitable; `stop()` / `remove()` / instance disposal now await `closeSession()` before deleting sessions or nulling process handles.
- Added PTY bridge spawn readiness checks so spawn/early-exit errors reject PTY creation instead of returning a `pid: 0` running session.
- Made SDK server process tests serial because they mutate `process.cwd()` and `process.env`, preventing test-level concurrency from masking process cleanup behavior.

Validation so far:

- `bun test packages/channel-runtime/test/local-cli-stt.test.ts --timeout 30000` passed.
- `bun test packages/opencorvus/test/script/sdk-build-format-contract.test.ts --timeout 30000 --test-name-pattern "SDK publish manifest transform"` passed.
- `bun run --cwd packages/sdk/js typecheck` passed.
- `bun run --cwd packages/sdk/js build` passed and regenerated `src/route-policy.ts`, `src/gen`, `src/defaults.ts`, `dist`, and root SDK OpenAPI.
- `rg -n "@opencorvus-ai/transport-protocol|workspace:\*" packages/sdk/js/dist packages/sdk/js/package.json packages/sdk/js/src/client.ts packages/sdk/js/src/route-policy.ts` returned no matches.
- `bun -e "const pkg=await Bun.file('packages/sdk/js/package.json').json(); const { buildPublishPackageJson }=await import('./packages/sdk/js/script/publish-manifest.ts'); const out=buildPublishPackageJson(pkg); console.log(JSON.stringify({dependencies:out.dependencies??null,exports:out.exports['./client']}, null, 2));"` printed `dependencies: null` and `./client` export targets under `dist`.
- `bun test packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/tabs-primitive.test.ts --timeout 30000` passed.
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --timeout 90000 --test-name-pattern "catalog squad projection hash follows|MCP-only package projection hash"` passed.
- `bun test packages/opencorvus/test/cli/serve-shutdown.test.ts --timeout 30000 --test-name-pattern "stop helper"` passed.
- `bun test packages/opencorvus/test/server/app-routes.test.ts --timeout 60000 --test-name-pattern "POST /restart"` passed.
- `bun test packages/opencorvus/test/server/global-db-destructive.test.ts --timeout 60000 --test-name-pattern "early exit"` passed.
- `bun test packages/opencorvus/test/server/pty-routes.test.ts --timeout 30000 --test-name-pattern "Node PTY bridge"` passed.
- `bun test packages/vscode-extension/test/e2e-process.test.ts --timeout 30000` passed.
- `bun run --cwd packages/vscode-extension typecheck`, `bun run --cwd packages/channel-runtime typecheck`, and `bun run --cwd packages/opencorvus typecheck` passed after the lifecycle edits.
- `bun test packages/sdk/js/test/server.test.ts --timeout 60000` passed after the process-mutating tests were made serial.

### Iteration 28

Status: Independent-agent findings accepted; repairs in progress.

Recall update:

- Iteration 28 was launched after Iteration 27 focused validation passed SDK package build/publish checks, Browser Preview panel and browser evidence tests, catalog hash focused resolver tests, lifecycle process cleanup tests, package/root typechecks, route/docs checks, and SDK pack dry-run.
- Four read-only agents audited SDK/package publish paths, GUI loading/error states, lifecycle/process cleanup, and expert-squad catalog/projection hashing. They were instructed not to edit files, stage/commit/push, create worktrees, touch running OpenCorvus/overlay processes, or spawn subagents.
- The user asked why the packaging problem appeared now when it did not exist before. Root diagnosis: the broken manifest shape comes from two older paths meeting: `publish.ts` added a temporary export rewrite on 2026-02-18, while the SDK manifest later moved to conditional exports and `files: ["dist"]` on 2026-04-16. Normal build/typecheck did not exercise raw package-manager pack/publish, so the issue stayed hidden until the SDK package delivery audit ran `bun pm pack` / `npm publish --dry-run`.
- Full-grep evidence before edits:
  - SDK raw package surface: `package.json`, `publishConfig`, `files`, `src/*.ts`, `dist/*.js`, `publish.ts`, `publish-manifest.ts`, `bun pm pack`, and `npm publish` were searched across `packages/sdk/js`, package docs, generated SDK tests, and workspace package references.
  - GUI loading/error state: `currentTarget`, `target.loading`, `previewActionPending`, `nativePreviewNavigationReady`, `catalogError`, `refreshCatalog`, and Expert Squad catalog browser tests were searched across overlay components and tests.
  - OpenTest runner lifecycle: `opentest-runner`, `context.abort`, `terminationFailure`, `clearInactivityTimer`, and `inactive_timeout_ms` were searched across the OpenTest package, package-manager tests, payload-generation tests, and lifecycle utility tests.
  - Expert-squad projection drift: `query_failed_goals`, `orchestratorSchedulerRoleBaseToolIDs`, `defaultToolProviderNames`, `package_mcp_server_refs`, `package_mcp_tool_refs`, `catalogSummaryFromPackage`, and `projection_hash` were searched across package manifests, resolver/catalog source, and resolver tests.

Agent feedback:

- Hilbert found that direct `bun pm pack --dry-run`, `npm pack --dry-run`, and `npm publish --dry-run` still read the repository `package.json`, whose exports point to `./src/*.ts` while the published file list only includes `dist`. The `publish.ts` manifest rewrite does not protect direct package-manager pack paths. Hilbert also found `publish.ts` runs `npm publish *.tgz`, so a stale tarball from a prior failed run could be published alongside or instead of the newly packed archive.
- Hegel found that Browser Preview native Back/Forward/Reload can still be enabled while `target.loading` is true because navigation readiness is derived from the previous native sync key. Hegel also found Expert Squad retry/loading shows the stale catalog error banner until success clears it.
- Boyle found that OpenTest runner spawns before checking an already-aborted signal and clears its inactivity timer / abort listener only after the termination race resolves; a cleanup failure can leave the long inactivity timer and abort listener live.
- Kuhn found that catalog `projection_hash` still hashes explicit `package_mcp_tool_refs` but does not expand `package_mcp_server_refs` the way the active resolver does before hashing provider names. This leaves a second hash source for package MCP server projections.

Accepted findings:

- BUILD-21: SDK raw package-manager pack/publish must be self-contained without relying on a temporary `publish.ts` manifest rewrite. The repository package manifest itself must point exported runtime entries at `dist`.
- BUILD-22: SDK publish must target the exact tarball created by the current pack run and must remove stale package tarballs before packing; `npm publish *.tgz` is not an acceptable artifact selector.
- GUI-40: Browser Preview native navigation controls must be disabled while the authoritative target is loading, not only while the previous native sync key remains valid.
- GUI-41: Expert Squad catalog retry must clear same-scope catalog errors before starting a new catalog load so the UI does not show stale failure during loading.
- LIFE-57: OpenTest runner must honor an already-aborted signal before spawning and must clear the inactivity timer / abort listener in a `finally` path even when termination fails.
- PROJ-21: Catalog projection hashing must expand `package_mcp_server_refs` into typed package MCP provider names using the same semantics as active resolver hashing.
- PROJ-22: The current OpenTest manifest and resolver tests still reference `query_failed_goals` as a standalone built-in scheduler tool even though the canonical scheduler base tool list no longer exposes it. The package projection must use the current `manage_task action=query_failed_goals` surface instead of retaining the retired tool ID.

Repair plan:

- Change `packages/sdk/js/package.json` exports to `dist` runtime entries, keep tests proving no exported package target points at `src`, and simplify publish manifest transformation to validation rather than hidden source-to-dist repair.
- Change SDK publish to pack to a controlled temporary destination/filename, delete any stale SDK tarballs before packing, and publish the exact generated tarball path.
- Make Browser Preview native navigation readiness include `!previewActionPending()` and extend static component coverage for the disabled path.
- Clear Expert Squad `catalogError` before same-scope catalog loading and add a regression to the existing browser panel test.
- Harden OpenTest runner cancellation with an already-aborted pre-spawn check and `try/finally` cleanup around the completion/termination race; update package payload tests and regenerate payload.
- Reuse resolver MCP server-ref expansion semantics in catalog hash construction or a shared helper, and add resolver coverage for server-ref catalog hash changes.
- Remove `query_failed_goals` from the OpenTest scheduler manifest and resolver expected scheduler base list, relying on `manage_task action=query_failed_goals` as the current single tool surface.

Implemented repairs so far:

- Changed `packages/sdk/js/package.json` so all exported runtime targets point to `dist` directly. `publish-manifest.ts` now validates dist-only exports instead of silently transforming `src` targets into a publish-only shape.
- Changed SDK `publish.ts` to run the build, validate the root manifest, remove stale SDK tarballs, pack to `.tmp-sdk-pack` with an exact filename, and publish the exact generated tarball path instead of `npm publish *.tgz`.
- Changed Browser Preview native navigation readiness so Back/Forward/Reload are disabled whenever `previewActionPending()` is true, including target refetch.
- Changed Expert Squad settings catalog reload to clear same-scope catalog errors before the new load starts, and extended the browser test to cover failure, retry-loading, and recovery states with screenshots.
- Changed OpenTest runner to reject an already-aborted command before spawning and to clear inactivity timer / abort listener in `finally`, even when termination fails. Regenerated expert-squad payload from the updated package source.
- Changed catalog projection hashing so the active project package catalog summary receives the same fully loaded package MCP ref inventory as active resolver hashing, while inactive project package catalog summaries remain lightweight and do not parse inactive MCP definitions.
- Removed the retired standalone `query_failed_goals` built-in scheduler tool from the OpenTest package projection and resolver expected scheduler base list.

Validation so far:

- `bun test packages/opencorvus/test/script/sdk-build-format-contract.test.ts --timeout 30000 --test-name-pattern "SDK publish|SDK build materializes"` passed.
- `bun test packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/expert-squad-scope.test.ts --timeout 30000` passed.
- `bun test packages/opencorvus/test/expert-squad/package-manager.test.ts packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --timeout 120000 --test-name-pattern "opentest payload exposes|catalog squad projection hash follows|resolves general scheduler capability|projects repository opentest selector|projects scheduler default tool refs"` passed.
- `node test/browser-runner.mjs test/browser/expert-squad-panel.test.ts` passed after the retry-loading browser regression was added. Screenshots reviewed: `packages/overlay/.scratch/expert-squad-catalog-error-recovery.png` and `packages/overlay/.scratch/expert-squad-catalog-retry-loading.png`.
- `bun run --cwd packages/sdk/js build` passed.
- `bun pm pack --dry-run` in `packages/sdk/js` passed and packed only `package.json` plus `dist/**`; no `.tgz` remained afterward.
- `rg -n "@opencorvus-ai/transport-protocol|workspace:\*|\./src/" packages/sdk/js/package.json packages/sdk/js/dist packages/sdk/js/src/client.ts packages/sdk/js/src/route-policy.ts` returned no matches.
- `bun run --cwd packages/sdk/js typecheck`, `bun run --cwd packages/overlay typecheck`, and `bun run --cwd packages/opencorvus typecheck` passed.
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --timeout 180000` passed: 78 pass, 4 skip, 0 fail.
- `node test/browser-runner.mjs test/browser/browser-preview-evidence.test.ts` passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts --timeout 60000` did not pass because `specs/records/2026-07/README.md` links to untracked `2026-07-07-dependency-contract-single-source-repair.md`. This is a docs/index tracking issue outside the SDK/GUI/OpenTest/catalog code paths and remains unresolved in the current worktree.

### Iteration 29

Status: Independent-agent findings accepted; repairs in progress.

Recall update:

- Iteration 29 was launched after Iteration 28 SDK/GUI/OpenTest/catalog repairs passed focused tests, SDK raw pack dry-run, SDK/overlay/opencorvus/root typechecks, route inventory check, Browser Preview and Expert Squad browser tests with screenshot review, and full prompt-profile-resolver validation.
- Four read-only agents audited SDK/package publishing, GUI/overlay state ownership, lifecycle/process cleanup, and expert-squad/catalog/payload projection. They were instructed not to edit files, stage/commit/push, create worktrees, touch running OpenCorvus/overlay processes, or spawn subagents.

Agent feedback:

- Aquinas found that SDK `package.json` still contains unsupported `publishConfig.directory` and that raw package-manager pack/publish can ship stale ignored `dist` output because direct pack has no lifecycle build and `dist` is intentionally ignored.
- Hubble found that Expert Squad archive import captures scope only when the file input `change` event fires, not when the user clicks Import ZIP. A native file-picker delay can therefore import into a later task/project scope; folder import already captures before opening the picker.
- Averroes found that Windows PowerShell cleanup delegates in OpenTest runner, LocalCLI, and VS Code process-tree cleanup can hang forever before bounded PID waits begin. Averroes also found the outer VS Code E2E idle timer resets only on stdout/stderr, ignoring event-log progress that the suite writes without console output.
- Ptolemy found no new high-confidence expert-squad/catalog/payload/projection issue after checking active/inactive catalog split, active MCP server-ref hash parity, payload release identity checks, runtime built-in `general` boundary, and `query_failed_goals` removal from OpenTest package projection.

Accepted findings:

- BUILD-23: SDK `publishConfig.directory` is unsupported by npm and must be removed; the root package manifest must not carry ignored package-manager config.
- BUILD-24: Raw SDK `npm pack` / `bun pm pack` must run the SDK build lifecycle or otherwise prove `dist` freshness before packing ignored output. The scripted publish path can build once and pack with lifecycle scripts disabled, but direct package-manager pack must not ship stale `dist`.
- GUI-42: Expert Squad archive import must capture catalog scope before opening the native file picker, matching folder import's scope ownership across picker delay.
- LIFE-58: Windows cleanup helper delegate processes must be bounded; cleanup cannot wait forever for PowerShell before reaching the already bounded PID wait.
- LIFE-59: VS Code E2E outer process idle timeout must treat event-log file progress as activity, not only stdout/stderr.
- PROJ-23: Full expert-squad package-manager validation shows `frontend-innovate` formal contract drift: the frontend-design overlay no longer names missing `competitor/source` resources even though the payload contract requires that boundary.

Repair plan:

- Remove `publishConfig.directory`, add SDK package lifecycle scripts that call `bun run build` for raw pack/publish, and make `publish.ts` use `bun pm pack --ignore-scripts` after its explicit build to avoid duplicate builds while preserving direct pack freshness.
- Extend SDK build/publish contract tests to assert no unsupported `publishConfig.directory`, direct lifecycle scripts exist, and scripted publish disables lifecycle after explicit build.
- Capture Expert Squad archive import scope at Import ZIP click time and consume that captured scope on file `change`; reset it after use or cancel. Extend scope tests to cover the pre-picker capture path.
- Add bounded timeout handling to Windows PowerShell cleanup helpers in LocalCLI, OpenTest runner, and VS Code process-tree cleanup, plus static/focused tests for the timeout guard.
- Wire VS Code E2E outer idle tracking to event-log progress using the existing event-log utilities, and add focused tests proving event-log activity refreshes the main idle timer.
- Restore the `frontend-innovate` frontend-design overlay's explicit `competitor/source resources are missing` blocking language and regenerate payload so the package source and embedded payload stay single-sourced.

### Iteration 30

Status: Independent-agent findings accepted; repairs in progress.

Recall update:

- Iteration 30 launched after Iteration 29 SDK package lifecycle, Expert Squad archive scope capture, Windows PowerShell cleanup timeout, VS Code E2E event-log idle activity, and frontend-innovate formal contract repairs passed focused tests, SDK raw pack/publish dry-runs, package-manager full validation, browser Expert Squad regression, root typecheck, package typechecks, route check, and screenshot review.
- Four read-only agents were launched over SDK/package delivery, GUI/overlay state ownership, lifecycle/process cleanup, and expert-squad/catalog/payload/formal contracts. They were instructed not to edit files, stage/commit/push, create worktrees, touch running OpenCorvus/overlay processes, or spawn subagents.

Agent feedback:

- Goodall found that raw `npm publish` for the prerelease SDK is still not self-contained: `0.0.1-alpha` requires an explicit npm tag, while only `script/publish.ts` passes `--tag`.
- Maxwell found a new Browser Preview state ownership bug: `targetSelectionError` is standalone, renders before `target.loading`, and is cleared only by manual refresh, another candidate selection, or task/directory change. External authoritative target refreshes driven by `refreshKey` can therefore be hidden behind a stale candidate selection error.
- Heisenberg found that shared Windows `Process.spawn` / `Process.run` cleanup still returns early after root process close and can miss ignored-stdio descendants, and that PTY bridge readiness proves only wrapper process spawn, not inner `node-pty` spawn readiness.
- Zeno found public catalog `squads[].capability_projection.scheduler` still exposes raw manifest MCP prompt/resource refs while the active scheduler capability expands `package_mcp_server_refs` into runtime prompt/resource refs.

Accepted findings:

- BUILD-25: Raw SDK `npm publish` for prerelease versions must carry a supported default publish tag so the package-manager publish surface is self-contained without requiring the caller to remember `--tag`.
- GUI-43: Browser Preview candidate selection errors must clear when the authoritative target request scope changes, including board/preview-link `refreshKey` refreshes, so stale selection failures cannot hide real target loading or recovered target state.
- LIFE-60: Shared Windows process cleanup must not short-circuit descendant cleanup after the root process exits; ignored-stdio descendants remain owned cleanup responsibility.
- LIFE-61: PTY bridge readiness must be acknowledged after the inner pseudo-terminal spawn succeeds, not merely after the wrapper Node process emits the OS-level spawn event.
- PROJ-24: Public catalog scheduler projection DTOs must expand package MCP server refs into prompt/resource refs using the same semantics as active scheduler capability projection.

Repair plan:

- Add workspace-root npm tag configuration for the prerelease raw publish path and validate `npm publish --dry-run --ignore-scripts --json` no longer fails on missing tag or publishes as `latest`.
- Add a Browser Preview target request key that tracks active task, directory, `refreshKey`, and explicit refresh token, clear `targetSelectionError` when that key changes, and extend static coverage to assert the selection error is scoped to target request changes rather than only task/directory cleanup.
- Repair shared Windows process-tree cleanup to enumerate descendants even after the root PID naturally exits, and replace Windows-skipped descendant cleanup coverage with a platform-aware assertion.
- Add PTY bridge ready/error messaging after inner `Pty.spawn`, make parent creation wait for that message, and add a regression that inner spawn failure cannot return a running bridge session.
- Extend catalog resolver/catalog profile projection to pass expanded package MCP prompt/resource refs into public catalog summaries, and update resolver tests so catalog DTOs match active scheduler prompt/resource expansion.

Implemented repairs so far:

- Added root `.npmrc` with `tag=alpha` because npm 11 ignores workspace package-local `.npmrc` for `npm publish` but honors the workspace root config. Removed the attempted package-local SDK `.npmrc`.
- Added Browser Preview `targetRequestKey` tracking active task, directory, `refreshKey`, and explicit refresh token; `targetSelectionError` is cleared when that authoritative target request key changes.
- Extended Browser Preview browser coverage to reproduce a failed candidate selection, trigger board-driven `refreshKey` target refetch, pause the response, and assert loading appears without stale selection error.
- Expanded public catalog scheduler projection DTOs so active package summaries receive resolved package MCP tool, prompt, and resource refs, matching active scheduler capability projection.
- Changed shared Windows `Process.run`/`Process.spawn` cleanup so `terminate()` no longer returns early after root close. `ProcessSupervisor.terminateWindowsProcessTree` now uses `taskkill /T /F` when the root is alive and uses `wmic` parent-PID traversal only for root-exited descendant cleanup.
- Added PTY bridge protocol readiness: the bridge child emits `ready` only after inner `Pty.spawn` succeeds and emits `startup_error` before exit when inner spawn fails. Parent creation waits for this protocol readiness before returning a running `HostProcess`.

Validation so far:

- `bun test packages/opencorvus/test/script/sdk-build-format-contract.test.ts --timeout 30000` passed.
- `npm publish --dry-run --ignore-scripts --json` in `packages/sdk/js` passed and reported `tag alpha`.
- `bun test packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/expert-squad-scope.test.ts --timeout 30000` passed.
- `node test/browser-runner.mjs test/browser/browser-preview-evidence.test.ts` passed. Screenshot reviewed: `packages/overlay/.scratch/browser-preview-selection-error-refetch-loading.png`.
- `bun test packages/opencorvus/test/util/process.test.ts --timeout 30000` passed.
- `bun test packages/opencorvus/test/server/pty-routes.test.ts --timeout 30000 --test-name-pattern "Node PTY bridge"` passed.
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --timeout 180000` passed: 78 pass, 4 skip, 0 fail.
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --timeout 60000 --test-name-pattern "projects active package MCP prompts and resources as scoped runtime providers"` passed after the taskkill-first cleanup adjustment, with no cleanup error log.
- `bun run --cwd packages/sdk/js typecheck`, `bun run --cwd packages/overlay typecheck`, `bun run --cwd packages/opencorvus typecheck`, and root `bun typecheck` passed.
- `bun run api:routes-check` passed.
- `git diff --check` passed with only the existing CRLF warning for `packages/opencorvus/test/orchestrator/tools.test.ts`.

### Iteration 31

Status: Independent-agent findings accepted; repairs in progress.

Recall update:

- Iteration 31 launched after Iteration 30 repairs passed root/package typechecks, SDK raw publish dry-run with `tag alpha`, Browser Preview browser regression and screenshot review, shared util process tests, PTY focused tests, full prompt-profile-resolver validation, API route check, and diff whitespace check.
- Four read-only agents audited SDK/package delivery, GUI/overlay, lifecycle/process cleanup, and expert-squad/catalog/payload/contracts. They were instructed not to edit files, stage/commit/push, create worktrees, touch running OpenCorvus/overlay processes, or spawn subagents.

Agent feedback:

- Epicurus found that SDK `publish.ts` still explicitly passes `--tag ${Script.channel}`, overriding the new root npm `tag=alpha` default and allowing an alpha package to publish under the current branch tag.
- Faraday found Expert Squad settings can show a new directory/scope with old `Project active` / `Effective active` / `Selected squad` values while cross-scope catalog reload is loading.
- Curie found three lifecycle issues: shared Windows process cleanup can miss descendants if the root exits between the initial root-alive check and `taskkill`; LocalCLI/OpenTest PowerShell cleanup can abort on a stale PID before killing later descendants; VS Code visual screenshot capture uses unbounded synchronous PowerShell and can block the idle cleanup timer.
- Wegener found public catalog `squads[].capability_projection.agents` still exposes raw worker MCP server refs without typed tool/prompt/resource expansion, even though runtime worker capability and `active_agent_projection` use expanded refs.

Accepted findings:

- BUILD-26: SDK scripted publish must use the same npm tag source as raw publish and must not override root `.npmrc` with branch-derived `Script.channel`.
- GUI-44: Expert Squad overview values derived from catalog data must be scoped to the current catalog identity so cross-scope loading cannot display old active-state labels under a new scope.
- LIFE-62: Shared Windows process cleanup must handle root-exit races after the root-alive branch begins; descendant enumeration must run when `taskkill` finds the root already gone or leaves descendants behind.
- LIFE-63: LocalCLI and OpenTest Windows cleanup scripts must tolerate stale target PIDs and continue stopping remaining descendants.
- LIFE-64: VS Code visual screenshot capture must use a bounded PowerShell subprocess so screenshot capture cannot block the E2E idle cleanup path.
- PROJ-25: Public catalog worker projection DTOs must expand package MCP server refs into typed package MCP tool/prompt/resource refs with the same semantics as active worker projection.

Repair plan:

- Remove the explicit `--tag ${Script.channel}` override from SDK `publish.ts` and update SDK publish contract tests to require the root `.npmrc` tag source.
- Scope Expert Squad `catalog()` consumption with a catalog identity signal; during cross-scope loading, derived overview/list/projection values must read as empty until the matching catalog arrives.
- Change shared Windows cleanup to retry descendant enumeration when root cleanup races with natural exit, and keep the taskkill-first fast path for live roots.
- Change LocalCLI/OpenTest PowerShell cleanup `Stop-Process` calls to `-ErrorAction SilentlyContinue`, matching VS Code process-tree cleanup, then regenerate expert-squad payload.
- Add timeout to VS Code visual screenshot PowerShell `spawnSync`.
- Extend catalog profile/resolver to pass expanded worker package MCP refs into `capability_projection.agents`, and update resolver coverage for worker catalog DTO parity.

Implemented Iteration 31 repairs:

- Removed SDK scripted publish's explicit `--tag ${Script.channel}` override. Scripted publish now uses the same root `.npmrc` `tag=alpha` source as raw package-manager publish.
- Scoped Expert Squad settings catalog-derived overview/list/projection values through a `catalogIdentity` signal. During cross-scope loading or load failure, stale catalog values are hidden instead of being shown under the new scope.
- Changed shared Windows process cleanup so the live-root taskkill branch handles root-exit races: a taskkill miss caused by the root disappearing falls through to descendant enumeration, while normal taskkill success keeps the fast path.
- Changed Windows taskkill timeout handling to verify the target process state before reporting failure. If taskkill times out after the root already exited, cleanup proceeds to descendant scanning instead of logging a false MCP close failure.
- Changed LocalCLI and OpenTest Windows cleanup scripts to use `Stop-Process -ErrorAction SilentlyContinue`, so a stale PID cannot abort cleanup of later descendants.
- Added a timeout to VS Code visual screenshot PowerShell capture so screenshot capture cannot block the E2E idle cleanup path indefinitely.
- Expanded public catalog worker projection DTOs so `capability_projection.agents.*` receives typed package MCP tool/prompt/resource refs from the same `effectivePackageMcpRefs` semantics as runtime worker projection.
- Regenerated `packages/opencorvus/src/expert-squad/payload.ts` after the OpenTest runner source change.

Iteration 31 validation:

- `bun test packages/opencorvus/test/script/sdk-build-format-contract.test.ts --timeout 30000` passed.
- `npm publish --dry-run --ignore-scripts --json` in `packages/sdk/js` passed and reported `tag alpha`; the tarball inventory contained only `dist/**` and `package.json`.
- `bun test packages/overlay/test/expert-squad-scope.test.ts --timeout 30000` passed.
- `node test/browser-runner.mjs test/browser/expert-squad-panel.test.ts` from `packages/overlay` passed. Screenshots reviewed: `packages/overlay/.scratch/expert-squad-catalog-retry-loading.png` and `packages/overlay/.scratch/expert-squad-catalog-error-recovery.png`; loading/error states show `Project active`, `Effective active`, and `Selected squad` as `-`, with no stale catalog values.
- `bun test packages/channel-runtime/test/local-cli-stt.test.ts --timeout 30000` passed.
- `bun test packages/vscode-extension/test/e2e-process.test.ts --timeout 30000` passed.
- `bun test packages/opencorvus/test/util/process.test.ts --timeout 30000` passed after the taskkill timeout verification repair.
- `bun test packages/opencorvus/test/expert-squad/package-manager.test.ts --timeout 120000 --test-name-pattern "opentest payload exposes|payload source loading"` passed.
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --timeout 60000 --test-name-pattern "catalog active agent projection exposes"` passed.
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --timeout 60000 --test-name-pattern "projects active package MCP prompts and resources as scoped runtime providers"` passed with no MCP cleanup error log after the taskkill timeout verification repair.
- `bun run --cwd packages/sdk/js typecheck`, `bun run --cwd packages/overlay typecheck`, `bun run --cwd packages/channel-runtime typecheck`, `bun run --cwd packages/vscode-extension typecheck`, `bun run --cwd packages/opencorvus typecheck`, and root `bun run typecheck` passed.
- Full `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --timeout 180000` passed before the taskkill timeout verification repair, but emitted one `Failed to close MCP client` taskkill timeout log; this log was treated as a new cleanup finding and repaired rather than ignored.

### Iteration 32

Status: Independent-agent findings accepted; repairs in progress.

Recall update:

- Iteration 32 launched after Iteration 31 focused tests, raw SDK publish dry-run, Expert Squad browser visual review, package typechecks, root typecheck, docs health, API route check, and diff check. Full resolver rerun still emitted `taskkill.exe ETIMEDOUT` MCP close logs, so the taskkill path remains under repair.
- Four read-only agents were launched over SDK/package delivery, GUI/overlay, lifecycle/process cleanup, and expert-squad/catalog/contracts. They were instructed not to edit files, stage/commit/push, create worktrees, touch running OpenCorvus/overlay processes, or spawn subagents.

Accepted findings so far:

- SDK-LIFE-01: SDK `createOpenCorvusServer()` Windows PowerShell cleanup helper has no timeout. Startup timeout, abort, or close can therefore block forever before the bounded PID wait begins. This is distinct from LocalCLI/OpenTest/VS Code cleanup helper fixes because it lives in `packages/sdk/js/src/server.ts`.
- LIFE-65: Shared Windows `ProcessSupervisor` still treats `taskkill.exe` as the live-root cleanup authority. Full resolver validation repeatedly emitted `Failed to close MCP client` with `spawnSync taskkill.exe ETIMEDOUT`; the cleanup primitive itself is now the unstable layer. The repair must not add a second fallback path; Windows tree cleanup should use one bounded implementation based on parent-PID enumeration plus direct process termination.

Repair plan:

- Replace shared Windows process tree cleanup's `taskkill.exe` dependency with the existing bounded parent-PID enumeration and direct `process.kill` termination over root plus descendants, preserving descendant verification and root-exit behavior.
- Add/update process-supervisor regressions so the source no longer contains `taskkill.exe`, and Windows cleanup still enumerates descendants from the root before termination.
- Add bounded PowerShell cleanup behavior to SDK server `runWindowsPowerShellForProcessIDs`, matching the established LocalCLI/OpenTest pattern, and change stale target handling to `-ErrorAction SilentlyContinue`.
- Add SDK server tests that statically assert the cleanup helper timeout, runner kill, timer cleanup, and stale PID tolerant `Stop-Process` behavior.

Iteration 32 agent feedback:

- Locke found SDK-LIFE-01: SDK `createOpenCorvusServer()` Windows PowerShell cleanup helper had no timeout, so startup timeout, abort, or close could block forever before bounded PID waits.
- Feynman found GUI-45: Expert Squad settings only exposed worker capability projection through `active_agent_projection`, so selected inactive squads could not be inspected for worker tools/skills/MCP refs before activation even though the public catalog DTO contained the data.
- Pauli found lifecycle residuals: shared Windows ProcessSupervisor still used `taskkill.exe` as cleanup authority and could skip descendant verification on success; PTY bridge had a separate unbounded `taskkill.exe` cleanup path; MCP stdio cleanup skipped process-tree cleanup when the root process had already exited.
- Schrodinger found no new high-confidence expert-squad catalog/payload/projection bug after reviewing registry, manager, resolver, catalog schema/profile, payload source, OpenTest package, and projection single-source paths.

Implemented Iteration 32 repairs:

- Replaced shared Windows `ProcessSupervisor.terminateWindowsProcessTree` taskkill cleanup with a single bounded implementation: enumerate root descendants via parent PID, send direct `SIGTERM`, wait, then direct `SIGKILL` survivors and verify all targets exited.
- Changed MCP stdio cleanup to call `ProcessSupervisor.terminateProcessTree` whenever a tracked PID exists, even if the root process has already exited, so descendant ownership is not skipped.
- Changed PTY bridge Windows force kill to use `ProcessSupervisor.terminateProcessTree` instead of a separate raw `taskkill.exe` path.
- Added SDK server Windows PowerShell cleanup timeout and stale-PID tolerant `Stop-Process -ErrorAction SilentlyContinue` behavior.
- Added selected-squad `Agent Capability Projection` UI backed by `squad.capability_projection.agents`, so inactive squads expose worker skill/tool/MCP projection before activation.
- Added i18n labels and browser/static coverage for inactive Backend worker projection visibility.

Iteration 32 validation so far:

- `bun test packages/opencorvus/test/util/process.test.ts --timeout 30000` passed.
- `bun test packages/opencorvus/test/mcp/host-connection-lifecycle.test.ts packages/opencorvus/test/server/pty-routes.test.ts --timeout 60000 --test-name-pattern "host MCP lifecycle|Node PTY bridge"` passed.
- `bun test packages/sdk/js/test/server.test.ts --timeout 30000` passed.
- `bun test packages/overlay/test/expert-squad-settings-surface.test.ts packages/overlay/test/expert-squad-scope.test.ts --timeout 30000` passed.
- `node test/browser-runner.mjs test/browser/expert-squad-panel.test.ts` from `packages/overlay` passed; screenshot `packages/overlay/.scratch/expert-squad-settings-capability-projection.png` was reviewed and showed the new Agent Capability Projection row without overlap.
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --timeout 90000 --test-name-pattern "projects active package MCP prompts and resources as scoped runtime providers|projects active package worker MCP tools as scoped runtime providers"` passed with no `taskkill.exe ETIMEDOUT` cleanup log after the ProcessSupervisor repair.
- `bun run --cwd packages/opencorvus typecheck`, `bun run --cwd packages/sdk/js typecheck`, and `bun run --cwd packages/overlay typecheck` passed.
- `bun run api:routes-check` passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts --timeout 60000` passed after adding the README-linked `2026-07-07-dependency-contract-single-source-repair.md` record to the git index.
- `git diff --check` passed with existing CRLF warnings only.

### Iteration 33

Status: Independent-agent findings accepted; repairs in progress.

Recall update:

- Iteration 33 launched after Iteration 32 repaired shared `ProcessSupervisor`, MCP stdio cleanup, PTY bridge cleanup, SDK server cleanup, inactive worker projection entry, focused resolver validation, package typechecks, API route check, docs health, and diff check.
- Four read-only agents audited lifecycle/process cleanup, GUI/overlay, SDK/package delivery, and expert-squad/catalog/payload contracts. They were instructed not to edit files, stage/commit/push, create worktrees, touch running OpenCorvus/overlay processes, or spawn subagents.
- Full-repo grep before repair covered `taskkill.exe`, `killWindowsProcessTree`, `terminateChildTree`, `releaseExistingPackageMap`, `direct package roots are not supported`, `package_mcp_server_refs`, `capability_projection.agents`, `Agent Capability Projection`, `route-policy`, `GenerationTransaction`, and `transaction`.

Agent feedback:

- Laplace found LIFE-66: acceptance inactivity timeout, Browser Node sidecar, Browser MCP node launcher, and isolated Bun runner still call raw `taskkill.exe` directly, bypassing the new shared Windows process-tree cleanup source.
- Fermat found GUI-46: the new inactive `Agent Capability Projection` entry shows skill/tool/MCP counts but hides concrete skill/tool/MCP refs whenever MCP refs are present.
- Singer found two expert-squad contract issues: payload release currently rejects stale direct-child roots before installing namespaced payload packages, and inactive catalog summaries still use lightweight catalog packages that lack MCP inventory sets, so `package_mcp_server_refs` cannot expand into typed MCP refs for inactive project squads.
- Mendel found two SDK delivery issues: `.npmrc` and `packages/sdk/js/src/route-policy.ts` are not in the git index even though current SDK publish/client code depends on them, and SDK build still commits `dist`/`src/gen` before `defaults.ts`/`route-policy.ts`/root `openapi.json`, so a late file-write failure can leave split-version generated output.

Accepted findings:

- LIFE-66: Windows process-tree cleanup must have one implementation source for these runtime/test harness paths; local raw `taskkill.exe` helpers must be removed from acceptance inactivity, Browser Node sidecar, Browser MCP launcher, and isolated Bun runner.
- GUI-46: inactive worker capability projection must expose concrete ref rows, not only counts, including MCP-bearing projections.
- PAYLOAD-14: Explicit payload release must not be blocked by stale direct-child package roots; direct roots remain invalid for discovery/catalog but release should install missing namespaced payload packages without treating stale legacy roots as existing payload targets.
- PROJ-26: Public catalog inactive project squads must be loaded with the same MCP inventory needed to expand `package_mcp_server_refs` into typed package MCP tool/prompt/resource refs.
- SDK-31: SDK delivery files required by current client/publish semantics must be tracked in the git index.
- SDK-32: SDK build generated outputs must commit as one transaction after validation, so failure after validation cannot leave mixed generated versions.

Repair plan:

- Replace local raw Windows cleanup helpers with the shared `ProcessSupervisor.terminateProcessTree` where production code can import it, and with a bounded direct-enumeration helper where test harness code cannot import package internals without creating package cycles.
- Update static/lifecycle tests so old `taskkill.exe` contracts fail and the new cleanup source is asserted.
- Expand inactive agent projection UI rows to list concrete projection refs for all non-empty ref groups while keeping compact counts.
- Load full project packages for catalog summaries when package MCP inventory is needed, so inactive DTOs use the same expansion semantics as active DTOs.
- Change payload release existing-package mapping to enumerate only valid namespaced package roots and ignore stale direct-child roots for payload provisioning, while keeping registry discovery strict for normal catalog paths.
- Change SDK build to stage all generated outputs in one validated transaction and mirror `dist`, `src/gen`, `src/defaults.ts`, `src/route-policy.ts`, and root `openapi.json` only after all staging is complete.
