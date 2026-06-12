# Linux Binary WSL Packaging Plan - 2026-06-12

## Requirement

Package the Linux x64 binary version of OpenCorvus and run it in WSL against project directory:

`C:\Users\chuan\myhexin-local\demos\economy\economy2`

## Existing Sources Recalled

- `script/package-linux-binary.ts` is the single source for Linux x64 binary packaging. It must run on a Linux x64 host, including WSL.
- The script builds `packages/overlay/dist-vite`, generates `packages/opencorvus/src/server/overlay-ui-embedded.generated.ts` temporarily, compiles overlay-server Linux x64 and baseline binaries, then copies them to `packages/opencorvus/dist/binary`.
- Output binaries:
  - `packages/opencorvus/dist/binary/opencorvus-linux-x64/opencorvus`
  - `packages/opencorvus/dist/binary/opencorvus-linux-x64-baseline/opencorvus`
- `packages/opencorvus/test/script/package-linux-binary.test.ts` pins the output paths, embedded UI behavior, host requirement, and build command.
- `packages/opencorvus/script/build.ts` requires a target-platform `node` executable for Browser MCP runtime packaging.

## Call Point Inventory

- Packaging entrypoints:
  - root `package.json`: `package:linux-binary`
  - root `package.json`: `package:binary-matrix`
  - `script/package-linux-binary.ts`
  - `script/package-binary-matrix.ts`
- Build artifact helpers:
  - `packages/opencorvus/script/build.ts`
  - `packages/opencorvus/script/build-artifact.ts`
  - `packages/opencorvus/script/build-targets.ts`
- Tests:
  - `packages/opencorvus/test/script/package-linux-binary.test.ts`
  - `packages/opencorvus/test/script/build-artifact.test.ts`
  - `packages/opencorvus/test/script/build-clean.test.ts`

## Acceptance

1. WSL has a Linux x64 Bun and Linux x64 Node executable available to the build command.
2. `bun run package:linux-binary` succeeds inside WSL from the repository root.
3. Both generated Linux binaries report the package version via `--version`.
4. At least one generated binary starts in WSL with `--project /mnt/c/Users/chuan/myhexin-local/demos/economy/economy2` and exposes a healthy local server.
5. The embedded `/ui/` route returns HTML without requiring a sibling `ui/` directory.
6. Final review confirms no generated temporary source change remains in `overlay-ui-embedded.generated.ts`.
