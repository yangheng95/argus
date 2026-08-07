# Landing Monochrome Navigation Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every promotional documentation/source destination and the Windows-card version badge while converting the existing bilingual landing chrome to a restrained black, white, and gray visual system.

**Architecture:** `landing.ts` remains the sole bilingual content owner and `Lander.astro` remains the sole landing renderer/style owner. The implementation deletes obsolete navigation fields together with their markup, converts documentation-linked runtime cards to semantic non-interactive articles, and replaces landing-only color/decorative CSS with one neutral token set without changing Starlight documentation routes or native product media.

**Tech Stack:** Astro 5, Starlight 0.34, Astro assets, existing Starlight icons, TypeScript, static `build:landing-dist` assembler.

## Global Constraints

- Preserve all 102 documentation Markdown/MDX files, Starlight routes, architecture explorer pages, and documentation dependencies.
- Preserve landing content order, responsive structure, language switching, internal anchors, image preview, demo video, and direct Windows x64 download semantics.
- Do not display or retain landing documentation/source destination fields after their renderers are deleted.
- Do not display the Windows version badge; retain the internal package version that owns the installer filename.
- Landing surfaces, typography, controls, and decorative chrome use only `#0a0a0a`, `#1f1f1f`, `#ffffff`, `#f5f5f5`, `#d4d4d4`, `#737373`, and opacity variants of black/white/gray. The product-owned brand icon retains its native source colors.
- Remove green/blue accent tokens, colored gradients, ornamental grids, glow elements, glow shadows, and colored chrome dots from the landing renderer.
- Preserve the native colors inside imported product screenshots and the demo video.
- Do not add, modify, update, or run UI automation tests. UI acceptance uses the real visible page, screenshots, and personal review only.
- Use `apply_patch` for source/spec edits, stage exact task files, use the `dsw-33987` commit prefix, and push normally to `legacy-remote/work-lcx-v0.0.30beta` without bypassing hooks.

---

## Recall

### User request

- Keep the full documentation site; remove only landing-page documentation/source navigation.
- Remove the version badge from the upper-right corner of the Windows download card.
- Keep the current interaction and information architecture.
- Convert the landing visual treatment to black, white, and gray; remove green, gradients, glowing shadows, and unnecessary decoration; keep product screenshots and video.

### Acceptance criteria

- English and Simplified Chinese landing pages contain no documentation/source destination controls.
- Documentation pages still build.
- The download card contains no version badge and the direct setup executable still downloads.
- The landing chrome is monochrome and readable with no residual green/blue accent or decorative gradient/glow.
- Both real desktop pages are personally inspected from fresh screenshots after the final static build.

### Hard constraints

- The UI automation-test prohibition applies to TSX/HTML/CSS/i18n/source-string assertions, DOM/component/snapshot tests, Playwright tests, and screenshot baselines.
- The page may be operated with Browser/Playwright for one-off interactive inspection and screenshots, but that process must not be saved as a repeatable test.
- macOS packaging remains out of scope; `build:landing-dist` copies the existing Windows x64 directory and never rebuilds native artifacts.
- No worktree or sub-agent may be created in this side conversation.

### Sources read

- `AGENTS.md`
- `specs/records/2026-08/2026-08-04-landing-external-navigation-and-version-badge-cleanup-design.md`
- `specs/records/2026-08/2026-08-04-static-landing-native-downloads-design.md`
- `specs/records/2026-08/2026-08-04-static-landing-windows-download-implementation-plan.md`
- `packages/web/src/content/landing.ts`
- `packages/web/src/components/Lander.astro`
- `packages/web/src/content/docs/index.mdx`
- `packages/web/src/content/docs/zh-cn/index.mdx`
- `packages/web/astro.config.mjs`
- `packages/web/package.json`

### Repository search evidence

- `Lander.astro` imports `config` only for its header/footer source links, so the import becomes dead when those links are deleted.
- Documentation/source destinations exist in header actions, the hero secondary action, every scenario story, every runtime surface, the final call-to-action, and the footer.
- The version badge has one renderer at the download-card heading and one section-local CSS rule; package versioning remains in `landing-download.ts`.
- Landing CSS currently defines green and blue tokens, five gradient/grid surfaces, a blurred product glow, multiple colored hover/focus treatments, and several large decorative shadows.
- The three imported screenshots and the video source are independent media inputs and do not require modification.

### Independent agent feedback

- No sub-agent was used because this side conversation explicitly prohibits sub-agent interaction.

---

### Task 1: Delete promotional documentation/source navigation and version presentation

**Files:**
- Modify: `packages/web/src/content/landing.ts`
- Modify: `packages/web/src/components/Lander.astro`

**Interfaces:**
- Consumes: `landingContent: Record<LandingLocale, LandingContent>` and `landingWindowsDownload`.
- Produces: a reduced content contract with no landing external-document destinations and a renderer whose remaining links are internal navigation, language switching, media, or direct download.

- [x] **Step 1: Reduce the bilingual content types**

In `landing.ts`:

- Delete `href` and `linkLabel` from `LandingStory` and `LandingSurface`.
- Delete `docs` and `source` from `LandingContent.nav`.
- Delete `secondary` from `LandingContent.hero`.
- Delete `versionLabel` from `LandingContent.download`.
- Delete `primary` and `secondary` from `LandingContent.cta`.

Keep `LandingLink` because `language` still uses it. Keep the package version only in `landingWindowsDownload`.

- [x] **Step 2: Delete matching English and Chinese values**

Delete the bilingual values for every removed field. In all three scenario items and all four runtime-surface items, retain only their label/icon, title, description, and bullets as applicable.

- [x] **Step 3: Delete external-navigation markup**

In `Lander.astro`:

- Remove `import config from "../../config.mjs"`.
- Keep only the language link in `.header-actions`.
- Keep only the `#download` action in `.hero-actions`.
- Delete each story documentation anchor.
- Replace each runtime `<a class="surface-card">` with `<article class="surface-card">` and delete `.surface-link`.
- Delete `.cta-actions`; preserve the mark and explanatory copy.
- Keep only the license text beside the footer brand.
- Remove the download-card version span. Simplify its heading to the platform label without an empty flex counterweight.
- Remove the `product-glow` element because the approved visual system also retires that decorative glow.

- [x] **Step 4: Remove dead structural selectors**

Delete rules that only support removed controls: `.docs-link`, `.source-link`, `.secondary-button`, `.story-copy a`, `.surface-link`, `.cta-actions`, `.primary-button.light`, `.outline-button`, `.download-version`, and their hover/transition entries. Update `.cta-section` from three columns to `auto minmax(0, 1fr)` so the removed action column leaves no gap. Update footer alignment without link-specific selectors.

- [x] **Step 5: Run the type checker**

Run:

```powershell
bun run --cwd packages/web check
```

Expected: Astro reports zero errors. The existing `qa/dedupe-lead.cjs` unused-variable hint may remain.

- [x] **Step 6: Review and commit the deletion**

Review only the two task files, confirm no documentation source file changed, then commit:

```powershell
git diff --check
git diff -- packages/web/src/content/landing.ts packages/web/src/components/Lander.astro
git add -- packages/web/src/content/landing.ts packages/web/src/components/Lander.astro
git commit -m "dsw-33987 remove landing documentation navigation"
```

### Task 2: Replace landing chrome with one monochrome visual system

**Files:**
- Modify: `packages/web/src/components/Lander.astro`

**Interfaces:**
- Consumes: the reduced markup from Task 1.
- Produces: the same page layout and media with neutral landing-only tokens and section styles.

- [x] **Step 1: Replace landing color tokens**

Replace the current token block with:

```css
--ink: #0a0a0a;
--ink-soft: #1f1f1f;
--paper: #f5f5f5;
--paper-bright: #ffffff;
--muted: #737373;
--line: #d4d4d4;
--line-dark: rgba(255, 255, 255, 0.16);
```

Delete `--green`, `--green-deep`, and `--blue`.

- [x] **Step 2: Flatten section backgrounds and decoration**

- Set hero, download, squad, and surfaces backgrounds to solid `var(--ink)`.
- Set demo and alternating light sections to `var(--paper)` or `var(--paper-bright)`.
- Delete gradient background layers and hero/demo/squad grid pseudo-elements, including masks.
- Delete `.product-glow` CSS.
- Keep real product media and its framing.

- [x] **Step 3: Normalize controls, cards, and metadata**

- Primary light-surface actions: `background: var(--ink); color: white` with hover `#1f1f1f`.
- Dark-surface actions: white surfaces with black text where applicable.
- Download/story cards: white, `1px solid var(--line)`, no decorative shadow.
- Dark cards: translucent white/gray surfaces and `var(--line-dark)` borders.
- Replace green bullets, indices, icons, package numbers, kickers, and placeholder marks with black/white/gray values appropriate to their section.
- Convert the three fake window chrome dots to one neutral gray instead of red/yellow/green.
- Use `#a3a3a3` for focus outlines so they remain visible on black and white.

- [x] **Step 4: Remove glow and lift effects**

Delete large box shadows from product windows, media cards, demo stage, download card, CTA mark, and demo chip. Delete green overlay hover washes and card lift transforms. Retain only functional dialog backdrop separation; do not recolor screenshot or video pixels.

- [x] **Step 5: Inspect the remaining style inventory**

Use `rg` as a read-only review aid, not an automated UI assertion:

```powershell
rg -n "green|blue|gradient|product-glow|box-shadow|98, 230, 174|28, 191, 123|111, 140, 255" packages/web/src/components/Lander.astro
```

Review every remaining result. Functional black backdrop opacity is allowed; landing green/blue/gradient/glow results are not.

- [x] **Step 6: Check and commit the monochrome renderer**

Run:

```powershell
bun run --cwd packages/web check
git diff --check
git add -- packages/web/src/components/Lander.astro
git commit -m "dsw-33987 simplify landing monochrome visuals"
```

Expected: zero Astro errors and a commit limited to the landing renderer.

### Task 3: Build the static distribution and visually correct the real pages

**Files:**
- Modify: `specs/records/2026-08/2026-08-04-landing-monochrome-navigation-cleanup-implementation-plan.md`
- Create: `specs/artifacts/landing-monochrome-en.png`
- Create: `specs/artifacts/landing-monochrome-zh-cn.png`

**Interfaces:**
- Consumes: the final bilingual landing renderer, existing documentation corpus, and existing Windows x64 artifact directory.
- Produces: deployment-ready `packages/web/dist`, one-off visual evidence, and final implementation evidence.

- [x] **Step 1: Run focused non-UI validation**

Run:

```powershell
bun test packages/opencorvus/test/script/landing-download-contract.test.ts
bun run --cwd packages/web check
```

Expected: the artifact-copy contract passes, Astro reports zero errors, and no UI automation test is run.

- [x] **Step 2: Build the complete static distribution**

Run:

```powershell
bun run build:landing-dist
```

Expected: the Starlight documentation routes remain in the 105-page build, and all three existing Windows files are copied to `packages/web/dist/downloads/windows-x64` without native packaging.

- [x] **Step 3: Compare the artifact inventories**

Use PowerShell to compare relative paths and byte sizes between `packages/overlay/dist-artifacts/windows-x64` and `packages/web/dist/downloads/windows-x64`. Expected: three files and 639,398,417 bytes match exactly.

- [x] **Step 4: Inspect the English real page**

Open `http://127.0.0.1:9999/docs/` in the visible Browser. Inspect the header, hero, download card, story sections, demo stage, Expert Squads, runtime cards, CTA, and footer. Confirm by direct interaction that internal anchors, image preview, language switch, and Windows download remain usable. Capture `specs/artifacts/landing-monochrome-en.png` and personally inspect it.

- [x] **Step 5: Inspect the Simplified Chinese real page**

Open `http://127.0.0.1:9999/docs/zh-cn/` in the visible Browser and repeat the same inspection. Capture `specs/artifacts/landing-monochrome-zh-cn.png` and personally inspect it.

- [x] **Step 6: Correct and repeat visual review**

If either screenshot shows residual green/blue chrome, gradients, glow, weak contrast, empty action gaps, broken card rhythm, or clipping, update section-local CSS/markup, rebuild, and repeat both screenshots until corrected. Do not create a screenshot baseline, fixture, or automated pass/fail script.

- [x] **Step 7: Run required documentation checks**

Run:

```powershell
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
```

Expected: all three files pass because the documentation corpus remains unchanged and the new plan is tracked.

- [x] **Step 8: Record evidence and commit**

Append exact check counts, build route count, artifact inventory, preview URLs, interaction results, personal screenshot findings, and any visual correction to this plan. Then stage only the plan and two screenshots and commit:

```powershell
git add -- specs/records/2026-08/2026-08-04-landing-monochrome-navigation-cleanup-implementation-plan.md specs/artifacts/landing-monochrome-en.png specs/artifacts/landing-monochrome-zh-cn.png
git commit -m "dsw-33987 record landing monochrome evidence"
```

- [x] **Step 9: Reconcile and push legacy remote**

Run:

```powershell
git fetch legacy-remote work-lcx-v0.0.30beta
git rev-list --left-right --count HEAD...legacy-remote/work-lcx-v0.0.30beta
git push legacy-remote work-lcx-v0.0.30beta
```

Do not force-push or bypass hooks. Preserve unrelated work and report any evidenced external blocker exactly.

## Implementation evidence

- Implementation commit: `9703a69539 dsw-33987 simplify landing navigation and visuals` removes landing-only documentation/source navigation, removes the visible download-card version badge, replaces linked surfaces with semantic articles, and converts the page chrome to a black/white/gray system while retaining the existing product screenshots and video.
- Final visual correction: landing-owned brand icons now use grayscale presentation. This removes the last blue page-chrome accent without changing pixels inside product screenshots or the retained video.
- Astro validation: `bun run --cwd packages/web check` completed with 0 errors, 0 warnings, and 1 pre-existing unused-variable hint in `qa/dedupe-lead.cjs`.
- Distribution contract: `landing-download-contract.test.ts` completed with 1 pass, 0 failures, and 2 assertions.
- Documentation validation: the three required documentation suites completed with 70 passes, 0 failures, and 1,188 assertions.
- Static build: `bun run build:landing-dist` completed successfully with 105 pages, 102 indexed documentation pages, and both `en` and `zh-cn` search indexes. The documentation corpus and routes remain part of the distribution.
- Windows artifact inventory: source and destination both contain 3 files totaling 639,398,417 bytes. The setup executable is 209,913,873 bytes and returned HTTP 200 with the same `Content-Length` from a temporary static server rooted at `packages/web/dist`.
- English visual evidence: `specs/artifacts/landing-monochrome-en.png` was captured from `http://127.0.0.1:9999/docs/`. Header, hero, download card, stories, demo, Expert Squads, runtime cards, CTA, and footer were inspected in the real page. No documentation/source navigation remains, the version badge is absent, and the screenshot-preview dialog opens and closes normally.
- Simplified Chinese visual evidence: `specs/artifacts/landing-monochrome-zh-cn.png` was captured from `http://127.0.0.1:9999/docs/zh-cn/`. The Windows card exposes `/docs/downloads/windows-x64/OpenCorvus_0.0.30-beta_x64-setup.exe`; its black/white card hierarchy, CTA, footer, typography, and language switch were inspected without clipping or residual page-chrome color.
- Visual review result: the rendered chrome uses solid black, white, and neutral gray surfaces, fine borders, and flat controls. Green/blue accents, gradients, glow shadows, ornamental grids, and lift effects are removed. Product evidence media intentionally retains its native application colors.
- UI acceptance stayed interactive and manual: no UI automation test, source-string UI assertion, snapshot baseline, or pixel-diff fixture was created or run.
- legacy remote delivery: after fetching `legacy-remote/work-lcx-v0.0.30beta`, the local branch was 3 commits ahead and 0 behind. The normal push completed successfully; pre-push hooks passed SDK imports, AI runtime checks, 8 typecheck tasks across the 10-package scope, API route checks, documentation checks, overlay/panel internationalization checks, and secret scanning.

## Follow-up adjustment: native brand color and MOSA label

### Recall

- User request: restore the logo icon's original colors and rename every visible landing-page occurrence of the product from `OpenCorvus` to `MOSA` in both languages.
- Acceptance: the shared brand image has no grayscale filter; the header, demo stage, bilingual landing copy, footer, and accessibility labels all identify `MOSA`; the existing installer filename, code/package identifiers, media filename, and text rendered inside screenshot/video pixels remain unchanged.
- Repository evidence: `Lander.astro` owns the header/demo brand renderers and one grouped CSS rule applies `filter: grayscale(1)` to `.brand`, `.demo-stage-brand`, `.cta-mark`, and `.footer-brand` images. `landing.ts` contains sixteen visible bilingual `OpenCorvus` occurrences. `landing-download.ts` owns the existing installer filename and must remain stable so the deployed download path continues to resolve.
- Constraint update: monochrome remains the surface/control/decorative system, while the product-owned brand icon is an explicit native-color asset alongside the already preserved screenshots and video.
- Independent agent feedback: none; sub-agent use is prohibited in this side conversation.

- [x] Define one exported `landingProductName = "MOSA"` value in `landing.ts`; use it for all bilingual product copy and import it into `Lander.astro` for the header, demo-stage label, workspace label, and accessibility descriptions.
- [x] Remove the grouped brand-image grayscale filter without changing image files or product evidence media.
- [x] Run Astro checks and the static distribution build, then inspect the real English and Simplified Chinese landing pages and capture fresh screenshots.
- [x] Record verification, commit with the `dsw-33987` prefix, and push normally to `legacy-remote/work-lcx-v0.0.30beta`.

### Follow-up evidence

- `landingProductName` is the single landing-page product-name source. Both locale objects and all renderer-owned product labels now resolve to `MOSA`.
- Remaining `OpenCorvus` references in the touched landing implementation are limited to the existing installer filename in `landing-download.ts` and the existing demo media filename; these are distribution/runtime paths, not rendered product copy.
- `filter: grayscale(1)` was removed from the shared brand-image rule. No image asset was edited.
- `bun run --cwd packages/web check` completed with 0 errors, 0 warnings, and the existing unused-variable hint in `qa/dedupe-lead.cjs`.
- `bun run build:landing-dist` rebuilt 105 pages and retained all three Windows artifacts, including the current setup executable.
- Real-page review used `http://127.0.0.1:9996/docs/zh-cn/` and `http://127.0.0.1:9996/docs/`. The header, hero, download section, demo stage, Expert Squads, runtime surfaces, CTA, footer, and accessibility tree identify MOSA; the brand icon renders in its original blue. The installer link remains `/docs/downloads/windows-x64/OpenCorvus_0.0.30-beta_x64-setup.exe`.
- Fresh visual evidence is stored in `specs/artifacts/landing-mosa-zh-cn.png` and `specs/artifacts/landing-mosa-en.png`. Product screenshots/video intentionally retain their original embedded pixels.
- legacy remote delivery: commit `e774e28c95` was pushed normally to `legacy-remote/work-lcx-v0.0.30beta`. Pre-push checks passed SDK imports, AI runtime compatibility, all 8 typecheck tasks, API route validation, documentation checks, overlay/panel internationalization checks, and secret scanning.

## Plan self-review

- Spec coverage: navigation deletion, documentation preservation, version-badge deletion, monochrome tokens, gradient/glow retirement, media preservation, distribution build, screenshots, and legacy remote delivery all map to concrete tasks.
- Placeholder scan: all file paths, tokens, commands, route URLs, screenshot paths, expected inventories, and commit subjects are explicit.
- Type consistency: `LandingLink` remains for language only; `LandingStory` and `LandingSurface` no longer expose link fields; installer `version` remains internal to `landingWindowsDownload`.
- Test boundary: automated checks cover TypeScript/Astro compilation, documentation health, and filesystem artifact copying only. No UI source-string, DOM, component, snapshot, Playwright-test, or screenshot assertion is added or run.
- Worktree safety: every stage command names exact task files and no worktree/sub-agent operation is used.
