# Binary Native Node Modules

Date: 2026-06-04

## Problem

The Bun-compiled OpenCorvus binary changes `cwd` to the executable directory so native Node packages can resolve from a co-located `node_modules` directory. The packaging script only copies Playwright runtime packages, so runtime paths that load native packages can fail after packaging even though the development workspace can load them.

Observed failure: the build agent session processor could not load the `sharp` native module on `win32-x64`.

## Call Points

Full-repo grep for the packaging helpers found:

| Symbol                                    | Call points                                                                                                                                                                                              | Action                                                                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `artifactExternalModules()`               | `packages/opencorvus/script/build.ts`, `packages/opencorvus/script/build.local.ts`, `packages/opencorvus/test/script/build-artifact.test.ts`                                                             | Extend the single external-module source to include native packages that must resolve from packaged `node_modules`.                            |
| `artifactBrowserMcpNodeExternalModules()` | `packages/opencorvus/script/build.ts`, `packages/opencorvus/script/build.local.ts`, `packages/opencorvus/test/script/build-artifact.test.ts`                                                             | Keep it derived from `artifactExternalModules()`.                                                                                              |
| `copyBrowserRuntimeNodeModules()`         | `packages/opencorvus/script/build.ts`, `packages/opencorvus/script/build.local.ts`                                                                                                                       | Replace with target-aware runtime node module copy so the main binary and Browser MCP node sidecar share one package set.                      |
| `copyRuntimeNodeModules()`                | `packages/opencorvus/script/build.ts`, `packages/opencorvus/script/build.local.ts`, `packages/opencorvus/script/build-runtime-node-modules.ts`, `packages/opencorvus/test/script/build-artifact.test.ts` | Shared package-tree copier. Resolve dependencies from the package that declares them and copy them under that package's nested `node_modules`. |
| Native runtime imports                    | `src/file/watcher.ts`, `src/gui/screenshot.ts`, `src/platform/capability.ts`, Claude agent SDK optional `@img/sharp-*` packages, `sharp` package                                                         | Package the target platform native packages instead of asking users to install per-platform dependencies manually.                             |

## Runtime Package Matrix

Packages always copied:

- `playwright`
- `playwright-core`
- `chromium-bidi`
- `sharp`
- `@img/colour`
- `detect-libc`
- `semver`
- `@parcel/watcher`
- `node-screenshots`

Target-specific packages:

| Target              | Packages                                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `win32-x64`         | `@img/sharp-win32-x64`, `@parcel/watcher-win32-x64`, `node-screenshots-win32-x64-msvc`                                              |
| `darwin-x64`        | `@img/sharp-darwin-x64`, `@img/sharp-libvips-darwin-x64`, `@parcel/watcher-darwin-x64`, `node-screenshots-darwin-x64`               |
| `darwin-arm64`      | `@img/sharp-darwin-arm64`, `@img/sharp-libvips-darwin-arm64`, `@parcel/watcher-darwin-arm64`, `node-screenshots-darwin-arm64`       |
| `linux-x64` glibc   | `@img/sharp-linux-x64`, `@img/sharp-libvips-linux-x64`, `@parcel/watcher-linux-x64-glibc`, `node-screenshots-linux-x64-gnu`         |
| `linux-x64` musl    | `@img/sharp-linuxmusl-x64`, `@img/sharp-libvips-linuxmusl-x64`, `@parcel/watcher-linux-x64-musl`, `node-screenshots-linux-x64-musl` |
| `linux-arm64` glibc | `@img/sharp-linux-arm64`, `@img/sharp-libvips-linux-arm64`, `@parcel/watcher-linux-arm64-glibc`, `node-screenshots-linux-arm64-gnu` |
| `linux-arm64` musl  | `@img/sharp-linuxmusl-arm64`, `@img/sharp-libvips-linuxmusl-arm64`, `@parcel/watcher-linux-arm64-musl`                              |

`node-screenshots` does not publish a `linux-arm64-musl` package in version `0.2.8`, so the matrix does not invent one.

## Package Management Constraint

Do not run `npm install --os/--cpu` inside the Bun workspace. The build must copy packages from the package manager's existing install graph. If a target package is missing locally, the build should fail with a direct message that the target package is unavailable in the current install, rather than mutating the lockfile for another platform.

## Codex Review Feedback

The first target-aware copy implementation flattened every runtime package by resolving from `packages/opencorvus/package.json`. That missed Bun-linked packages nested under their declaring dependency, including `sharp/node_modules/@img/colour`, and would also collapse conflicting transitive dependencies such as `detect-libc` for Sharp and Parcel. The revised implementation copies root external packages at the artifact root and copies each declared dependency plus target native package under the declaring package's own `node_modules`.
