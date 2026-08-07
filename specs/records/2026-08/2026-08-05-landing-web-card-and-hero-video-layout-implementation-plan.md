# Landing Web card and hero video layout implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This task executes inline because the user did not authorize sub-Agent delegation.

**Goal:** Distinguish the Web application entry with a pale green card and expand the hero video into a full-width row below its copy.

**Architecture:** Keep `Lander.astro` as the single renderer. Add one semantic modifier to the existing Web card and change the existing hero grid from two columns to one; preserve all content, URL, and media contracts.

**Tech Stack:** Astro 5, TypeScript, CSS Grid, native HTML video, visible Node-launched browser.

## Global Constraints

- Desktop-only acceptance; do not add mobile or responsive scope.
- Do not add, modify, update, or run User Interface automated tests, source-string assertions, DOM assertions, snapshots, or visual baselines.
- Preserve the current download catalog, external anchor behavior, video source, poster, controls, caption, and accessible label.
- Commit subjects begin with `dsw-33987`; push the completed `v0.0.30beta` state to `legacy-remote` without bypassing hooks.

## Recall

The complete request, screenshot evidence, alternatives, approved layout, and verification boundary are recorded in `2026-08-05-landing-web-card-and-hero-video-layout-design.md`. Re-read it before editing and after any context compaction.

---

### Task 1: Apply the Web application visual modifier

**Files:**
- Modify: `packages/web/src/components/Lander.astro`

**Interfaces:**
- Consumes the existing final Web article and shared `.download-card` / `.download-button` rules.
- Produces `.download-card-web` as the one visual distinction while preserving the canonical Web URL and new-tab anchor.

- [x] Add `download-card-web` to the existing Web application article only.
- [x] Add a pale mint surface, green border, and deep-green button/hover rules scoped below the shared card styles.
- [x] Keep native installer card markup and styles unchanged.
- [x] Review the source diff to confirm no content, URL, or action attributes changed.

### Task 2: Convert the hero to copy-above-video hierarchy

**Files:**
- Modify: `packages/web/src/components/Lander.astro`

**Interfaces:**
- Consumes the existing `.hero-section`, `.hero-copy`, `.hero-product`, and `.hero-video-frame` elements.
- Produces a single-column grid with copy in row one and the current video in row two.

- [x] Replace the hero's two-column definition with one `minmax(0, 1fr)` column and a looser vertical gap.
- [x] Remove split-layout centering and all title, copy, and description width caps so text fills the row before naturally wrapping.
- [x] Replace balanced title wrapping with normal wrapping while preserving font size, weight, and line height.
- [x] Preserve the existing 78rem section maximum so the video expands without changing page alignment.
- [x] Keep the video markup, source, aspect ratio, controls, caption, poster, and label unchanged.

### Task 3: Build and real-page visual verification

**Files:**
- Modify: this plan with exact evidence.
- Create: `specs/artifacts/landing-web-card-green.png`
- Create: `specs/artifacts/landing-hero-video-wide-zh.png`
- Create: `specs/artifacts/landing-hero-video-wide-en.png`
- Modify: `specs/README.md`
- Modify: `specs/records/2026-08/README.md`

**Interfaces:**
- Produces compiler/build evidence, task-scoped screenshots, manual review, and legacy remote delivery.

- [x] Run `bun run --cwd packages/web check` and confirm zero errors.
- [x] Run the canonical landing distribution build; resolve or explicitly report any missing release input without bypassing its validation.
- [x] Start an isolated preview and open the Chinese and English routes in a visible desktop browser.
- [x] Capture and inspect the three task-scoped screenshots for card contrast, video width, copy hierarchy, title wrapping, and unchanged native cards.
- [x] Run `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` and `bun test --timeout 60000 packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts`.
- [x] Append exact verification results and a second-review verdict to this plan.
- [x] Commit with a `dsw-33987` subject, fetch/merge current legacy remote changes, push without bypassing hooks, and verify local/remote identity.

### Task 4: Remove runtime imagery and compact the four surface cards

**Files:**
- Modify: `packages/web/src/components/Lander.astro`
- Create: `specs/artifacts/landing-surface-cards-compact.png`
- Modify: this plan and `specs/README.md`

**Interfaces:**
- Consumes the existing ordered `content.surfaces.items` text contract.
- Removes the landing-page-only bitmap projection and produces a compact number-plus-copy card without a second rendering path.

- [x] Remove the four runtime bitmap imports, `runtimeImages`, and `.surface-media` markup together.
- [x] Keep the ordered number, title, and description for each surface item.
- [x] Replace the 28rem image-backed card with a 15.5rem text-only card and retain bottom-aligned copy.
- [x] Rebuild the canonical distribution, inspect the Chinese surface row in a visible browser, and record the exact rendered height.
- [x] Capture and manually review `landing-surface-cards-compact.png` without creating a reusable User Interface test or screenshot baseline.

### Task 5: Adopt the user-approved balanced Agent illustrations

**Files:**
- Create: `packages/web/src/assets/lander/runtime-desktop-continuity-agent-v2.png`
- Create: `packages/web/src/assets/lander/runtime-headless-agent-v2.png`
- Create: `packages/web/src/assets/lander/runtime-channel-reach-agent-v2.png`
- Create: `packages/web/src/assets/lander/runtime-repository-automation-agent-v2.png`
- Modify: `packages/web/src/components/Lander.astro`
- Create: `specs/artifacts/landing-surface-cards-agent-images.png`

**Interfaces:**
- Consumes the four explicitly approved built-in image-generation outputs and the existing ordered `content.surfaces.items` contract.
- Produces one versioned bitmap per scenario and one shared media-plus-copy card structure.

- [x] Copy all four approved outputs into versioned project assets without overwriting the retired images.
- [x] Restore one ordered `runtimeImages` projection and one accessible decorative media branch.
- [x] Keep each complete 3:2 illustration visible above compact copy; preserve card number, title, and description.
- [x] Replace the abrupt white canvases with deep-charcoal edits and restore a continuous dark card surface without changing illustration structure.
- [x] Rebuild the canonical distribution and inspect the four-card row in a visible browser.
- [x] Capture and manually review `landing-surface-cards-agent-images.png`, then record exact rendered dimensions and final asset paths.

## Verification evidence

- `bun run --cwd packages/web check`: completed with zero errors and zero warnings. Astro retained one informational hint for the pre-existing unused `startBlock` symbol in `qa/dedupe-lead.cjs`.
- The first canonical distribution attempt exposed incomplete Windows staging: `packages/overlay/dist-artifacts/windows-x64` held only the Network Software Installation (NSIS) setup executable. The canonical same-version release outputs were intact under `packages/overlay/src-tauri/target/release`, so `bun run script/package-gui-installer-matrix.ts --skip-build` restored the validated three-file Windows matrix without bypassing package validation.
- `bun run build:landing-dist`: completed with 105 generated pages and copied the Windows x64 Microsoft Installer (MSI), setup executable, and overlay executable; the macOS arm64 application archive; and the Linux x64 executable into the fresh `packages/web/dist` distribution.
- The in-app browser connector could not initialize because its kernel asset path was missing (`os error 3`). The same built distribution was therefore opened in a visible Microsoft Edge instance launched by Node and Playwright, as required for the Windows toolchain; no reusable User Interface test, fixture, assertion, snapshot, or baseline was created.
- Chinese measurements at a 1920×1080 desktop viewport: title 1248×66 px, description 1248×28 px, and video 1248×744 px. The title uses `text-wrap: wrap` and now holds the complete Chinese heading on one line, while retaining the established 66 px line height.
- English measurements at the same viewport: title 1248×155 px, description 1248×56 px, and video 1248×744 px. Natural wrapping remains readable with no overlap or clipping.
- Computed Web-card colors are `rgb(234, 247, 238)` for the pale mint surface and `rgb(158, 207, 175)` for the border. Manual review confirmed that Windows, macOS, and Linux cards remain white and the existing Web action remains distinct in deep green.
- Documentation verification passed: 2 historical-link contracts and 68 document-health/product-single-source contracts, with zero failures. Workspace type checking completed successfully across all 8 participating package tasks.
- Evidence: [`landing-hero-video-wide-zh.png`](../../artifacts/landing-hero-video-wide-zh.png), [`landing-web-card-green.png`](../../artifacts/landing-web-card-green.png), and [`landing-hero-video-wide-en.png`](../../artifacts/landing-hero-video-wide-en.png).
- The compact-card refinement rebuilt the same 105-page distribution with the full Windows, macOS, and Linux inventory. At 1920×1080, all four cards render at 299×248 px, each copy block is bottom-aligned with a 25 px inset, and the card row contains zero image elements. Manual review confirmed equal card heights, unobstructed numbering, readable text, and no residual image surface. Evidence: [`landing-surface-cards-compact.png`](../../artifacts/landing-surface-cards-compact.png).
- legacy remote delivery completed in `bb73c19020` (`dsw-33987 style landing Web card and full-width hero`) and `a7a4096159` (`dsw-33987 compact landing surface cards`). The pre-push hook reran type checking, Application Programming Interface (API) route checks, documentation checks, internationalization checks, and secret scanning successfully. A post-push fetch confirmed local `HEAD` and `legacy-remote/v0.0.30beta` were identical at `a7a4096159346aeac4454eb8f1938a2d7cb16bd9` before this record-only closure.
- The approved-image refinement rebuilt the 105-page distribution with the full three-platform download inventory. Visible Edge review at 1920×1080 measured four equal 299×298 px cards with 297×198 px media areas. All images decoded successfully and use `object-fit: contain`, so the small source-ratio differences remain uncropped. The first white-canvas pass was rejected after real-page inspection; the final deep-charcoal canvases merge into the `rgb(10, 10, 10)` section while preserving blue/cyan state paths and readable module edges. Evidence: [`landing-surface-cards-agent-images.png`](../../artifacts/landing-surface-cards-agent-images.png).
- Final built-in image-generation assets: `runtime-desktop-continuity-agent-v2.png`, `runtime-headless-agent-v2.png`, `runtime-channel-reach-agent-v2.png`, and `runtime-repository-automation-agent-v2.png` under `packages/web/src/assets/lander/`.

## Second review verdict

The rendered Chinese and English pages satisfy the approved hierarchy: copy occupies the full content row and wraps only at the row boundary, the long video owns the following full-width row, and the Web card is visually distinct without changing the other three card contracts. The runtime-surface region now presents four balanced Agent illustrations on continuous dark cards; all content remains visible without the rejected white interruption or the original oversized card treatment. No visual collision, clipping, unintended card recolor, media cropping, or alignment regression was observed.

## Plan self-review

- Spec coverage: the Web-card, hero-layout, line-fill, and compact-surface requests each map to a scoped markup or CSS owner and real-page screenshot evidence.
- Placeholder scan: no deferred selector, color role, route, command, screenshot, or acceptance result remains.
- Type consistency: no type or content source is introduced; modifier and layout selectors exactly match the current renderer.
- UI boundary: all UI acceptance is manual on the real page; no prohibited automated UI test is planned.
