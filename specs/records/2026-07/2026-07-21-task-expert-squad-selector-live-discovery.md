# Task Expert Squad Selector Live Discovery

Date: 2026-07-21
Status: Implemented and verified
Owner: Codex with one independent read-only cross-check

## Recall

### User requirement

- Explain why Task `tsk_f847cda240017UmWvf9BfprJuU` reported that no specialist Expert Squad was available even though Expert Squads had been installed.
- Use an independent Agent to cross-check the causal analysis.
- Repair the proven discovery and reasoning defects without restarting or refreshing the running OpenCorvus process.

### Acceptance criteria

1. `expert_squad_selector` lists every currently projected inactive Expert Squad without keyword filtering.
2. Exact selector loading remains strict and returns the complete current `selector.md` instructions.
3. A selector tool created before an Expert Squad is installed discovers that package when the tool executes after installation, without rebuilding the Orchestrator tool table or restarting the Task.
4. An empty list is an exact current catalog result with an explicit count, not the result of an undocumented all-keywords search.
5. The Orchestrator prompt forbids treating a failed exact load or an earlier empty result as proof that no specialist exists; it must enumerate the live selector catalog before making that claim and may reconsider selection at later delivery phases.
6. Active production prompts, tools, skills, MCP capabilities, dynamic Agent identities, and `prompt_profile.active` remain fixed until the existing `select_expert_squad` transition schedules the next wake.
7. Focused selector, scheduler projection, prompt hygiene, typecheck, document-health, and historical-link tests pass.

### Hard constraints

- Preserve `PromptProfileResolver` as the single catalog and projection owner.
- Do not add a host keyword classifier, routing gate, fallback catalog, install shadow state, synthetic message, hidden wake, or a second active Expert Squad field.
- Do not make package installation implicitly activate a profile.
- Do not restart, stop, or refresh the user's running OpenCorvus or Overlay processes.
- Do not alter unrelated untracked `.DS_Store` files.

### Evidence read

- Runtime SQLite rows for Task `tsk_f847cda240017UmWvf9BfprJuU`, root session `ses_07b8325d3ffexgdDfqiOJfDiH4`, and Orchestrator session `ses_07b8324e0ffeFuU1qn5sKL94IP`.
- The recorded `expert_squad_selector` call used the query `PostgreSQL 17 Drizzle 数据库 schema migrations deterministic seed repository integration tests integrity review`, returned `{"selectors":[]}`, and was followed by the unsupported statement that no specialist Expert Squad existed.
- The current live session catalog contains `general`, globally installed `frontend-replica` and `mirror-watch`, and project-installed `frontend-innovate` and `opentest`.
- External package filesystem creation times were later than the Task wake and selector call. This supports, but does not alone prove, that the wake-owned selector snapshot predated installation.

### Architecture and historical records read

- `AGENTS.md`
- `specs/current/architecture/01-agents.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-17-all-expert-squad-runtime-audit.md`
- `specs/records/2026-07/2026-07-17-composer-install-more-expert-squads-option.md`
- `specs/records/2026-07/2026-07-21-settings-extension-runtime-repairs.md`

### Whole-repository grep evidence

- `rg -n "createExpertSquadSelectorTool|expert_squad_selector|select_expert_squad|selectorSkills|selector_skills" packages/opencorvus/src packages/opencorvus/test specs`
- `rg -n "installExpertSquad|install-payload|importExpertSquad|release-payload|markExpertSquadCatalogStale" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test`
- `rg -n "dispatchTaskLoop|continuation.*wake|task.*wake|task.completed|task.failed|task.cancelled" packages/opencorvus/src packages/opencorvus/test`
- Production creation has one owner: `packages/opencorvus/src/orchestrator/agent.ts` calls `createOrchestratorTools` once per wake.
- `createOrchestratorTools` has 171 test/production call sites. Its selector input is used only to construct `expert_squad_selector`, so that input can be replaced directly by one live resolver without retaining a second snapshot source.
- Direct `createExpertSquadSelectorTool` coverage exists in `runtime-contract-tools.test.ts` and `tools.test.ts`.

### Independent Agent feedback

The independent read-only Agent rejected the initial claim that the all-keywords matcher was proven to be the sole direct trigger. It established three separate facts:

1. The historical empty result was immediately overgeneralized into catalog absence.
2. Package creation times postdated the wake-owned projection, so a stale captured selector array is the strongest historical timing explanation, while the exact historical array contents remain unknown.
3. The `terms.every(...)` matcher is independently defective because the recorded mixed-language query cannot match MirrorTest's short name and description even after installation.

The Agent also confirmed that General is appropriate for the initial database implementation, while MirrorTest should be reconsidered for the explicit integration-test, evidence-review, and release-judgment phases.

## Root cause

`Orchestrator.processTask` resolves `PromptProfileResolver.resolveSchedulerTurnProjection` once at wake start and passes the resulting selector array into `createOrchestratorTools`. `createExpertSquadSelectorTool` closes over that array for every model step in the wake. Packages installed later are visible to the canonical Registry and HTTP catalog but remain absent from the captured array.

The same tool then splits an arbitrary query on whitespace and requires every term to occur in the selector name plus one-line description. This host-side keyword gate discards relevant selectors and returns an unqualified empty array. The prompt does not require catalog enumeration or distinguish a search miss from catalog absence, so the model converted one empty result into a false global claim.

## Call-point disposition

| Call point                                               | Disposition                                                                                                                                                                                                           |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orchestrator/agent.ts::processTask`                     | Keep the fixed scheduler/worker capability projection; add a task-scoped live selector resolver that rereads effective config, directory, and `PromptProfileResolver.resolveSkillProjection` when discovery executes. |
| `orchestrator/tools.ts::createOrchestratorTools`         | Replace the captured selector-array input with the live selector resolver and pass it only to the selection-only discovery tool. Do not use it to mutate the fixed production tool table.                             |
| `orchestrator/tools.ts::createExpertSquadSelectorTool`   | Replace keyword search with complete enumeration and exact-name loading. Return `selector_count` with the list. Resolve selectors on every execution.                                                                 |
| `prompt/core/orchestrator-core.txt`                      | Require live enumeration before claiming absence and phase-aware reconsideration; keep exact selection through `select_expert_squad`.                                                                                 |
| `prompt-profile-resolver.ts`                             | Preserve as the only discovery/projection implementation; no new scan or cache is introduced.                                                                                                                         |
| Expert Squad install/import/update routes and Manager    | Preserve atomic package writes. No install-specific Task wake is added because live selector discovery observes the canonical Registry directly.                                                                      |
| Overlay refresh token and terminal Task SSE invalidation | Preserve as the UI catalog invalidation path; it is not a Task scheduler projection source.                                                                                                                           |
| Existing tests                                           | Replace captured-array selector fixtures with explicit live resolver fixtures where `createOrchestratorTools` is constructed; add late-install and no-keyword regressions.                                            |

## Implementation plan

1. Change the selector discovery contract to an asynchronous live resolver, complete list, and strict exact load.
2. Wire production discovery to the current root session's effective config and directory through `PromptProfileResolver.resolveSkillProjection`.
3. Update the core Orchestrator selection instructions and prompt-hygiene assertions.
4. Add regressions proving a long domain query is no longer accepted by the schema, enumeration exposes MirrorTest, and a package installed after tool creation appears on execution.
5. Update current architecture and document indexes, then run focused and repository-required verification.

## Verification commands

```text
bun test packages/opencorvus/test/session/runtime-contract-tools.test.ts
bun test packages/opencorvus/test/orchestrator/tools.test.ts
bun test packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts
bun test packages/opencorvus/test/agent/core-prompt-hygiene.test.ts
bun run typecheck
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
git diff --check
```

## Verification results

- Selector runtime, tool-description, and prompt-hygiene suite: 38 passed, 0 failed.
- Scheduler capability projection suite: 17 passed, 0 failed.
- Full Orchestrator tools suite: 131 passed, 0 failed.
- General projection, wait-tool, and integrity artifact-recovery fixture checks: 10 passed, 0 failed.
- Historical-link and document-health suites: 103 passed, 0 failed.
- `docs:check`: 285 operations across 23 groups are clean.
- `api:routes-check`: 6 rules across 31 route files are clean.
- Repository typecheck: 9 tasks passed.
- `git diff --check`: clean.

An additional aggregate run exposed three existing A2A conversation-route failures around the missing `orchestrator_wake` response field and one downstream null payload. The only change in that test file is the required `createOrchestratorTools` argument rename from a captured selector array to an asynchronous selector resolver; the focused Orchestrator selector and tool suites above pass. These A2A failures are recorded as separate baseline evidence and are not represented as selector acceptance coverage.
