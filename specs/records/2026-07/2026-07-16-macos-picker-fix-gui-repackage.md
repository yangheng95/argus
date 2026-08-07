# macOS picker-fix GUI repackage

## Recall

| Field | Evidence |
| --- | --- |
| User request | Repackage the macOS Overlay after repairing the Finder-style project-folder picker freeze. |
| Acceptance criteria | Produce a fresh macOS ARM64 Graphical User Interface (GUI) executable, Apple Disk Image (DMG), and `.app` archive from current `v0.0.7beta`; prove the picker fix is in source HEAD; validate release contracts, architecture, version, DMG integrity, hashes, and artifact timestamps. |
| Hard constraints | Use `package:gui-installer-matrix` as the single production packager; package only the native host row; do not restart or interfere with the running Overlay; do not add a second packaging path or commit generated artifacts; push documentation commits to `myhexin/v0.0.7beta` with `dsw-33987`. |
| Sources read | `AGENTS.md`; `specs/records/2026-07/2026-07-16-macos-native-picker-main-thread-freeze.md`; `specs/records/2026-07/2026-07-16-v0.0.7beta-latest-repackage.md`; `script/package-gui-installer-matrix.ts`; `packages/overlay/script/build.ts`; root and Overlay package manifests. |
| Whole-repository search evidence | The root `package:gui-installer-matrix` command is the sole GUI matrix entrypoint. On `darwin-arm64` it builds through the Overlay production build, stages `opencorvus-overlay`, one matching DMG, and one generated `.app.tar.gz`, then runs `check-release-assets.ts --require-bundle`. The current HEAD contains `async fn overlay_pick_dir` and `async fn overlay_pick_files`; blocking picker methods have no other native owners. |
| Git baseline | `v0.0.7beta` and `myhexin/v0.0.7beta` both point to `a53c95d642`; tracked worktree is clean. The existing untracked `packages/overlay/dist-artifacts/darwin-arm64/` contains the prior package and is the canonical matrix staging destination to be replaced. |
| Independent agent feedback | None. The user did not request delegation, and the active collaboration policy forbids unrequested sub-agents. |

## Execution plan

1. Commit and push this packaging plan before replacing artifacts.
2. Run `bun run package:gui-installer-matrix` on the native macOS ARM64 host.
3. Verify the staged executable and bundled `.app` are Mach-O ARM64, all version projections report `0.0.7-beta`, `hdiutil verify` accepts the DMG, release-asset validation passes, and SHA-256 hashes/timestamps are fresh.
4. Record exact evidence, commit and push the validation record, and leave the running Overlay untouched.

## Packaging integrity addendum

The first fresh matrix build passed the repository release-asset checker, produced a valid ARM64 executable and DMG checksum, but failed `codesign --verify --deep --strict OpenCorvus.app` with `code has no resources but signature indicates they must be present`. Inspection showed only the linker-signed executable identity and no complete application-bundle resource seal. Tauri's official distribution guidance says Apple Silicon builds without a certificate must configure an ad-hoc signing identity; the repository configured neither a certificate nor the ad-hoc identity.

The root repair is a platform-scoped `tauri.macos.conf.json` that sets Tauri's canonical `bundle.macOS.signingIdentity` to `-`. Tauri then signs the complete `.app` before it creates the DMG, keeping the native bundler as the single owner. A source contract test must pin this configuration, and the matrix must be rerun rather than manually mutating an already-created artifact.

## Validation record

- Source baseline: final package was built from `36dd7e214` after merging the latest remote `v0.0.7beta`; `async fn overlay_pick_dir` and `async fn overlay_pick_files` remain present.
- Focused packaging regression: `bun test packages/opencorvus/test/script/package-gui-installer-matrix.test.ts` passed, 13 tests and 0 failures.
- First matrix run exposed and reproduced the missing bundle seal; this run was rejected as the final artifact even though its asset-name and DMG checksum checks passed.
- Root repair: `tauri.macos.conf.json` configures Tauri's platform-scoped ad-hoc signing identity. The second build log proves Tauri signed the executable and complete `.app` before DMG construction.
- Final `bun run package:gui-installer-matrix` passed the native `darwin-arm64` row and the release-asset checker. Linux x64/ARM64, macOS x64, and Windows x64 were explicitly skipped because they require their native hosts.
- `codesign --verify --deep --strict` passed for the build `.app`, the application mounted from the final DMG, and the application extracted from the final `.app.tar.gz`. The signature is ad-hoc with hardened runtime, identifier `ai.opencorvus.overlay`, and a version-2 sealed-resource envelope. No Apple Developer credentials were available, so notarization was correctly skipped; this is a local/test package rather than a public Developer ID distribution.
- Both the staged executable and application executable are Mach-O ARM64. `CFBundleShortVersionString` and `CFBundleVersion` are `0.0.7-beta`.
- `hdiutil verify` reports the final DMG valid.
- Final SHA-256: executable `45a6d5f0387018ccfae053e6ac024842ddb00942d4d45c4330454b939f945219`; DMG `e39d56e1cf3393c78f322e38e887ec47d7f464356b7decd366b2fef5f7f4b2c1`; app archive `3c4a94bb74502e53f6463fdd658c52c7aad03e6030492fab85078eb9381360fb`.
- Final timestamps are 2026-07-16 23:10:17 +0800 for the executable and DMG, and 23:10:20 +0800 for the app archive. Sizes are 162,008,944 bytes, 153,120,720 bytes, and 152,400,600 bytes respectively.
