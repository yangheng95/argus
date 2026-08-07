# Open Project Freeze Systemic Repair

## Recall

### User Request

- User reported that opening a project freezes on macOS and then explicitly required all platforms to be considered.
- User asked for independent agent cross-analysis.
- User then asked to define a detailed goal and start execution.

### Goal

Systemically repair cross-platform project-open freeze risk without fallback, gate, or dual-source behavior. The repair must make the project-open path diagnosable and testable across desktop launch, directory selection, sidecar startup, backend instance bootstrap, Git operations, watcher initialization, expert-squad payload release/discovery, and first project-scope reload.

### Acceptance Criteria

- Sidecar startup must not continue with inherited cwd when the intended sidecar cwd cannot be created.
- Project-open initialization must emit structured start/done/error evidence for each blocking stage, including duration, platform, directory, worktree, and project identity where available.
- Git subprocess timeout semantics must be inactivity-based: stdout/stderr activity refreshes the timeout; silent commands time out.
- A project-open benchmark/regression test must exercise the real `Instance.provide` bootstrap path and assert stage evidence exists for the blocking lifecycle.
- Existing directory-source and project identity tests must continue to pass.
- Changes must be verified with focused tests and a second review; no fallback/gate workaround is acceptable.

### Hard Constraints

- No fallback or compatibility branch may be introduced.
- No process cwd may become a project directory source in app-mode project-open behavior.
- Timeout semantics must be inactivity-based, not process-start elapsed time.
- Do not restart, kill, or refresh running OpenCorvus/overlay processes without explicit user instruction.
- Do not revert unrelated dirty worktree changes.
- New specs must live under `specs/records/2026-07/` and be indexed in the monthly README.

### Sources Read

- `AGENTS.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/current/architecture/02-data.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-06/2026-06-28-directory-source-convergence-plan.md`
- `packages/overlay/src-tauri/src/main.rs`
- `packages/overlay/src/services/workspace.ts`
- `packages/overlay/src/services/config.ts`
- `packages/opencorvus/src/server/server.ts`
- `packages/opencorvus/src/server/directory.ts`
- `packages/opencorvus/src/project/project.ts`
- `packages/opencorvus/src/project/instance.ts`
- `packages/opencorvus/src/project/bootstrap.ts`
- `packages/opencorvus/src/util/process.ts`
- `packages/opencorvus/src/util/git.ts`
- `packages/opencorvus/src/file/watcher.ts`
- `packages/opencorvus/src/acceptance/checks/inactivity-timeout-process.ts`
- `packages/opencorvus/test/project/instance-cache.test.ts`
- `packages/opencorvus/test/util/git-timeout.test.ts`
- `packages/opencorvus/test/util/process.test.ts`
- `packages/overlay/test/host-transport-capabilities.test.ts`

### Whole-Repository Search Evidence

- `rg -n "sidecar CWD|sidecar_cwd|directory source|process\\.cwd|inactivity|workspace onboarding|project discovery|global/projects/discover|FileWatcher|GitTimeout|Instance\\.provide|Project\\.fromDirectory" specs/current specs/records/2026-06 specs/records/2026-07 packages/opencorvus/test packages/overlay/test`
- `rg -n "resolveGitTimeoutMs|GitTimeout|git\\(\\[|timed out after .*cwd|exitCode.*124|timeoutProfile" packages/opencorvus/test packages/opencorvus/src -g "*.test.ts" -g "*.ts"`
- `rg -n "AttachmentStore\\.sweep|sweep failed|AttachmentStore" packages/opencorvus/test packages/opencorvus/src/project packages/opencorvus/src/storage specs/records specs/current`
- `rg -n "cargo test|src-tauri|main.rs|tauri" package.json packages/overlay/package.json packages/overlay/src-tauri/Cargo.toml packages/overlay/test packages/opencorvus/test`

### Independent Agent Feedback

- Curie confirmed the sidecar cwd contract drift: the June directory-source plan required cwd creation failure to become a visible startup failure, while current `main.rs` still logs and continues with inherited cwd.
- Curie confirmed existing coverage is strong for directory injection, discovery failure surfacing, `Project.fromDirectory`, and expert-squad payload release, but lacks a true project-open benchmark that spans Tauri sidecar, onboarding selection, `Instance.provide`, `Project.fromDirectory`, expert-squad release/discover, `FileWatcher.init`, `File.init`, and first usable UI frame.
- Noether and Halley did not return evidence before shutdown after the scope was narrowed; their missing result is not counted as independent consensus.

### Additional Findings During Execution

- `packages/opencorvus/test/server/global-project-discovery.test.ts` changed cwd into a temporary project directory and relied on `afterEach` to restore it. On Windows, `await using` disposed the temp directory before `afterEach`, producing stable `EBUSY` cleanup failures. The test now restores cwd before fixture disposal.
- Current expert-squad worktree state added `goal-workload-analyst` to `.opencorvus/expert-squads/builtin/frontend-replica/expert-squad.jsonc` and added the matching prompt file, but `packages/opencorvus/src/expert-squad/payload.ts` was stale. Project-open payload release failed fast with `built-in expert squad frontend-replica: missing prompt file agents/goal-workload-analyst/system.md`. The payload module was regenerated from the source package so project-open release/discovery succeeds again.
- `packages/opencorvus/test/script/document-health.test.ts` checks monthly README links against `git ls-files`; new record links fail until the linked record files are added to the git index. This is an index-state validation, not a runtime project-open failure.

### Dirty Worktree

Before this task, the worktree already contained unrelated modified expert-squad template files and `specs/records/2026-07/README.md`. This repair must avoid reverting or staging those unrelated changes.

## Design

### Lifecycle Evidence

Add a small project-open lifecycle helper under `packages/opencorvus/src/project/` that records:

- `project.open.stage` with `status: "started"`.
- `project.open.stage` with `status: "completed"` and `duration`.
- `project.open.stage` with `status: "failed"`, `duration`, and error text.

The helper is used by `Instance.provide` bootstrap and `InstanceBootstrap` so the first blocking project-open request leaves precise stage evidence.

### Sidecar cwd Contract

The Tauri sidecar launcher must create the computed sidecar cwd before `Command::current_dir`. Failure is a startup error with the intended cwd and sidecar log path, not a fallback to inherited cwd.

### Git Inactivity Timeout

Move git timeout enforcement from `AbortController` elapsed time to `Process.run` inactivity support:

- `Process.run` gets an optional `inactivityTimeoutMs`.
- stdout/stderr data refresh the timer.
- a silent process is terminated through the existing process supervisor path.
- `git()` passes the resolved profile timeout as inactivity timeout and preserves the existing timeout message shape.

### Benchmark / Regression

Add focused project-open tests:

- lifecycle helper unit coverage for started/completed/failed evidence.
- `Instance.provide` coverage proving bootstrap emits project-open stage evidence.
- process inactivity coverage proving output activity extends the timeout while silence times out.
- git coverage using the shared inactivity mechanism.
- Rust unit coverage proving sidecar cwd creation failure is surfaced instead of ignored.

## Execution Notes

- The focused process/git/lifecycle test group passed after the active-process fixture was changed to emit an initial activity signal before verifying repeated stdout/stderr activity refreshes the inactivity window.
- The project-open lifecycle test reads the durable log file instead of mocking `Log.create`, so it verifies the real `Instance.provide` path emits `project.open.stage` records.
- The expert-squad payload fix uses `packages/opencorvus/script/generate-expert-squad-payload.ts`; no payload mapping was hand-written.

## Verification Plan

- `bun test packages/opencorvus/test/util/process.test.ts packages/opencorvus/test/util/git-timeout.test.ts packages/opencorvus/test/project/open-lifecycle.test.ts packages/opencorvus/test/project/instance-cache.test.ts`
- `bun test packages/opencorvus/test/server/global-project-discovery.test.ts packages/overlay/test/api-directory-injection.test.ts packages/overlay/test/workspace-discovery-service.test.ts`
- `cargo test --manifest-path packages/overlay/src-tauri/Cargo.toml`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`

## Verification Results

- PASS: `bun test packages/opencorvus/test/util/process.test.ts packages/opencorvus/test/util/git-timeout.test.ts packages/opencorvus/test/project/open-lifecycle.test.ts --timeout 60000` — 28 pass.
- PASS: `cargo test --manifest-path packages/overlay/src-tauri/Cargo.toml sidecar_cwd` — 4 pass.
- PASS: `bun test packages/opencorvus/test/server/global-project-discovery.test.ts packages/overlay/test/api-directory-injection.test.ts packages/overlay/test/workspace-discovery-service.test.ts --timeout 90000` — 101 pass.
- PASS: `bun test packages/opencorvus/test/project/instance-cache.test.ts packages/opencorvus/test/project/open-lifecycle.test.ts --timeout 120000` — 11 pass.
- PENDING INDEX: `bun test packages/opencorvus/test/expert-squad/payload-generation.test.ts packages/opencorvus/test/expert-squad/registry.test.ts --timeout 90000` has runtime freshness passing and registry passing; `payload source files are tracked delivery inputs` requires the new `agents/goal-workload-analyst/system.md` source file to be added to git.
- PENDING INDEX: `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts --timeout 60000` has link/content checks passing except `monthly record README links target tracked record files`, which requires newly linked record files to be added to git.

## Review Checklist

- No fallback or gate added.
- Sidecar cwd failure cannot continue into inherited cwd.
- Project-open stages include failure evidence.
- Git active output is not killed by the timeout window.
- Silent git/process execution is terminated with an explicit inactivity diagnostic.
- Spec README index is updated.
