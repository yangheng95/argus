# Mirror Prism Unified Expert Squad

## Recall

| Item | Requirement or evidence |
| --- | --- |
| User requirement | The current Mirror Prism cluster is too redundant. Merge every agent used by the cluster delivery path into one new Expert Squad, reuse the existing package assets, and do not delete any existing squad yet. |
| Acceptance | Add one self-contained external package with manifest ID `mirror-prism-unified`; preserve the existing `mirror-watch`, `mirror-prd`, `mirror-design`, `mirror-code`, and `opentest` packages unchanged; project all and only the agents used by the cluster delivery workflows; expose exact generic and AInvest end-to-end workflows in one active profile; reuse the current prompts, Skills, tools, libraries, and assets through one strict package closure; prove Registry, Manager, Resolver, inactive isolation, workflow topology, payload generation, and SDK authoring behavior. |
| Hard constraints | `prompt_profile.active` remains the sole active Expert Squad source and `PromptProfileResolver` remains the sole projection owner. The new package has no cross-package runtime references, compatibility alias, fallback, host router, hidden state, optional workflow node, or second workflow engine. Generic and AInvest paths are separate immutable workflows. Existing packages and the existing Mission Skill remain available during this transition. No OpenCorvus or Overlay process is restarted or refreshed. |
| Existing architecture read | `specs/current/architecture/04-extensions.md`; `2026-07-22-mirror-prism-five-squad-dissolution.md`; `2026-07-22-mission-squad-stage-task-orchestration.md`; `2026-07-23-mirror-prism-source-capability-completion.md`; all five current package manifests, scheduler prompts, stage-agent prompts, Skills, tools, libraries, assets, focused package tests, Registry validation, Manager payload loading, PromptProfileResolver projection, and payload generation. |
| Whole-repository grep | `mirror-prism-cluster` is a built-in Mission Skill with generic/AInvest collaboration definitions; its delivery stages bind `mirror-prism-source-observation`, `mirror-prism-prd-stage` or `mirror-prism-ainvest-prd-stage`, `mirror-prism-design-stage`, `mirror-prism-code-stage`, and `mirror-prism-acceptance-stage`. Those workflows reference 29 unique agents: 3 Watch, 10 PRD, 5 Design, 5 Code, and 6 MirrorTest identities. Package refs are required to start with the active manifest ID, so a unified package must own a self-contained copied closure and rewrite refs instead of reading inactive packages. Payload discovery reads tracked `expert-squads/<namespace>/<id>` paths from the Git index. |
| Independent-agent feedback | None. The user did not request sub-agents or a parallel audit, so the primary agent performs the required second review. |
| Dirty-work boundary | The worktree already contains unrelated changes in runtime, Overlay, tests, and spec indexes plus one pre-existing local commit. This task will not overwrite them. Only the new package, its focused tests, generated payload delta, this record, and minimal index additions are eligible for this task's commit. |

## Design

Create `expert-squads/mirror/mirror-prism-unified/` as a new source package:

- Keep the 29 existing dynamic agent IDs so role ownership and evidence vocabulary remain recognizable.
- Copy only those agents' current prompts and their required agent-local Skill closures.
- Copy the shared Skills, tools, libraries, and assets required by the five cluster stages. Prefix shared Skill directory names by source package to avoid collisions, then rewrite manifest and textual package refs to `mirror-prism-unified/...`.
- Add one unified scheduler prompt. It chooses exactly one manifest workflow from explicit task scope, dispatches every declared node in dependency order, preserves page-disjoint Goal concurrency, and never changes the active squad during execution.
- Add `mirror-prism-generic` with PRD → Design → Code → MirrorTest and `mirror-prism-ainvest` with Watch → AInvest PRD → Design → Code → MirrorTest. Stage boundaries become ordinary graph dependencies inside one package; they are not persisted workflow state.
- Keep the old five packages and `mirror-prism-cluster` Mission Skill unchanged so users can compare and migrate deliberately.

## Exhaustive call-point disposition

| Surface | Disposition |
| --- | --- |
| Five existing manifests and package trees | Preserve unchanged. They remain independently selectable and are the source assets for this transitional unified package. |
| Cluster Mission Skill and four collaboration JSON files | Preserve unchanged. The new package is selected directly and does not masquerade as the existing cross-squad Mission launcher. |
| Six cluster stage workflow IDs | Read their exact nodes and dependencies as source evidence. Compose two new workflow IDs rather than retaining stage-local workflow IDs as competing entry points. |
| 29 referenced agent projections | Copy into the unified manifest, retain base roles/default tools/MCP surfaces/concurrency, rewrite only package-local refs and stage wording that incorrectly assumes profile switching or a separate stage Task. |
| Shared and agent-local Skills | Copy required closures into the unified package. Shared folders receive source-qualified names; agent-local MirrorTest Skill names remain under their unique agent owners. |
| Package tools, `lib/**`, and `assets/**` | Copy the current required implementations and their relative dependency closures. Rename colliding top-level tool IDs only if an actual collision is proven. |
| Registry and Resolver | Reuse unchanged. Focused tests load the real source package, install it with Manager, activate it through `prompt_profile.active`, and prove old-package resources are absent. |
| Payload generator | Stage the new authoring tree, regenerate the single generated payload, and verify freshness. |
| SDK authoring | Add a focused round-trip/validation test or extend the existing collaboration coverage so the complete source tree and immutable workflows are authoring-valid. |
| Documentation indexes | Add this record to `specs/README.md` and `specs/records/2026-07/README.md` without rewriting unrelated in-progress entries. |

## Implementation plan

- [x] Materialize the self-contained `mirror/mirror-prism-unified` package from current cluster-owned assets.
- [x] Author the unified scheduler, selector, README, and two exact immutable workflow graphs.
- [x] Adapt copied stage-planning prompts to one fixed unified Task while preserving domain and evidence boundaries.
- [x] Add focused source-package, workflow-topology, Manager/Resolver, inactive-isolation, and authoring regression tests.
- [x] Stage the new package and regenerate the Git-index-backed payload.
- [ ] Run focused tests, payload freshness, repository dynamic-package validation, SDK tests, required docs tests, typecheck, and `git diff --check`.
- [ ] Perform a second diff/evidence review, record validation results, commit with the `dsw-33987` prefix, and push the current main branch to `myhexin`.

## Validation plan

- `bun test packages/opencorvus/test/expert-squad/mirror-prism-unified-package.test.ts`
- `bun test packages/sdk/js/test/mirror-prism-unified-authoring.test.ts`
- Existing Mirror squad, collaboration, source-capability, payload, Registry/Manager, and dynamic-package tests affected by the new tracked package.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- Relevant document-health tests and both SDK/OpenCorvus TypeScript checks.
- `bun run packages/opencorvus/script/generate-expert-squad-payload.ts` followed by the payload freshness test.
- `git diff --check` and an explicit staged-file audit before commit.

## Validation evidence

- Registry source loading succeeds with manifest ID `mirror-prism-unified`, 29 exact cluster-workflow agents, 26 package Skills, five compiled package tools, and exactly two workflow IDs.
- The focused package and SDK authoring run initially passed 5 tests with 429 assertions, including real Manager import, Resolver activation, production Skill projection, coexistence with `mirror-prd`, and inactive isolation. After concurrent runtime edits made Manager imports fail before test execution, the unaffected Registry/topology/asset/planning subset passed 4 tests with 240 assertions and SDK round-trip passed with 202 assertions.
- The package test derives the expected agent set from the six current source stage workflows rather than trusting the new manifest's labels. It proves the union is exactly 29 identities, the generic graph has 25 mandatory nodes, the AInvest graph has 29 mandatory nodes, and phase boundaries are exact dependencies.
- Reused iFind/MirrorTest assets, selected package tools, and their library closures match the current source package bytes. Skill and prompt copies retain their domain content while package references and unified phase wording are intentionally rewritten.
- Git-index-backed payload generation produces one 197-file embedded package. Direct source and embedded Registry loads both report 29 agents and the exact two workflows. Payload freshness/discovery/embedding tests pass; the final broad payload import-build case is currently blocked by unrelated concurrent removal of `listLiveRunsForProject` from `engine/store.ts`.
- Existing Mirror Prism collaboration/source-capability and Mirror PRD/Design/Code SDK round-trip suites pass: 11 tests and 258 assertions.
- SDK TypeScript typecheck passes. Historical docs links pass 21 tests. Document health passes 81 of 82 tests; its only failure is an unrelated concurrent untracked record already linked from the July index. Targeted `git diff --check` passes.
- OpenCorvus TypeScript checking is currently blocked by the concurrent Task Run retirement worktree: old callers still reference removed `Run`, `runID`, `run_id`, run-status exports, and runtime functions. None of those files is changed by this task.

## Second review

- The first generated closure compiled iFind, PRD, and Design tools but failed MirrorTest bundling because a broad textual replacement changed `../lib/opentest/**` imports into `../lib/mirror-prism-unified/**`. The replacement was narrowed to package refs only; a real Registry load then compiled all five tools successfully.
- The first copied PRD workflow Skill still named four source-package workflow IDs that do not exist in the unified manifest, and its inherited prose treated AInvest as a default when team identity was missing. The unified copy now names only `mirror-prism-generic` and `mirror-prism-ainvest`, requires explicit AInvest identity, and treats a missing team as a blocker.
- The first Watch planning copy retained one standalone financial-research paragraph and cross-squad/Mission wording. It now owns only the AInvest source-observation phase inside the fixed unified Task and excludes only later-phase deliverables.
- The Code workflow's handoff named the separate existing MirrorTest squad. It now hands off to the MirrorTest phase in the selected unified workflow.
- A whole-package reference scan finds no old package-local runtime refs. The only `select_expert_squad` occurrence is the selector's explicit prohibition; the old packages and Mission cluster remain untouched.
