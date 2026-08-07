# Landing content and media recomposition implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The current task executes inline because the user did not authorize sub-Agent delegation.

**Goal:** Recompose the bilingual desktop landing page around the existing 01:36 hero video, expanded static access options, Expert Squad Mission-flow proof, generated runtime scenes, a simplified closing section, and a race-free centered image preview.

**Architecture:** Extend the existing immutable release catalog for Linux and add a separate immutable Web entry; keep page structure, localized copy, and interaction in their current owners. Reuse the existing video and Mission-flow renderer exactly once, add four project-bound bitmap assets, and repair the lightbox by decoding the selected source before opening the dialog.

**Tech Stack:** Astro 5, Starlight, TypeScript, native HTML dialog, Bun positive non-UI contract tests, built-in image generation, Node-launched visible browser.

## Global Constraints

- Desktop-only acceptance at approximately 1,440 pixels wide; do not add tablet/mobile/responsive scope.
- Do not add, modify, update, or run User Interface automated tests, snapshots, source-string assertions, screenshot baselines, or pixel comparisons.
- Reuse `packages/web/public/media/opencorvus-client-demo.webm` and `LandingMissionFlow.astro`; each must render exactly once.
- Linux source is `packages/overlay/dist-artifacts/linux-x64/OpenCorvus-v0.0.30beta-linux-x64`; Web entry is `https://mirror.myhexin.com/opencorvus/ui/`.
- Generated scene images must be copied into `packages/web/src/assets/lander/`, inspected, and referenced from source before completion.
- Keep one static package catalog and one artifact-copy path; no fallback URL/source or retained hidden markup.
- Commit subjects begin with `dsw-33987`; push the completed main-branch state to `myhexin/v0.0.30beta` without bypassing hooks.

## Recall

The complete Recall, approach comparison, approved design, root-cause chain, and verification boundary are recorded in `2026-08-04-landing-content-and-media-recomposition-design.md`. Before implementation, re-read that file and confirm the current branch, dirty state, and remote state still match its evidence.

---

### Task 1: Extend the static access catalog and distribution contract

**Files:**
- Modify: `packages/web/src/lib/landing-download.ts`
- Modify: `script/build-landing-dist.ts`
- Modify: `packages/opencorvus/test/script/landing-download-contract.test.ts`

**Interfaces:**
- Produces `LandingBinaryDownload` with platform union `windows-x64 | darwin-arm64 | linux-x64`.
- Produces `landingBinaryDownloads`, containing the exact three local artifact contracts.
- Produces `landingWebApplication`, containing the exact HTTPS entry URL and display facts.
- Produces `copyLandingBinaryArtifacts(repoRoot, contracts)` for all three local platform directories.

- [ ] **Step 1: Update the positive non-UI contract**

Change the existing artifact-copy test to create three temporary source directories/files and assert one complete result array for Windows, macOS, and Linux. Assert `landingWebApplication.href` equals `https://mirror.myhexin.com/opencorvus/ui/` and its kind is `web`.

- [ ] **Step 2: Run the focused contract and observe the missing Linux/Web contract failure**

Run `bun test packages/opencorvus/test/script/landing-download-contract.test.ts`. Expected: the positive result differs because the catalog still contains two binary platforms and no Web entry.

- [ ] **Step 3: Implement the three-platform catalog**

Rename the catalog/type to binary terminology, add the Linux source/destination/filename/platform facts, and add the Web application entry. Update the distribution script imports, result type, copier name, and Windows release validation lookup while preserving the one directory-inventory implementation.

- [ ] **Step 4: Run the focused contract**

Run the command from Step 2. Expected: one positive contract passes with all three copied artifacts and the exact Web application entry.

### Task 2: Generate and integrate four runtime scene assets

**Files:**
- Create: `packages/web/src/assets/lander/runtime-desktop-continuity.png`
- Create: `packages/web/src/assets/lander/runtime-headless.png`
- Create: `packages/web/src/assets/lander/runtime-channel-reach.png`
- Create: `packages/web/src/assets/lander/runtime-repository-automation.png`

**Interfaces:**
- Produces four landscape raster assets in one visual system for `content.surfaces.items` index order.

- [ ] **Step 1: Generate each distinct scene with the built-in image tool**

Use four separate `image_gen` calls. Shared prompt contract: `stylized-concept`, landing-page feature-card artwork, dark cinematic editorial 3D/illustration, black/graphite environment with restrained cobalt-blue light, landscape crop, edge-to-edge composition, no text, no logo, no watermark. Vary only the subject according to the four approved runtime scenarios.

- [ ] **Step 2: Copy final outputs into the workspace**

Move or copy each selected generated output from the Codex generated-images location to its exact project path above without overwriting unrelated existing assets.

- [ ] **Step 3: Inspect all four assets**

Open each final file at original detail. Confirm one coherent palette/style, distinct scenario legibility, no accidental words/logos/watermarks, and usable full-card crops. Regenerate only the failed asset with one targeted prompt change if necessary.

### Task 3: Recompose localized content and page structure

**Files:**
- Modify: `packages/web/src/content/landing.ts`
- Modify: `packages/web/src/components/Lander.astro`

**Interfaces:**
- Consumes `landingBinaryDownloads`, `landingWebApplication`, the existing video, the existing Mission-flow component, and the four new scene assets.
- Produces one hero video, four access cards, one Expert Squad Mission-flow panel, four image-led runtime cards, and one footer-free closing section in both locales.

- [ ] **Step 1: Remove retired content fields and add Linux/Web actions**

Delete hero eyebrow/proof/diagram-window fields, demo section content, Expert Squad eyebrow/packages, surface icon fields, CTA eyebrow, and footer fields from `LandingContent` and both locale objects. Add localized `linux-x64` action copy and a localized Web entry action/system/architecture/package description.

- [ ] **Step 2: Move video and Mission flow to their new single owners**

Replace the hero product-window Mission flow with the existing video and its concise caption. Delete hero action/proof markup and delete the complete former demo section. In Expert Squads, delete the package list and add the existing Mission-flow component after the capability/media proof region.

- [ ] **Step 3: Render four access cards**

Render the three static binary cards from `landingBinaryDownloads`, then render one Web application card from `landingWebApplication`. Use a download attribute only for local binary anchors; the Web anchor is a normal same-tab HTTPS link.

- [ ] **Step 4: Convert runtime cards to image-led tiles**

Import the four generated assets, remove the Starlight icon renderer for this section, and render the index-matched image at the top of each card. Preserve the number/title/description as the lower semantic content region.

- [ ] **Step 5: Remove footer and expand the closing section**

Keep only the large product mark, requested title, and requested description. Delete the footer markup and all now-unused footer styles.

- [ ] **Step 6: Relax section rhythm without creating a second style system**

Increase desktop vertical padding and key grid gaps, keep the current monochrome tokens, use a 2-by-2 download grid, give the hero video and Expert Squad Mission flow bounded 16:9 stages, and give the runtime images full card width with a stable landscape field.

### Task 4: Repair the image-preview data flow and centering

**Files:**
- Modify: `packages/web/src/components/Lander.astro`

**Interfaces:**
- Consumes each preview trigger's `data-preview-src` and `data-preview-alt`.
- Produces a dialog that becomes visible only after the currently requested image is decoded and is geometrically centered in the viewport.

- [ ] **Step 1: Trace the current reproduction in the real page**

In the isolated visible preview, open one screenshot, close it, immediately open a different screenshot, and observe the retained decoded bitmap before touching source. Record the sequence in this plan's implementation evidence; do not turn it into a test file.

- [ ] **Step 2: Implement decode-before-open ownership**

Use a monotonically increasing request token. Clear the current dialog image, load the selected source into a detached `Image`, await `decode()` with `load` as the browser-native completion path, ignore superseded requests, then assign the selected source/alt and call `showModal()`. Clear source/alt again on dialog close.

- [ ] **Step 3: Make the dialog the explicit viewport-centering owner**

Add fixed `inset: 0`, automatic margins, bounded width/height, and centered surface geometry. Keep the close button and backdrop click behavior.

### Task 5: Run static and non-UI verification

**Files:**
- Inspect: all changed source, assets, and distribution output.

**Interfaces:**
- Produces fresh compiler/build/distribution evidence before any completion claim.

- [ ] **Step 1: Run focused positive contract**

Run `bun test packages/opencorvus/test/script/landing-download-contract.test.ts` and confirm zero failures.

- [ ] **Step 2: Run Astro checks and build**

Run `bun run --cwd packages/web check` and `bun run --cwd packages/web build`. Confirm exit code 0 and both landing locales generated.

- [ ] **Step 3: Run the full landing distribution build**

Run `bun run build:landing-dist`. Confirm Windows validation succeeds and the distribution inventory reports Windows, macOS, and Linux outputs with non-zero files.

- [ ] **Step 4: Review the source diff**

Confirm no retired hero controls, demo section, Expert Squad package list/eyebrow, surface icons, or footer remain; confirm the video and Mission-flow component each render once; confirm the Web URL has one catalog owner.

### Task 6: Perform real desktop visual acceptance and second review

**Files:**
- Create: `specs/artifacts/landing-recomposition-hero-download.png`
- Create: `specs/artifacts/landing-recomposition-squads-runtime.png`
- Create: `specs/artifacts/landing-recomposition-closing.png`
- Create: `specs/artifacts/landing-recomposition-image-preview.png`

**Interfaces:**
- Consumes the built real page in an isolated visible browser session.
- Produces task-scoped screenshots and manual interaction evidence, not automated tests or baselines.

- [ ] **Step 1: Launch an isolated real page**

Use a separate Astro preview/dev process without restarting or refreshing any user-owned OpenCorvus/Overlay process. Use Node, not Bun, for any Playwright browser-sidecar launch.

- [ ] **Step 2: Inspect English and Chinese desktop routes**

At approximately 1,440 pixels wide, inspect hero/video balance, four download/Web cards, Expert Squad spacing and Mission flow, all four runtime images, and the expanded closing section. Correct visual defects and repeat screenshots until aligned.

- [ ] **Step 3: Inspect consecutive image previews**

Open two different source images consecutively. Confirm the second dialog shows only the second decoded image, is centered, fits the viewport, closes from its button/backdrop/Escape, and has no previous-image flash.

- [ ] **Step 4: Perform a fresh second source and visual review**

Re-read the user request and design record line by line, compare each requirement with the final source and screenshots, and record any unmet item plainly.

### Task 7: Index evidence, verify documents, commit, and push

**Files:**
- Modify: this plan
- Modify: `specs/README.md`
- Modify: `specs/records/2026-08/README.md`

**Interfaces:**
- Produces indexed implementation evidence and the delivered git-cc commit.

- [ ] **Step 1: Run document health contracts**

Run `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` and `bun test packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts`.

- [ ] **Step 2: Append implementation evidence**

Record exact command results, distribution file facts, generated asset paths and final prompts, real page URLs, screenshot paths, preview reproduction/root cause/fix evidence, and second-review verdict.

- [ ] **Step 3: Commit and push**

Review `git status --short` and the full scoped diff, commit with a `dsw-33987` subject, pull/fetch the current `myhexin/v0.0.30beta` state without rewriting user history, push without bypassing hooks, and verify local/remote commit identity.

## Plan self-review

- Spec coverage: all six user requirements map to explicit implementation and real-page acceptance tasks.
- Placeholder scan: every file, path, URL, visual role, verification command, and interaction sequence is explicit.
- Type consistency: the binary catalog/copy names and three-platform union are identical across producer, test, build script, and renderer; the Web entry remains outside artifact copying.
- UI boundary: only the artifact distribution contract is automated. Visible structure, styling, and interaction are accepted through a one-off real page and manually inspected screenshots.

## Implementation evidence

### Delivered structure and distribution

- `landingBinaryDownloads` now owns Windows x64, macOS Apple Silicon, and Linux x64 as one immutable binary catalog. The Linux filename is derived from the overlay package version and resolves to `OpenCorvus-v0.0.30beta-linux-x64`.
- `landingWebApplication` is the single source for `https://mirror.myhexin.com/opencorvus/ui/`; it is rendered as a normal same-tab HTTPS link and is not included in artifact copying.
- `bun run build:landing-dist` completed successfully. Its fresh inventory reported 210,000,443-byte Windows EXE, 179,914,086-byte macOS archive, and 208,814,536-byte Linux executable outputs, alongside the complete Windows source directory inventory.
- The built Chinese route was inspected at `http://127.0.0.1:4329/opencorvus-dist/dist/zh-cn/`; the English route was inspected at `http://127.0.0.1:4329/opencorvus-dist/dist/`. The video metadata reported 95.5 seconds, which is the requested 01:36 presentation duration.

### Generated runtime scenes

All four assets were generated with the built-in image generation mode as separate calls, copied into the project, opened at original detail, and visually reviewed for a coherent graphite/cobalt system with no words, logos, or watermarks.

- `packages/web/src/assets/lander/runtime-desktop-continuity.png` — prompt: “Stylized-concept landing-page feature-card artwork; a desktop engineering workstation whose project context continues through connected screens and a restrained cobalt data trail; dark cinematic editorial 3D illustration, black/graphite environment, edge-to-edge landscape composition, no text, no logo, no watermark.”
- `packages/web/src/assets/lander/runtime-headless.png` — prompt: “Stylized-concept landing-page feature-card artwork; a compact headless runtime server core sustaining durable task and event streams without a display; dark cinematic editorial 3D illustration, black/graphite environment, restrained cobalt light, edge-to-edge landscape composition, no text, no logo, no watermark.”
- `packages/web/src/assets/lander/runtime-channel-reach.png` — prompt: “Stylized-concept landing-page feature-card artwork; a protected central communication hub reaching several permission-aware message channels; dark cinematic editorial 3D illustration, black/graphite environment, restrained cobalt light, edge-to-edge landscape composition, no text, no logo, no watermark.”
- `packages/web/src/assets/lander/runtime-repository-automation.png` — prompt: “Stylized-concept landing-page feature-card artwork; a precise repository automation track with timing machinery and branching event paths; dark cinematic editorial 3D illustration, black/graphite environment, restrained cobalt light, edge-to-edge landscape composition, no text, no logo, no watermark.”

The source PNG files are 1,569,408, 1,930,113, 1,896,144, and 1,856,146 bytes respectively. Astro emitted optimized WebP variants of approximately 28–48 kilobytes for the page.

### Image-preview root cause and repair

The previous interaction assigned a new `src` directly to the already-present dialog image and exposed the dialog while the browser still retained the prior decoded bitmap. The dialog also lacked one explicit full-viewport centering owner. The repaired path clears the mounted image, decodes the requested source in a detached `Image`, commits it only if its monotonic request token is still current, and only then opens the modal. Closing invalidates the request and clears source/alt again. The fixed dialog owns `position: fixed`, `inset: 0`, automatic margins, viewport bounds, and a centered grid surface.

The Browser plugin's Node REPL failed before page code with `failed to write kernel assets: 系统找不到指定的路径。 (os error 3)` even after kernel reset and verification of the runtime, Codex executable, working directory, and temporary paths. Per the project tool-repair rule, acceptance continued through a visible Node-launched Playwright session using installed Microsoft Edge; no test file, UI assertion, fixture, or screenshot baseline was created. Two different images were opened consecutively and visually reviewed; the second image was centered and contained no retained first-image frame. Close button, Escape, and backdrop dismissal were each exercised.

### Task-scoped visual evidence

- `specs/artifacts/landing-recomposition-hero-download.png`
- `specs/artifacts/landing-recomposition-squads-runtime.png`
- `specs/artifacts/landing-recomposition-closing.png`
- `specs/artifacts/landing-recomposition-image-preview.png`

The first visual pass exposed an orphaned final character in the Chinese download heading and runtime art that occupied only the card top. The second pass replaced the partial art field with full-card imagery and exposed delayed decoding for two cards. The final pass removed the inherited `12ch` title constraint, restored the intended heading size, and eagerly loads the four optimized runtime images. Fresh Chinese and English screenshots were then inspected and accepted.

### Verification results and second-review verdict

- `bun test packages/opencorvus/test/script/landing-download-contract.test.ts`: 2 passed, 0 failed.
- `bun run --cwd packages/web check`: 0 errors and 0 warnings; one unrelated existing `qa/dedupe-lead.cjs` unused-variable hint remains.
- `bun run build:landing-dist`: success; 105 static pages and all three binary download directories produced.
- `NODE_OPTIONS=--max-old-space-size=8192 bun run typecheck`: 8 package tasks successful. The first run reached the `packages/opencorvus` TypeScript process's default approximately 2-gigabyte V8 heap limit without reporting a type error; the unchanged original checker passed after the explicit heap increase.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: 2 passed, 0 failed.
- `bun test --timeout 60000 packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts`: 68 passed, 0 failed. The explicit timeout followed one concurrent run where two repository-wide scans exceeded Bun's default five seconds; the serial rerun completed in 3.94 seconds with unchanged test logic.

Fresh source and visual review against all six user requirements found no unmet delivery surface: Linux and Web entry cards are present; the hero owns the sole long video; the former demo module, requested labels/lists, and footer are absent; Mission flow is in Expert Squads; four full-card generated scenes are present; the closing section contains only the large mark and requested copy; and consecutive previews are decoded before a centered modal opens.
