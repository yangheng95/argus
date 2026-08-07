# Independent Developer Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the OpenCorvus desktop promotional landing page around independent-developer scenarios and truthful Expert Squad differentiation, reusing current product screenshots and video.

**Architecture:** Keep Astro/Starlight and the existing `Hero.astro` → `Lander.astro` composition as the single page implementation. Keep bilingual content in `landing.ts`, existing media in `src/assets/lander` and `public/docs/media`, and component-local styling in `Lander.astro`; introduce no second renderer, data source, or interaction framework.

**Tech Stack:** Astro 5, Starlight, TypeScript, Astro Image, existing component-local CSS, native HTML dialog/video, Node-backed browser inspection.

## Recall

| Item | Current contract |
| --- | --- |
| User request | Optimize the promotional page using CrewForm only as inspiration, target independent developers, emphasize distinctive features and usage scenarios, reuse existing screenshots/video, and use explicit temporary media placeholders where evidence is missing. |
| Approved design | `specs/records/2026-08/2026-08-03-independent-developer-landing-page-design.md`. |
| Acceptance | Desktop-only real-page review for English and Simplified Chinese; inspect screenshots personally, interact with image preview and video, and iterate on visual defects. |
| Product evidence | Existing landing content/composition/media; current built-in `base`, `advanced`, and `research-studio` Expert Squad packages; resolver and Settings catalog projection. |
| Whole-repository grep | One composition owner (`Lander.astro`), one localized content owner (`landing.ts`), one splash consumer (`Hero.astro`), three current landing PNG files, one current WebM demo, and one prohibited UI source test (`packages/opencorvus/test/script/web-landing-page.test.ts`). |
| Parallel-work safety | Current branch was clean when planning began. Scope remains limited to the approved landing files, the discovered prohibited UI test, and specs indexes/records. |

## Global Constraints

- Desktop-only delivery; do not add tablet, mobile, or responsive acceptance work.
- Reuse the existing three tracked product screenshots and `/docs/media/opencorvus-client-demo.webm`.
- The missing Expert Squads capture must be a visibly labelled non-interactive placeholder, never a fabricated client screen.
- Do not copy CrewForm wording, branding, capability claims, pricing, provider counts, marketplace claims, or protocols.
- Do not add, update, or run UI automated tests. Delete the discovered landing UI test without running it.
- Preserve actual documentation/source links, native video controls, image preview behavior, and visible keyboard focus.
- `prompt_profile.active` and `PromptProfileResolver` remain product implementation facts; the landing page only explains them and does not add runtime logic.

---

### Task 1: Replace capability-first copy with scenario-first bilingual content

**Files:**
- Modify: `packages/web/src/content/landing.ts:34-350`
- Modify: `specs/records/2026-08/2026-08-03-independent-developer-landing-page-design.md:12`

**Interfaces:**
- Consumes: `landingContent[locale]` from the existing `LandingLocale` selection.
- Produces: `content.expertSquads` with `eyebrow`, `title`, `description`, `capabilities`, `packages`, and `placeholder`; revised `hero`, `demo`, `features`, `surfaces`, and `cta` copy in both locales.

- [x] **Step 1: Extend the content contract**

Add this structure to `LandingContent`:

```ts
expertSquads: {
  eyebrow: string
  title: string
  description: string
  capabilities: Array<{ label: string; description: string }>
  packages: Array<{ name: string; role: string }>
  placeholder: { label: string; title: string; description: string }
}
```

- [x] **Step 2: Rewrite the English narrative**

Use an independent-developer headline equivalent to “From idea to review-ready delivery” and three scenario labels in this order: investigate and unblock, build a complete change, delegate durable work. Describe Expert Squads as selected self-contained teams that project Agents, Skills, tools, MCP access, and binding workflows. Name only the current built-ins: Base, Advanced, Research Studio.

- [x] **Step 3: Rewrite the Simplified Chinese narrative**

Mirror the same meaning and ordering in natural Chinese: “从一个想法，到可审查的完整交付”, “快速排障”, “完整交付”, “长程推进”, and “选择专业能力闭包，而不是堆叠更多 Agent”. Translate MCP once as `MCP（Model Context Protocol，模型上下文协议）` in the descriptive copy.

- [x] **Step 4: Validate the content module statically**

Run:

```powershell
bunx prettier --check packages/web/src/content/landing.ts
```

Expected: exit code 0 after formatting. This is a source-format check, not a UI test.

### Task 2: Compose the Expert Squads section and scenario evidence

**Files:**
- Modify: `packages/web/src/components/Lander.astro:1-1220`

**Interfaces:**
- Consumes: `content.expertSquads`, `content.features.items`, existing `storyImages`, and `demoSource`.
- Produces: one `#expert-squads` section between scenario stories and runtime surfaces; three scenario stories retain existing media; no new client runtime dependency.

- [x] **Step 1: Add truthful navigation and section order**

Add the Expert Squads anchor to the header and render the new section after `#features`. Keep the sequence Hero → scenarios → demo evidence → Expert Squads → runtime → call to action, placing the existing native video adjacent to the durable-work scenario rather than presenting it as an unrelated product inventory.

- [x] **Step 2: Render the product capability closure**

Use semantic markup with one heading, four capability rows, and three built-in package chips:

```astro
<section id="expert-squads" class="squad-section" aria-labelledby="squad-title">
  <div class="section-wrap squad-layout">
    <div class="squad-copy">...</div>
    <div class="squad-proof">
      <div class="squad-capability-list">...</div>
      <div class="squad-package-list">...</div>
    </div>
  </div>
</section>
```

The four capability rows are Agents, Skills, Tools + MCP, and Binding workflows. The package chips are Base, Advanced, and Research Studio.

- [x] **Step 3: Render the explicit media placeholder**

Add a non-interactive frame inside the section using `content.expertSquads.placeholder`. It must visibly say that an Expert Squads product capture is coming soon and must not contain fake window chrome, invented data, or a disabled action.

- [x] **Step 4: Establish the visual system with existing primitives**

Extend component-local CSS using current tokens (`--ink`, `--paper`, `--green`, `--blue`) and existing section widths. Use a dark high-contrast Expert Squads band, a two-column desktop composition, compact capability rows, and restrained green/blue accents. Preserve existing `:focus-visible`, dialog, and video styles; do not introduce a library or parallel stylesheet.

- [x] **Step 5: Format the Astro source**

Run:

```powershell
bunx prettier --write packages/web/src/components/Lander.astro packages/web/src/content/landing.ts
```

Expected: both files formatted successfully. Formatting is a mechanical source operation, not UI automation.

### Task 3: Remove prohibited UI test debt and verify static contracts

**Files:**
- Delete: `packages/opencorvus/test/script/web-landing-page.test.ts`
- Inspect: `packages/opencorvus/test/script`

**Interfaces:**
- Consumes: the existing web package build/check scripts.
- Produces: a landing implementation with no UI source-assertion test in the touched scope and successful TypeScript/Astro static verification.

- [x] **Step 1: Inspect the test's references without running it**

Run:

```powershell
rg -n "web-landing-page|LandingContent|landingContent" packages/opencorvus/test packages/opencorvus/package.json package.json
```

Record whether any fixture or script is exclusively owned by this test.

- [x] **Step 2: Delete the UI automated test**

Delete `packages/opencorvus/test/script/web-landing-page.test.ts` with a repository patch. Delete an associated fixture/config only if Step 1 proves exclusive ownership.

- [x] **Step 3: Run Astro static checking**

Run:

```powershell
bun run --cwd packages/web check
```

Expected: exit code 0 with no Astro or TypeScript errors.

- [x] **Step 4: Build the production docs site**

Run:

```powershell
bun run --cwd packages/web build
```

Expected: exit code 0 and generated `/docs/` plus `/docs/zh-cn/` pages.

### Task 4: Validate the real desktop page visually

**Files:**
- Inspect: built output and real preview URLs for `/docs/` and `/docs/zh-cn/`
- Create only as delivery evidence when needed: `specs/artifacts/independent-developer-landing-page-en.png`
- Create only as delivery evidence when needed: `specs/artifacts/independent-developer-landing-page-zh-cn.png`

**Interfaces:**
- Consumes: successful Task 3 build and the Node-backed real browser path.
- Produces: manually inspected desktop screenshots and interaction evidence, not a repeatable test script or baseline.

- [x] **Step 1: Start an isolated real docs preview**

Start the package's Astro preview on an available local port using Node-backed project tooling. Do not use Bun to launch Playwright and do not touch a running OpenCorvus/Overlay process.

- [x] **Step 2: Inspect the English desktop page**

Open `/docs/` at approximately 1440×1000, capture the full page and focused regional screenshots, and personally inspect headline wrapping, scenario rhythm, Expert Squads hierarchy, placeholder honesty, contrast, media sizing, and final call to action.

- [x] **Step 3: Exercise real interactions**

Use the real page to open and close one screenshot preview, operate native video controls, and traverse header/primary actions with the keyboard. Confirm URL, title, focus, dialog, and native media state from the live browser.

- [x] **Step 4: Inspect the Simplified Chinese desktop page**

Open `/docs/zh-cn/` at the same viewport and inspect Chinese line breaks, glyph rendering, content parity, spacing, placeholder labelling, and action hierarchy.

- [x] **Step 5: Correct and repeat**

If any screenshot differs from the approved hierarchy or has clipping, weak contrast, false affordances, excessive density, or poor line wrapping, patch `Lander.astro`/`landing.ts`, rerun static checks/build, recapture, and inspect again until corrected.

### Task 5: Second review, documentation health, and delivery

**Files:**
- Modify: `specs/records/2026-08/2026-08-04-independent-developer-landing-page-implementation-plan.md`
- Modify: `specs/README.md`
- Modify: `specs/records/2026-08/README.md`

**Interfaces:**
- Consumes: final source diff, static command output, live browser evidence, and approved design.
- Produces: current Recall/verification record, indexed specs, one scoped commit, and legacy remote push.

- [x] **Step 1: Perform the independent source review**

Review every changed landing claim against current Base, Advanced, Research Studio, resolver, and client evidence. Verify that all URLs exist, existing media remains real, the placeholder is explicit, and the page contains no CrewForm-only capability claim.

- [x] **Step 2: Run required documentation health checks**

Run:

```powershell
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
```

Expected: all positive documentation-contract tests pass. These tests assert documentation structure/single-source contracts, not UI appearance.

- [x] **Step 3: Record final evidence**

Append an `## Implementation evidence` section to this plan with exact commands, exit codes, real preview URLs, screenshots personally inspected, interaction states exercised, remaining explicit media placeholder, and second-review verdict.

- [x] **Step 4: Commit the scoped delivery**

Stage only landing files, the prohibited UI test deletion, this plan/design, required indexes, and Task-scoped screenshot evidence. Commit with subject:

```text
dsw-33987 redesign landing page for independent developers
```

- [x] **Step 5: Push through project hooks**

Push the current delivery branch to the `legacy-remote` remote without bypassing hooks. Resolve any typecheck, route, or docs check failure at its root and push again.

## Plan self-review

- Spec coverage: every approved page region, current Expert Squad evidence, media reuse/placeholder rule, desktop visual acceptance, interaction acceptance, prohibited UI-test deletion, second review, docs indexes, and push is owned by a task.
- Placeholder scan: the only product placeholder is the user-approved, explicitly labelled Expert Squads capture slot; every implementation step is concrete.
- Type consistency: `content.expertSquads` is defined once in Task 1 and consumed with the same field names in Task 2.

## Implementation evidence

- `bunx prettier --write packages/web/src/components/Lander.astro packages/web/src/content/landing.ts` formatted `landing.ts` and reported that the repository has no Astro parser for `Lander.astro`. No dependency was added; the Astro source retained its existing format and was verified by Astro's own checker.
- The first combined `check; build` command reached Astro cache generation but exceeded the outer 120-second budget without output. Process inspection showed no residual Bun or Node process. The isolated rerun `bun run --cwd packages/web check` completed in 12.6 seconds with 0 errors, 0 warnings, and one existing unused-variable hint in `qa/dedupe-lead.cjs`.
- `bun run --cwd packages/web build` completed in 21 seconds and generated 105 pages, including the English and Simplified Chinese landing pages and every linked documentation route.
- A Node-launched Playwright session used installed Microsoft Edge 151 against `http://127.0.0.1:4322/docs/` and `/docs/zh-cn/`. The in-app browser connector was attempted first, but its JavaScript kernel failed before browser setup with Windows path error 3; the one-off Edge session created no test file or assertion.
- Real interaction evidence: the localized native image dialog opened and closed with Escape; the WebM video reported ready state 4, changed from paused to playing, advanced to 0.48 seconds, and paused again; keyboard Tab moved focus from the brand link to the first `Use cases` navigation link.
- Initial full-page capture exposed unloaded lazy images. The real page was scrolled through all three scenarios, demo, Expert Squads, runtime, and final action; a second capture verified all eight material images had non-zero natural width before final screenshots were inspected.
- Personally inspected screenshots: `specs/artifacts/independent-developer-landing-page-{en,zh-cn}.png`, `...-{en,zh-cn}-hero.png`, `...-{en,zh-cn}-scenarios.png`, and `...-{en,zh-cn}-expert-squads.png`. The review found coherent desktop hierarchy, readable bilingual wrapping, real media in all three scenarios, visible calls to action, clear contrast, and no clipping.
- Product-claim review matched Base, Advanced, and Research Studio manifests plus their declared tools, Skills, Model Context Protocol access, and binding workflows. Built output proves all public links exist. A focused source scan found no CrewForm-only pricing, marketplace, provider-count, Bring Your Own Key, Agent-to-Agent, or Agent-User Interaction capability claim.
- Accepted remaining media boundary: the Expert Squads section visibly labels its catalog/Agent media frame as a placeholder to be replaced by a future real product capture; it has no fake window, invented data, disabled action, or false live affordance.
- Final pre-commit verification reran `bun run --cwd packages/web check`, `bun run --cwd packages/web build`, both required documentation-test commands, and `git diff --check` on the delivery tree. Results: Astro reported 0 errors and 0 warnings (plus the same pre-existing hint), the production build generated 105 pages, historical links reported 2 passes, documentation health/single-source reported 68 passes and 1,186 assertions, and the diff whitespace check exited 0.
- After expanding the English acronym to `Model Context Protocol (MCP)`, a fresh visible Edge session recaptured and personally inspected `specs/artifacts/independent-developer-landing-page-en-expert-squads.png`; the section remained unclipped and preserved its hierarchy at a 1,440-pixel desktop width.
- Scoped delivery commit `fc5ad6673b` (`dsw-33987 redesign landing page for independent developers`) was pushed successfully to `legacy-remote/work-lcx-v0.0.30beta` without bypassing hooks.
