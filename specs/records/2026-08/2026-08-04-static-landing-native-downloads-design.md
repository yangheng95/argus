# Static landing Windows download design

## Recall

| Item | Recorded context |
| --- | --- |
| User request | Package the existing Windows x64 desktop artifacts with the promotional-site `dist`, download the installer from the deployed static site, and replace the platform dialog with a permanently visible download area. |
| Revised platform scope | macOS packaging and download presentation are explicitly deferred. This delivery publishes Windows x64 only and does not display a non-functional macOS placeholder. |
| Existing artifact authority | Do not rebuild Windows. Copy the current contents of `packages/overlay/dist-artifacts/windows-x64/` into the promotional distribution during its build. |
| Approved primary package | The visible one-click download targets the existing native Nullsoft Scriptable Install System (NSIS) `OpenCorvus_<version>_x64-setup.exe`. The complete Windows artifact directory is retained in the static distribution. |
| Approved interaction | The hero download action scrolls to an inline download section. Activating its Windows action starts the static setup-executable download without opening a dialog or making an API request. |
| Existing download ownership | `packages/web/src/lib/landing-download.ts` owns the plugin-history endpoints and latest-upload resolver; `packages/web/src/components/Lander.astro` owns the modal dialog, network requests, browser recommendation, and download activation; `packages/web/src/content/landing.ts` owns bilingual dialog copy. |
| Packaging evidence | `script/package-gui-installer-matrix.ts` already stages native bundles in `packages/overlay/dist-artifacts/<platform>/`. The Windows directory currently contains the executable, NSIS setup executable, and Microsoft Installer (MSI) package for Overlay version `0.0.30-beta`. |
| Web build evidence | `packages/web` is an Astro static site with base `/docs`; `bun run --cwd packages/web build` owns `packages/web/dist`. The Windows directory must therefore be copied after Astro completes and linked beneath `/docs/downloads/windows-x64/`. |
| Reviewed records | `2026-08-04-landing-platform-download-dialog-design.md` and `2026-08-04-landing-platform-download-dialog-implementation-plan.md` document the API-backed dialog being replaced. |
| Full-scope search | A repository search found the landing API URLs and dialog runtime only in the shared download module, landing component, bilingual content, and their positive resolver test. Existing native artifact staging is owned by `script/package-gui-installer-matrix.ts`. |
| Hard constraints | One static package source, no API or fallback, no Windows or macOS native rebuild, no UI automated tests, real desktop page interaction plus manually inspected screenshots, no unrelated Overlay changes, and scoped commit/push to `legacy-remote` with the `dsw-33987` prefix. |
| Independent agent feedback | None. This side conversation prohibits sub-Agent delegation. |

## Decision

Replace the API-backed platform dialog with one Windows static-download catalog and one reproducible landing-distribution assembler.

The catalog derives the current NSIS setup filename from the version in `packages/overlay/package.json`. It is the single owner of platform identity, architecture, installer kind, public filename, and public download path. Both the Astro page and the distribution assembler consume it. Runtime package discovery, plugin-history requests, session caches, macOS presentation, and hard-coded fallback URLs are removed.

The distribution assembler runs the Astro production build, requires the existing `packages/overlay/dist-artifacts/windows-x64/` directory and its exact current-version NSIS setup executable, then copies the complete directory into `packages/web/dist/downloads/windows-x64/`. Copying preserves the canonical desktop-build evidence. The assembler does not invoke the native packaging matrix and does not mutate the source artifact directory.

## Considered approaches

1. **Copy the existing Windows artifact directory after the Web build — approved.** It uses the user's current native output, preserves all deployable Windows artifacts, and avoids an expensive duplicate desktop build.
2. **Rebuild Windows from the promotional build command.** Rejected because the approved native artifacts already exist and the user explicitly removed repeated packaging from scope.
3. **Store installers under `packages/web/public/downloads/`.** Rejected because generated binaries would live inside Web source and stale releases could silently survive across product versions.
4. **Manually copy packages after every Web build.** Rejected because it has no reproducible path or completeness validation.

## Artifact contract

| Role | Path |
| --- | --- |
| Canonical source directory | `packages/overlay/dist-artifacts/windows-x64/` |
| Required one-click installer | `OpenCorvus_<version>_x64-setup.exe` |
| Static destination directory | `packages/web/dist/downloads/windows-x64/` |
| Public one-click path | `/docs/downloads/windows-x64/OpenCorvus_<version>_x64-setup.exe` |

`<version>` is derived from `packages/overlay/package.json`; it is not duplicated in page copy or a second configuration file.

The assembler validates positive facts:

- the source directory exists and contains regular files;
- the exact current-version NSIS setup executable exists and is non-empty;
- every source file is copied into the destination directory;
- every copied destination has the same byte size as its source;
- the final reported public path targets the copied setup executable.

No network request is part of page rendering or download selection. No desktop build command runs as part of promotional-page packaging. The existing artifact directory is the sole binary input.

## Page structure and interaction

- The hero primary action becomes an ordinary link to `#download`; it no longer owns modal state or initiates a network request.
- A new `download` section appears immediately after the hero proof/demo surface and before the deeper feature narrative.
- The section contains a concise bilingual heading, current Overlay version, Windows 10/11 and x64 metadata, NSIS/EXE installer identification, and one prominent download anchor.
- The anchor points to the catalog-owned `/docs/downloads/windows-x64/<filename>` path and carries the HTML `download` attribute.
- Keyboard focus remains visible on both the hero anchor and download anchor. There is no dialog focus restoration, loading state, retry state, platform detection, or asynchronous error state.
- macOS is absent from this section until a separate request supplies and approves a real native artifact. A dead or disabled placeholder would weaken the one-click promise and create a second incomplete product state.
- The section reuses the current landing-page color, border, radius, typography, and spacing tokens. It introduces no second component library or page-wide redesign.

## Content ownership

`packages/web/src/content/landing.ts` retains only bilingual, visible download-section content: heading, supporting line, Windows system/architecture label, installer kind, and action label. Dialog-only platform, close, loading, error, retry, and recommendation copy is deleted.

The static catalog owns non-localized release facts. `Lander.astro` renders those facts and localized copy, but does not know the source artifact directory, infer filenames independently, fetch package metadata, or resolve versions.

## Build flow

1. Confirm the existing Windows x64 artifact directory remains available; do not rebuild it.
2. Run the landing distribution command. It builds Astro and then copies the complete Windows directory into `dist/downloads/windows-x64/`.
3. Validate the copied directory and exact setup-executable public path.
4. Deploy the complete `packages/web/dist` directory. The link and installer share the same `/docs` deployment base and require no Cross-Origin Resource Sharing (CORS) configuration or package API availability.

## Verification

- Add positive non-UI contract coverage for the version-derived installer filename and successful full-directory assembly with copied byte-size equality.
- Delete the superseded API resolver test together with its resolver implementation; do not add a test whose purpose is proving the old API/dialog is absent.
- Run focused non-UI artifact tests, Astro check, Astro production distribution build, and required historical/document-health/product-document checks.
- Validate the final `packages/web/dist/downloads/windows-x64/` directory against the existing source directory, including exact file names and byte sizes.
- Start the real static distribution with a Node-launched server. Do not use Bun to launch Playwright.
- In a visible desktop browser, inspect the English and Simplified Chinese pages, hero-to-download scrolling, focus treatment, and the direct static installer request.
- Capture focused English and Chinese download-section screenshots, personally inspect them, correct visual defects, and repeat until the section is coherent and unclipped.
- Perform a second source and distribution review before committing the implementation.

## Non-goals

- macOS, Linux, or Windows ARM64 packaging and download presentation.
- Rebuilding the existing Windows x64 desktop artifacts.
- Runtime latest-version lookup, API proxying, remote mirrors, or fallback download sources.
- Automatic installation, code signing, or changing native installer internals.
- Mobile or tablet delivery.

## Self-review

- Single source: the static catalog owns the Windows release fact consumed by the page and assembler; the Overlay package version remains the sole version fact.
- Native integrity: the assembler consumes the existing Windows artifact directory without rebuilding or modifying it.
- Distribution integrity: every existing file is copied and verified, while the one-click link targets the exact current-version NSIS setup executable.
- Interaction clarity: the hero reveals the inline section and one native link owns the actual download with no modal or asynchronous lifecycle.
- Replacement scope: the API resolver, runtime fetches, dialog, macOS row, and dialog-only copy are deleted rather than retained as compatibility paths.
- UI boundary: automation covers artifact/data contracts only. Visible behavior is accepted through real browser interaction and manually reviewed screenshots.
