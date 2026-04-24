---
name: webpage-clone
description: Clone a live webpage as a static single-file HTML skeleton with visual similarity ≥ 95%. Uses headless-browser extraction, deterministic structure/token analysis, and an SSIM+pixel-match feedback loop. Activate when the user asks to clone, copy, reproduce, replicate, mirror, 复刻, 克隆, 模仿, or "make a page that looks like" another webpage; or when the brief cites a reference design (Apple HIG, macOS/iOS app, a specific site URL, a Figma/screenshot) and expects a visual match.
stage: build
auto_detect:
  # OR-semantics across these blocks: any match activates the skill. For
  # benchmark / greenfield clones the worktree starts empty, so files/deps
  # miss; the task_signals block covers that case — a reference screenshot
  # attachment OR an http(s) URL in the request text is an unambiguous
  # "clone this page" intent.
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

# Webpage Clone Skill

You are producing a **static HTML skeleton** that visually mirrors a reference webpage. You have five deterministic tools — use them in order. Never open a browser yourself via `bash`; use the provided tools.

## Critical Dependency Rule

The general "parallelize independent tool calls" guidance does **not** apply to this workflow.

- Steps 1-3 are **strictly serial** because each one writes artifacts consumed by the next step.
- Never call `webpage_compile` or `webpage_analyze` in the same response as `webpage_extract`.
- Wait for `webpage_extract` to finish and confirm `extracted-page.json` exists before calling either downstream tool.
- Never start render/evaluate until after you have actually written `index.html`.

## Activation

Use this skill when the user asks to reproduce a webpage's look — e.g.

- "Clone the Baidu homepage"
- "复刻 https://example.com/"
- "Make a landing page that looks like 小红书"
- "Rebuild the visual shell of <url>"

Do NOT use it for content rewriting, SEO analysis, or behavioural scraping.

## Step 0 — Resolve the URL

If the user provided a URL that starts with `http://` or `https://`, skip to step 1.

If the user said "clone X" or "复刻 X" but gave only a name/brand/product (e.g. "clone Baidu", "复刻 bilibili"), resolve the canonical URL:

1. Call the `websearch` tool with a tight query like `X official homepage` or `X 官网`.
2. Pick the top hit whose host looks canonical (e.g. `baidu.com`, not `baidu.fandom.com`).
3. Confirm with the user in one sentence: "I'll clone `<url>` — is that right?" unless the mapping is unambiguous.

Never invent a URL. If `websearch` returns nothing useful, stop and ask the user for the URL.

## Artifact layout

All mirror-tool artifacts live under **`mirror/`** — a single top-level folder at the worktree root, separate from the clone's deliverable (`index.html` + its final `images/` if you promote them). It is git-visible so the delivery commit captures the artifacts (do NOT place them under `.opencorvus/` — that tree is orchestrator scratch and is gitignored, so `git add -A` would drop them).

Refer to artifacts as `mirror/<file>` unless a tool specifically accepts a different `inputDir` / `referenceDir` override. Do not scatter these into the worktree root.

## Step 1 — Extract the reference

Call `webpage_extract` with the URL. Defaults (1440×900 viewport, `body` scope) are right for most desktop pages. Artifacts land under `mirror/`:

- `mirror/reference.png` — the pixel target for scoring later
- `mirror/extracted-page.json` — DOM tree with ~33 computed CSS properties per element
- `mirror/images/img-N.{png,jpg,svg}` — downloaded image assets
- (the tool prints a summary to context — the full JSON stays on disk)

Network access to the URL is required. The tool will ask for permission.

### P1-A hard rule: no text-only fallback

If `webpage_extract` cannot resolve the reference (SPA behind a login wall,
pixel-free canvas, JS-only shell), **STOP and escalate to the user** —
report the specific failure mode and ask for a different URL or a
pre-extracted PNG. You MUST NOT:

- Continue by reading `mirror/scaffold.json` + `mirror/App.tsx` and writing
  an invented `index.html` from the visual-contract text alone.
- Fabricate screenshots, DOM snapshots, or `webpage_evaluate` scores.
- Call `submit_verdict(accepted)` on a deliverable whose build artifact
  cannot be rendered — the delivery runtime-evidence gate (P1-A) re-runs
  puppeteer against `dist/`/`build/` independently and will reject any
  empty-root-shell (`<div id="root"></div>` only) or thin-DOM output with
  `category="runtime"` regardless of your verdict text.

This is the ainvest-style failure the gate exists to stop. "Static scaffold
because dynamic capture failed" is a hard-no.

## Step 2 — Compile the XML IR

Call `webpage_compile` **only after step 1 completed successfully**. It reads `mirror/extracted-page.json` and emits `mirror/page-ir.xml` — a compact (<20KB) XML representation of the DOM with layout/style attributes inlined and repeated siblings collapsed. You will `read` this file in step 4.

## Step 3 — Analyze the structure

Call `webpage_analyze` **only after step 1 completed successfully**. It reads `mirror/extracted-page.json` and writes under the same folder:

- `mirror/scaffold.json` — section list + pattern catalog + design-token system
- `mirror/design-tokens.ts` — `COLORS` / `FONTS` / `SPACING` / `RADII` constants (copy values; do NOT invent hex codes)
- `mirror/App.tsx` — reference composition (you can inspect but don't copy it directly)
- `mirror/shared-context.md` — compact prompt-ready summary of tokens + patterns

## Step 4 — Write the static HTML

Write **one file**: `index.html` at the root of the worktree.

Hard rules:

1. **Static HTML only**. No JavaScript frameworks (React, Vue, etc.), no Babel, no JSX. Every visible text node MUST be present as raw HTML text — a viewer with JS disabled should still see the page's content.
2. **CSS**: inline `<style>` + Tailwind via CDN (`<script src="https://cdn.tailwindcss.com"></script>`). No other runtime dependencies.
3. **Text**: copy phrases verbatim from `mirror/page-ir.xml` `<Text>` tags and the `Section Text` catalog. Do not paraphrase headings, nav labels, or button text.
4. **Images**: before writing `<img>` tags, copy / move `mirror/images/` out to `./images/` at the worktree root so the final clone is portable and doesn't reference a hidden folder. Use relative paths `images/img-N.ext` from `index.html`. Fall back to original URLs only if local paths are absent.
5. **Colors**: copy the hex values from `mirror/design-tokens.ts` `COLORS` directly into your inline CSS / Tailwind arbitrary-value classes. Do NOT `import` or `<script src>` that file — the final HTML must be self-contained so step 8 can delete `mirror/`. Never invent tones.
6. **Structure**: match the section order and rough bounds reported in `mirror/scaffold.json`.

Before writing, `read` `mirror/page-ir.xml` and `mirror/shared-context.md` at minimum.

## Step 5 — Render

Call `webpage_render` (no args needed — `inputDir` defaults to the current worktree where `index.html` lives, `outputDir` defaults to `mirror/`). It writes `mirror/rendered.png` and reports render time + any console errors.

## Step 6 — Evaluate

Call `webpage_evaluate` with `reference=reference.png` and `rendered=rendered.png` (both resolved inside `mirror/` — evaluate's `outputDir` defaults there). It writes `mirror/diff.png` (red = pixels that differ) and returns an overall score in 0-100.

The score formula: `round(ssim × 50 + (100 − pixelDiff%) × 0.5)`. Target ≥ 95.

## Step 7 — Iterate until score reaches target

If `webpage_evaluate` returns a score below the target (default 95), you MUST iterate. Do **not** move to step 8 prematurely — "close enough" is not acceptable.

For each round:
1. **Diagnose**: call `webpage_text_diff`. It returns a concrete list of strings that exist in the reference but not in your current `index.html`. This is the single most effective signal for closing the SSIM gap — text mismatches cost more per-pixel than colour drift.
2. **Edit** `index.html` (use the `edit` tool — do NOT rewrite the whole file with `write`):
   - Add every missing string from `webpage_text_diff` output, placed in the correct section per `page-ir.xml`'s `Section Text` catalogue. Keep wording verbatim.
   - Attack the largest red regions in `diff.png` next.
   - Use only the hex values copied from `design-tokens.ts`.
   - Preserve every element that's already rendering correctly — deleting correct markup costs points you won't recover.
3. Re-run `webpage_render`.
4. Re-run `webpage_evaluate`.
5. If `score ≥ target`, proceed to step 8.
6. If `score < target` and you've completed fewer than **8 rounds**, go back to #1.
7. If you've completed 8 rounds and the score still lags, STOP. Do NOT run step 8 cleanup. Report the final score, the biggest remaining diff regions, and any obvious blockers (e.g. dynamic content that cannot be statically cloned).

Track your round count explicitly in your reasoning. Do not hand-wave ("I've done several rounds"); count them.

## Step 8 — Clean up intermediate artifacts

**Gate**: only run this step when the most recent `webpage_evaluate` score was ≥ target. If the loop in step 7 bailed out without reaching target, SKIP step 8 entirely — the forensic artifacts stay under `mirror/` so the user can inspect what failed.

**Keep**:
- `index.html` — the final clone
- `images/` — the image assets the HTML references (promoted out of `mirror/images/` in step 4)

**Delete** the entire mirror folder in one shot:

```bash
rm -rf ./mirror
rm -f best-index.html
```

Verify afterwards with `ls` — the working directory must contain **only** `index.html` and `images/`. If `index.html` still imports `design-tokens.ts` at this stage, that is a bug — the colour values should have been inlined in step 4.

## What success looks like

A single-file static `index.html` plus an `images/` folder, nothing else, that visually reproduces the reference at the target viewport with:

- All canonical text from the reference present verbatim
- All images referenced by their local `images/` paths
- Colour values inlined (no external `design-tokens.ts` dependency)
- No JS runtime dependency
- Score ≥ 95 from `webpage_evaluate` before cleanup

Report the final score and list the sections that are still below pixel parity (they are usually dynamic content — e.g. rotating placeholders, ads, personalisation).
