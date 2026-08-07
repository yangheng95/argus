# Landing Hero Mission Flow PNG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install the approved black-and-white Mission workflow PNG as the landing hero's right-side media and remove the floating local-client walkthrough entry without changing the later product-demo section.

**Architecture:** The approved generated bitmap becomes one project-owned Astro asset. `landing.ts` extends the existing bilingual hero contract with diagram-specific labels, while `Lander.astro` swaps only the hero media source and deletes the obsolete `.demo-chip` markup/styles. The existing product-window frame and image-preview dialog remain the only media presentation and enlargement path.

**Tech Stack:** Astro 5, Starlight 0.34, Astro Image assets, TypeScript, existing native `dialog`, static `build:landing-dist` assembler.

## Global Constraints

- Use the approved source image at `C:/Users/lichenxing/.codex/generated_images/019fcb72-515f-73a1-9e8b-48e2654b1409/exec-ec14cff9-7878-4d0b-8b0f-e542e746b0db.png` without regenerating or restyling it.
- Copy, do not move or overwrite, the generated source. The project asset is `packages/web/src/assets/lander/mission-workflow-hero.png`.
- Preserve every pixel and label in the approved PNG.
- Preserve the header Product demo navigation and the complete later `#demo` video section.
- Preserve later scenario screenshots and their image-preview behavior.
- Delete the hero's floating local-client walkthrough chip and all selectors that only support it.
- Do not add, modify, update, or run UI automation tests. UI acceptance uses real visible English and Simplified Chinese pages, manual interaction, screenshots, and personal review.
- Do not rebuild native Windows artifacts; `build:landing-dist` copies the existing three-file Windows directory.
- Use `apply_patch` for text/source edits, exact-path staging, `dsw-33987` commit subjects, and normal pushes to `legacy-remote/work-lcx-v0.0.30beta`.
- Do not create a worktree or use a sub-agent in this side conversation.

---

## Recall

### User request

- Optimize the supplied complete Mission workflow for the promotional landing style.
- Preserve all visible workflow nodes.
- Use PNG.
- Show a preview before integration; the user approved the second pure black-and-white preview.
- Replace the hero's local-client screenshot and remove the lower-right local-client walkthrough entry.

### Acceptance criteria

- The approved PNG appears in the hero on both locales with readable framing and click-to-enlarge behavior.
- The previous hero client screenshot no longer renders in that position; later story screenshots remain unchanged.
- No `.demo-chip` UI or dead CSS remains.
- The later video demo, internal `#demo` navigation, language switch, Windows download, and image dialog remain usable.
- The final static distribution contains 105 pages and the three unchanged Windows x64 files.

### Sources read

- `specs/records/2026-08/2026-08-04-landing-hero-mission-flow-design.md`
- `packages/web/src/components/Lander.astro`
- `packages/web/src/content/landing.ts`
- `packages/web/src/assets/lander/client-agent-workspace.png`
- Approved generated PNG path from Global Constraints

### Repository search evidence

- `ClientAgentWorkspace` is imported once and used by the hero, story image array, and video poster; only the hero image/preview source changes, so the import remains live.
- `.demo-chip` is a hero-only anchor to `#demo`; the header already owns a separate product-demo anchor.
- The image dialog reads `data-preview-src` and `data-preview-alt`, so no new preview implementation is needed.
- `hero-product`, `product-window`, and `image-preview-trigger` already own the target sizing, border, overflow, and interaction primitives.

### Independent agent feedback

- None. Sub-agent use is prohibited in this side conversation.

---

### Task 1: Install the approved PNG and extend the content contract

**Files:**
- Create: `packages/web/src/assets/lander/mission-workflow-hero.png`
- Modify: `packages/web/src/content/landing.ts`

**Interfaces:**
- Consumes: approved generated PNG and existing `LandingContent.hero` locale contract.
- Produces: `MissionWorkflowHero` importable asset plus `hero.diagramWindowLabel` and `hero.diagramAlt` strings for both locales.

- [x] **Step 1: Copy the approved asset**

Run:

```powershell
Copy-Item -LiteralPath 'C:\Users\lichenxing\.codex\generated_images\019fcb72-515f-73a1-9e8b-48e2654b1409\exec-ec14cff9-7878-4d0b-8b0f-e542e746b0db.png' -Destination 'packages\web\src\assets\lander\mission-workflow-hero.png'
```

Expected: the source remains present and the project copy has the same byte length and SHA-256 digest.

- [x] **Step 2: Add diagram-owned content fields**

Add to the `hero` type:

```ts
diagramWindowLabel: string
diagramAlt: string
```

English values:

```ts
diagramWindowLabel: "MOSA / complete Mission workflow",
diagramAlt: "A complete Mission workflow branching through two schedulers, investigators, planners, developers, reviewers, and handoffs.",
```

Simplified Chinese values:

```ts
diagramWindowLabel: "MOSA / 完整 Mission 工作流",
diagramAlt: "一条完整 Mission 工作流，分为两条调度链，依次经过调查、规划、开发、审查与交接。",
```

- [x] **Step 3: Run Astro validation**

Run `bun run --cwd packages/web check` after Task 2 consumes both fields. Expected: zero Astro errors; the existing `qa/dedupe-lead.cjs` hint may remain.

### Task 2: Replace hero media and delete the walkthrough chip

**Files:**
- Modify: `packages/web/src/components/Lander.astro`

**Interfaces:**
- Consumes: `MissionWorkflowHero`, `content.hero.diagramWindowLabel`, and `content.hero.diagramAlt`.
- Produces: the same `.product-window`/dialog interaction with the new bitmap, and no `.demo-chip` surface.

- [x] **Step 1: Import the new bitmap**

Add:

```ts
import MissionWorkflowHero from "../assets/lander/mission-workflow-hero.png"
```

- [x] **Step 2: Swap the hero media only**

Within `.hero-product`, replace the window label with `content.hero.diagramWindowLabel`. Replace the trigger `aria-label`, `data-preview-src`, `data-preview-alt`, rendered `Image src`, and rendered `Image alt` with diagram-owned values and `MissionWorkflowHero`. Keep `ClientAgentWorkspace` for `storyImages` and the demo poster.

- [x] **Step 3: Delete the floating entry**

Delete the `<a class="demo-chip" href="#demo">...</a>` block. Delete `.demo-chip`, `.demo-chip-play`, and their hover/focus/responsive rules. Do not delete the header `content.nav.demo` link or the `<section id="demo">` video.

- [x] **Step 4: Review touched selectors**

Use `rg -n "demo-chip|MissionWorkflowHero|ClientAgentWorkspace" packages/web/src/components/Lander.astro` as a read-only review. Expected: no `demo-chip`; one `MissionWorkflowHero` import and hero use set; live `ClientAgentWorkspace` story/poster uses remain.

- [x] **Step 5: Validate and commit implementation**

Run `bun run --cwd packages/web check`, inspect `git diff --check`, stage the asset and two source files exactly, then commit:

```powershell
git commit -m "dsw-33987 replace hero with mission workflow"
```

### Task 3: Build, real-page visual review, and delivery

**Files:**
- Modify: `specs/records/2026-08/2026-08-04-landing-hero-mission-flow-implementation-plan.md`
- Create: `specs/artifacts/landing-mission-flow-en.png`
- Create: `specs/artifacts/landing-mission-flow-zh-cn.png`

**Interfaces:**
- Consumes: final page renderer and existing Windows artifact directory.
- Produces: deployment-ready `packages/web/dist`, visual evidence, completed plan, and legacy remote delivery.

- [x] **Step 1: Run non-UI checks and build**

Run:

```powershell
bun test packages/opencorvus/test/script/landing-download-contract.test.ts
bun run build:landing-dist
```

Expected: 1 download-contract pass, 105 generated pages, and three copied Windows files totaling 639,398,417 bytes.

- [x] **Step 2: Inspect the English real page**

Open `http://127.0.0.1:9996/docs/`. Inspect the full hero, workflow readability, page balance, absence of the walkthrough chip, download anchor, header demo anchor, and click-to-enlarge dialog. Capture `specs/artifacts/landing-mission-flow-en.png` and personally inspect it.

- [x] **Step 3: Inspect the Simplified Chinese real page**

Open `http://127.0.0.1:9996/docs/zh-cn/` and repeat the real-page inspection. Capture `specs/artifacts/landing-mission-flow-zh-cn.png` and personally inspect it.

- [x] **Step 4: Run required documentation checks**

Run:

```powershell
bun test --timeout 30000 packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
```

Expected: 70 passes and zero failures.

- [x] **Step 5: Record evidence and commit**

Append exact command counts, asset hash, build inventory, browser URLs, screenshot findings, and interaction results to this plan. Stage only the plan and screenshots, then commit:

```powershell
git commit -m "dsw-33987 record mission flow hero evidence"
```

- [x] **Step 6: Fetch, reconcile, and push**

Fetch `legacy-remote/work-lcx-v0.0.30beta`, require a zero-behind comparison, and push normally without bypassing hooks. Record the final commit and remote alignment in this plan.

## Implementation evidence

- Approved image source: `C:/Users/lichenxing/.codex/generated_images/019fcb72-515f-73a1-9e8b-48e2654b1409/exec-ec14cff9-7878-4d0b-8b0f-e542e746b0db.png`.
- Project asset: `packages/web/src/assets/lander/mission-workflow-hero.png`, 1,690 × 931 pixels, 942,471 bytes, SHA-256 `D36E99F37AE73B421BCC3C301925BADA300429842C3E814873BF20EB7D543DB8`. Source and project-copy hashes match exactly.
- Implementation commit: `e1899d43e2 dsw-33987 replace hero with mission workflow` installs the bitmap, adds the bilingual diagram content contract, replaces only the hero media, removes `demoDuration`, and deletes the walkthrough-chip markup and CSS.
- Astro validation: `bun run --cwd packages/web check` completed with 0 errors, 0 warnings, and the existing unused-variable hint in `qa/dedupe-lead.cjs`.
- Download distribution contract: `landing-download-contract.test.ts` completed with 1 pass, 0 failures, and 2 assertions.
- Static build: `bun run build:landing-dist` completed with 105 pages and 102 indexed documentation pages. Astro optimized the 920 KB source bitmap to an approximately 29 KB hero WebP while retaining the original project PNG.
- Windows inventory: the build copied the unchanged MSI, setup EXE, and overlay executable from `packages/overlay/dist-artifacts/windows-x64` into `packages/web/dist/downloads/windows-x64`; the three files still total 639,398,417 bytes.
- English real-page evidence: `http://127.0.0.1:9996/docs/` renders the complete monochrome workflow in the hero without the floating walkthrough chip. The image-preview dialog opens with all labels readable, and the header Product demo link still reaches `#demo` and the retained video section. Screenshot: `specs/artifacts/landing-mission-flow-en.png`.
- Simplified Chinese real-page evidence: `http://127.0.0.1:9996/docs/zh-cn/` renders the same approved workflow with localized window/alternative text, balanced against the Chinese hero copy and without clipping. Screenshot: `specs/artifacts/landing-mission-flow-zh-cn.png`.
- Visual review: the pure black/warm-white diagram matches the landing's restrained surfaces, its window frame aligns with the existing hero geometry, every supplied node remains present, and the removed chip leaves no empty overlay or alignment gap.
- UI acceptance remained manual and interactive; no UI automation test, DOM/source-string assertion, screenshot baseline, or pixel-difference fixture was created or run.
- Git delivery: `git fetch legacy-remote work-lcx-v0.0.30beta` showed the local branch two commits ahead and zero behind before push. Commits `e1899d43e2` and `bfc2c30a87` were pushed normally to `legacy-remote/work-lcx-v0.0.30beta` without bypassing hooks.
- Pre-push verification: SDK import and AI runtime checks passed; all 8 scheduled package typechecks passed; API route inventory, documentation generation, overlay internationalization, and secret scanning all completed successfully.

## Plan self-review

- Spec coverage: approved PNG, complete nodes, pure monochrome design, hero replacement, chip deletion, retained demo/story/download behavior, static build, screenshots, and legacy remote delivery all map to explicit steps.
- Placeholder scan: all files, fields, locale values, commands, URLs, expected counts, and commit subjects are explicit.
- Type consistency: both new `hero` fields are declared once and consumed by the hero renderer; no second content source is introduced.
- UI-test boundary: automated checks cover Astro compilation, filesystem distribution, and documentation health only. UI acceptance is real-page interaction and manual screenshot review.
- Worktree safety: the plan uses the current authorized branch because the repository rules and side-conversation boundary prohibit creating a worktree.
