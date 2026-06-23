# Packaged Ripgrep Runtime Source

## Problem

OpenCorvus package artifacts are expected to carry the Ripgrep (`rg`) binary, but runtime search currently resolves `rg` from the host `PATH` first. If the host has a different or broken system Ripgrep installation, the packaged application silently uses the wrong executable. If the host has no system Ripgrep, `packages/opencorvus/src/file/ripgrep.ts` downloads Ripgrep into the user data directory at runtime, which is a fallback path and hides packaging defects.

The container image has the same masking problem because it installs the Debian `ripgrep` package, so a missing packaged `bin/rg` can pass smoke checks.

## Call Point Inventory

| Area | Evidence | Decision |
| --- | --- | --- |
| Runtime resolver | `packages/opencorvus/src/file/ripgrep.ts` calls `which("rg")`, then uses `Global.Path.bin`, then downloads GitHub release archives. | Replace with a runtime resolver: packaged executable reads only `<bundle>/bin/rg(.exe)`; Bun source runtime reads developer `PATH` only as the explicit source-mode dependency. Remove runtime download and `Global.Path.bin` fallback. |
| File APIs and tools | `packages/opencorvus/src/file/index.ts`, `src/tool/grep.ts`, `src/tool/glob.ts`, `src/tool/ls.ts`, `src/tool/skill.ts`, `src/server/routes/file.ts`, and debug commands already call `Ripgrep.filepath()` or `Ripgrep.files/search`. | They inherit the central resolver. No caller-specific path logic. |
| Engine codebase search | `packages/opencorvus/src/engine/codebase-tools.ts` spawns literal `"rg"`. | Replace with `Ripgrep.filepath()` so orchestrator search uses the same runtime binary source. |
| Build artifact | `packages/opencorvus/script/build.ts` and `build.local.ts` copy native node modules and Browser MCP Node runtime but do not copy `rg`. | Add a build-time runtime binary copier that requires a host-compatible `rg` and writes `<artifact>/bin/rg(.exe)`. |
| Artifact helpers | `packages/opencorvus/script/build-artifact.ts` owns executable naming helpers. | Add `artifactRipgrepExecutableName()` beside the existing artifact executable helper. |
| Linux bundle and container | `script/package-linux-binary.ts` copies the overlay-server artifact tree; `packages/opencorvus/Dockerfile` installs system `ripgrep`. | Bundle inherits `<artifact>/bin/rg`; Docker stops installing system `ripgrep` and verifies `/opt/opencorvus/bin/rg`. |
| Release validation | `script/check-release-assets.ts` verifies CLI executable and UI files, not `bin/rg`. | Require the packaged Ripgrep binary in every CLI platform directory. |
| Registry scripts | `packages/opencorvus/script/publish.ts` emits AUR and Homebrew system `ripgrep` dependencies. | Remove those generated dependencies so installers cannot mask missing packaged `rg`. |

## Design

Packaged runtime source is `<dirname(process.execPath)>/bin/rg(.exe)`. Missing packaged `rg` is a hard runtime error. There is no lookup of host `PATH` from packaged executables and no runtime download.

Source development runtime is identified by a Bun executable and resolves `rg` from the developer `PATH`. That path is not a packaged fallback; it is the source-mode dependency because no package artifact exists while running `bun src/index.ts`.

Build scripts copy the host `rg` only when the host runtime matches the target OS, CPU architecture, and Linux C library ABI. A mismatch fails the build instead of copying an incompatible executable.

## Validation

- Unit tests for packaged `rg` path computation, packaged precedence over `PATH`, packaged missing error, and source-mode `PATH` resolution.
- Unit tests for build-time `rg` copy and release asset validation.
- Existing `packages/opencorvus/test/file/ripgrep.test.ts` continues to verify search behavior through `Ripgrep.filepath()`.
- Dockerfile static test asserts no system `ripgrep` install remains and bundled `/opt/opencorvus/bin/rg` is checked.
