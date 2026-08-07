# Base Manifest Runtime Contract Repair

Date: 2026-08-01

Status: Implemented; task-owned contracts accepted.

## Recall

| Item                       | Details                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement           | Repair the OpenCorvus client conversation-send failure shown as HTTP 500 from `POST /coding/chat/session`, with Zod issues at the Base Planner and Base Developer `goal_concurrency` fields.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Acceptance criteria        | The embedded `base` package loads through the real Registry; both Base Agents expose the intended non-Goal concurrency metadata; both mandatory workflow nodes expose Task dispatch scope; the default Resolver projection materializes; the real right-sidebar Chat session-create route returns its positive success contract; focused non-UI tests, typecheck, route checks, documentation checks, and a second semantic review pass succeed; the task-owned commit is pushed to `legacy-remote`.                                                                                                                                                                      |
| Hard constraints           | Fix the canonical Base manifest rather than weakening the SDK schema, adding defaults, fallback parsing, compatibility logic, a Host gate, or a second projection source. Preserve the unrelated modified benchmark catalog. Do not create a worktree, reset the worktree, bypass hooks, restart the running OpenCorvus/Overlay process, add or run UI automation tests, or modify the client error dialog for a server contract failure. Commit subjects use `dsw-33987`.                                                                                                                                                                                          |
| Existing worktree          | Branch `work-v0.0.27beta-yr-0801` at `79be91d979`, equal to `legacy-remote/work-v0.0.27beta-yr-0801` after fetch. `specs/artifacts/opencorvus-workbuddy-qoderwork-multica-codex-benchmark-catalog.md` has an unrelated pre-existing modification and remains user-owned.                                                                                                                                                                                                                                                                                                                                                                                                  |
| Sources read               | Root and test `AGENTS.md`; the screenshot; Base manifest, README, prompts, selector, package test, and original Base implementation record; manifest-v1 SDK schema; Registry embedded loader; built-in package index; PromptProfileResolver; General manifest; current Expert Squad architecture; authoring Skill; right-sidebar conversation route and session constructor.                                                                                                                                                                                                                                                                                        |
| Whole-repository grep      | `goal_concurrency` and `dispatch_scope` are defined by `packages/sdk/js/src/expert-squad-manifest-v1.ts`, projected through Registry/Resolver/catalog/skill surfaces, and explicitly declared by every valid package. `base-planner`, `base-developer`, and `planner-development` have one product declaration source: `packages/opencorvus/src/expert-squad/builtin/base/expert-squad.jsonc`; their other references are prompts/docs/tests/index imports. `POST /coding/chat/session` is defined by `right-sidebar-conversation.ts`; existing positive route coverage is in `coding-routes.test.ts`. No alternate Base manifest or generated Base payload exists. |
| Independent Agent feedback | No independent Agent was requested. Current collaboration policy prohibits inferred sub-agent spawning; the primary Agent performs implementation and a separate final diff/test review.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## Evidence and cause

The client-visible 500 is reproduced by
`bun test packages/opencorvus/test/expert-squad/base-package.test.ts`. The real
Registry loader reports four schema failures:

- `base-planner.goal_concurrency` is absent;
- `base-developer.goal_concurrency` is absent;
- `planner-development.nodes.base-planner.dispatch_scope` is absent;
- `planner-development.nodes.base-developer.dispatch_scope` is absent.

Git history proves both fields were already strict manifest-v1 requirements in
`8316afb7de`, before Base was introduced by `6a8cbdfa1c`. The Base commit added a
handwritten embedded manifest and positive tests whose expected objects also
omitted the required metadata. The failure therefore is not a later schema
change and must not be repaired by compatibility parsing. The observable chain
is: the Chat request enters the project-bound conversation route; default
profile resolution enumerates embedded packages; `getLoadedBuiltInPackages()`
passes Base to `ExpertSquadRegistry.loadEmbeddedPackage()`; strict SDK parsing
rejects the incomplete Base declaration; the uncaught configuration error is
returned as HTTP 500 before the conversation can proceed.

Base is explicitly non-Goal and its workflow is Task-owned. Its correct v1
declaration is therefore `goal_concurrency: "single"` for each worker and
`dispatch_scope: "task"` for each workflow node. This records the existing
architecture; it does not add a new execution mechanism.

## Call-point disposition

| Surface                                                                                         | Disposition                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/expert-squad/builtin/base/expert-squad.jsonc`                          | Repair the sole Base declaration source with both required Agent concurrency values and both required node dispatch scopes; increment the package revision for the corrected declaration.                       |
| `packages/sdk/js/src/expert-squad-manifest-v1.ts`                                               | Preserve strict required schemas. No optional/default/fallback behavior.                                                                                                                                        |
| `packages/opencorvus/src/expert-squad/registry.ts`                                              | Preserve strict embedded-package parsing. It is correctly exposing the invalid package.                                                                                                                         |
| `packages/opencorvus/src/expert-squad/builtin/index.ts`                                         | Preserve the single embedded import path and cache. Correcting its imported manifest is sufficient.                                                                                                             |
| `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts` and catalog/skill projections | Preserve as consumers of the parsed manifest; verify their full positive Base projection.                                                                                                                       |
| `packages/opencorvus/test/expert-squad/base-package.test.ts`                                    | Strengthen the existing positive contract to require exact version, concurrency, and Task-scoped workflow nodes. Do not add absence assertions.                                                                 |
| `packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`                         | Replace stale selector-set expectations from the Base introduction with the complete current built-in selector catalog, retaining only positive projection contracts.                                           |
| `packages/opencorvus/test/server/coding-routes.test.ts`                                         | Preserve the existing positive session-create test and run its focused case as observable API coverage; no test rewrite is needed.                                                                              |
| Base README, prompts, selector, product docs, and current architecture                          | Preserve: they already define a non-Goal, Task-owned Planner-to-Developer workflow and require no semantic copy change.                                                                                         |
| SDK/OpenAPI/generated payloads                                                                  | Preserve: this repair changes a runtime-embedded package declaration, not an HTTP schema or distributable package payload source. Confirm via generator/status checks rather than hand editing generated files. |
| Client error dialog                                                                             | Preserve: it correctly displays the server failure. The server must stop producing the invalid configuration error.                                                                                             |

## Validation plan

1. Load Base through the real Registry and assert the complete positive Agent and
   workflow metadata.
2. Resolve the default scheduler, both worker capabilities, catalog projection,
   and projected concurrency values from an isolated project.
3. Run the focused positive `POST /coding/chat/session` route contract.
4. Run related Registry/Resolver tests, package typecheck, API route checks,
   documentation checks, historical-link and document-health tests.
5. Review the task-owned diff independently, confirm the unrelated benchmark
   catalog remains untouched, commit only owned paths, push to `legacy-remote`, and
   verify local/remote equality.

## Implementation outcome

- Corrected the single embedded Base manifest to declare
  `goal_concurrency: "single"` for `base-planner` and `base-developer`.
- Corrected the same manifest to declare `dispatch_scope: "task"` for both
  mandatory `planner-development` nodes.
- Incremented the corrected package declaration to `2026.08.01.2`.
- Strengthened the Base package test across Registry, worker capability,
  workflow, and catalog projection outputs.
- Repaired two stale Resolver selector-catalog expectations left by the Base
  introduction and removed their mixed negative assertions, leaving complete
  positive projection contracts.

## Validation evidence

- `bun test packages/opencorvus/test/expert-squad/base-package.test.ts`: 3 pass.
- Focused `coding-routes.test.ts` right-sidebar session create/claim contract:
  1 pass.
- Focused built-in Registry parser contract: 1 pass.
- Full `prompt-profile-resolver.test.ts` with elapsed timeout disabled: 25 pass.
- Full `prompt-profile.test.ts` with elapsed timeout disabled: 16 pass.
- Root `bun run typecheck`: 8 package tasks passed.
- `bun run api:routes-check`: 33-file route inventory clean.
- `bun run docs:check`: 311 operations across 24 groups clean.
- Prettier check and `git diff --check`: clean.
- Product-doc single-source suite: 8 pass. Document-health suite after exact
  staging: 62 pass.
- The historical-docs-links suite's index/readability contract passes. Its
  benchmark case-ID contract remains red because the pre-existing, user-owned
  benchmark catalog edit has replaced E01-E10/N01-N10 with a new numbered
  01-26 contract while the test still expects the former catalog. This repair
  does not modify or stage that concurrent work.
