# Multica global expert-squad storage

Status: In progress; the first remote implementation was rejected by exact-tree review.

## Recall

### Original request

把 Multica 导入的 Squads 默认存放位置改为全局 `.opencorvus` 目录，并通过测试证明导入结果可以跨项目使用。

### Acceptance criteria

1. Multica import writes the generated canonical package into the existing cross-platform global OpenCorvus configuration root, under `expert-squads/multica/<manifest-id>/`, rather than into the initiating project's `.opencorvus` tree.
2. Registry discovery and `PromptProfileResolver` expose that package from a different project, so the second project can catalog, select, and resolve the imported Squad without copying or re-importing it.
3. Multica catalog filtering treats a globally installed package as installed from every project.
4. Project-owned manual imports and bundled payload packages remain under `<project>/.opencorvus/expert-squads`; this task does not silently globalize all package operations.
5. Global/project duplicate manifest IDs fail visibly. There is no precedence fallback, alias, compatibility copy, or automatic migration of old project packages.
6. Focused Registry, Multica, Resolver, route, typecheck, document-health, diff, and second-review checks pass before a `dsw-33987` commit is pushed to `legacy-remote`.

### Hard constraints

- The user's `.openccorvus` spelling is normalized to the repository's canonical `.opencorvus` identity. The implementation reuses `Global.Path.config`, including `OPENCORVUS_HOME` and `OPENCORVUS_GLOBAL_CONFIG_DIR` overrides, instead of hard-coding a home-directory path.
- `expert-squad.jsonc` manifest `id` remains the only Squad identity and `prompt_profile.active` remains the only active selection source.
- `PromptProfileResolver` remains the only runtime projection owner; global storage adds no second resolver, hidden state, or synthetic message.
- No fallback, project-to-global copy, global-to-project copy, replacement, auto-activation, migration, gate, or state machine.
- Preserve unrelated dirty Overlay notification/diagnostic edits and build artifacts. Do not restart or refresh a running OpenCorvus/Overlay process.

### Sources read before implementation

- `AGENTS.md`
- `specs/README.md` and `specs/records/2026-07/README.md`
- `specs/current/architecture/01-agents.md`, `04-extensions.md`, `05-config.md`, and `99-principles.md`
- `specs/records/2026-07/2026-07-14-multica-expert-squad-import.md`
- `specs/records/2026-07/2026-07-15-multica-mission-multi-squad-parallel-import.md`
- `specs/records/2026-07/2026-07-16-multica-remote-mcp-import.md`
- `specs/records/2026-07/2026-07-16-multica-profile-long-path-and-catalog-identity-repair.md`
- `packages/opencorvus/src/global/index.ts`
- `packages/opencorvus/src/project/runtime-paths.ts`
- `packages/opencorvus/src/expert-squad/{manager,registry,multica-import,prompt-profile-resolver}.ts`
- `packages/opencorvus/src/project/instance.ts`
- `packages/opencorvus/src/server/routes/expert-squad.ts`
- Focused expert-squad, project-open, server-route, Overlay service, and document-health tests found by the repository searches below.

### Full-repository search evidence

Before this plan was written, repository-wide `rg` searches covered `multica`, `expert-squad`, `.opencorvus`, `ExpertSquadRegistry.discover`, every `ExpertSquadPackageManager` import/export/payload call, `PromptProfileResolver`, `ProjectRuntimePaths.projectConfigRoot`, `Global.Path.config`, `OPENCORVUS_GLOBAL_CONFIG_DIR`, all expert-squad routes, and matching tests/docs.

| Call point                                                  | Disposition                                                                                                                                                                                                                        |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expert-squad/multica-import.ts` catalog/preview/import     | Change catalog collision/filtering and final installation to the global package location while retaining the initiating project as the active resolution context.                                                                  |
| `expert-squad/manager.ts` import internals                  | Add one explicit global-directory import entry backed by the same atomic installer; retain project import/archive/payload entry points unchanged.                                                                                  |
| `expert-squad/registry.ts` `discover(projectDirectory)`     | Discover the canonical global and project package roots as one strict catalog; reject duplicate manifest IDs across roots.                                                                                                         |
| `expert-squad/prompt-profile-resolver.ts` discovery callers | Retain the resolver calls; global visibility arrives only through Registry. Rename project-only wording where it becomes inaccurate.                                                                                               |
| `project/instance.ts` bootstrap discovery                   | Retain the same call so project open validates both global and current-project packages.                                                                                                                                           |
| `server/routes/expert-squad.ts`                             | Retain route inputs and generated API shape; update descriptions that incorrectly say Multica is project-installed.                                                                                                                |
| Manager manual folder/archive/payload imports               | Retain project storage. They are outside the requested Multica default-storage change.                                                                                                                                             |
| Manager export                                              | Permit export of a Registry-discovered package from either canonical global or project root; retain strict containment validation.                                                                                                 |
| Overlay catalog/service consumers                           | Retain unchanged because their project-scoped request now receives the combined Registry catalog.                                                                                                                                  |
| Tests                                                       | Add real filesystem coverage with an isolated global-config override: import from project A, discover/filter/catalog/resolve from project B, and prove no package was written into either project. Update route target assertions. |

### Independent agent feedback

No independent sub-agent was started because the current execution policy permits delegation only when the user explicitly requests it. The primary agent performed the required full-repository inventory and will perform a separate post-implementation diff review.

## Causal analysis

Observable behavior: a Multica Squad imported in one project disappears from the expert-squad catalog after switching projects. Direct trigger: `MulticaExpertSquadImport.importSquad()` calls the project-scoped `ExpertSquadPackageManager.importDirectory()`. Deeper cause: both Manager target selection and Registry discovery derive the package root exclusively from `<project>/.opencorvus`; Resolver correctly trusts Registry and therefore cannot see packages outside the current project. Earlier Multica work preserved project isolation intentionally, so route/catalog fixes alone cannot solve cross-project reuse. The storage owner and Registry discovery contract must change together.

## Implementation plan

1. Introduce one package-location abstraction for canonical global/project config roots and discovery order.
2. Extend Registry discovery across those roots with strict global/project duplicate-ID rejection.
3. Reuse Manager's atomic source installer through an explicit global import entry; point only Multica import at it and make export containment location-aware.
4. Update architecture/route wording to describe global Multica storage and combined discovery without changing activation semantics.
5. Add cross-project filesystem/Resolver/catalog regressions and update exact route assertions.
6. Run focused tests, generated-contract checks if affected, typecheck, documentation checks, `git diff --check`, and an independent second diff review; then commit and push only task-owned files.

## Verification ledger

- `bun test packages/opencorvus/test/expert-squad/multica-import.test.ts packages/opencorvus/test/expert-squad/registry.test.ts packages/opencorvus/test/expert-squad/package-manager.test.ts packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts packages/opencorvus/test/server/expert-squad-routes.test.ts --timeout 90000`
  - Initial implementation run: 126 passed, one existing skip, zero failures.
  - The required second-review rerun exposed one missing `ProjectRuntimePaths` import after helper consolidation; the original route/archive/runtime-storage failures were retained as evidence and fixed at the import owner.
  - Final full rerun after the review fix: 127 passed, one existing skip, zero failures. This includes project A import, project B discovery/catalog filtering/Resolver projection/export, global target assertion, project zero-write assertion, and no-replacement behavior.
- `bun test packages/opencorvus/test/expert-squad/registry.test.ts --timeout 90000`: 55 passed, zero failures, including strict global/project duplicate manifest-ID rejection with both source paths in the diagnostic.
- `bun test packages/opencorvus/test/project/instance-cache.test.ts packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts --timeout 90000`: 114 passed, zero failures.
- `bun run --cwd packages/opencorvus typecheck`: passed.
- `bun run --cwd packages/sdk/js typecheck`: passed.
- `bun run api:routes-check`: passed with 31 route files clean.
- `bun run docs:check`: passed with 266 operations across 24 groups.
- `bun run script/generate.ts`: regenerated OpenAPI and SDK descriptions from the real route definitions; expert-squad payload and portable-template sources remained stable.
- `git diff --check`: passed before second review.

## Codex review feedback

The post-implementation diff review found that consolidating project/global staging helpers had removed the `ProjectRuntimePaths` import even though `assertSourceNotRuntimeInternal()` still owns the runtime-storage boundary. The review reran the full route/Manager suite, observed the real `ReferenceError` through isolated route output, restored the exact import, and retained the original safety check. It also removed the optional target-location default so every project/global import call now supplies its canonical location explicitly; there is no implicit location fallback. A cross-project export assertion was added so catalog visibility cannot hide a containment failure. No remaining P0, P1, or P2 issue was found in the reviewed task diff.

## 2026-07-17 Revised Recall: Generic Installation Scope

This section supersedes the earlier acceptance claim and implementation plan wherever they conflict. The
first remote implementation was reviewed against merge candidate `ba6db427b37d0e2bbc3562baace0c779df51f392`
by three one-layer, read-only agents. All three returned `REJECT`; therefore the earlier statement that no P0,
P1, or P2 issue remained was a false-green and is not acceptance evidence for the current tree.

### Revised user requirement

The platform must expose one generic expert-squad installation protocol. Multica is an ordinary caller that
chooses user-global installation; it is not a branded exception, a second package type, or an alternative
registry. Third-party callers must be able to choose project or user-global installation through the same
Manager, HTTP, OpenAPI and SDK contract. The three cancelled Frontend Replica, Mirror Watch and IWC/MirrorTest
real E2E runs remain outside this Goal; this installation slice is verified with static, unit, integration,
real-process concurrency and generated-contract tests.

### Revised acceptance criteria

1. `locations.ts` owns one required `project | global` installation-scope schema, type and path resolver.
2. Folder and ZIP imports use the same Manager methods and require an explicit scope; there is no default,
   inference, compatibility alias, `importGlobalDirectory` side entrance or Multica-only storage branch.
3. Registry, Manager imports, payload market/install/release and export observe one strict combined global plus
   current-project inventory. A duplicate manifest ID is rejected before either location is modified.
4. Installation serialization is keyed by manifest ID across target locations and backend processes. The lock
   is held while the combined inventory is re-read and the atomic package publication completes.
5. Folder sources inside either canonical installed/staging runtime root are rejected for both target scopes.
6. The canonical test preload always replaces inherited `OPENCORVUS_GLOBAL_CONFIG_DIR` with a process-owned
   temporary root before source imports; test cleanup cannot touch a developer's real global packages.
7. Existing Overlay manual folder/ZIP actions explicitly request `project`. The transport service does not
   invent a default. OpenAPI and generated SDK expose the required generic scope.
8. Multica calls the ordinary directory import with explicit `global`; its tool/skill/docs describe user-global
   installation and cross-project reuse rather than current-project installation.
9. The exact merge tree passes focused Manager/Registry/Resolver/Multica/routes/Overlay tests, a two-process
   same-ID race, generated freshness, typechecks, route/docs health, residue scans, diff checks and a new
   independent review before commit and push.

### Additional sources read

- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `packages/opencorvus/src/expert-squad/locations.ts`
- `packages/opencorvus/test/preload.ts`
- `packages/opencorvus/src/global/index.ts`
- Existing Sidecar, Worktree, atomic-filesystem and protocol lease lock implementations and their tests.

### Revised full-repository call-point disposition

Repository searches covered `importGlobalDirectory`, every `importDirectory`, `importArchive`,
`releasePayloadPackages`, `installPayloadPackage`, `payloadMarket`, `ExpertSquadRegistry.discover`,
`OPENCORVUS_GLOBAL_CONFIG_DIR`, package install locks, HTTP schemas, generated OpenAPI/SDK, Overlay service and
panel callers, Multica prompts/tools, portable template/docs and all direct Manager tests.

| Surface                                            | Required disposition                                                                                                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `expert-squad/locations.ts`                        | Own the required installation scope and resolve it to the canonical global or project location.                                                                             |
| `expert-squad/manager.ts`                          | Delete `importGlobalDirectory`; require scope on folder/ZIP import; use an ID-wide cross-process critical section and combined inventory for import and payload operations. |
| `expert-squad/registry.ts`                         | Remain the strict combined discovery owner; duplicate IDs never acquire precedence.                                                                                         |
| `expert-squad/multica-import.ts`                   | Call ordinary `importDirectory` with `global`; no branded Manager method.                                                                                                   |
| `server/routes/expert-squad.ts`                    | Require scope for folder/ZIP bodies; payload routes explicitly remain project provisioning.                                                                                 |
| OpenAPI and generated SDK                          | Regenerate required `project                                                                                                                                                | global` request fields from the real route schemas. |
| Overlay service and `ExpertSquadPanel`             | Derive request types from generated SDK where practical and explicitly submit `project`; no service default or new UI control in this non-visual slice.                     |
| Multica tool, skill and generated built-in payload | Remove current-project installation wording and regenerate from its authoritative source.                                                                                   |
| Web docs, architecture and portable template       | Describe the generic installation protocol; identify Multica only as a current global-scope caller.                                                                         |
| Manager direct tests                               | Update all project folder/ZIP calls to explicit `project`; add ordinary non-Multica global cases.                                                                           |
| Test preload                                       | Override inherited global-config paths before any source import and clean only the process-owned root.                                                                      |

### Reproduced causal failures

- Sequentially installing the same Mirror Watch manifest globally and then into a project succeeds twice; only
  later `Registry.discover()` reports the duplicate. The direct trigger is `releaseExistingPackageMap()` scanning
  only the project root. The deeper defect is that Manager and Registry do not share one identity inventory.
- The in-memory lock key contains the target packages root, so global and project writes for the same manifest
  use different critical sections. A process-local `Map` also cannot serialize two backend processes.
- `Global.Path.config` gives inherited `OPENCORVUS_GLOBAL_CONFIG_DIR` priority over the temporary portable root.
  The preload did not replace that value, while Multica cleanup deletes paths beneath it.
- Public docs and AGENTS described Multica as a unique user-global exception even though the underlying location
  abstraction was generic. That branded rule would make every future connector require another exception.

### Independent review feedback and correction

The reviewers rejected the remote candidate for four concrete reasons: project-only duplicate scanning,
target-root lock granularity, unisolated inherited global test configuration, and a public branded exception.
They also identified stale current-project wording and incomplete global runtime-source rejection. The initial
review concern that the already-run focused suite had deleted real user data was withdrawn after proving both
supported Bun test entry points preload a per-process portable root and the current shell had no global override;
the inherited-variable defect remains a required regression, not evidence that deletion occurred.

No existing repository lock is safe to copy as the generic package-install primitive: Sidecar locking is
workspace/port-specific, Worktree locking is Instance-bound and has a stale-takeover race, database transactions
cannot wrap asynchronous filesystem publication, and atomic-if-absent only protects one target path. The
implementation must use a maintained cross-platform file-lock primitive or first provide an independently
reviewed generic equivalent; it must not duplicate one of those domain locks.

### Revised implementation and test order

1. Introduce the canonical scope schema/resolver and the cross-process ID lock, with process isolation and
   contention tests.
2. Unify folder/ZIP import and combined inventory semantics; add sequential, same-process and two-process
   global/project duplicate tests plus cleanup/residue assertions.
3. Make payload market/install/release recognize globally installed IDs while continuing to provision payloads
   only into projects.
4. Update routes, OpenAPI/SDK and Overlay explicit callers; cover valid project/global and missing/invalid scope.
5. Move Multica to the ordinary global-scope call and correct all prompt/docs/generated wording.
6. Run the complete focused and generated matrix, bind review to the exact Git tree/patch, then commit the merge
   and push before resuming unrelated legacy cleanup.

## 2026-07-17 Cross-Project Uniqueness Review

### Recall

The first corrected candidate was still rejected after an independent reviewer challenged the inventory boundary.
The counterexample is concrete: project A owns project-local manifest ID `X`; project B installs `X` user-global;
an inventory limited to global plus B cannot see A, so the write succeeds and the next Registry load for A fails
on the new duplicate. The earlier ACCEPT was withdrawn. This is not a theoretical arbitrary-filesystem problem:
`ProjectTable` is the platform's durable registry for known projects, and `Project.list()` exposes every registered
worktree plus its registered sandboxes.

Full-repository searches refreshed every call to `discoverInstalledPackageIdentities`,
`releaseExistingPackageMap`, `ExpertSquadPackageLocations.discover`, `importDirectory`, `importArchive` and
`Project.list`. Registry catalog discovery must remain global plus the one active project. Project installation
and payload provisioning must retain that same conflict domain. Only a user-global installation expands its
pre-write inventory to global, the initiating directory, and all worktree/sandbox directories in `Project.list()`.
The scan remains inside the manifest-ID cross-process lock and reuses Registry identity discovery; it does not
create a second package index or persist a compatibility ledger.

An arbitrary directory that has never been registered with OpenCorvus cannot be enumerated without scanning the
user's filesystem or creating a stale second identity source. Such a directory is validated when first opened;
the guaranteed pre-write boundary is every platform-registered project. Public architecture wording and tests
must state that exact boundary rather than claiming knowledge of unknown directories.

### Additional acceptance

1. A project-local `X` in registered project A makes a global `X` import initiated from project B fail before any
   global target or staging directory is written; A remains catalog-loadable.
2. Registered sandboxes participate in the same global-install conflict scan.
3. Project-local imports and payload provisioning do not scan unrelated projects and keep their existing
   global-plus-current-project semantics.
4. Registry owns location/identity traversal; Manager may obtain directories from `Project.list()` but must not
   implement a parallel manifest reader.
5. Focused tests, typecheck, generated freshness and a new exact-tree independent review must pass before push.

Different projects are intentionally isolated project package scopes and may each own the same local manifest ID.
Therefore the global pre-write scan must query only the ID being installed. It must not build one strict catalog
from every registered project, which would incorrectly reject valid same-ID local packages or let an unrelated
duplicate block a different global installation. Registry remains the filesystem identity reader and exposes an
ID-filtered cross-project lookup; its ordinary `discover(projectDirectory)` remains the strict global-plus-current
catalog. Tests must cover two registered projects sharing a local ID, rejection of a global install for that ID,
and success of an unrelated global ID.

## Current verification ledger

- The first registered-project implementation attempt failed before Manager tests because the pre-write identity
  result and the later target-directory boolean both used the local name `existing`. The exact compiler error was
  retained and corrected at the owner by renaming the identity result to `existingIdentity`; the original complete
  command was rerun rather than narrowing acceptance.
- Manager, Registry and installation-lock matrix: 107 passed, one existing isolated-wrapper skip, zero failures,
  1007 assertions. This includes two projects with the same local ID, registered sandbox collision, unrelated
  global-ID success, and a true two-process local-project/global race across different registered projects.
- OpenCorvus TypeScript check: passed.
- Expert-squad route isolation: one aggregate test passed with 42 assertions across the real route cases.
- Generator freshness: full tracked diff hash remained
  `d7161d332d421f76fb6bca678d15bc677f3320d6` before and after `script/generate.ts`.
- `api:routes-check`: 31 route files clean. `docs:check`: 266 operations in 24 groups clean.
- Historical links, document health and product-doc single-source: 81 passed, zero failures, 1282 assertions.
- The earlier independent ACCEPT was withdrawn after the A-local-X/B-global-X counterexample. A new exact-tree
  review is required for this corrected candidate; no prior verdict is reused.

The registered-directory pre-scan also has a project-open TOCTOU window: an unknown directory can be registered
after the global pre-scan and finish its local catalog read before the global rename. Global installation must
therefore repeat the target-ID registered-directory scan after publication while still holding the manifest-ID
lock. A newly observed conflict throws through the existing atomic-install rollback, removing the new global
target or restoring the replaced target. Fault injection must register a pre-existing local package during the
global target validation and prove the global write is rolled back while the newly registered project remains
catalog-loadable.

### Exact-tree review rejection and cleanup correction

Independent review rejected tree `eb359f128fb39f647a4296e021279511c67a36d2`: the post-publication scan
detected the late project conflict, but first-install rollback suppressed failure to remove the published target.
The caller could receive only the duplicate-ID error while the conflicting global package remained. Directory
staging, payload staging/target and ZIP temporary-source cleanup also suppressed or hid cleanup failures.

The correction uses one cleanup-failure aggregation path for directory and payload installation. It attempts
every required cleanup action, preserves the primary failure, and throws an `AggregateError` containing every
cleanup failure. ZIP import similarly aggregates a simultaneous import and temporary-source cleanup failure.
Five isolated-process scenarios cover a global target, directory staging, replacement restore, payload target
and ZIP source. The replacement scenario proves the original backup remains readable when removal of the new
target fails. The fixture has no production test switch or platform-specific permission dependency and removes
its injected residues through filesystem functions captured before mocking.

The first fixture run failed before Manager because Bun normalized `fs/promises` and `node:fs/promises` to
the same mocked module, causing recursive `rm`. Capturing original function references before registering the
mock corrected the test tool. A later review rejected `Bun.which("bun") ?? process.execPath` as a prohibited
executable fallback and found the missing replacement failure case. The current process-fixture helper requires
Bun and fails immediately if unavailable; both adjacent pre-existing Manager concurrency tests now use that same
strict helper.

The corrected matrix before the parallel merge event passed 110 tests with one existing skip, zero failures and
1016 assertions. The route aggregate passed with 42 assertions; OpenCorvus and generated JavaScript SDK
TypeScript checks passed; generator freshness, `api:routes-check`, `docs:check`, historical links, document
health and product-doc single-source checks passed. These results are historical evidence for the saved candidate,
not acceptance of a later tree.

While the final re-review was running, a parallel process changed HEAD to merge commit `74141564f7` and removed
the staged correction and fixture from the worktree. Review of saved tree `8b300221dd84d1d199d391f3bf8df4c6c5f95f38`
was stopped without a verdict. The correction was then replayed semantically against the new HEAD rather than
restoring whole old files, so the newly merged remote changes remain intact. All validation and exact-tree review
must be repeated for this replayed candidate.

The mixed HEAD still contains a Mirror Watch record claiming that a resumed goal superseded the user's explicit
cancellation of the three real E2E runs. That text is not acceptance evidence and remains a separate delivery
blocker until the active parallel writer releases the file and a forward correction records the latest Goal.

Commit-level review of `6b91aee07a` found no production P0/P1 but rejected one P2 test gap: ZIP import failure
plus cleanup failure was covered, while successful installation followed by temporary-source cleanup failure was
not. A sixth isolated scenario now imports a real valid ZIP, forces only source cleanup to fail, and proves the
original cleanup error is visible while the installed package remains discoverable. The fixture then removes
both the injected temporary-source residue and the installed test package with the captured original filesystem
function.
