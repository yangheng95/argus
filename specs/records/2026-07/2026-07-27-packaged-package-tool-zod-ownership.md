# Packaged package-tool Zod ownership repair

Status: Completed

## Recall

### Original request

The user reported that Task `tsk_fa3d85f45001wuFYqqzEYpyFDf` still had an empty message panel after the earlier compiled Artifact Search schema repair and asked to continue the repair.

### Acceptance criteria

- Explain the empty panel from persisted Task, Session, and log evidence rather than UI inference.
- Repair the runtime failure before the Orchestrator's first visible message.
- Preserve one dependency owner: package-tool Plugin compilation must use the Zod declared by `@opencorvus-ai/plugin`.
- Reproduce the installed runtime's conflicting root Zod 3 and nested Plugin Zod 4 layout in an executable regression test.
- Do not restart, refresh, or terminate the running OpenCorvus or Overlay processes.
- Preserve unrelated shared-worktree changes and push only task-owned changes through normal hooks to `myhexin`.

### Hard constraints

- No fallback, compatibility branch, version sniff, gate, or UI-generated placeholder message.
- No database migration or mutation of the failed historical Task.
- Use the package dependency graph as the single source of module ownership.
- Playwright is not required because the visible empty state is downstream of a proven zero-message backend failure and this repair does not alter UI code.

### Materials read

- `specs/records/2026-07/2026-07-27-compiled-artifact-search-schema-initialization.md`
- `packages/opencorvus/src/runtime/package-require.ts`
- `packages/opencorvus/src/expert-squad/package-tool-bundle.ts`
- `packages/opencorvus/script/build-artifact.ts`
- `packages/opencorvus/script/build-runtime-node-modules.ts`
- `packages/opencorvus/test/script/compiled-package-tool-artifact.test.ts`
- `packages/opencorvus/test/fixture/compiled-package-tool-probe.ts`
- `packages/plugin/src/artifact-catalog.ts`
- the installed sidecar dependency tree under its content-addressed embedded runtime
- runtime database and `2026-07-27T134902-84415-1.log`

### Full-repository search

`rg` found exactly two production resolutions of bare `zod` for package-tool compilation, both in `package-tool-bundle.ts`: the Plugin runtime closure and the final package-tool closure. The only production `.overwrite()` call is `ArtifactJSONValueShapeSchema.overwrite(restoreArtifactJSONKeys)` in `packages/plugin/src/artifact-catalog.ts`. Zod is owned by the Plugin package through its `catalog:` dependency. The installed full runtime contains root `zod@3.25.76` and Plugin-local `zod@4.1.8`; `chromium-bidi` is the root Zod 3 owner.

### Independent agent feedback

The previous repair received an independent Agent review and closed its findings. This new failure is outside that review's exercised dependency layout: its compiled probe initialized the Orchestrator graph but did not reproduce the full runtime module-version conflict.

The follow-up independent read-only review found no code or regression-design defect. It confirmed that `createRequire(entry)` binds dependencies to the real Plugin package graph, the same owner-derived Zod entry is reused without entering the reproducible snapshot, and the executable test is red on the former root-resolution implementation and green after the repair. It also found two delivery-record issues:

- the shared spec indexes contain unrelated staged and unstaged changes, so delivery must use an isolated temporary Git index and include only this record's two index lines;
- this Recall section initially said no new review was requested, which became stale when the review was dispatched and is corrected here.

## Evidence and causal chain

1. `engine_task.error` records `TypeError: rt.overwrite is not a function`.
2. The root and Orchestrator child sessions contain zero messages and zero parts, so the panel has no canonical transcript to render.
3. The installed runtime contains root `zod@3.25.76` plus `@opencorvus-ai/plugin/node_modules/zod@4.1.8`.
4. `PackageToolBundle.compilePluginRuntimeClosure()` resolves `zod` through `runtimePackageRequire()`, whose base is the executable-adjacent package manifest. It therefore selects root Zod 3.
5. The Plugin source uses the Zod 4 `overwrite()` API. Compiling that source closure against root Zod 3 makes module evaluation fail before the Orchestrator can emit a message.
6. The earlier executable probe copied only Plugin and TypeScript runtime modules. Without `chromium-bidi`, Plugin Zod 4 occupied the runtime root and hid the ownership error.

## Implementation

- Resolve Plugin runtime dependencies through a `createRequire()` rooted at the resolved `@opencorvus-ai/plugin/tool` entry.
- Reuse that exact owner-derived Zod entry for both compilation stages.
- Extend the compiled package-tool executable probe to copy `chromium-bidi` before Plugin, assert the root/nested Zod split, import the real Plugin runtime, and parse an Artifact JSON payload.

## Verification

- `bun test packages/opencorvus/test/script/compiled-package-tool-artifact.test.ts packages/opencorvus/test/expert-squad/package-tool-bundle.test.ts packages/opencorvus/test/script/compiled-overlay-artifact.test.ts`
  - 21 pass, 0 fail.
  - The executable package-tool probe asserted root Zod 3 and Plugin-local Zod 4, compiled the real Plugin closure, imported it, and parsed an Artifact JSON payload.
- `bun test packages/opencorvus/test/expert-squad/mirror-watch-package.test.ts packages/opencorvus/test/expert-squad/repository-dynamic-agent-packages.test.ts`
  - 22 pass, 0 fail, including every repository package tool reaching provider schema preparation and the real MirrorWatch projected tools executing.
- `bun run --cwd packages/opencorvus typecheck`
  - passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  - 22 pass, 0 fail.
- `git diff --check`
  - passed.
- Independent Agent read-only review
  - no code or regression-design findings after checking dependency ownership, pre-fix reproduction, snapshot determinism, and path leakage;
  - its two delivery-record findings were corrected by updating this record and isolating the commit index.
- The running OpenCorvus and Overlay processes were inspected read-only and were not restarted, refreshed, or terminated.
