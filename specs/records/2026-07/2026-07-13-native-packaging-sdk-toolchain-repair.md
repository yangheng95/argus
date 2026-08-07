# Native Packaging SDK Toolchain Repair

## Recall

### User Request

- Complete the package build on the freshly cloned `v0.0.3beta` branch.
- Resolve the local toolchain problems instead of stopping at the first missing dependency.

### Acceptance Criteria

- A fresh checkout with `bun install --frozen-lockfile` can run `bun run package:binary-matrix` without a separate undocumented SDK build command.
- The native packager builds the Software Development Kit (SDK) before compiling CLI consumers of `@opencorvus-ai/sdk`.
- Packaged OpenCorvus, Ripgrep, and Browser Model Context Protocol (MCP) Node.js executables all pass real `--version` smoke checks.
- The matching macOS ARM64 matrix row builds, executes `opencorvus --version`, validates the complete colocated runtime, and creates its archive.
- Focused packaging tests, spec/document health checks, and a second artifact inspection pass succeed.

### Hard Constraints

- Keep `script/package-native-binary.ts` as the single native bundle lifecycle used by both `package:native-binary` and `package:binary-matrix`.
- Do not add a fallback resolver or source-import bypass for `@opencorvus-ai/sdk`; its package exports continue to point to generated `dist` output.
- Do not interfere with any running OpenCorvus or Overlay process.
- Preserve unrelated worktree changes and do not create another worktree.

### Sources Read

- `AGENTS.md`
- `packages/opencorvus/test/AGENTS.md`
- `README.md`
- `CONTRIBUTING.md`
- `RELEASE.md`
- `docs/packaging.md`
- `package.json`
- `packages/opencorvus/package.json`
- `packages/sdk/js/package.json`
- `script/package-native-binary.ts`
- `script/package-binary-matrix.ts`
- `.github/workflows/build.yml`
- `packages/opencorvus/test/script/package-native-binary.test.ts`
- `packages/opencorvus/test/script/package-binary-matrix.test.ts`
- `packages/opencorvus/test/script/release-overlay-contract.test.ts`
- `specs/records/2026-07/2026-07-10-cross-platform-native-binary-installation.md`

### Whole-Repository Search Evidence

- Root `package:native-binary` directly runs `script/package-native-binary.ts`; `package:binary-matrix` reaches the same implementation through `packageNativeBinary`.
- `packageNativeBinary` builds Overlay UI and then compiles the CLI, but it does not build `packages/sdk/js/dist` first.
- `@opencorvus-ai/sdk` is a valid workspace link whose exports intentionally resolve only to `packages/sdk/js/dist`; the failed fresh build therefore cannot resolve four real CLI/runtime imports.
- `.github/workflows/build.yml` currently builds the SDK before invoking the matrix, while public local-install docs instruct users to run the native packager without that extra command.
- `script/generate.ts`, `script/publish.ts`, and the project-open benchmark invoke the SDK generator for their own workflows; they do not own native package preparation.
- Searches used: `rg '@opencorvus-ai/sdk|packages/sdk/js/script/build.ts|packageNativeBinary\\(|package:native-binary|package:binary-matrix'` across the repository, excluding installed/generated output.

### Independent Agent Feedback

- No independent agent was requested, and the active collaboration policy prohibits spawning sub-agents unless the user explicitly asks for delegation. The repair is bounded to the native packaging lifecycle and its focused tests.

## Root Cause

- Observable failure: the native matrix reaches Bun compile and reports that `@opencorvus-ai/sdk` cannot be resolved from four production imports.
- Direct trigger: `packages/sdk/js/dist` does not exist after a fresh frozen dependency install.
- Deeper cause: local native packaging omits SDK generation, while CI carries a separate preparatory step. This makes CI and the documented local packager two different dependency pipelines.
- Secondary toolchain failure: without a host Node.js runtime, the existing bundle copied Bun's `node` compatibility wrapper; the old verifier accepted it because it checked only file existence.
- Required repair: make the native packager prepare the SDK before compiling the CLI, install the documented Node.js 22 toolchain, and execute every packaged runtime during verification.

## Implementation

- `script/package-native-binary.ts` now owns the ordered SDK and CLI build commands for both local and CI native packaging.
- The CLI release job no longer duplicates SDK generation before calling the native package matrix; the independent Overlay release job retains its SDK prerequisite.
- Native bundle verification now executes OpenCorvus, Ripgrep, and Browser MCP Node.js with `--version` before archiving.

## Verification

- Focused native packaging tests.
- Spec history and document-health tests required for this record.
- `bun run package:binary-matrix` on the current macOS ARM64 host.
- Archive listing, executable `--version`, required runtime file inspection, and `git diff --check`.

## Results

- Installed Bun 1.3.13, Bunx 1.3.13, and the SHA-256-verified official Node.js 22.23.1 macOS ARM64 distribution in the user toolchain.
- `bun run package:binary-matrix` passed and packaged the native `darwin-arm64` row.
- `packages/opencorvus/dist/opencorvus-darwin-arm64.tar.gz` is 101,705,761 bytes with SHA-256 `970f37fc4479d58b0050ad5536b6929cdead7c880a5fd5fabb278629620f2af3`.
- Independent artifact checks passed for OpenCorvus `0.0.1`, Ripgrep `15.1.0`, Browser MCP Node.js `v22.23.1`, archive readability, UI, Browser MCP sidecar, and Playwright package presence.
- Focused native packaging and release-contract tests passed: 21 tests, 0 failures.
- Root typecheck passed: 9 Turbo tasks, 0 failures. API route check, API docs check, Overlay i18n check, dead-code check, historical links, product-doc single-source tests, and `git diff --check` passed.
- SDK generation surfaced and committed the previously stale `cursorPinned` OpenAPI query parameter.
- The broader document-health suite has one pre-existing failure: `agent-compact-visual-stress.test.ts` does not yet implement the expected `finalizeBrowserEvidence` evidence aggregation contract. This does not affect the native CLI bundle, and no test expectation was weakened to hide it.
