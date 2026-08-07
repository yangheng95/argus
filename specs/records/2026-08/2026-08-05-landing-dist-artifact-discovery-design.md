# Landing distribution artifact discovery design

## Recall

| Item | Recorded context |
| --- | --- |
| User request | Rebuild the promotional-site distribution from the latest `packages/overlay/dist-artifacts` client packages, keep every platform download working, and publish each package as `OpenCorvus_<version>_<platform>.<suffix>`. |
| Follow-up workflow | The durable operator flow must be exactly: package clients into `packages/overlay/dist-artifacts`, then run the promotional distribution build. A client version upgrade must require no manual landing-page version edit. |
| Acceptance | The generated page links and copied files use the real current artifact version; Windows x64, Darwin ARM64, and Linux x64 downloads exist; the three versions agree; `packages/web/dist.zip` is rebuilt from the same dist tree; the real page and direct package requests are visually and interactively reviewed. |
| Hard constraints | `dist-artifacts` is the only client-package source; no `package.json` version fallback, compatibility filename, network lookup, native rebuild, state machine, UI automated test, or extra active download source. Use Node for browser tooling and `http://localhost:9999` for the real preview. |
| Existing evidence | `packages/overlay/package.json` reports `0.0.30-beta`, while all three latest artifact directories contain `0.0.31-beta`; therefore the current landing catalog generates stale paths. Windows is a Portable Executable installer, Darwin is a gzip-compressed application archive, and Linux has Debian archive magic plus `debian-binary`, `control.tar.gz`, and `data.tar.gz`. |
| Existing implementation | `packages/web/src/lib/landing-download.ts` derives names from Overlay package metadata; `script/build-landing-dist.ts` validates only Windows against that stale version, builds Astro, and recursively copies source directories; `Lander.astro` consumes the static catalog. |
| Existing tests | `packages/opencorvus/test/script/landing-download-contract.test.ts` positively covers catalog paths and copies but hard-codes the old version and old platform filenames. It is a non-UI contract test and remains the focused regression surface. |
| Historical records read | `2026-08-04-static-landing-native-downloads-design.md`, `2026-08-04-static-landing-windows-download-implementation-plan.md`, and the current landing recomposition implementation. |
| Whole-repository grep | Download filenames are owned by `landing-download.ts`, copied by `build-landing-dist.ts`, consumed by `Lander.astro`, and asserted by the focused contract. Client staging remains under `package-gui-installer-matrix.ts`; no release manifest or second landing catalog exists. |
| Independent agent feedback | None. The current session does not authorize sub-Agent delegation. |

## Decision

Replace package-metadata filename synthesis with strict build-time discovery of the three real client packages. One platform-definition table owns the source directory, canonical installer selector, public platform token, public suffix, and display metadata. Discovery requires exactly one matching non-empty installer in every directory, extracts the version from its `OpenCorvus_<version>_...` filename, and requires the full platform set to report one identical version. Non-installer artifacts may coexist in the source directory but cannot become landing downloads.

The public filenames are deterministic projections of the discovered version:

| Platform | Canonical source selector | Public distribution name |
| --- | --- | --- |
| Windows x64 | Unique `OpenCorvus_<version>_*-setup.exe` with Portable Executable magic | `OpenCorvus_<version>_windows-x64.exe` |
| Darwin ARM64 | Unique `OpenCorvus_<version>_*.tar.gz` with gzip magic | `OpenCorvus_<version>_darwin-arm64.tar.gz` |
| Linux x64 | Unique `OpenCorvus_<version>_*` with Debian `ar` archive magic | `OpenCorvus_<version>_linux-x64.deb` |

`discoverLandingBinaryDownloads(repoRoot)` is the single contract constructor. Astro calls it while generating the static page, and the distribution builder calls the same function before copying files. The builder removes the generated download root, copies each selected package to its standardized public name, verifies byte equality, and writes no legacy filename.

After Astro and package copying succeed, the same command replaces `packages/web/dist.zip` with a ZIP archive containing the `dist/` directory. The mature `archiver` library owns ZIP encoding so the implementation does not hand-roll an archive format or depend on a platform-specific shell compressor.

## Considered approaches

1. **Discover real artifacts at landing-build time — selected.** This makes the operator's two-command workflow sufficient, keeps the artifact directories authoritative, and guarantees page paths and copied files come from one constructor.
2. **Generate and persist a release manifest during every client packaging job.** Rejected because it would require coordinating all three platform packaging jobs around another tracked or uploaded source before the current simple workflow could work.
3. **Continue reading `packages/overlay/package.json` and rename files manually.** Rejected because the observed `0.0.30-beta` versus `0.0.31-beta` drift proves that metadata is not the landing package authority.

## Failure contract

The distribution build stops with a direct error when a required directory is missing, a platform has zero or multiple canonical installer matches, a file is empty, a selected source name does not expose a version, its file signature disagrees with the platform package kind, or platform versions differ. These checks establish data integrity; they do not route or gate an LLM workflow. No alternate package kind, fallback name, or older release is selected.

## Verification

- A focused positive non-UI test creates one current-format package per platform, discovers a shared upgraded version, copies standardized filenames, and verifies exact bytes.
- Astro static analysis and production build complete.
- The real `0.0.31-beta` inputs produce three exact standardized files and a fresh `dist.zip`; source/destination sizes and archive entries are inspected.
- A visible desktop browser at `http://localhost:9999/opencorvus-dist/dist/` checks the English and Chinese download cards and establishes real successful requests for all three package paths. Screenshots are personally reviewed without creating UI test files or baselines.
- Required documentation health checks, source diff review, `git diff --check`, hook-backed push, and a second semantic review close the delivery.

## Design self-review

- Placeholder scan: no pending decisions or unspecified filenames remain.
- Consistency: discovery, page rendering, copying, and ZIP creation all consume the same dist-artifact facts.
- Scope: native client packaging is not rebuilt or redesigned; only promotional distribution assembly changes.
- Ambiguity: platform tokens are the canonical directory identities, and Linux's verified Debian content determines `.deb`.
