# Multica simple-Squad import stability

## Recall

### Original request

Repair Multica import and use stability. Small source defects must not stop an otherwise usable expert squad, and the dominant simple-Squad case must not be forced through Goal, Requirements, Architect, or a synthetic virtual workflow. After implementation and verification, obtain an independent Agent review.

### Incident evidence

- An imported Multica package declared workflow nodes named `requirements`, `design`, and `coding`, but every generated Agent had `base_role: "delegated-worker"`.
- The delegated worker produced a document artifact titled as a spec snapshot, but no requirements adapter persisted the canonical task spec snapshot.
- `manage_task(add_goal)` correctly refused to append a Goal without the active spec and plan lineage.
- A final delegated-worker dispatch also missed `submit_delegated_worker_result`, leaving a secondary lifecycle symptom.

### Acceptance criteria

1. A Multica mapping explicitly binds every source Agent to one OpenCorvus runtime template; the generator no longer hardcodes every imported Agent to `delegated-worker`.
2. `virtual_workflows` remains an explicit manifest and mapping field but may be `{}`. A simple imported Squad can run by direct task-scoped dispatch without Requirements, Architect, Goal, or a fabricated dependency graph.
3. Existing complex imported workflows preserve exact nodes and dependencies while using the mapped typed adapters.
4. Human members and archived source entities remain visible provenance/advisory evidence and do not stop import by themselves.
5. A source MCP server may be excluded only by an exact, canonically sorted, digest-bound omission with a non-empty evidence reason. There is no generic ignore flag or silent drop.
6. Identity substitution, dangling graph references, cycles, unsafe Skill paths, redacted/ambiguous MCP configuration, credential copying, invalid canonical package data, and source/mapping drift remain zero-write failures.
7. The built-in import Skill chooses the smallest sufficient projection: direct delegated workers for ordinary routing squads; typed workflow adapters only when source evidence supports a fixed workflow contract.
8. Tests cover simple no-workflow import and Resolver projection, explicit requirements/architect mapping, exact MCP omission, retained hard failures, and generated package behavior.
9. Focused tests, typecheck, route/docs checks, documentation health tests, and a separate read-only Agent review pass before delivery.

### Hard constraints

- No runtime fallback, compatibility alias, inferred role keyword table, activation gate, hidden state, synthetic message, automatic Goal creation, or second package source.
- Do not weaken the active-spec/active-plan data-integrity checks in Goal lifecycle tools.
- Do not infer a typed adapter from workflow node names. The Agent-led import mapping owns the explicit decision.
- Do not restart, refresh, or stop the user's running OpenCorvus/Overlay.
- Preserve unrelated dirty worktree changes and commit only this task's files with the `dsw-33987` prefix.

### Landed material read

- `AGENTS.md`
- `specs/current/architecture/01-agents.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/99-principles.md`
- prior Multica import, remote MCP, repair-dialog, and confirmation records from 2026-07-14 through 2026-07-21
- Multica importer, tools, built-in Skill, Registry, Resolver, runtime-template registry, dispatch-adapter contracts, Goal lifecycle tools, and focused tests
- official Multica Squads, Skills, Agents, and CLI documentation

### Full-repository grep results

| Surface | Disposition |
| --- | --- |
| `MulticaOpenCorvusMappingSchema`, tool schemas, routes, OpenAPI, generated SDK | Replace `agent_goal_concurrency` with one explicit per-Agent runtime mapping; add exact MCP omissions; allow an empty workflow record; regenerate API artifacts. |
| `packageFiles()` in `multica-import.ts` | Materialize mapped `base_role` and concurrency, never a hardcoded role; preserve empty workflows. |
| `previewForSnapshot()` and MCP analysis | Reclassify human/archive facts as non-portable evidence; apply exact omission dispositions before capability probing; retain structural/security blockers. |
| `ExpertSquadVirtualWorkflowsSchema`, Registry topology tests | Keep `virtual_workflows` required as a single-source declaration but allow `{}`; preserve node/reference/cycle validation for non-empty graphs. |
| `PromptProfileResolver` and Orchestrator prompt composition | Preserve existing behavior: an empty workflow projection emits no workflow XML and direct projected-Agent dispatch remains available. |
| `goal-lifecycle-tools.ts` | Preserve active spec/plan integrity checks unchanged. |
| built-in `multica-import` Skill and generated payload tests | Replace mandatory workflow authoring with smallest-sufficient direct projection guidance and exact omission repair behavior. |
| Multica adapter, Registry, Resolver, route, SDK, Skill tests | Update the strict mapping shape and add direct-Squad, typed-workflow, omission, and retained-failure regressions. |

### Independent Agent feedback

The requested read-only reviewer found that the initial `mcp_omissions.source_server_name` schema used a trimming transform. That changed an exact source identity and made a declaration such as `" unavailable "` impossible to match. The implementation now preserves the source string byte-for-byte while separately rejecting blank-only values. Regression coverage uses a source key with leading/trailing spaces and also covers duplicate omissions, non-canonical ordering, and replace/omit conflicts.

After re-reading the repaired diff and rerunning 114 focused tests, the independent reviewer reported no remaining blocking finding and judged the acceptance criteria satisfied. The review specifically confirmed direct-Squad prompt behavior, explicit typed-adapter materialization, provenance-only human/archive handling, retained structural/security failures, digest binding, and absence of compatibility logic, generic ignore, gates, state machines, or a second source. The remaining non-blocking risk is intentionally model-owned: the import Agent must judge adapter semantics from source evidence; the host does not infer roles from keywords or workflow titles.

## Root cause

The importer conflates source routing membership with an OpenCorvus binding workflow. Its mapping requires a non-empty workflow while omitting runtime-template identity, and its materializer then assigns every imported Agent the generic delegated-worker adapter. This over-models ordinary Multica squads and under-specifies the rare workflow squad at the same time. Separately, a single prose blocker list treats provenance and transient peripheral capabilities like identity or security corruption.

## Design

### Smallest-sufficient Agent projection

The mapping owns one record per source Agent containing `base_role` and `goal_concurrency`. A simple Squad uses delegated workers and an explicit empty `virtual_workflows` object. The package Orchestrator can directly dispatch the exact projected Agent at task scope. Fixed workflows are authored only when the import Agent has concrete evidence for the stages and chooses matching typed adapters.

### Exact peripheral-resource disposition

`mcp_omissions` identifies one source Agent/server tuple plus a non-empty reason. The omission is validated against a real source declaration, recorded in preview and README evidence, and included in the mapping digest. It removes only that MCP projection; it never changes Agent identity, instructions, Skills, or workflow topology. Redacted configuration without exact server evidence cannot use this path.

### Diagnostic boundary

Human roster rows and archive timestamps describe Multica routing/runtime state, not OpenCorvus package corruption. They remain visible under non-portable evidence. Structural identity, graph, filesystem, credential, canonical-schema, and digest failures remain import blockers.

## Verification

1. Run focused Multica import, Skill, Registry, virtual-workflow, Resolver, and server-route tests.
2. Regenerate OpenAPI, SDK, and API docs and run route/docs consistency checks.
3. Run `bunx turbo run typecheck`.
4. Run `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` and relevant document-health tests.
5. Inspect the final diff for accidental compatibility logic, generic ignore behavior, keyword role mapping, or unrelated staged content.
6. Request an independent read-only Agent review, record findings here, repair any valid findings, and rerun affected verification.

### Results

- Focused Multica, Registry, Resolver, virtual-workflow, Skill, and delegated-worker suites: 125 passed, 0 failed.
- Multica importer after independent-review repair: 28 passed, 0 failed.
- Exact Multica catalog/preview/import server-route case: 1 passed, 0 failed.
- Generated JavaScript SDK tests: 35 passed, 0 failed.
- Historical links, document health, and product-doc single-source suites passed before a concurrent task added an indexed but untracked `2026-07-22-p0-server-settled-deletion-lifetime.md`; the repeat then reported 86 passes and that one unrelated tracking failure. This repair does not stage or commit the concurrent task's file.
- OpenCorvus TypeScript check, repository typecheck, API route consistency, documentation consistency, JavaScript SDK generation, and API documentation generation passed.
- The broad expert-squad directory run reached 430 passes but also exposed concurrent unrelated repository-package expectation drift for the newly present `review-debug` package and an existing cleanup-fixture process termination. Targeted output showed those failures outside the Multica files; this task did not absorb or stage that concurrent work.
