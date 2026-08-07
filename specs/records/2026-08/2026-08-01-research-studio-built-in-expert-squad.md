# Research Studio built-in Expert Squad

Status: implemented and verified on 2026-08-01.

## Recall

### Operator request

- Promote Research Studio to a true built-in Expert Squad.
- Preserve its current five research identities and three binding research workflows.
- Do not retain a second installable payload copy.

### Acceptance

- `research-studio` is embedded through `builtInPackageSources` beside Base and Advanced and resolves without project/global installation.
- The repository release package under `expert-squads/builtin/research-studio` is removed rather than retained as a duplicate source.
- Generated payload, market/release behavior, Registry/Resolver catalogs, tests, public documentation, and current architecture agree that Research Studio is built in and not provisioned.
- Base remains the default active Expert Squad; promoting Research Studio does not change selection defaults.
- The existing direct-writing, evidence-synthesis, and full-research workflow graphs and all five mature adapter roles remain exact.
- Non-User-Interface contracts pass. The real Overlay catalog shows three built-in squads; no User-Interface automation test is added, modified, or run.

### Hard constraints

- Preserve unrelated dirty-worktree changes and stage only this task's files or exact hunks.
- Keep one package source: move the self-contained package into the embedded built-in tree and remove it from payload discovery.
- Do not add alias, fallback, migration, hidden active state, workflow state, or Host scheduling gates.
- Commit subjects start with `dsw-33987` and push `v0.0.27beta` to `legacy-remote`.

### Read material and whole-repository search

- Read the embedded built-in loader, Research Studio manifest/README/selector/agent overlays, payload generator, Manager release path, Registry/Resolver tests, package test, generated payload, public docs, and current architecture records.
- Whole-repository searches covered `research-studio`, `Research Studio`, `builtInPackageSources`, `payloadPackageSources`, release/market expectations, repository package enumeration, and built-in catalog assertions.

| Surface | Disposition |
| --- | --- |
| `expert-squads/builtin/research-studio/**` | Move the exact package closure into `packages/opencorvus/src/expert-squad/builtin/research-studio/**`; do not retain the release copy. |
| `packages/opencorvus/src/expert-squad/builtin/index.ts` | Add the canonical ID, embedded text imports, and one built-in source entry. |
| Generated payload and Manager tests | Remove Research Studio from payload/market/release expectations while retaining all other packages exactly. |
| Registry/Resolver/package tests | Assert three built-ins and resolve Research Studio directly from the embedded source without installation. |
| Current architecture, public docs, and principles | Name Base, Advanced, and Research Studio as the complete embedded built-in set. |
| Overlay | Verify through the real catalog page that three built-in squads appear and Base remains effective active. |

## Verification

- Focused Research Studio, Registry, Resolver, payload generation, package manager, and route contracts.
- Repository typecheck, API route check, documentation check, internationalization check, secret scan, and `git diff --check`.
- Real Overlay catalog inspection and manually viewed screenshot; no User-Interface automation test.
- Second review of the staged diff and remote equality after push.

### Recorded results

- Focused built-in, Research Studio, Base, Advanced, Registry, Resolver, payload-generation, package-manager, repository-package, and route contracts passed. The primary combined run reported 97 passing tests and 829 assertions; the extended Resolver/Manager/route run passed after updating the complete three-built-in selector projection.
- Research Studio loads directly from `builtInPackageSources` at version `2026.08.01.4`; its five projected Agents and three workflow graphs are unchanged.
- Payload discovery and release produce the exact remaining external package set, with no Research Studio payload entry.
- Real Overlay acceptance against an isolated port 18889 server showed `3 available`, Base as `Effective active`, and Research Studio as `Built-in` with five Agents. The Research Studio detail view listed Planner, Deep Researcher, Evidence Analyst, Fact Checker, and Report Writer; console warning/error output was empty.
