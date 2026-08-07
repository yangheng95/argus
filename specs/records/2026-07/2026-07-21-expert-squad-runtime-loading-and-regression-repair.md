# Expert Squad Runtime Loading and Regression Repair

Date: 2026-07-21
Status: completed

## Recall

### User requirements

- Check all Expert Squad packages and their infrastructure rather than treating the packaged `typescript` error as an isolated copy omission.
- Repair all proven non-Mirror-Prism problems.
- Treat Mirror Prism as an upstream scheduling system that contains Watch and MirrorTest concepts; do not modify, dissolve, port, or otherwise operate on Mirror Prism in this task.

### Acceptance criteria

1. A compiled standalone OpenCorvus runtime can prepare and execute an Expert Squad package tool with MirrorTest's `import * as ts from "typescript"` shape without resolving a bare package from a `blob:` URL.
2. Package-tool execution has one module publication/loading model; no blob/file fallback, temporary-directory resolution trick, `NODE_PATH`, current-working-directory dependency, or parent-package probing is added.
3. Frontend Innovate and Frontend Replica authoring-source tests resolve the official `@opencorvus-ai/plugin` package through a declared repository test/runtime boundary instead of an incidental ancestor `node_modules`.
4. Expert Squad Skill tests match the current canonical unknown-frontmatter strip semantics and do not restore retired `mounted_agents` behavior.
5. Scheduler/session regressions pass the explicit project directory and session-owned MCP connection owner required by the current production contracts.
6. Registry, Manager, Resolver, payload generation, authoring packages, Overlay catalog/lifecycle, packaged runtime, document health, and typecheck pass with Mirror Prism package tests explicitly excluded.
7. No running OpenCorvus/Overlay process is stopped, restarted, refreshed, or reused for validation.

### Hard constraints

- Do not modify `expert-squads/hermes/mirror-prism/**` or its package-specific tests.
- `prompt_profile.active` remains the only active Expert Squad source and `PromptProfileResolver` remains the only runtime projection owner.
- Preserve immutable sidecar payload publication; runtime-generated modules must not be written into the extracted sidecar directory.
- Preserve content-addressed package-tool integrity and owner isolation.
- No fallback loading, alias identity, host routing gate, state machine, hidden message, or second package dependency source.
- Preserve unrelated untracked `.DS_Store` files unless one directly prevents a required repository check; any removal must be reported.

### Material read

- `AGENTS.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-17-all-expert-squad-runtime-audit.md`
- `specs/records/2026-07/2026-07-16-expert-squad-package-tool-runtime-dependencies.md`
- `specs/records/2026-07/2026-07-20-skill-unknown-frontmatter-ignore.md`
- `specs/records/2026-07/2026-07-21-task-expert-squad-selector-live-discovery.md`
- all six current manifests and the complete `src/expert-squad`, `test/expert-squad`, Overlay Expert Squad, package build, session runtime-contract, and package runtime resolver surfaces.

### Whole-repository inventory and grep

- Runtime identities: built-in `general`, plus repository packages `frontend-innovate`, `frontend-replica`, `mirror-prism`, `mirror-watch`, and `opentest`.
- Non-Mirror-Prism package inventory: 49 dynamic Agents, 10 virtual workflows, 8 package tools, and 26 unique package Skills. No repository package declares package MCP servers or typed package MCP capabilities.
- The repository-wide Expert Squad/projection search produced approximately 900 current production, test, Overlay, and architecture references.
- Bare executable package imports were enumerated across every authoring-source TypeScript file. `@opencorvus-ai/plugin` is used by Frontend Innovate, Frontend Replica, Mirror Prism, Mirror Watch, and MirrorTest tools; MirrorTest additionally imports `typescript` from its protocol engine.
- Direct authoring-source imports exist in Frontend Innovate, Frontend Replica, and Mirror Watch tests. Only the first two currently traverse files importing `@opencorvus-ai/plugin`; the root workspace has no `node_modules/@opencorvus-ai/plugin`, while `packages/opencorvus/node_modules/@opencorvus-ai/plugin` exists.

### Initial evidence

- Full Expert Squad suite: 342 passed, 1 skipped, 6 failed. Excluding the independently passing Mirror Prism isolated test, the deterministic failures are four authoring-source module-resolution errors and one stale Skill assertion.
- Repository-wide resolver/provider preparation passes for all packages and every declared package tool, proving the active projection chain itself is intact in source Bun.
- Package build and compiled Overlay health tests pass, but the compiled health test only starts the server and embedded UI; it never runs an Expert Squad package tool.
- Current `PackageToolBundle.importPrepared` still converts verified disk bytes to a `blob:` URL. `typescript` is deliberately external in the generated tool bundle, so standalone resolution has no filesystem importer root.
- Frontend authoring-source failures reproduce independently.
- The stale `mounted_agents` assertion reproduces independently; canonical Skill and Manager tests prove unknown fields are now stripped.
- Two session regressions reproduce independently: cancellation omits the known directory after leaving `Instance.provide`, and the worker runtime fixture omits the required session-scoped MCP owner.
- Typecheck passes. Document health has one unrelated filesystem-metadata failure because `specs/.DS_Store` exists.

### Independent Agent feedback

- None. The user did not request independent Agents for this repair, and current collaboration policy does not authorize delegation.

## Root causes and call-point disposition

| Surface                                                  | Root cause                                                                                                                                                                                                                                                                                                             | Disposition                                                                                                                                                                                                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PackageToolBundle.prepare/importPrepared/publishBundle` | A real content-addressed `.mjs` is published to the system temporary directory, then discarded as an importer identity by converting its bytes to `blob:`. External bare imports therefore have no packaged module-resolution tree.                                                                                    | Publish the content-addressed module under the existing OpenCorvus writable versioned cache, compile each allowlisted package import into that same verified tool closure, and import the verified module by `file:` URL.                           |
| `build-artifact.ts` runtime dependency list              | Copying `typescript` is necessary for source validation/compilation but insufficient for executing a blob importer.                                                                                                                                                                                                    | Keep the packaged dependency because `prepare()` uses it; add compiled execution evidence instead of weakening strict runtime resolution.                                                                                                           |
| Frontend authoring-source tests                          | Tests import repository-root package files directly, but their official Plugin dependency was declared only by the OpenCorvus package and could not be found by ascending from `expert-squads/**`. The React lifecycle test also read Bun's private package-cache layout and relied on incidental transitive packages. | Declare the repository authoring/test dependencies at the root workspace boundary, use the canonical package-copy fixture for installed package paths, and resolve React through the public module resolver. No source-code fallback is introduced. |
| Dynamic Agent Registry Skill assertion                   | The test predates the 2026-07-20 canonical unknown-frontmatter strip contract.                                                                                                                                                                                                                                         | Assert that `mounted_agents` is absent from the prepared Skill while supporting-file snapshots remain immutable.                                                                                                                                    |
| Standby cancellation test                                | `SessionPrompt.cancel` correctly needs a directory outside `Instance.provide`; the fixture omits the known directory.                                                                                                                                                                                                  | Pass the exact test project directory.                                                                                                                                                                                                              |
| Projected Browser MCP fixture                            | `projectWorkerTools` correctly requires a session-scoped connection owner; the shared test fixture was not updated when ownership became mandatory.                                                                                                                                                                    | Create one fixture-owned scoped owner, bind it into projection/runtime resources, and close it after the test-owned runtime settles.                                                                                                                |
| Build and manager subprocess tests                       | Bun executes tests in a file concurrently and may terminate a long-running child as a dangling process when a sibling test completes. This killed the packaged OpenClaw copy and cleanup-failure fixtures while both passed alone.                                                                                     | Keep the packaging copy child synchronously owned, run the heavyweight build suite serially, separate compiled artifact probes by file, and validate the manager cleanup fixture in its own invocation.                                             |
| Mirror Prism                                             | Explicitly outside current authorization.                                                                                                                                                                                                                                                                              | No modification, no acceptance claim, no Agent Team dissolution.                                                                                                                                                                                    |

## Implementation plan

1. Generalize package-tool content-addressed publication around `Global.Path.cache`, compile allowlisted package imports into the deterministic tool closure, and import the verified tool through `pathToFileURL`.
2. Add a real `bun build --compile` probe that runs the package-tool path with an MirrorTest-shaped `import * as ts from "typescript"` tool from an isolated packaged directory and isolated `OPENCORVUS_HOME`.
3. Repair Frontend Innovate/Replica authoring-source test imports through the OpenCorvus-owned dependency boundary.
4. Align the stale Skill regression and both session fixtures with current canonical contracts.
5. Run focused tests, then the full non-Mirror-Prism Expert Squad suite, packaged runtime tests, Overlay Expert Squad tests, typecheck, document health, and diff review.
6. Update this record with final evidence, commit with `dsw-33987`, and push the current main delivery branch to `legacy-remote`.

## Final evidence

- `PackageToolBundle` no longer creates or imports a `blob:` URL. It verifies the published bytes and imports the content-addressed cache file with `pathToFileURL`; TypeScript is bundled into the same closure while the packaged runtime still supplies TypeScript to the runtime compiler.
- The standalone compiled probe built and ran from an isolated release directory and isolated `OPENCORVUS_HOME`, returning `{ "bundleProtocol": "file:", "typescriptVersion": "5.8.2" }`.
- Frontend Innovate and Frontend Replica authoring-source tests: 24 passed. Direct package installation now uses the canonical repository fixture; React 19.2.7 and React DOM 19.2.7 are explicit root development dependencies resolved through `createRequire`.
- Session runtime contract and wake tests: 47 passed. Cancellation carries the known directory, and replacement runtime contracts preserve one session-owned MCP connection owner.
- Non-Mirror-Prism Expert Squad sweep: 377 passed and 1 skipped in the combined run; the single Bun child-cleanup collision was then verified as 58 passed plus 1 skipped for the manager remainder and 1 passed for the isolated cleanup fixture. Mirror Prism tests and sources were not modified.
- Packaging: 48 build-artifact tests passed, the compiled Overlay artifact probe passed, and the compiled Expert Squad package-tool artifact probe passed.
- Server and Overlay Expert Squad catalog/lifecycle tests: 49 passed.
- Repository checks passed: `bun run typecheck`, `bun run docs:check`, `bun run api:routes-check`, the historical docs link suite (21 passed), and `git diff --check`.
- No OpenCorvus or Overlay process was stopped, restarted, refreshed, or reused for validation.
