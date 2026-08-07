# Expert Squad Payload Git Index Source

## Recall

| Item | Evidence / constraint |
| --- | --- |
| User request | Pull the newest code and solve the packaging problem. |
| Acceptance criteria | Fast-forward `v0.0.13beta`; make canonical GUI packaging succeed with the pre-existing ignored `.DS_Store` files left in place; preserve strict rejection of invalid tracked authoring content; add regression coverage; run the real macOS ARM64 installer matrix and independent artifact verification; commit and push to `myhexin`. |
| Hard constraints | Fix the root cause without a `.DS_Store` keyword special case, fallback, route gate, stash/reset/worktree, hook bypass, or OpenCorvus/Overlay restart. Repository-authored bundled Expert Squads must retain one reproducible source. Commit subjects start with `dsw-33987`. |
| Sources read | Repository `AGENTS.md`; `docs/packaging.md`; current packaging record; `packages/opencorvus/script/generate-expert-squad-payload.ts`; `packages/opencorvus/script/generate-build-artifacts.ts`; Expert Squad Registry discovery; payload-generation and repository-package tests; root `.gitignore`. |
| Whole-repository grep | `discoverExpertSquadPayloadPackages` has one production consumer through `renderExpertSquadPayloadModule` / `generateExpertSquadPayloadModule` and `generate-build-artifacts.ts`; direct consumers outside that chain are `payload-generation.test.ts` and `repository-dynamic-agent-packages.test.ts`. `collectPackageFiles` is private to the generator. Registry installed-package discovery is a distinct runtime source and remains unchanged. |
| Root-cause evidence | `.gitignore` already ignores `.DS_Store`, and the payload contract test states that tracked authoring packages are the reproducible source. The generator nevertheless scans all disk directory entries and rejects an ignored untracked `expert-squads/.DS_Store` as a namespace. The first real GUI matrix therefore failed before native compilation, while manually moving the files made the identical source build pass. Git index intent and raw filesystem discovery are conflicting sources. |
| Pull evidence | Local `c0ba4751e` was 27 commits behind `myhexin/v0.0.13beta`; `git pull --ff-only` advanced to `6ce601775` with the two ignored `.DS_Store` files preserved. Latest code still contains the raw-directory discovery defect. |
| Independent agent feedback | None requested; current collaboration policy forbids unrequested delegation. |

## Call-Site Disposition

| Call site | Disposition |
| --- | --- |
| `generate-build-artifacts.ts` | Keep; it remains the build owner and receives deterministic index-backed payload generation. |
| `generateExpertSquadPayloadModule` / `renderExpertSquadPayloadModule` | Keep; module rendering and write-if-changed behavior remain unchanged. |
| `discoverExpertSquadPayloadPackages` | Replace raw directory enumeration with strict Git-index enumeration and exact tracked-file validation. |
| `payload-generation.test.ts` | Extend with ignored/untracked root and package-file regressions plus tracked invalid-entry failure coverage. |
| `repository-dynamic-agent-packages.test.ts` | Keep; it continues checking the real indexed package identity roster. |
| Runtime `ExpertSquadRegistry` discovery | Keep unchanged; installed project/user packages are runtime state, not repository bundled payload authoring. |

## Plan

1. Commit and push this Recall before implementation.
2. Add one Git-index reader for `expert-squads/**`, group only tracked `<namespace>/<id>/<file>` paths, and validate every tracked path/file before loading packages.
3. Remove raw recursive filesystem discovery so ignored/untracked metadata at the authoring root, namespace, or package level cannot affect payload bytes; retain strict failures for tracked invalid shape, runtime-internal paths, symlinks, missing files, duplicates, and manifest/package validation.
4. Add focused regression tests proving ignored/untracked files do not affect discovery or rendering and malformed tracked entries fail explicitly.
5. Run focused payload/build/packaging tests, repository checks, and a second review of the diff.
6. Commit/push the fix, then run the canonical GUI installer matrix with both `.DS_Store` files present, independently validate the ARM64 assets, and record delivery evidence.

## Verification Ledger

- `585e18d53 dsw-33987 plan expert squad payload source repair` committed and pushed the pre-implementation Recall to `myhexin/v0.0.13beta`.
- The official npm registry was unreachable from this host; the lockfile-exact workspace dependencies were restored once with `bun install --frozen-lockfile --registry=https://registry.npmmirror.com`. Rebuilding the checked-in SDK distribution removed a stale local generated-type mismatch, after which root typecheck passed all 9 participating packages.
- Payload discovery now reads the Git index, validates every tracked path and ancestor, materializes only those tracked files into an isolated Registry-validation snapshot, and renders payload bytes only from the indexed authoring package. The runtime Registry remains unchanged.
- The two pre-existing untracked files `expert-squads/.DS_Store` and `expert-squads/builtin/.DS_Store` remain present. Regression coverage additionally creates untracked files at the authoring root, namespace, and package levels and proves they cannot change the rendered payload.
- `bun test --timeout=0 packages/opencorvus/test/expert-squad/payload-generation.test.ts packages/opencorvus/test/expert-squad/repository-dynamic-agent-packages.test.ts packages/opencorvus/test/script/build-artifact.test.ts`: 69 passed, 0 failed. The required `--timeout=0` matters because the pulled OpenClaw package is 127 MB across 9,918 files; direct `bun test` uses Bun's approximately five-second default and terminates a valid pinned-Node copy child. The repository package test command already encodes the correct no-timeout contract.
- `bun test --timeout=0 packages/opencorvus/test/script/package-gui-installer-matrix.test.ts packages/opencorvus/test/script/release-overlay-contract.test.ts`: 25 passed, 0 failed.
- `bun run typecheck`: 9 packages passed. The pulled duplicate `execFile` import in `build-runtime-node-modules.ts` was removed; production copy behavior is otherwise unchanged.
- `bun test --timeout=0 packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`: 82 passed, 0 failed. The ignored `specs/.DS_Store` was moved aside only for this repository-shape audit and restored afterward.
- `2ae872330 dsw-33987 make expert squad payload index deterministic` passed the pre-push typecheck, Application Programming Interface route inventory, documentation, Overlay internationalization, and secret-scan hooks and was pushed to `myhexin/v0.0.13beta`.
- `bun run package:gui-installer-matrix` succeeded with `expert-squads/.DS_Store` and `expert-squads/builtin/.DS_Store` present at their original SHA-256 hashes. The build generated the payload, compiled the embedded Overlay server and Tauri application, ad-hoc signed the application, built the disk image, and passed the matrix's darwin-arm64 asset validator. Non-native matrix rows were correctly reported as unverified rather than emulated.
- Independent artifact verification passed: both staged executables are ARM64 Mach-O files; `codesign --verify --deep --strict` accepted the application bundle; `hdiutil verify` accepted the disk image checksum; the application plist reports `0.0.13-beta`; and the compressed application archive contains the signed bundle structure. Notarization was correctly skipped because no Apple notarization credentials were configured.
- Final darwin-arm64 assets:
  - `OpenCorvus_0.0.13-beta_aarch64.app.tar.gz`: 285,698,469 bytes, SHA-256 `0f9e40f7196ad837e433355404efe8c34e6a48a2086edbe99e72999bd647bbbe`.
  - `OpenCorvus_0.0.13-beta_aarch64.dmg`: 286,882,472 bytes, SHA-256 `1b0aa19bf2835c371fc0ae250e2bee1287ed4bb9ea20ce93cce870c3f0f68b9c`.
  - `opencorvus-overlay`: 310,934,912 bytes, SHA-256 `c757582deb8d76ae9815cafb7bca0510c97abcc281d5b02df5ad23828f97d5f6`.
- Final source and remote evidence before the evidence-only commit: local `HEAD` and `myhexin/v0.0.13beta` both resolved to `2ae8723302d1808816b8b1131a5713506f5d8128`; the only visible untracked files remained the two preserved Expert Squad `.DS_Store` files.
