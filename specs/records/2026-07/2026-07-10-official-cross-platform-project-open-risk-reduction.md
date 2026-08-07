# Official Cross-Platform Project-Open Risk Reduction

## Recall

### User Request

- Opening a project had frozen on macOS; all supported desktop platforms must be considered.
- The repair must use officially supported cross-platform mechanisms and reduce delivery risk.
- The preceding task required independent-agent cross-analysis and a detailed executable goal.

### Goal

Converge project-open startup onto public Tauri 2 path APIs and native operating-system verification. Remove hidden path and executable-source fallbacks from the managed sidecar startup path, preserve the existing embedded multi-file runtime contract, and make the remaining cross-platform risk measurable.

### Acceptance Criteria

- Default overlay data, log, and sidecar working directories resolve through Tauri 2 `PathResolver` APIs; there are no hand-written Windows/macOS/Linux environment-path branches.
- An explicitly configured non-empty `OPENCORVUS_HOME` remains the only portable-mode override. An empty value is invalid and must not silently select another root.
- `OPENCORVUS_HOME` must be an absolute, non-blank path so portable mode never depends on the host process cwd.
- The embedded sidecar payload is the only managed backend executable source. Extraction or path-resolution failure is surfaced directly; adjacent-executable and resource-directory probes are removed.
- Embedded payload version directories are immutable. Startup never deletes an older version that another process may still execute, and a new version is published from a unique temporary directory only after complete extraction.
- Windows managed startup fails visibly and reaps the child when Job Object creation or assignment fails; it never continues without process-tree ownership.
- Sidecar cwd and log initialization fail visibly. They do not continue with inherited cwd, a temporary directory, or null stdio.
- Existing project-open lifecycle and inactivity-timeout tests pass.
- The project-open regression command is assigned to native Linux x64, Windows x64, macOS arm64, and macOS x64 GitHub-hosted runners.
- Focused benchmark and Rust tests pass locally; a second code review finds no remaining hidden path fallback in the changed startup surface.

### Quantified Risk Targets

| Measure | Before | Target |
| --- | ---: | ---: |
| Default overlay runtime path implementations | Hand-written OS branches plus Tauri paths | Tauri `PathResolver` only |
| Embedded server executable candidates | Embedded extraction, executable directory, resource directory | 1 |
| App-local-data resolution fallback to system temp | 1 | 0 |
| Sidecar stdio failure paths that continue with `Stdio::null()` | 3 | 0 |
| Native project-open regression environments | 3 broad unit runners, no named project-open matrix; macOS Intel absent | 4 named project-open runners |
| Unsupported cross-OS local builds used as release evidence | Not allowed by build script | 0 |
| Startup deletion of older embedded payload versions | 1 unowned cleanup pass | 0 |
| Windows Job Object failures that continue startup | 2 creation/assignment surfaces | 0 |

### Hard Constraints

- No fallback, compatibility path, gate, or dual source.
- Do not treat process cwd as a project directory source.
- Do not migrate the embedded multi-file payload to a second packaging path in this task.
- Do not restart, stop, refresh, or otherwise interfere with a running OpenCorvus or overlay process.
- Do not revert or stage unrelated dirty worktree changes.
- Timeouts remain inactivity-based.
- Implementation records live under `specs/records/2026-07/` and are indexed by the monthly README.

### Sources Read

- `AGENTS.md`
- the user's local July route-planning draft (read as working context, not a repository record)
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-06/2026-06-28-directory-source-convergence-plan.md`
- `specs/records/2026-07/2026-07-09-open-project-freeze-systemic-repair.md`
- `specs/records/2026-07/2026-07-09-github-overlay-package-ci.md`
- `packages/overlay/src-tauri/Cargo.toml`
- `packages/overlay/src-tauri/Cargo.lock`
- `packages/overlay/src-tauri/tauri.conf.json`
- `packages/overlay/src-tauri/build.rs`
- `packages/overlay/src-tauri/src/main.rs`
- `packages/opencorvus/src/global/index.ts`
- `packages/opencorvus/src/project/instance.ts`
- `packages/opencorvus/src/project/bootstrap.ts`
- `packages/opencorvus/src/project/open-lifecycle.ts`
- `packages/opencorvus/src/util/process.ts`
- `packages/opencorvus/src/util/git.ts`
- `packages/opencorvus/test/project/open-lifecycle.test.ts`
- `packages/opencorvus/test/util/process.test.ts`
- `packages/opencorvus/test/util/git-timeout.test.ts`
- `.github/actions/setup-bun/action.yml`
- `.github/workflows/test.yml`
- `.github/workflows/build-overlays.yml`

### Official References

- Tauri 2 PathResolver: <https://docs.rs/tauri/latest/tauri/path/struct.PathResolver.html>
- Tauri 2 external binaries: <https://v2.tauri.app/develop/sidecar/>
- Tauri desktop prerequisites: <https://v2.tauri.app/start/prerequisites/>
- GitHub-hosted runner labels: <https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job>
- Node.js `child_process.spawn`: <https://nodejs.org/api/child_process.html#child_processspawncommand-args-options>
- Rust cross-platform filesystem APIs: <https://doc.rust-lang.org/std/fs/>
- Tauri WebDriver testing: <https://v2.tauri.app/develop/tests/webdriver/>

### Whole-Repository Search Evidence

- `rg -n --hidden --glob '!**/node_modules/**' --glob '!**/target*/**' --glob '!**/dist*/**' "new_sidecar|current_dir\\(|create_dir_all|Bun\\.spawn|node:child_process|inactivityTimeoutMs|ProjectOpenLifecycle|start_server|sidecar" packages specs`
- `rg -n "opencorvus_log_dir\\(|sidecar_cwd_dir\\(|sidecar_stdio_targets\\(|start_server\\(" packages specs/current specs/records/2026-06 specs/records/2026-07`
- `rg -n "candidate_server_paths|server_path|embedded_server|app_local_data_dir|temp_dir|opencorvus_log_dir|sidecar_cwd" packages/overlay packages/opencorvus/test .github`
- `rg -n "darwin|macos|windows|linux|package:binary-matrix|build:overlay|cargo test|runs-on|strategy:" .github packages/overlay/script packages/opencorvus/script script`

### Call-Site Decisions

| Surface | Current evidence | Decision |
| --- | --- | --- |
| `candidate_server_paths` | Probes embedded extraction, executable directory, and Tauri resource directory; embedded extraction errors are discarded. | Delete. Managed startup requires the embedded payload path. |
| `ensure_embedded_server_path` | Uses `app_local_data_dir()` but falls back to `std::env::temp_dir()`. | Return the official path-resolution error; accept resolved runtime paths as input. |
| `opencorvus_log_dir` | Reimplements Windows/XDG/home logic and returns temp on failure. Its macOS comment does not match its Unix implementation. | Delete. Default logs use `app_log_dir()`. |
| `sidecar_cwd_dir` | Derives cwd from the hand-written log path and falls back to temp if the parent is absent. | Delete. Cwd is the resolved app-local-data root. |
| `sidecar_stdio_targets` | Continues with null stdio after directory, open, or clone failure. | Return `Result` and fail startup with the real log error. |
| `append_overlay_startup_diagnostic` | Uses the hand-written log resolver and can lose the path error. | Resolve the same runtime-path contract and include diagnostic-write failure in the visible startup details. |
| `start_server` | Uses the candidate executable chain and manually derived cwd/log paths. | Resolve one `OverlayRuntimePaths` value, then use it for extraction, cwd, and logs. |
| `Process.run` / `git()` | Uses Node-compatible streams and the shared process supervisor; output refreshes inactivity timeout. | Keep. This is already based on public Node child-process stream behavior. |
| Project-open tests | Run inside the broad Linux/macOS/Windows unit matrix, but do not name macOS Intel or expose a focused project-open job. | Add a four-environment focused matrix using existing tests. |
| `cleanup_stale_embedded_sidecars` | Deletes every old `sidecar-*` directory at startup without proving that no running process owns it. | Delete automatic cleanup. Publish new immutable payload versions atomically and leave lifecycle cleanup to a separately owned process. |
| `job_object::create_and_assign` | Ignores `AssignProcessToJobObject` and returns `None` for setup failures; caller logs and continues. | Return detailed errors, kill and wait for the child, and fail managed startup. |
| Portable root | Accepts relative and whitespace-only `OPENCORVUS_HOME`. | Require an absolute, non-blank path. |

### Independent Agent Feedback

- Ampere confirmed the new Tauri `app_local_data_dir()` and `app_log_dir()` direction and the removal of executable/temp/null-stdio fallbacks. It found three P1 startup risks: unowned deletion and in-place extraction of embedded payload directories, relative `OPENCORVUS_HOME`, and Windows Job Object assignment failure continuing without process-tree ownership. It advised against migrating the current multi-file runtime directly to `externalBin` or `tauri-plugin-shell` in this task.
- Lovelace confirmed the native runner labels are official and correct, but found no real CI evidence: GitHub `test.yml` is manually disabled, the repair commit is absent from GitHub, and no workflow currently runs `cargo test`. It also found that the current `Instance.provide` test bypasses packaged Tauri launch and uses a fixed 1.5 second log deadline with non-isolated global events. Therefore runner configuration and focused regression can be completed here, but true packaged cross-platform E2E must not be claimed without an enabled GitHub workflow and a real Tauri UI driver.
- Lovelace's risk scores: no current runner evidence 25/25; Rust sidecar tests absent from CI 25/25; no packaged desktop project-open E2E 20/25; fixed deadline/global-log oracle 16/25; skippable payload tests 16/25; relative portable root 15/25; missing macOS x64 lifecycle behavior 12/25.

## Design

### Runtime Paths

Introduce one `OverlayRuntimePaths` value with three explicit categories:

- `data_dir`: Tauri `app_local_data_dir()` by default; `<OPENCORVUS_HOME>/data` in explicit portable mode.
- `log_dir`: Tauri `app_log_dir()` by default; `<OPENCORVUS_HOME>/data/log` in explicit portable mode.
- `embedded_dir`: `<data_dir>/embedded`.

The sidecar cwd is `data_dir`. No category is inferred from another category's parent and no resolution error selects a different root.

### Sidecar Packaging Boundary

Keep the existing embedded archive because it is a multi-file runtime containing the OpenCorvus executable, Node runtime, browser support, plugins, and native dependencies. Tauri `externalBin` is the official executable bundling mechanism, but replacing this archive with `externalBin` plus resources is a separate packaging migration with signing, updater, executable-permission, and standalone-binary consequences. This task removes platform path reinvention without adding a parallel packaging source.

The embedded directory name uses the payload's content SHA-256 identity. Extraction targets a unique temporary sibling directory, verifies the generated manifest, writes a completion marker, and publishes with a same-filesystem rename. Startup never deletes old version directories and never repairs an incomplete final directory in place.

### Packaged E2E Boundary

The official Tauri recommendation is WebdriverIO with `@wdio/tauri-service`; its embedded provider supports Windows, Linux, and macOS. Adopting it requires Tauri test plugins, a packaged-app launch contract, native project selection, first-interactive-frame evidence, screenshots, and GitHub workflow execution. That is a separate product-facing E2E goal. This record does not label `Instance.provide`, source assertions, `cargo test`, or unexecuted YAML as packaged cross-platform E2E.

### Native Verification

Use GitHub-hosted native runners rather than cross-OS emulation:

| Runner | Platform evidence |
| --- | --- |
| `ubuntu-latest` | Linux x64 |
| `windows-latest` | Windows x64 |
| `macos-latest` | macOS arm64 |
| `macos-15-intel` | macOS x64 |

The focused command covers real `Instance.provide`, project-open lifecycle evidence, shared inactivity timeout behavior, Git timeout wiring, and global project discovery.

## Verification Plan

- `bun packages/opencorvus/script/benchmark/project-open.ts --idle-timeout-ms 600000`
- `cargo test --manifest-path packages/overlay/src-tauri/Cargo.toml`
- `bun test --timeout 0 packages/opencorvus/test/project/open-lifecycle.test.ts packages/opencorvus/test/util/process.test.ts packages/opencorvus/test/util/git-timeout.test.ts packages/opencorvus/test/server/global-project-discovery.test.ts packages/overlay/test/official-runtime-paths.test.ts`
- `bun test --timeout 0 packages/opencorvus/test/script/ci-overlay-tests.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/build-artifact.test.ts packages/opencorvus/test/benchmark/project-open.test.ts`
- `bun run typecheck`
- `git diff --check`

## Verification Results

### Passed Locally On Windows x64

- `cargo test --manifest-path packages/overlay/src-tauri/Cargo.toml`: 34 passed, 0 failed. This includes runtime path categories, portable-root rejection, immutable payload publication, embedded payload completeness, sidecar cwd/log failures, and startup diagnostic behavior.
- `bun test --timeout 0 packages/opencorvus/test/util/process.test.ts`: 17 passed, 0 failed. Both stdout and stderr activity independently refresh the inactivity timeout; a silent process still terminates.
- Git timeout and global project discovery: 10 passed, 0 failed.
- Official runtime-path architecture tests, project-open benchmark contract tests, build artifact tests, CI workflow contract tests, historical link tests, and the non-index-sensitive document health checks passed.
- SDK generation and Overlay Vite production build passed inside the focused benchmark.
- `cargo fmt --check` and `git diff --check` passed.

### Explicitly Not Passed

- The focused benchmark failed during embedded-server preparation before the project-open runtime tests. The observable error is the in-progress expert-squad schema transition: every `capability_projection.agents.*.label` is required but missing in current manifests, while the current registry rejects the still-present top-level `team`, `workflow`, and `agents` keys.
- The same failure is independently reproduced by the expert-squad payload and registry suites: 17 passed and 55 failed. Therefore it is not a benchmark-runner defect or a Tauri path failure.
- `bun run typecheck` completed 8 of 9 package tasks, then failed in the concurrently modified expert-squad/agent-coordination surfaces. Errors include removed manifest fields still being consumed, missing `VirtualAgentDefinition` and `defaultWorkflow` exports, old `projectionID` access, and missing `target_id` bindings. No reported type error points to the cross-platform runtime-path, payload, benchmark, or logging changes in this record.
- The combined document-health run reported 123 passed and 1 failed because the monthly README currently links six untracked records from parallel tasks. This record is one of them; staging the other five would violate the unrelated-change boundary.
- Linux x64, Windows x64, macOS arm64, and macOS x64 are configured as native GitHub-hosted runners, but no runner result exists. The repository `test` workflow is manually disabled in GitHub, and this branch has not supplied execution evidence there.
- No packaged Tauri WebdriverIO project-open E2E was added or run. Source assertions, Rust tests, `Instance.provide`, and workflow YAML are not packaged-app evidence.

## Second Review

The second review incorporated both independent-agent findings and re-ran repository searches over the changed startup surface. The implementation now has one Tauri-resolved runtime-path contract, one embedded executable source, content-addressed immutable payload directories, fail-fast log/cwd setup, and fail-fast Windows Job Object ownership. The old manual OS path resolver, executable candidate chain, startup deletion of old payloads, and null-stdio continuation are removed.

Residual risk remains measurable:

| Priority | Residual risk | Evidence required to close |
| --- | --- | --- |
| P0 | The real project-open benchmark cannot reach runtime initialization while the expert-squad schema transition is inconsistent. | Complete that separate transition, make its payload/registry suites and typecheck pass, then rerun the unchanged benchmark. |
| P0 | No native runner has executed this branch, and GitHub currently marks the workflow disabled. | Enable the existing workflow through an authorized repository operation and obtain green results from all four matrix entries. |
| P1 | There is no packaged desktop project-open E2E on any platform. | Add the official `@wdio/tauri-service` embedded-provider path as a separate goal and capture real packaged launch/project-selection evidence on the four target runners. |
| P2 | First-use payload extraction is synchronous during Tauri setup; it was not proven to be the original project-open freeze trigger. | Measure first-use extraction and first-interactive-frame latency in the packaged E2E before changing startup ownership or threading. |
| P2 | Runtime reuse validates the completion marker, file type, and file size rather than rehashing the full multi-file payload on every launch. | Keep build-time SHA-256 as the payload identity; only add measured runtime hashing if corruption evidence justifies the added startup I/O. |

Current verdict: the implementation reduces the identified cross-platform startup risks, but the goal is **not accepted as fully verified** until the P0 benchmark and native-runner evidence are closed.
