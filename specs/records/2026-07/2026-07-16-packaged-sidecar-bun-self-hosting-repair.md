# Packaged Sidecar Bun Self-Hosting Repair

## Recall

- User request: explain and repair why the macOS GUI package produced after the native folder-picker fix cannot start its backend, then produce a corrected package.
- Acceptance criteria: the packaged sidecar starts without a shell-provided Bun executable; package registry and plugin installation retain strict failure reporting; focused regressions, type checking, real compiled-sidecar execution, native package verification, and a second review pass succeed.
- Hard constraints: preserve one executable source and one dependency-install path; do not add a fallback, compatibility branch, startup gate, or second bundled Bun; do not restart or otherwise interfere with the user's running Overlay; retain unrelated untracked package artifacts; commit subjects use `dsw-33987`; push the finished main delivery branch to `myhexin`.
- Sources read: the current sidecar logs under `~/Library/Logs/ai.opencorvus.overlay`, the extracted embedded package under `~/Library/Application Support/ai.opencorvus.overlay/embedded`, `packages/opencorvus/src/bun/{executable,index,registry}.ts`, `packages/opencorvus/test/bun-strict-install.test.ts`, commit `fdebbfcba9`, and the July/root spec indexes.
- Whole-repository search: `BunExecutable` is called by `BunProc.run`, `BunProc.which`, and `PackageRegistry.info`; all three command paths already provide `BUN_BE_BUN=1`. Other `BUN_BE_BUN` users consume `BunProc.which` or explicitly start the compiled application as Bun. Basename helpers in PTY, package-require, ripgrep, and browser Node-sidecar selection decide different runtime concerns and are unchanged.
- Independent agent feedback: none; the user did not request sub-agent or parallel-agent review.

## Evidence and causal chain

The packaged Overlay extracted its embedded sidecar successfully, but the sidecar logs repeatedly terminated with `Bun executable is required for package registry and installation operations`. Finder-launched applications do not inherit the interactive shell's Bun path. `BunExecutable.resolve()` therefore rejected `process.execPath` because its basename was `opencorvus`, then failed to find a separate `bun` executable.

That basename rule contradicts the actual Bun-compiled runtime contract already used by both callers: they start the selected executable with `BUN_BE_BUN=1`. Running the exact extracted package binary with that environment produced Bun version `1.3.13` and exit code zero. The compiled sidecar is therefore the required Bun command-line executable; no separate Bun installation is needed.

Observable failure → dependency preparation throws during backend startup → `BunExecutable.resolve()` rejects the compiled sidecar by filename → commit `fdebbfcba9` encoded an incorrect assumption that a compiled Bun application cannot self-host the Bun command-line interface → Finder's environment exposed the regression because no unrelated system Bun masked it.

## Implementation

`BunExecutable.resolve()` remains the sole executable authority and returns the current runtime executable for both development and compiled distributions. `BunProc` and `PackageRegistry` continue to apply `BUN_BE_BUN=1` and continue to throw on failed registry or installation commands. The incorrect path lookup and basename gate are deleted rather than retained as an alternate route.

The regression test covers both a development Bun path and a packaged OpenCorvus application path. Final package evidence must execute the newly built compiled sidecar with `BUN_BE_BUN=1 --version`, exercise an isolated backend startup/health path, verify signatures and artifacts, and record hashes here before delivery.

## Verification record

- Focused strict dependency regressions: 20 passed across `bun-strict-install`, config dependency strictness, and plugin strict-failure suites.
- Repository type check: 10 package tasks passed; SDK import and AI runtime checks passed.
- Spec/document health: 81 passed across historical links, document health, and product-doc single-source suites.
- GUI packaging contracts: 24 passed across installer-matrix and release-overlay contract suites.
- Native package command: `bun run package:gui-installer-matrix` completed for `darwin-arm64`; other operating-system/architecture rows were truthfully skipped because this host cannot validate them.
- Compiled sidecar self-host: `BUN_BE_BUN=1 .../opencorvus --version` returned `1.3.13`; sidecar SHA-256 is `d0d8a740b4aa4a6dafdd4155863fc22e0e6fc8e3b99187d39ce4dd26479abd6c`.
- Isolated Finder-like environment: the compiled sidecar started with `PATH=/usr/bin:/bin`, and `GET /global/health` returned `healthy: true`, version `0.0.7-beta`, and runtime paths under the isolated temporary home. The test server then completed its normal SIGINT shutdown with zero live tasks or sessions.
- macOS verification: the `.app` and staged GUI executable satisfy `codesign --verify --deep --strict`; `hdiutil verify` reports the disk image checksum valid; both executables are Mach-O ARM64.
- Staged SHA-256 values: GUI executable `ab1fe24986b864a7fb51fbbcdfd2b99ab7823bf202eb9efe2b31edcd3ce75524`; DMG `3c050b71a26ff7cf7d89bf1177b8f9ed2cfb682637ad1f271c135816c64d4560`; application archive `09d9657f6786e7cd9ce847b5934fb348cf2d6d746d45e525c52a6ab7ee0850e2`.
- Second review: the final source diff retains one executable resolver, both callers retain strict exit-code/error handling and `BUN_BE_BUN=1`, no alternate Bun lookup remains, generated package-schema output was removed, and the user's unrelated concurrent spec edits remain untouched.
