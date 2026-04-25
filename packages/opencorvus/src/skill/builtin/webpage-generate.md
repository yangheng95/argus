---
name: webpage-generate
description: Generate a single-file static HTML clone of a reference webpage with visual similarity ≥ 95. The mirror toolchain (`webpage_extract` → `webpage_compile` → `webpage_analyze`) extracts structure, design tokens, copy, and assets deterministically; you then HAND-WRITE `index.html` using vanilla CSS (one `<style>` block, design tokens injected as `:root` custom properties, real cascading selectors), iterating against `webpage_render` + `webpage_evaluate` until the score meets target. Activate when the user asks to clone, copy, reproduce, replicate, mirror, 复刻, 克隆, 模仿, or "make a page that looks like" another webpage; or when the brief cites a reference design (specific URL, screenshot). Always pull palette / text / structure from the mirror artifacts — never invent hex codes, copy, or section structure.
stage: build
auto_detect:
  task_signals:
    has_attachment_image: true
    request_contains_url: true
priority: 60
required_tools:
  - webpage_extract
  - webpage_compile
  - webpage_analyze
  - webpage_render
  - webpage_evaluate
  - webpage_text_diff
  - webpage_vision_judge
---

# Webpage Generate Skill

You produce a **single-file static HTML clone** of a reference webpage. The mirror toolchain extracts structure, tokens, and text deterministically; **you hand-write** `index.html` using vanilla CSS, then iterate against visual + textual diffs until the score meets target.

## Output contract — read carefully

The deliverable must satisfy ALL of:

- One `index.html` at the worktree root.
- ONE `<style>` block at the top of `<head>`. Use real CSS class selectors and cascading rules — do **NOT** put `style="…"` on every element.
- Inject every COLORS / FONTS / SPACING / RADII value from `mirror/design-tokens.ts` as a CSS custom property under `:root { --color-primary: …; }` and reference them via `var(--…)`. No hard-coded hex values inside selectors.
- Standard reset: `*, *::before, *::after { box-sizing: border-box }`, `body { margin: 0 }`, set `font-family` on `body`.
- **NO Tailwind. NO external CSS framework. NO CDN. NO JS framework. NO build step. NO `<script>` tag.** Only standard HTML5 + CSS3.
- All visible text from the reference appears as raw HTML — non-executing readers see the content.
- Images via the local `images/` paths from the mirror toolchain (or original URLs as fallback when the extractor could not download).

The agent does **not** call any "magic compile" tool that emits the HTML — there is no such tool by design (rule 22 — single source of truth for the generation strategy lives in `src/mirror/url/prompt.ts`). You write it.

## Reuse on re-entry

This skill is idempotent on `mirror/` and `index.html`. On re-entry:

- `mirror/extracted-page.json` — DOM tree + ~33 computed CSS properties per element
- `mirror/page-ir.xml` — compact XML IR (text catalogue, section structure)
- `mirror/scaffold.json` — section list + pattern catalog + design-token system
- `mirror/design-tokens.ts` — `COLORS` / `FONTS` / `SPACING` / `RADII` constants
- `mirror/shared-context.md` — compact prompt-ready summary
- `mirror/images/img-N.{png,jpg,svg}` — downloaded image assets
- `mirror/reference.png` — the pixel target for SSIM scoring
- `index.html` — your hand-written deliverable
- `images/` — assets the deliverable references (promoted from `mirror/images/`)

When the artefacts exist for the right URL, REUSE — skip extract, skip compile, skip analyze, jump to step 4. The whole point of `mirror/` being git-tracked + ff-only merged across goal worktrees is that subsequent goals build on the same authoritative source instead of re-extracting.

## Critical rules

- Steps 1–3 are **strictly serial**. Each consumes the previous step's output; never call them in the same response.
- Do NOT delete `mirror/` artifacts — see "Cross-goal artifact sharing" below.
- Do NOT mark the goal `passed` without the visual-acceptance gate (see "Hard acceptance gate").

## Activation

Use this skill when the user asks to reproduce a webpage's look — e.g. "Clone the Baidu homepage", "复刻 https://example.com/", "Make a landing page that looks like 小红书", "Rebuild the visual shell of <url>".

Do NOT use it for content rewriting, SEO analysis, or behavioural scraping.

## Step 0 — Resolve the URL

If the user provided a URL starting with `http://` or `https://`, skip to step 1. Otherwise call `websearch` for `X official homepage` / `X 官网`, pick the canonical host, and confirm with the user in one sentence unless unambiguous. Never invent a URL — if `websearch` returns nothing useful, stop and ask the user.

## Step 1 — Extract the reference

Call `webpage_extract` with the URL. Defaults (1440×900 viewport, `body` scope, `keep_images: true`) are right for most desktop pages. Artifacts land under `mirror/`:

- `mirror/reference.png` — the pixel target for scoring later
- `mirror/extracted-page.json` — DOM tree with computed CSS per element
- `mirror/images/img-N.{png,jpg,svg}` — downloaded image assets

Network access required. The tool will ask for permission.

### P1-A hard rule: no text-only fallback

If `webpage_extract` cannot resolve the reference (SPA login wall, pixel-free canvas, JS-only shell), **STOP and escalate to the user** — report the specific failure mode and ask for a different URL or a pre-extracted PNG. You MUST NOT:

- Continue by reading `mirror/scaffold.json` + writing an invented `index.html` from the visual-contract text alone.
- Fabricate screenshots, DOM snapshots, or `webpage_evaluate` scores.
- Call any submit / accept verdict on a deliverable whose build artefact cannot be rendered.

"Static scaffold because dynamic capture failed" is a hard-no.

## Step 2 — Compile the IR

Call `webpage_compile` (no args needed — defaults read `mirror/extracted-page.json` and write `mirror/page-ir.xml`). Pure transformation, no network.

## Step 3 — Analyze tokens + scaffold

Call `webpage_analyze` (no args needed). Writes:

- `mirror/scaffold.json` — `ProjectScaffold` (sections + patterns + token system)
- `mirror/design-tokens.ts` — `COLORS` / `FONTS` / `SPACING` / `RADII` constants you must use as `:root` custom properties
- `mirror/shared-context.md` — concise prompt-ready summary

## Step 4 — Read the artefacts BEFORE writing

`read` (the actual file contents):

- `mirror/page-ir.xml` — exact text + element structure (your section catalogue)
- `mirror/shared-context.md` — design-token / pattern summary
- `mirror/design-tokens.ts` — palette / typography
- `mirror/reference.png` — the visual target

Quote the exact strings, copy the exact hex codes (via `var(--…)`), follow the section ordering from `page-ir.xml`. Do not paraphrase headings, nav labels, or button text.

## Step 5 — Hand-write `index.html`

Skeleton (adapt to the reference):

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=1440, initial-scale=1" />
  <title><!-- exact title from page-ir.xml --></title>
  <style>
    :root {
      --color-primary: #4E6EF2;
      --color-bg: #ffffff;
      --color-text: #222;
      --color-border: #C8C8C8;
      --font-sans: "PingFang SC", system-ui, sans-serif;
      --space-1: 4px; --space-2: 8px; --space-3: 16px; --space-4: 24px;
      --radius-1: 4px; --radius-2: 8px;
      /* one custom property per token from design-tokens.ts */
    }
    *, *::before, *::after { box-sizing: border-box }
    body { margin: 0; font-family: var(--font-sans); color: var(--color-text); background: var(--color-bg); }
    .header { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3); }
    .search-box { border: 1px solid var(--color-border); border-radius: var(--radius-1); }
    .search-submit { background: var(--color-primary); color: #fff; }
    /* … real cascading rules … */
  </style>
</head>
<body>
  <header class="header">
    <!-- exact text from Section Text catalog in page-ir.xml -->
  </header>
  <main>…</main>
  <footer>…</footer>
</body>
</html>
```

Match section structure verbatim from `page-ir.xml`. Match bounds approximately via flex/grid + sizing tokens — pixel-exact placement is not required, structural similarity is.

## Step 6 — Render

Call `webpage_render` (no args needed — defaults render `<worktree>/index.html` and write `mirror/rendered.png`). Returns render time + any console errors.

## Step 7 — Evaluate

Two complementary checks. Run BOTH after every render — they catch different failure modes and disagreement between them is itself a signal.

### 7a. Visual judge (PRIMARY acceptance gate)

Call `webpage_vision_judge` (no args needed — defaults read `mirror/reference.png` + `mirror/rendered.png`). It does a single-shot vision-LLM call with no system prompt and no tool list — just the two images and a request to enumerate visible differences. Output goes to `mirror/vision-judge.json` and includes:

- `accepted: true|false` — the acceptance signal you trust
- `differences[]` — ranked list with `severity` (critical/major/minor), `region`, `observed`, `expected`, and a concrete `fix_hint` per item

Why this is primary: SSIM numbers and text-diffs are proxies that have historically let the agent skip looking at pixels (score plateau at ~94 with logo SVG and icons visibly wrong). Vision-judge forces an actual visual comparison every round.

### 7b. SSIM + diff heatmap (secondary, structural)

Call `webpage_evaluate reference=reference.png rendered=rendered.png` (both inside `mirror/`). Writes `mirror/diff.png` (red = pixels that differ) and `mirror/eval-result.json`. Returns a 0–100 score (`round(ssim × 50 + (100 − pixelDiff%) × 0.5)`).

Treat the score as a **trend indicator** for layout/colour drift, not as the acceptance gate. The diff heatmap is useful when vision-judge flags a region but you can't immediately see where the largest pixel-level error sits.

## Step 8 — Iterate on specific gaps

If the score is below target you MUST iterate. Most remaining gaps come from dynamic content (rotating placeholders, ads, personalisation), font fallbacks, images the extractor could not download, or layout drift.

For each round (up to **8**, count explicitly):

1. **Diagnose** in this order:
   - `webpage_vision_judge` — the structured `differences[]` list IS your work queue. Each entry already has a `fix_hint`. Address `severity: "critical"` items first, then `major`, then `minor`.
   - `webpage_text_diff` — list of reference strings absent from your render. Reliable signal for missing copy / hot-search rows / nav labels.
   - Inspect `mirror/diff.png` — only when you need to localise the pixel error that vision-judge flagged but you can't see at a glance.
2. **Edit** `index.html` with the `edit` tool (targeted patches; do NOT rewrite the whole file once it's at a workable state):
   - Apply the `fix_hint` for each diff vision-judge listed (severity-ordered).
   - Insert any strings reported by `webpage_text_diff`, in the right section per `page-ir.xml`'s `Section Text` catalogue. Keep wording verbatim.
   - Add or refine CSS rules for color drift / spacing / typography. Reference tokens via `var(--…)` only — do not invent hex values.
   - Replace placeholder image src values when `mirror/images/` is missing the asset (use the original remote URL from `extracted-page.json` as a fallback).
   - Preserve every element + CSS rule that is already rendering correctly. Deleting correct markup costs points you won't recover.
3. Re-run `webpage_render`.
4. Re-run `webpage_vision_judge` AND `webpage_evaluate`.
5. If `webpage_vision_judge` returns `accepted=true` (and SSIM has not regressed), proceed to acceptance. If still `accepted=false` and you've completed fewer than 8 rounds, go back to step 1. If you've completed 8 rounds and the verdict still rejects, STOP. Report the final verdict, the biggest remaining critical/major diffs, and any obvious blockers (e.g. dynamic content that cannot be statically cloned).

## Cross-goal artifact sharing — DO NOT delete `mirror/`

The mirror toolchain output MUST stay in the worktree. Subsequent goals + delivery agents read these artifacts to verify and refine your work; the build runtime ff-only merges your goal branch back into primary HEAD so the next worktree inherits them via git (rule 22 — single source of truth lives in git, not regenerated per goal). The deliverable is `index.html` + `images/`; mirror artefacts are git-tracked scratch — leave them in place.

## Hard acceptance gate — render screenshot is mandatory

You MUST NOT mark the goal `passed` or call `goal_report` / `StructuredOutput` until you have:

1. Run `webpage_render` and produced `mirror/rendered.png` for the CURRENT `index.html` (re-run after every edit pass — a stale rendered.png from before your last edit does NOT count).
2. Run `webpage_vision_judge` against the freshly-rendered `mirror/rendered.png` and confirmed the verdict file `mirror/vision-judge.json` reports `accepted: true`. This is the SINGLE primary acceptance signal — SSIM scores alone are NOT enough.
3. Read `mirror/rendered.png` (the actual image, not just its bytes count) and visually compared it against `mirror/reference.png`. Confirm in your structured output that you inspected both images.
4. Run `webpage_evaluate` against the freshly-rendered `mirror/rendered.png` and recorded the score in `mirror/eval-result.json` (secondary trend signal).

The render screenshot is the SINGLE source of truth for "does this look like the reference". DOM diffs, text-presence checks, file-existence asserts, and DOCTYPE greps are sanity checks — they are NEVER a substitute for looking at the rendered image. A goal that compiled, committed, and passes every textual check but renders to a blank page or a broken layout is a FAILED goal regardless of what the structural checks say. Catch that before delivery does.

If `webpage_render` fails (port collision, puppeteer crash, missing assets) — fix the root cause and re-run; do NOT ship without a successful render.

## What success looks like

A self-contained `index.html` + `images/` folder at the worktree root, plus the `mirror/` toolchain output preserved for downstream goals, with:

- All canonical text from the reference present verbatim (read from `page-ir.xml`)
- All images referenced by their local `images/` paths
- One `<style>` block, vanilla CSS, design tokens injected via `:root` custom properties (no inline styles, no Tailwind, no JS runtime)
- `mirror/rendered.png` exists, was visually inspected against `mirror/reference.png`, and matches
- Score ≥ 95 from `webpage_evaluate` (against the freshly-rendered screenshot)

Report the final score, cite the render screenshot path in your goal_report, and list the sections that are still below pixel parity (usually dynamic content — rotating placeholders, ads, personalisation).
