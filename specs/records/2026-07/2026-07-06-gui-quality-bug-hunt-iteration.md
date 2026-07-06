# GUI Quality Bug Hunt Iteration

Date: 2026-07-06
Status: Active iteration record
Owner: Codex

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
