# Packaging Current State

This document is the packaging map for the repository. It separates the CLI
binary, the Tauri overlay desktop app, release CI, and local smoke packaging.

## Package Surfaces

| Surface                   | Main output                                                                                                        | UI hosting model                                                                                                          | Current owner                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| CLI binary                | `packages/opencorvus/dist/opencorvus-<platform>/opencorvus(.exe)`                                                  | CI currently stages `ui/` sidecar assets next to the CLI binary.                                                          | `packages/opencorvus/script/build.ts` and `.github/workflows/build.yml`                                               |
| Local Linux single binary | `packages/opencorvus/dist/binary/opencorvus-linux-x64/opencorvus` and `...-baseline/opencorvus`                    | Overlay UI files are embedded into the Bun executable; no sibling `ui/` directory is required.                            | `script/package-linux-binary.ts`                                                                                      |
| Overlay desktop app       | `packages/overlay/dist/opencorvus-overlay-<platform>-<arch>/opencorvus-overlay(.exe)` plus installer bundles in CI | Tauri embeds an `opencorvus-overlay-server-*` sidecar archive through Rust `include_bytes!`, then extracts it at runtime. | `packages/overlay/script/build.ts`, `packages/overlay/script/build-overlay.ts`, `packages/overlay/src-tauri/build.rs` |
| Overlay server sidecar    | `packages/opencorvus/dist/opencorvus-overlay-server-<platform>-<arch>/opencorvus(.exe)`                            | No web UI sidecar contract; it is the backend payload consumed by the Tauri overlay.                                      | `packages/opencorvus/script/build.ts --overlay-server`                                                                |

## Root Scripts

| Command                         | Script                                     | Purpose                                                                             | Platform behavior                                                                                                                |
| ------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `bun run package:linux-binary`  | `script/package-linux-binary.ts`           | Build Linux x64 and Linux x64 baseline CLI executables with embedded overlay UI.    | Requires Linux x64 or WSL. Rejects other hosts.                                                                                  |
| `bun run package:binary-matrix` | `script/package-binary-matrix.ts`          | Run the host-verifiable package matrix.                                             | Packages Linux x64 on Linux x64; lists Linux ARM64, macOS, and Windows rows as skipped on unsupported hosts.                     |
| `bun run package:local`         | `script/package-local.ts`                  | Older local aggregate for overlay-server and overlay builds.                        | Uses Bun for overlay-server, native Tauri for current host overlay, Docker for Linux overlay targets, and skips macOS off macOS. |
| `bun run build:overlay`         | `packages/overlay/script/build-overlay.ts` | Build the bound overlay app for the current host or explicit same-OS target triple. | Rejects cross-OS Tauri builds.                                                                                                   |

## OpenCorvus Build Scripts

| Script                                         | Role                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/script/build.ts`          | Main Bun compile script. Supports CLI and `--overlay-server` flavors, `--single`, `--all`, `--baseline`, `--musl-only`, `--no-clean`, and `--binary-only`. It compiles the executable, packages native runtime `node_modules`, builds Browser MCP Node sidecars, and copies a target-compatible Node runtime. |
| `packages/opencorvus/script/build-targets.ts`  | Pure target filtering for `build.ts`. Keeps target selection testable without running compile side effects.                                                                                                                                                                                                   |
| `packages/opencorvus/script/build-artifact.ts` | Artifact naming, entrypoint, external-module, native dependency, and Node runtime rules for Bun compile outputs.                                                                                                                                                                                              |
| `packages/opencorvus/script/build.local.ts`    | Local build variant still present in the tree. It is not the root `package:linux-binary` entrypoint.                                                                                                                                                                                                          |

## Overlay Build Scripts

| Script                                      | Role                                                                                                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/script/build-overlay.ts`  | Developer-facing full overlay build. Runs i18n check, Vite build, SDK rebuild, `opencorvus --overlay-server` build, then `tauri build --no-bundle`.             |
| `packages/overlay/script/build.ts`          | Release overlay build. Builds the overlay-server sidecar, builds Vite, cleans stale resources, and runs `tauri build --bundles` for platform installer outputs. |
| `packages/overlay/script/build-docker.ts`   | Linux overlay Docker builder. Requires prebuilt `opencorvus-overlay-server-linux-*` payloads and produces portable overlay directories.                         |
| `packages/overlay/script/artifact-names.ts` | Single naming helper for overlay package, executable, and overlay-server sidecar names.                                                                         |
| `packages/overlay/src-tauri/build.rs`       | Rust build script that archives the overlay-server payload as `embedded_sidecar.tar.gz` and emits an `include_bytes!` module.                                   |

## Release CI

`.github/workflows/build.yml` is the canonical release workflow.

It currently has these jobs:

1. `prepare`: resolves version, syncs package metadata, and optionally creates the GitHub Release.
2. `package-cli`: builds native and baseline CLI artifacts for Linux x64, Linux ARM64, macOS ARM64, macOS x64, and Windows x64. Linux also builds musl variants in Docker.
3. `package-overlay`: builds the Tauri overlay app and installer bundles on the same platform matrix.
4. `publish-release-assets`: uploads overlay artifacts to the GitHub Release.
5. `publish-release-branch`: assembles platform directories and pushes the `release` branch.

Important current mismatch:

- `package-cli` still builds CLI artifacts with `packages/opencorvus/script/build.ts`, then separately copies `packages/overlay/dist-vite` into each `dist/opencorvus-<platform>/ui/` directory.
- `script/check-release-assets.ts cli` still requires `ui/index.html`, a JavaScript file, and a CSS file under that sidecar UI directory.
- `script/package-linux-binary.ts` now builds a different local Linux package shape under `dist/binary/*/opencorvus`: the UI is embedded into the executable, and the output intentionally has no `ui/` directory.
- `publish-release-branch` copies only top-level files from `dist/opencorvus-<platform>`, so it does not preserve the sidecar `ui/` directory. Until CI is moved to embedded-UI CLI binaries or the release branch copy logic is changed, the release branch CLI layout is not equivalent to the uploaded CI dist artifact layout.

## Validation Commands

Run the script and route tests after changing packaging logic:

```bash
bun test packages/opencorvus/test/script/package-linux-binary.test.ts packages/opencorvus/test/script/package-binary-matrix.test.ts packages/opencorvus/test/server/overlay-ui-handler.test.ts packages/opencorvus/test/server/overlay-ui-traversal.test.ts
```

Run a Linux x64 single-binary package from WSL or Linux:

```bash
bun run package:binary-matrix
```

The Linux single-binary smoke check must copy only the executable to an empty
directory, run `opencorvus serve`, and fetch `/ui/`. Passing that check proves
the UI is embedded rather than accidentally served from a sibling `ui/`
directory or workspace `packages/overlay/dist-vite`.

## Current Linux Binary Outputs

The latest local package run produced:

| File                                                                       |    Size |
| -------------------------------------------------------------------------- | ------: |
| `packages/opencorvus/dist/binary/opencorvus-linux-x64/opencorvus`          | 172 MiB |
| `packages/opencorvus/dist/binary/opencorvus-linux-x64-baseline/opencorvus` | 171 MiB |

Both files report version `0.0.1` and serve `/ui/` without a sibling `ui/`
directory.
