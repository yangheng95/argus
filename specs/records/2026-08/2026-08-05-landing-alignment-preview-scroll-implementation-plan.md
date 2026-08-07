# Landing alignment and preview scroll implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This task executes inline because the user did not authorize sub-Agent delegation.

**Goal:** Correct the landing Web-link target, modal scroll ownership, Expert Squad alignment, closing text alignment/wrapping, and compressed title line heights.

**Architecture:** Keep `Lander.astro` as the single structure, interaction, and style owner. Use standard anchor attributes and native dialog overflow semantics; apply section-local layout overrides and consistent display-title line-height changes without new state or dependencies.

**Tech Stack:** Astro 5, TypeScript, native HTML dialog, CSS Grid, visible Node-launched browser.

## Global Constraints

- Desktop-only acceptance; do not add mobile or responsive scope.
- Do not add, modify, update, or run User Interface automated tests, source-string assertions, screenshots baselines, or pixel comparisons.
- Preserve one native dialog, one preview request token, and one landing renderer.
- Commit subjects begin with `dsw-33987`; push the completed `v0.0.30beta` state to `legacy-remote` without bypassing hooks.

## Recall

The complete user request, screenshot evidence, current owners, root-cause chain, approved design, and validation boundary are recorded in `2026-08-05-landing-alignment-preview-scroll-design.md`. Re-read it before editing and after any context compaction.

---

### Task 1: Correct link and preview interaction ownership

**Files:**
- Modify: `packages/web/src/components/Lander.astro`

**Interfaces:**
- Consumes the existing `webApplicationCard.href`, preview request token, native dialog, and decoded image assignment.
- Produces a new-tab Web application anchor and a modal-owned scroll range for oversized decoded images.

- [x] Add `target="_blank"` and `rel="noopener noreferrer"` only to the Web application anchor.
- [x] Change the dialog from visible overflow to automatic overflow with contained scroll chaining and stable scrollbars.
- [x] Change the preview surface from fixed height to `min-height: 100%` plus internal padding and border-box sizing.
- [x] Remove the image's viewport-height cap while retaining width containment and intrinsic aspect ratio.
- [x] Keep the current decode-before-open request-token flow unchanged.

### Task 2: Correct landing alignment and display typography

**Files:**
- Modify: `packages/web/src/components/Lander.astro`

**Interfaces:**
- Consumes the current Expert Squad two-column grid, closing two-column grid, and existing heading selectors.
- Produces optically aligned Expert Squad columns, left-aligned closing copy with full-row wrapping, and more open title line rhythm.

- [x] Explicitly start-align the Expert Squad grid and add one optical top inset to the proof column.
- [x] Remove the CTA copy width cap and the title's `14ch` cap; use normal wrapping rather than balanced wrapping for the CTA title.
- [x] Override the CTA paragraph's automatic inline margins so its left edge matches the title.
- [x] Increase line height slightly for hero, download, feature, story, Expert Squad, surfaces, CTA, capability-card, and runtime-card titles without changing font sizes or weights.
- [x] Review the scoped source diff and remove any superseded selector rather than retaining a second path.

### Task 3: Static and real-page verification

**Files:**
- Modify: this plan with implementation evidence.
- Create: `specs/artifacts/landing-alignment-expert-squads.png`
- Create: `specs/artifacts/landing-alignment-closing.png`
- Create: `specs/artifacts/landing-preview-scroll.png`
- Create: `specs/artifacts/landing-title-rhythm.png`
- Create: `specs/artifacts/landing-title-rhythm-en.png`
- Modify: `specs/README.md`
- Modify: `specs/records/2026-08/README.md`

**Interfaces:**
- Produces fresh compiler/build evidence, task-scoped visual evidence, and a second-review verdict.

- [x] Run `bun run --cwd packages/web check` and confirm zero errors.
- [x] Run `bun run build:landing-dist` and confirm the static site plus three binary download directories build successfully.
- [x] Start an isolated preview; use a visible Node-launched browser at 1,920 by 1,080 pixels for both locale routes.
- [x] Open the Web application entry and confirm a distinct tab is created without navigating the landing tab.
- [x] Open an image whose rendered height exceeds the dialog viewport, wheel the modal, and visually confirm its content scrolls while the landing page behind retains its position.
- [x] Capture and inspect the task-scoped screenshots; correct defects and repeat until aligned.
- [x] Run `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` and `bun test --timeout 60000 packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts`.
- [x] Append exact verification results and second-review evidence to this plan.
- [x] Commit with a `dsw-33987` subject, fetch/merge current legacy remote changes, push without bypassing hooks, and verify local/remote commit identity.

## Plan self-review

- Spec coverage: all five user corrections map to one implementation owner and explicit real-page acceptance steps.
- Placeholder scan: no deferred selector, state, command, route, screenshot, or acceptance criterion remains.
- Type consistency: no new type is introduced; all markup and styles remain local to `Lander.astro`.
- UI boundary: no automated User Interface test is proposed; visible behavior is accepted only through the real page and manually inspected screenshots.

## Implementation evidence

- `bun run --cwd packages/web check`: completed with zero errors; the existing `qa/dedupe-lead.cjs` unused-local hint remains outside this landing scope.
- `bun run build:landing-dist`: completed 105 static pages and republished Windows x64, macOS arm64, and Linux x64 download directories from their canonical artifacts.
- The isolated preview served both `/opencorvus-dist/dist/zh-cn/` and `/opencorvus-dist/dist/` in visible Edge at 1,920 by 1,080 pixels. The application browser connector could not initialize because its local kernel assets path was missing, so the documented visible Node-launched Edge fallback was used without creating a reusable User Interface test.
- The Web application anchor exposed `target="_blank"` with `rel="noopener noreferrer"`; a real click produced two browser pages while the landing page remained the original tab.
- At a 1,440 by 650 desktop viewport, the oversized preview measured 1,103 pixels of scroll content in a 586-pixel dialog. A real mouse click and wheel moved the dialog from `scrollTop = 0` to its 517.33-pixel maximum while the landing page remained at `scrollY = 4,440`.
- Manual screenshot review found the Chinese Expert Squad heading and proof cards optically top-aligned, the closing title reduced to two left-aligned lines with its description on the same left edge, and no compressed or colliding display-title lines in the Chinese full-page or English Expert Squad evidence.
- Plan baseline `39313efa7b` was merged with current legacy remote state as `c733b25b8e` and pushed before source implementation.
- Implementation commit `caed01208a` was merged with the intervening legacy remote Mirror Watch update as `6f9d1f44b6`; the merged result passed typecheck, documentation health, route, localization, and secret checks before the branch push succeeded.
