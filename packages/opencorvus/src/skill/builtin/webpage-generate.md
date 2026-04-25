---
name: webpage-generate
description: Generate a webpage as a static single-file HTML clone with visual similarity ≥ 95%. Pipeline is deterministic — extract DOM via headless Chrome, compile to inline-styled `index.html`, then render + evaluate against the reference and edit on specific gaps. Activate when the user asks to clone, copy, reproduce, replicate, mirror, 复刻, 克隆, 模仿, or "make a page that looks like" another webpage; or when the brief cites a reference design (Apple HIG, macOS/iOS app, a specific site URL, a Figma/screenshot) and expects a visual match. Always compile from `mirror/extracted-page.json` — do NOT hand-write the clone from a screenshot. 始终从 mirror 抽取产物编译，不要根据截图手写 HTML。
stage: build
auto_detect:
  files:
    - index.html
    - public/index.html
    - src/App.tsx
    - src/App.vue
    - src/main.tsx
    - vite.config.ts
    - vite.config.js
    - next.config.js
    - next.config.ts
    - package.json
  deps:
    - react
    - react-dom
    - vue
    - svelte
    - next
    - nuxt
    - solid-js
    - astro
    - vite
    - tailwindcss
  task_signals:
    has_attachment_image: true
    request_contains_url: true
priority: 60
---

# Webpage Generate Skill

You produce a **static HTML clone** that visually mirrors a reference webpage. The pipeline is deterministic: the mirror toolchain extracts the authoritative DOM tree + computed styles + image assets, then `webpage_compile_html` replays them as inline-styled `index.html`. **You do NOT hand-write the clone.** Your job is to (a) trigger the pipeline in order, (b) render and evaluate, (c) edit `index.html` only when `webpage_evaluate` / `webpage_text_diff` surfaces a specific gap.

## Reuse on re-entry

This skill is idempotent on `mirror/` and `index.html`. Before doing anything, list the worktree root and check what already exists from a prior invocation or sibling goal:

- `mirror/extracted-page.json` — DOM tree + ~33 computed CSS properties per element
- `mirror/page-ir.xml` — compact XML IR (text catalogue, section structure)
- `mirror/scaffold.json` — section list + pattern catalog + design-token system
- `mirror/design-tokens.ts` — `COLORS` / `FONTS` / `SPACING` / `RADII` constants
- `mirror/shared-context.md` — compact prompt-ready summary
- `mirror/images/img-N.{png,jpg,svg}` — downloaded image assets
- `mirror/reference.png` — the pixel target for SSIM scoring
- `index.html` — the compiled deliverable
- `images/` — assets the deliverable references (promoted from `mirror/images/`)

When `mirror/extracted-page.json` exists for the right URL, REUSE — skip extract, jump straight to `webpage_compile_html`. The whole point of `mirror/` being git-tracked + ff-only merged across goal worktrees is so subsequent goals build on the same authoritative source instead of re-extracting.

## Critical rules

- Steps 1–2 are **strictly serial**. `webpage_compile_html` reads what `webpage_extract` writes; never call them in the same response.
- Do NOT hand-write `index.html` from a screenshot. Always go through `webpage_compile_html`.
- Do NOT call `webpage_compile` or `webpage_analyze` unless `webpage_evaluate` surfaces a gap that needs the IR or scaffold to diagnose — they're optional diagnostic tools, not part of the happy path.
- Do NOT delete `mirror/` artifacts — see "Cross-goal artifact sharing" below.

## Activation

Use this skill when the user asks to reproduce a webpage's look — e.g.

- "Clone the Baidu homepage"
- "复刻 https://example.com/"
- "Make a landing page that looks like 小红书"
- "Rebuild the visual shell of <url>"

Do NOT use it for content rewriting, SEO analysis, or behavioural scraping.

## Step 0 — Resolve the URL

If the user provided a URL that starts with `http://` or `https://`, skip to step 1.

If the user said "clone X" but gave only a name/brand (e.g. "clone Baidu", "复刻 bilibili"), resolve the canonical URL:

1. Call `websearch` with a tight query like `X official homepage` or `X 官网`.
2. Pick the top hit whose host looks canonical (`baidu.com`, not `baidu.fandom.com`).
3. Confirm with the user in one sentence unless the mapping is unambiguous.

Never invent a URL. If `websearch` returns nothing useful, stop and ask the user.

## Step 1 — Extract the reference

Call `webpage_extract` with the URL. Defaults (1440×900 viewport, `body` scope, `keep_images: true`) are right for most desktop pages. Artifacts land under `mirror/`:

- `mirror/reference.png` — the pixel target for scoring later
- `mirror/extracted-page.json` — DOM tree with computed CSS per element (the authoritative source `webpage_compile_html` consumes)
- `mirror/images/img-N.{png,jpg,svg}` — downloaded image assets

Network access required. The tool will ask for permission.

### P1-A hard rule: no text-only fallback

If `webpage_extract` cannot resolve the reference (SPA behind a login wall, pixel-free canvas, JS-only shell), **STOP and escalate to the user** — report the specific failure mode and ask for a different URL or a pre-extracted PNG. You MUST NOT:

- Continue by reading `mirror/scaffold.json` + writing an invented `index.html` from the visual-contract text alone.
- Fabricate screenshots, DOM snapshots, or `webpage_evaluate` scores.
- Call any submit / accept verdict on a deliverable whose build artifact cannot be rendered — the delivery runtime-evidence gate (P1-A) re-runs puppeteer and rejects empty-root-shell or thin-DOM output regardless of your verdict text.

"Static scaffold because dynamic capture failed" is a hard-no.

## Step 2 — Compile `index.html`

Call `webpage_compile_html` (no args needed — defaults read `mirror/extracted-page.json` and write `index.html` + `images/` at the worktree root). The tool:

1. Replays the extracted DOM tree as nested HTML with inline styles (no JS, no Tailwind, no external CSS).
2. Copies `mirror/images/` to `images/` at the worktree root and remaps every `<img src>` to the local path.
3. Returns the byte size + element count.

**This is the entire write step.** No `write index.html`, no `edit index.html` from scratch. The compiled HTML is the high-fidelity baseline; iteration in step 5 only makes targeted patches.

## Step 3 — Render

Call `webpage_render` (no args needed — defaults render `<worktree>/index.html` and write `mirror/rendered.png`). Returns render time + any console errors.

## Step 4 — Evaluate

Call `webpage_evaluate` with `reference=reference.png` and `rendered=rendered.png` (both resolved inside `mirror/`). Writes `mirror/diff.png` (red = pixels that differ) and returns an overall score in 0–100.

The score formula: `round(ssim × 50 + (100 − pixelDiff%) × 0.5)`. Target ≥ 95.

## Step 5 — Iterate on specific gaps

If the score is below target you MUST iterate. The compiled HTML preserves the authoritative DOM, so most gaps come from dynamic content (rotating placeholders, ads, personalisation), font fallbacks, or images the extractor could not download.

For each round:

1. **Diagnose**:
   - `webpage_text_diff` — list of reference strings absent from your render. Single most effective signal.
   - Inspect `mirror/diff.png` — the largest red regions point you at the next correction.
   - Optional: call `webpage_compile` to read `mirror/page-ir.xml` for section structure context, or `webpage_analyze` for `mirror/scaffold.json` token / pattern catalogue. Skip these if `text_diff` + `diff.png` is enough.
2. **Edit** `index.html` (prefer the `edit` tool for targeted patches; you may also re-run `webpage_compile_html` if you re-extracted or want to rebase your edits on the authoritative DOM — be aware it will overwrite the file):
   - Insert any strings reported by `webpage_text_diff`, placed in the right section per `page-ir.xml`'s `Section Text` catalogue. Keep wording verbatim.
   - Replace placeholder image src values when `mirror/images/` is missing the asset (use the original remote URL from `extracted-page.json` as a fallback).
   - Adjust styles only where `diff.png` flags a clear regression — colour drift fixes use the values copied from `mirror/design-tokens.ts`; never invent hex codes.
   - Preserve every element that's already rendering correctly. Deleting correct markup costs points you won't recover.
3. Re-run `webpage_render`.
4. Re-run `webpage_evaluate`.
5. If `score ≥ target`, you are done — proceed to "What success looks like" below.
6. If `score < target` and you've completed fewer than **8 rounds**, go back to #1.
7. If you've completed 8 rounds and the score still lags, STOP. Report the final score, the biggest remaining diff regions, and any obvious blockers (e.g. dynamic content that cannot be statically cloned).

Track your round count explicitly. Do not hand-wave ("I've done several rounds"); count them.

## Cross-goal artifact sharing — DO NOT delete `mirror/`

The mirror toolchain output MUST stay in the worktree. Subsequent goals + delivery agents read these artifacts to verify and refine your work; the build runtime ff-only merges your goal branch back into primary HEAD so the next worktree inherits them via git. Removing them mid-pipeline breaks cross-goal sharing (rule 22 — single source of truth lives in git, not regenerated per goal). The deliverable is `index.html` + `images/`; mirror artifacts are git-tracked scratch — leave them in place.

## What success looks like

A self-contained static `index.html` plus an `images/` folder at the worktree root, plus the `mirror/` toolchain output preserved for downstream goals, with:

- All canonical text from the reference present verbatim (compiled directly from the DOM tree)
- All images referenced by their local `images/` paths
- Inline styles on every element (no external CSS, no Tailwind, no JS runtime)
- Score ≥ 95 from `webpage_evaluate`

Report the final score and list the sections that are still below pixel parity (usually dynamic content — rotating placeholders, ads, personalisation).
