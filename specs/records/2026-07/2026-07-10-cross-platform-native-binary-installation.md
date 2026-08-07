# Cross-Platform Native Binary Installation

## Recall

### User Request

- Change OpenCorvus to a cross-platform native binary installation mode.
- Keep `build:overlay` enabled; do not delete it.

### Interpreted Product Boundary

- The public OpenCorvus terminal/VS Code installation path uses host-native CLI-flavor runtime bundles for Windows, macOS, and Linux.
- A runtime bundle may contain required colocated native modules and helper binaries; “native binary” does not imply an invalid single-file claim.
- Tauri Overlay and remote overlay-server packages remain an independent product surface built from the overlay-server flavor; `build:overlay` remains enabled.

### Acceptance Criteria

- The package matrix has executable native-host packagers for Windows x64, macOS arm64/x64, and Linux x64/arm64 rows rather than declared rows that always skip.
- Each native-host package builds the OpenCorvus CLI flavor, includes the canonical Overlay UI, verifies the complete colocated runtime bundle with `opencorvus --version`, and writes an atomic platform archive.
- The install contract selects exactly one archive for the current supported platform/architecture and installs its complete bundle.
- Public English and Chinese install docs lead with verified native binary installation instead of repository source build.
- `build:overlay` remains present and executable in both the repository root and `packages/overlay/package.json`.
- CLI native runtime packaging and Tauri Overlay packaging remain separate commands with no duplicated build implementation.
- Native GitHub runners build and smoke-test their own artifacts; no unsupported cross-OS runtime validation is claimed.
- Runtime evidence proves the current matrix gap before implementation and proves each implemented native-host row after implementation.

### Hard Constraints

- No fallback from native archive installation to npm/Bun source installation.
- Do not claim a single-file executable when native modules, Ripgrep, Node, or helper binaries must remain colocated.
- Do not cross-compile an artifact and call it verified without executing it on its native operating system.
- Do not delete or disable `build:overlay`.
- Do not interfere with a running OpenCorvus/Overlay process.
- Preserve unrelated dirty worktree changes.
- Keep debug instrumentation until post-fix runtime verification succeeds.

### Sources Read

- `AGENTS.md`
- `specs/records/2026-07/2026-07-09-github-overlay-package-ci.md`
- `specs/records/2026-07/2026-07-10-official-cross-platform-project-open-risk-reduction.md`
- `package.json`
- `packages/opencorvus/package.json`
- `packages/overlay/package.json`
- `packages/opencorvus/script/build.ts`
- `packages/opencorvus/script/build.local.ts`
- `packages/opencorvus/script/build-targets.ts`
- `script/package-local.ts`
- `script/package-binary-matrix.ts`
- `script/package-native-binary.ts`
- `script/package-linux-binary.ts`
- `packages/opencorvus/src/installation/index.ts`
- `packages/opencorvus/src/cli/cmd/uninstall.ts`
- `packages/opencorvus/src/cli/cmd/upgrade.ts`
- `packages/opencorvus/script/postinstall.mjs`
- `packages/opencorvus/script/published-package-bin.mjs`
- `packages/web/src/content/docs/start/install.mdx`
- `packages/web/src/content/docs/zh-cn/start/install.mdx`
- `packages/web/src/content/docs/overlay/overview.mdx`

### Whole-Repository Search Evidence

- Root `build:overlay` delegates to `packages/overlay build:overlay`; the package command delegates to `script/build-overlay.ts`.
- `packages/overlay build` currently means Vite UI only, while `build:overlay` remains the explicit Tauri installer command.
- `packages/opencorvus build` compiles a current-host native Bun executable by default and declares a broader release target list.
- `script/package-binary-matrix.ts` declares Linux, macOS, and Windows rows but only calls a concrete packager for `linux-x64`.
- `script/package-linux-binary.ts` owns complete runtime-bundle copy, version smoke verification, and tar archive creation only for Linux x64.
- `Installation.method/upgrade/latest` still models curl, npm, pnpm, Bun, Homebrew, Chocolatey, and Scoop as parallel installation authorities.
- Public install docs explicitly state repository source build is the only documented verified path.
- Searches used: `rg "build:overlay|package:binary-matrix|package:linux-binary|standalone|native binary" .`; `rg "Installation\\.upgrade|npm install|bun install|brew|scoop|choco|curl.*install" packages/opencorvus`; `rg "Install|binary|Windows|macOS|Linux" packages/web/src/content/docs`.

### Independent Agent Feedback

- The native build audit confirmed three divergent UI delivery paths: CLI sidecar `ui/`, overlay-server embedded UI, and Tauri WebView packaging. It recommends making the existing embedded UI plugin canonical and retaining `build:overlay` as an independent developer command rather than treating it as the release installer.
- The installation audit confirmed that CLI flavor is required by terminal commands and the VS Code `sidecar` command, while overlay-server flavor intentionally exposes only server/MCP entrypoints. Therefore public native installation must package CLI flavor; Tauri and remote server bundles keep overlay-server flavor.
- Both audits confirmed the same ownership boundary: `package-binary-matrix.ts` must dispatch a shared native-host bundle lifecycle; the installer must install the complete bundle; CI must execute/smoke-test on native runners; `build:overlay` must not be coupled to CLI installation.
- The previous workspace-onboarding audit remains relevant only to the earlier default-workspace request and does not change this packaging boundary.

## Runtime Hypotheses

- **B1:** `package:binary-matrix` advertises cross-platform rows but only Linux x64 can return `packaged`; native Windows and macOS rows are hard-coded to `skipped`.
- **B2:** `packages/opencorvus build` already produces a native current-host runtime bundle, but no shared cross-platform archive/install contract consumes it.
- **B3:** `build:overlay` is already independently enabled, so the correct change preserves that command while separating it from CLI/server binary installation.
- **B4:** Runtime installation detection and upgrades still have multiple package-manager authorities, preventing native binary installation from being the single public mode.
- **B5:** Linux packaging contains the reusable bundle-copy/version-check/archive lifecycle, but its platform-specific names and tar-only archive implementation prevent reuse by Windows/macOS.

## Benchmark Contract

- Input: native runner operating system, architecture, OpenCorvus version, built overlay UI.
- Output: one complete runtime bundle and one atomic archive for every supported native matrix row.
- Environment: repository lockfile, native Bun runtime, native Node runtime, Ripgrep, Rust toolchain for Windows helper, and platform archive tool.
- Timeout: commands run through the existing inactivity-based runner when added to automation.
- Pass: archive extraction succeeds, executable reports the requested version, required runtime files exist, and `build:overlay` remains executable.

## Pre-Fix Runtime Evidence

- `debug-052468.log:125-127` records a Windows x64 native run of `package:binary-matrix`.
- The matrix entered with all five declared rows, then returned `skipped` with zero artifacts for every row, including `windows-x64` on the matching Windows x64 host.
- **B1 CONFIRMED:** the declared matrix is not an executable cross-platform native package matrix.
- A separate native Windows build completed with exit code 0. `debug-052468.log:5` records the selected `win32/x64` CLI target; terminal evidence records `building opencorvus-windows-x64` and a completed Rust release helper build.
- **B2 CONFIRMED:** the lower-level build already emits the matching native Windows runtime bundle.
- **B5 PARTIALLY CONFIRMED:** the matrix result proves there is no Windows packaging dispatcher even though the native build succeeds. Archive generalization still needs implementation evidence.
- `build:overlay -- --skip-tauri` completed the independent i18n and Vite pipeline with exit code 0; `debug-052468.log:4` records the Windows x64 overlay configuration and explicit `skipTauri` mode.
- **B3 CONFIRMED:** `build:overlay` is an active independent command and can be retained without coupling native CLI installation to a Tauri build.
- A source-process installation probe returned `unknown`; `debug-052468.log:13` records that result.
- The newly built Windows executable then failed before command handling with `TypeError: undefined is not an object (evaluating 'CheckConfig.optional')`.
- **B4 INCONCLUSIVE:** the packaged executable never reached installation detection, so native installation authority cannot be verified yet.
- **B2 REFINED:** native compilation completes, but the produced executable is not currently runnable and therefore is not an installable artifact.

## Native Startup Failure Hypotheses

- **C1:** Bun compile's `conditions: ["browser"]` changes dependency resolution or module ordering for the CLI launcher and creates the undefined schema binding.
- **C2:** `panel/capability.ts` imports `CheckConfig` and `StageRouting` from the broad `@/engine` barrel, creating a compile-time circular initialization path; direct schema ownership already lives in `@/engine/model`.
- **C3:** another `@/engine` barrel consumer creates the same initialization cycle, so changing only the visible `panel/capability.ts` call site would be incomplete.
- **C4:** the failure is CLI-entrypoint-specific; the overlay-server entrypoint may have a different import graph and must be smoke-tested independently before a shared packager is designed.

## Implementation

- `script/package-native-binary.ts` is the shared native-host lifecycle for Windows x64, macOS x64/arm64, and Linux x64/arm64. It cleans only the matching CLI target directories, preserves unrelated running Overlay artifacts, builds Vite and the CLI flavor, stages the UI, verifies every required runtime file, executes `--version`, and creates the platform archive atomically.
- `script/package-binary-matrix.ts` now invokes that lifecycle for whichever declared row matches the current host. Non-host rows remain explicit skips because they cannot be executed on the current operating system.
- The root `package:native-binary` command exposes the current-host packager. `package:binary-matrix` remains the CI matrix entry.
- The shell installer now rejects loose binaries and installs the complete extracted bundle under `~/.opencorvus/bin`.
- `Installation.method` now has one managed authority, `native`; package-manager probes and upgrade branches were removed. Source/development executions remain explicit `unknown`.
- `.github/workflows/build.yml` delegates native CLI build, UI staging, smoke verification, and archive creation to `package:binary-matrix`. Linux musl remains a native Linux ABI-specific build and is staged/archived after its Docker build.
- `build:overlay` remains unchanged as an independently executable developer command; Tauri release packages remain owned by `packages/overlay/script/build.ts`.
- English and Chinese installation docs lead with the native archive installer and describe the complete bundle boundary.

## Startup Crash Result

- **C2 CONFIRMED:** `panel/capability.ts` was the only observed module that dereferenced `CheckConfig.optional()` at module initialization through the broad `@/engine` barrel. Bun's compiled module order exposed that circular binding as `undefined`.
- The call site now imports `CheckConfig` and `StageRouting` directly from `@/engine/model`.
- Before the change, the compiled Windows CLI terminated with `TypeError: undefined is not an object (evaluating 'CheckConfig.optional')`.
- After the change, a clean matching-target rebuild completed and `packages/opencorvus/dist/opencorvus-windows-x64/opencorvus.exe --version` exited 0 with `0.0.0-v0.0.2beta-202607101321`.
- **C1 REJECTED for the observed crash:** no compile condition changed between the failing and passing binaries.
- **C3 REJECTED for the observed crash:** no second barrel consumer had to change for startup to succeed.
- **C4 INCONCLUSIVE:** the direct CLI regression is fixed, while overlay-server startup remains a separate product verification surface.

## Post-Fix Runtime Evidence

- `debug-052468.log:1-3` records a Windows x64 matrix run after implementation. The matching `windows-x64` row returned `packaged` with two artifacts; every non-host operating-system row remained an explicit skip.
- Terminal runtime evidence executed both Windows binaries through the packager's `--version` check and emitted:
  - `opencorvus-windows-x64/opencorvus.exe` at 143 MiB;
  - `opencorvus-windows-x64.tar.gz` at 121 MiB;
  - `opencorvus-windows-x64-baseline/opencorvus.exe` at 142 MiB;
  - `opencorvus-windows-x64-baseline.tar.gz` at 121 MiB.
- The post-fix matrix process exited 0. The shared `tar.gz` archive format avoided the previous PowerShell `Compress-Archive` duration and uses the same extraction contract on every supported host.
- **B1 FIXED:** the current native Windows row packages instead of being hard-coded to skip.
- **B2 CONFIRMED AND CONSUMED:** the native CLI build output is now verified and archived by the shared package lifecycle.
- **B4 IMPLEMENTED:** runtime installation ownership is `native | unknown`; package-manager authorities are removed.
- **B5 CONFIRMED:** one host-native lifecycle now handles platform naming, complete bundle validation, execution, and atomic archive creation.

## Verification Plan

- Pre-fix and post-fix `package:binary-matrix` runtime evidence in `debug-052468.log`.
- Focused package resolver, matrix, archive, published binary descriptor, and installation method tests.
- Native Windows local package and smoke verification.
- Native Linux and macOS verification through their supported runners; unexecuted workflow YAML is not runtime proof.
- `bun run build:overlay -- --skip-tauri` to prove the retained command reaches its pipeline without requiring a second Tauri package build.
- `bun run typecheck`
- Product-doc single-source and document-health tests.
- `git diff --check`
