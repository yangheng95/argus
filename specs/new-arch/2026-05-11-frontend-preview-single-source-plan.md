# Frontend Preview Single-Source Repair Plan

Date: 2026-05-11
Status: Draft for implementation

## 0. Problem Statement

Frontend preview has been failing with terminal reasons such as:

- `preview_process_exited: code=1 signal=null`
- `preview_process_exited: code=0 signal=null`

The failure is not a generic preview-route problem. It is a startup-chain design problem:

1. The managed preview session only knows how to run `<packageManager> run dev` inside a specific workspace directory.
2. Acceptance tooling and orchestrator visual-render startup currently point that workspace at `Instance.directory` rather than the actual frontend package root.
3. Runtime-flow evaluation already has a different code path that discovers the real project root first.
4. The result is a dual-source startup model: one path resolves the correct runtime root, the other path guesses the repo root. That violates the single-source rule and makes preview failure appear random.

## 1. Call-Site Inventory

This inventory is required before any implementation change.

### 1.1 Preview session constructor

- `packages/opencorvus/src/preview/session.ts`
  - `ensureManagedPreviewSession(...)`
  - `previewLaunchCommand(...)`
  - error shapes:
    - `no_preview_start_script`
    - `no_package_manager`
    - `preview_process_error`
    - `preview_not_ready`
    - `preview_process_exited`
    - `preview_start_idle_timeout`

### 1.2 Retired acceptance tool path

- Retired. Runtime screenshot capture is now build-owned via
  `packages/opencorvus/src/build/screenshot-tool.ts` and
  `packages/opencorvus/src/runtime/page-capture.ts`.

### 1.3 Runtime-flow / acceptance gate path

- `packages/opencorvus/src/acceptance/checks/project-gate.ts`
  - `buildAcceptanceEvidenceManifest(...)`
  - `runRuntimeFlows(...)`
  - `resolveRuntimeFlowPreview(...)`
  - already uses `surfaceManifest.projectRoot`

### 1.4 Project root discovery / runtime readiness

- `packages/opencorvus/src/acceptance/checks/discovery.ts`
  - `discoverPackageRoot(...)`
- `packages/opencorvus/src/acceptance/checks/runtime-readiness.ts`
  - `ensureProjectReadyForRuntime(...)`

### 1.5 Orchestrator visual render path

- `packages/opencorvus/src/orchestrator/tools.ts`
  - merged-worktree render before acceptance review visual comparison
  - currently hardcodes `workspaceDir = Instance.directory`

### 1.6 Existing tests

- `packages/opencorvus/test/preview-session.test.ts`
- `packages/opencorvus/test/acceptance/tools-readonly.test.ts`

Current gap: tests only cover the trivial case where `Instance.directory` itself is the package root. They do not cover the real monorepo/subpackage case, which is exactly where preview repeatedly fails.

## 2. Root Cause

The root cause is dual-source preview startup resolution.

- Acceptance runtime gate path:
  - discovers the actual frontend package root
  - starts preview from that root
- Acceptance tool path and orchestrator render path:
  - skip discovery
  - start preview from the repository root

In a monorepo, the repository root often has:

- a different `package.json`
- a different `scripts.dev`
- a TUI/server entrypoint that is not the browser-facing frontend

So preview can exit immediately even when the real frontend package is healthy.

This is why the failure has looked persistent: the wrong process is being started.

## 3. Design Decision

There must be one startup-resolution path for browser-facing preview:

1. Resolve the effective frontend project root.
2. Run runtime-readiness against that root.
3. Start the managed preview session from that root.
4. Persist structured failure evidence that includes:
   - resolved project root
   - attempted command
   - failure reason

No fallback to repo root is allowed.
No second startup algorithm is allowed.

## 4. Implementation Plan

### Phase A: Extract a shared preview target resolver

Add a shared helper under acceptance/runtime area that:

1. Accepts:
   - `taskID`
   - `workspaceDir`
   - `changedFiles`
   - `metadata`
2. Resolves a single `projectRoot`.
3. Runs `ensureProjectReadyForRuntime({ projectRoot })`.
4. Returns:
   - `projectRoot`
   - readiness result
   - optionally the managed preview session if requested

This helper becomes the only owner of preview-target resolution for acceptance/orchestrator frontend preview.

### Phase B: Replace acceptance tool startup path

`start_frontend_preview` must stop using repo root directly.

It should:

1. Resolve the real project root.
2. Fail early if runtime readiness is not passed.
3. Start preview from that resolved root.
4. Return structured JSON that exposes:
   - `project_root`
   - `command`
   - `reason`
   - `evidence`

### Phase C: Replace orchestrator visual-render startup path

The orchestrator visual-render branch must use the same shared resolver.

It should not call `ensureManagedPreviewSession(...)` with `Instance.directory` directly anymore.

### Phase D: Preserve truthful failure evidence

When preview startup fails, the failure payload must persist the resolved root and attempted command.

That means:

- do not return only `preview_process_exited: code=1`
- include the context that explains which package root and which startup path failed

This is not fallback. It is failure evidence.

## 5. Tests

Every code change must be covered by tests.

### Required new coverage

1. Acceptance tool resolves a frontend subpackage instead of repo root.
2. Acceptance tool surfaces runtime-readiness failure without attempting a bogus repo-root preview.
3. Acceptance tool failed-session payload contains the resolved project root.
4. Orchestrator/runtime preview path and acceptance tool path agree on the same root for the same changed-file set.

### Existing tests to retain

1. Basic managed preview session startup.
2. Preview URL parsing from colored Vite output.
3. Failed preview session preserves failed status and reason.

## 6. Acceptance Criteria

This repair is complete only when all items below are true:

1. Acceptance preview startup no longer guesses repo root when the frontend lives in a subpackage.
2. Acceptance tool path and runtime-flow path share one project-root resolution path.
3. Orchestrator visual render uses the same root-resolution path.
4. Failed preview output includes enough evidence to distinguish:
   - wrong root
   - readiness failure
   - process exit
   - URL never printed
5. Targeted tests pass.
6. Manual reproduction no longer fails in the current monorepo because of repo-root startup.

## 7. Non-Goals

- Do not add fallback to a second startup directory.
- Do not guess ports.
- Do not serve static files as a backup.
- Do not mark preview success from metadata unless metadata already provides a valid loopback preview URL.
