# Runtime Directory Root Convergence

## Recall

### User Request

- OpenCorvus currently creates too many working directories across the system drive.
- Consolidate those directories and deliver a converged version.
- User clarification after the first implementation: the requested outcome is converged
  directory **management**, not a one-off filesystem cleanup. Test, benchmark, build,
  channel, Overlay, and core callers must consume one owned directory contract instead
  of independently deriving operating-system temporary paths.

### Acceptance Criteria

- One canonical user-global OpenCorvus root owns config, durable data, cache, state,
  logs, binaries, temporary work, Overlay runtime payloads, and browser profile data.
- `OPENCORVUS_HOME` is the only explicit root override. Every owned path is a strict
  descendant of that resolved root.
- The default Windows root is `%LOCALAPPDATA%/opencorvus`; macOS uses
  `~/Library/Application Support/opencorvus`; Linux uses
  `$XDG_DATA_HOME/opencorvus` or `~/.local/share/opencorvus`.
- The core runtime, channel runtime, and Tauri Overlay resolve the same root contract.
- Production temporary directories no longer create top-level `opencorvus-*` entries
  in the operating-system temporary directory.
- Test fixtures create all temporary repositories beneath one process-owned test root
  inside the canonical `<root>/tmp/tests` tree and remove that root on
  normal completion/exit. Tests must not create OpenCorvus entries in the operating-
  system temporary directory.
- One shared operational directory manager owns directory initialization, temporary
  child creation, and recursive cleanup. Callers do not implement those operations
  independently.
- Overlay settings, embedded sidecar payloads, logs, and the Windows WebView2 user data
  folder live below the canonical root.
- Existing running processes are not stopped and existing user data is not moved,
  deleted, or copied while files are live.
- Positive non-UI path-contract tests, focused runtime tests, typecheck, docs health,
  and a real Overlay launch plus screenshot review pass.
- The final candidate receives a second manual source/diff review before push.

### Hard Constraints

- No legacy-path scanning, runtime migration, fallback, alias, or dual-write behavior.
- `SCHEMA_DDL` remains the only database schema source. This task does not reset,
  migrate, copy, or recreate the live database.
- Do not stop the currently running Overlay or sidecar.
- Do not create a worktree or overwrite unrelated untracked files.
- Do not add, modify, or run UI automation tests. UI validation is a real launch,
  interaction, screenshot, and manual visual review only.
- Do not add negative tests. Tests assert the complete resolved layout or typed errors.
- Use Tauri's supported WebView data-directory primitive rather than an iframe,
  environment hack, or handwritten browser-profile mechanism.
- Abbreviations are expanded on first use: XDG is the Cross-Desktop Group directory
  convention; PID is process identifier; STT is speech to text; UDF is WebView2 user
  data folder.

### Sources Read

- `AGENTS.md`
- `specs/current/architecture/02-data.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/2026-07-10-cross-platform-native-binary-installation.md`
- `specs/records/2026-07/2026-07-16-gui-installer-matrix-and-db-schema-backup.md`
- `packages/opencorvus/src/global/index.ts`
- `packages/opencorvus/src/project/runtime-paths.ts`
- `packages/opencorvus/src/storage/db.ts`
- all production `os.tmpdir()` / `tmpdir()` call sites under
  `packages/opencorvus/src` and `packages/channel-runtime/src`
- `packages/channel-runtime/src/bundled-env.ts`
- `packages/channel-runtime/src/dashscope.ts`
- `packages/channel-runtime/src/format.ts`
- `packages/channel-runtime/src/stt/providers/local-cli.ts`
- `packages/overlay/src-tauri/src/main.rs`
- `packages/overlay/src-tauri/tauri.conf.json`
- `packages/opencorvus/test/preload.ts`
- `packages/opencorvus/test/fixture/fixture.ts`
- Tauri 2 `WebviewWindowBuilder::data_directory` documentation
- Microsoft WebView2 UDF guidance
- Browser control skill instructions for final real-page visual review

### Whole-Repository Search and Runtime Evidence

- `Global.Path` currently splits config/data/cache/state through `xdg-basedir` and an
  independent `OPENCORVUS_GLOBAL_CONFIG_DIR` override. On Windows this repository run
  resolved to four dot-directories under the user profile instead of the documented
  AppData roots.
- The machine contains OpenCorvus-owned trees under `.config`, `.cache`, `.local/share`,
  `.local/state`, `AppData/Local/opencorvus`, `AppData/Local/ai.opencorvus.overlay`, and
  `AppData/Roaming/ai.opencorvus.overlay`.
- The measured core dot-directories contain at least 10,821 files and 152.29 MiB.
- The operating-system temporary directory contains 14,110 OpenCorvus/STT directories:
  13,264 test fixture directories, 296 supervisor directories, 546 other OpenCorvus
  directories, two browser directories, and two Git index directories. The oldest
  observed residue dates to 2026-06-06.
- Fifteen production TypeScript call sites derive paths directly from `os.tmpdir()` or
  `tmpdir()`; channel-runtime independently derives state/auth/screenshot paths and
  scans multiple candidate auth locations.
- Tauri currently writes settings through `app_config_dir`, payload/logs through
  `app_local_data_dir` / `app_log_dir`, and creates its WebView profile under the Tauri
  application directory.
- The official bundle deliberately removes `OPENCORVUS_HOME` from its sidecar, which
  causes the Overlay host and sidecar to resolve different roots.
- PID 17416 (`opencorvus-overlay`) and PID 14712 (`opencorvus`) were running during
  discovery, so physical cleanup is unsafe in this turn until those processes exit.
- Searches covered `OPENCORVUS_HOME`, `OPENCORVUS_GLOBAL_CONFIG_DIR`, XDG/AppData/home
  derivation, every `Global.Path` consumer, every production temporary-directory
  creator, Tauri app path resolver, channel-runtime auth/state/screenshot paths, and
  test fixture root creation.
- Follow-up whole-repository search found 262 TypeScript/Rust files referring to
  `tmpdir`, `temp_dir`, or `mkdtemp`. This proved that path resolution was converged
  before directory lifecycle management was converged. The completed Bun preload now
  projects `TEMP`, `TMP`, and `TMPDIR` into its canonical process root before tests load,
  so package-local `os.tmpdir()` helpers resolve below `<root>/tmp/tests`; production
  owners, benchmarks, and Rust tests use the canonical manager or fixed runtime children.
- Post-delivery continuation audit found one remaining production-visible second root:
  `Global.Path.config` still accepted `OPENCORVUS_TEST_GLOBAL_CONFIG_DIR`, with 25 source
  and test files depending on that exact-directory override. Benchmarks also selected a
  repository-local `.opencorvus/tmp/benchmarks` owner, while Rust tests selected the
  package `target/opencorvus-tests` tree. All three bypass the one-root identity even
  though they no longer scatter top-level operating-system temporary directories.

### Independent Agent Feedback

- No sub-agent was started because the user did not request delegation or parallel
  independent review. Repository rules prohibit unsolicited sub-agent spawning in the
  current collaboration mode.

## Root Cause

The directory spread is architectural rather than a cleanup-script problem. The core,
channel runtime, Tauri host, WebView engine, and tests each own separate path derivation.
`OPENCORVUS_HOME` only activates an optional portable branch and therefore cannot serve
as the default source of truth. Direct operating-system temporary-directory use creates
thousands of sibling directories whose cleanup depends on every call site exiting
perfectly. Deleting today's residue without replacing these owners would recreate the
same spread.

## Design

### Canonical Cross-Runtime Layout

`@opencorvus-ai/util/runtime-paths` owns the pure TypeScript root/layout contract. Core
and channel runtime consume it directly. The Rust host implements the same small
cross-language contract and has focused Rust path tests.

```text
<root>/
  bin/
  cache/
  config/
  data/
  log/
  state/
  tmp/
  overlay/
    embedded/
    webview/
```

`Global.Path.root` exposes the identity; every other `Global.Path` member joins a fixed
child to that identity. `Global.createTemporaryDirectory(prefix)` is the only core
production temporary-directory creator and ensures `<root>/tmp` exists before `mkdtemp`.
Channel runtime uses the shared layout for bundled state, auth, screenshots, and STT
temporary files.

### Overlay Ownership

The main Tauri window remains declared in `tauri.conf.json`, but `create: false` makes
the Rust setup hook instantiate it through `WebviewWindowBuilder::from_config` with
`data_directory(<root>/overlay/webview)`. Settings resolve to
`<root>/config/overlay.jsonc`; payloads resolve to `<root>/overlay/embedded`; native and
sidecar logs resolve to `<root>/log`; the sidecar always receives the exact canonical
root. The same mature Tauri window config remains the source for geometry and behavior.

### Test Temporary Ownership

The shared directory manager creates one process-owned root under the canonical
`<root>/tmp/tests` owner outside the tested Git worktree. The preload binds `OPENCORVUS_HOME`, `TEMP`,
`TMP`, and `TMPDIR` to descendants of that root before source modules load, so existing
third-party and package-local test helpers also remain inside the owner without a
second path resolver. Every fixture and Git template is a child of that root.
`afterAll` and an exit handler use the same manager to remove the complete process
root, including Windows read-only Git objects. A crash can leave at most one
process-root directory inside `<root>/tmp/tests`, never entries across the system
temporary directory.

Test isolation changes the complete `OPENCORVUS_HOME` identity or uses
`Global.provideRoot`; it must not override `config` independently. Benchmark and Rust
test owners are fixed descendants of the canonical runtime `tmp` directory, not
repository-local or package-local second roots.

### Existing Data Boundary

Runtime code does not inspect or copy historical paths. This is an intentional current
layout break for an unpublished product and prevents a second authority from surviving.
Physical consolidation of the machine's existing trees is a separate explicit
maintenance action after Overlay/sidecar exit. Database files must move as one closed
SQLite set (main database plus Write-Ahead Log and shared-memory companions) and must
not be opened, copied, or structurally modified during this implementation.

## Verification Plan

1. Assert Windows, macOS, Linux, and explicit-root layouts resolve to complete exact
   child sets under one root.
2. Assert blank/relative explicit roots return their typed path-contract errors.
3. Assert `Global.Path` and channel runtime consumers use the shared resolved layout.
4. Assert production temporary creation returns a path below `<root>/tmp` and cleanup
   leaves that owner empty.
5. Run focused core, channel-runtime, and Rust path tests; do not run UI tests.
6. Run `bun run typecheck`, API route checks, docs checks, document-health checks,
   historical-links checks, and `git diff --check`.
7. Launch a task-scoped real Overlay instance with an isolated root, inspect the actual
   page, capture a screenshot, and manually review window/layout behavior and the
   resulting on-disk tree.
8. Review the final diff and resolved-path inventory a second time, commit with the
   required prefix, and push `v0.0.29beta` to `git-cc`.

## Implementation Status

- Implemented across the shared TypeScript resolver, core `Global.Path`, channel runtime,
  Overlay/Tauri host, installers, container entrypoint, operator documentation, production
  temporary owners, and test preload.
- Follow-up correction introduced `@opencorvus-ai/util/runtime-directories` as the single
  operational owner for initialization, temporary child creation, and cleanup. Core,
  channel runtime, build scripts, benchmark scripts, Overlay icon generation, the Bun
  preload, and the shared fixture helper consume it. Rust tests now write beneath the
  canonical `<root>/tmp/tests/rust` owner rather than a package-local `target` tree.
- Removed the test-only exact config-directory override. Tests now replace the complete
  runtime identity through `OPENCORVUS_HOME` or `Global.provideRoot`, and the shared test
  runtime fixture closes project and database resources before Windows removes that root.
  Benchmarks now use `<root>/tmp/benchmarks` as their only owner.
- The Bun test process root moved from the operating-system temporary directory to the
  canonical `<root>/tmp/tests` tree outside the tested Git worktree. A focused isolated-child test confirms
  the complete environment projection and confirms the process owner is empty after the
  run.
- Verified with repository typecheck and push hooks, API route and docs checks, focused core,
  channel, container, document-health, historical-link and Rust path tests, plus `cargo check`.
- A real Vite-served Overlay page was opened in the in-app browser and manually reviewed at
  desktop size. The sidebar, titlebar, Composer, suggested actions, and right-dock controls
  rendered without layout regressions. The browser-only mailbox event-stream timeout was
  expected because that inspection surface does not provide the native Tauri event bridge.
- Existing scattered machine data was intentionally left untouched while the current
  Overlay/sidecar processes were running. This version does not scan or migrate those paths;
  closed-process physical cleanup remains an explicit maintenance action.
