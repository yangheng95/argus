---
name: webpage-generate
description: Generate a high-fidelity clone of a reference webpage with visual similarity ≥ 95. The mirror toolchain (`webpage_extract` → `webpage_compile` → `webpage_analyze`) extracts structure, design tokens, copy, and assets deterministically; you implement the page in whatever tech stack the brief or surrounding goals call for (static HTML+CSS, React+Tailwind, Vue, plain Hono SSR — the skill is tech-stack-neutral); then iterate against `webpage_render` + `webpage_evaluate` + `webpage_vision_judge` until the score meets target. Pass `url=http://127.0.0.1:<port>/<route>` to `webpage_render` when your project needs a live server. Activate when the user asks to clone, copy, reproduce, replicate, mirror, 复刻, 克隆, 模仿, or "make a page that looks like" another webpage; or when the brief cites a reference design (specific URL, screenshot). Always pull palette / text / structure from the mirror artifacts — never invent hex codes, copy, or section structure.
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

You produce a **high-fidelity visual clone** of a reference webpage. The mirror toolchain extracts structure, tokens, and text deterministically; you implement the page; you iterate against the visual judge until the score meets target.

## Tech-stack policy — adaptive

This skill is tech-stack-neutral. Pick the shape that best fits the brief, the surrounding goals, and the project files already on disk:

- **Static single-file** (`index.html` + inline `<style>`, no build step): simplest path, works for most landing-page-shaped clones. Choose this when nothing in the brief or repo demands otherwise — fewer moving parts means faster convergence.
- **Framework + bundler** (React+Vite, Vue, Solid, Svelte, plain HTML+vite, etc.): choose when the brief or an upstream goal already mandates a framework, or when component reuse is a genuine asset for this clone.
- **CSS approach**: vanilla CSS, Tailwind, CSS modules, styled-components — whatever the chosen stack is idiomatic with. The fidelity gate doesn't care; the rendered pixels do.
- **Backend (Express / Hono / Fastify / etc.)**: include only if the page genuinely depends on dynamic data (search APIs, hot-search feeds, autocomplete) AND inlining canonical sample data into the page is not acceptable for the brief.

What is NOT optional regardless of stack:

- The deliverable MUST be loadable by `webpage_render` — either as a static file (`index.html` at the worktree root or `inputDir`) or via a live server you start yourself.
- Design tokens (colours, fonts, spacing, radii) come from `mirror/design-tokens.ts` — do not invent hex codes, font sizes, or spacing values. Apply them through whatever convention your stack uses (CSS custom properties under `:root`, Tailwind theme extension, design-tokens-as-TS-export, etc.).
- Visible text comes verbatim from `mirror/page-ir.xml` `<Text>` nodes / `Section Text` catalog — do not paraphrase.
- Images from `mirror/images/` (or fallback to the original URLs from `mirror/extracted-page.json` when the extractor could not download).

## Rendering the result for evaluation

Two `webpage_render` modes — pick whichever fits your project shape:

1. **Static mode** (default): your project produces a self-contained `index.html` at the worktree root. `webpage_render` serves the directory over a built-in loopback server and screenshots `index.html`.
2. **Live-server mode**: your project needs a backend or a dev server (Vite, Webpack, Next, etc.). Start it yourself on a known port (e.g. `PORT=4123 bun run dev &`) and call `webpage_render` with `url=http://127.0.0.1:4123/<route>`. Puppeteer navigates directly to the live URL. Kill the server after the goal closes.

`webpage_render` hard-fails in static mode when the rendered page logs 404 / fetch / network errors — that signals your page expected a live backend. Switch to live-server mode or inline the data; do not iterate on a degraded screenshot.

The skill exposes no "magic compile" tool that emits the page — you implement it (rule 22, single source of truth for generation strategy is your code, not a hidden compiler).

## Reuse on re-entry

This skill is idempotent on `mirror/` and `index.html`. On re-entry:

- `mirror/extracted-page.json` — DOM tree + ~33 computed CSS properties per element
- `mirror/page-ir.xml` — compact XML IR (text catalogue, section structure)
- `mirror/scaffold.json` — section list + pattern catalog + design-token system
- `mirror/design-tokens.ts` — `COLORS` / `FONTS` / `SPACING` / `RADII` constants
- `mirror/shared-context.md` — compact prompt-ready summary
- `mirror/images/img-N.{png,jpg,svg}` — downloaded image assets
- `mirror/reference.png` — the pixel target for SSIM scoring
- The deliverable itself (e.g. `index.html` for a static clone, `src/` + a dev-server entry for a framework-shaped clone)
- `images/` — assets the deliverable references (promoted from `mirror/images/`) when your stack serves them from a public directory

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

## Step 5 — Implement the page

Adapt to the chosen tech stack. Whatever shape you pick, the deliverable must:

- Match section structure verbatim from `page-ir.xml` — section ordering, nesting, and approximate bounds.
- Use exact text from the `Section Text` catalog — no paraphrasing.
- Wire colours / fonts / spacing through `mirror/design-tokens.ts` via your stack's idiomatic mechanism (CSS custom properties under `:root`, Tailwind theme extension, design-token export, etc.). Don't invent values.
- Reference image assets via `mirror/images/<name>` (or original URLs from `mirror/extracted-page.json` as fallback).

If you're picking the static path, a minimal skeleton looks like this — every other approach (React component tree, Vue SFC, etc.) has its own equivalent:

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=1440, initial-scale=1" />
  <title><!-- exact title from page-ir.xml --></title>
  <style>
    :root {
      /* one custom property per token from mirror/design-tokens.ts */
    }
    *, *::before, *::after { box-sizing: border-box }
    body { margin: 0; font-family: var(--font-sans); color: var(--color-text); background: var(--color-bg); }
    /* real cascading rules referencing var(--…) */
  </style>
</head>
<body>
  <header><!-- exact text from Section Text catalog in page-ir.xml --></header>
  <main>…</main>
  <footer>…</footer>
</body>
</html>
```

Bounds: match approximately via flex/grid + sizing tokens — pixel-exact placement is not required, structural similarity is.

## Step 6 — Render

Call `webpage_render` (no args needed — defaults render `<worktree>/index.html` and write `mirror/rendered.png`). Returns render time + any console errors.

## Step 7 — Evaluate

### 7a. Visual judge (THE acceptance gate)

Call `webpage_vision_judge` (no args needed — defaults read `mirror/reference.png` + `mirror/rendered.png`). It does a single-shot vision-LLM call with no system prompt and no tool list — just the two images and a request to enumerate visible differences. Output goes to `mirror/vision-judge.json` and includes:

- `accepted: true|false` — the acceptance signal you trust
- `differences[]` — ranked list with `severity` (critical/major/minor), `region`, `observed`, `expected`, and a concrete `fix_hint` per item

Why this is the gate: SSIM numbers and pixel-diff heatmaps are proxies that let the agent skip looking at pixels (score plateau at ~94 with logo, search-box layout, and floating buttons visibly wrong). Vision-judge forces an actual visual comparison every round.

### 7b. SSIM score (progress + regression signal)

Call `webpage_evaluate reference=reference.png rendered=rendered.png` (both inside `mirror/`). Writes `mirror/eval-result.json`. Returns a 0–100 score (`round(ssim × 50 + (100 − pixelDiff%) × 0.5)`).

Track the score across iterations: rising = your edits are helping, falling = a refactor regressed something. The score alone cannot decide acceptance — vision-judge does that — but a sudden drop is a real signal worth investigating.

## Step 8 — Iterate on specific gaps

**Target:** `webpage_evaluate` overall score **≥ 95** AND `webpage_vision_judge.accepted = true`. Either condition alone is not enough — a 96 score with structurally wrong layout is not done; a vision-judge accept with score 80 means a regression slipped in.

**Stagnation guard (HARD STOP):** if **3 consecutive iterations** fail to raise the score above the previous best (`new_score ≤ best_score_so_far`), STOP iterating and proceed to acceptance with the best snapshot. The remaining gap is either dynamic content that can't be statically cloned, or a structural decision the next pass (delivery / orchestrator) needs to handle. Do not burn rounds 4–8 grinding on the same plateau — record the final verdict and hand off.

For each round (up to **8**, count explicitly):

1. **Diagnose** in this order:
   - Open `mirror/reference.png` and `mirror/rendered.png` with the `read` tool and look at them yourself first. The score by itself can plateau in the 90s while structural elements are still wrong.
   - `webpage_vision_judge` — the structured `differences[]` list IS your work queue. Each entry already has a `fix_hint`. Address `severity: "critical"` items first, then `major`, then `minor`.
   - `webpage_text_diff` — list of reference strings absent from your render. Reliable signal for missing copy / hot-search rows / nav labels.
2. **Edit** `index.html` with the `edit` tool (targeted patches; do NOT rewrite the whole file once it's at a workable state):
   - Apply the `fix_hint` for each diff vision-judge listed (severity-ordered).
   - Insert any strings reported by `webpage_text_diff`, in the right section per `page-ir.xml`'s `Section Text` catalogue. Keep wording verbatim.
   - Add or refine CSS rules for color drift / spacing / typography. Reference tokens via `var(--…)` only — do not invent hex values.
   - Replace placeholder image src values when `mirror/images/` is missing the asset (use the original remote URL from `extracted-page.json` as a fallback).
   - Preserve every element + CSS rule that is already rendering correctly. Deleting correct markup costs points you won't recover.
3. Re-run `webpage_render`.
4. Re-run `webpage_vision_judge` AND `webpage_evaluate`.
5. **Decide:**
   - If `score ≥ 95` AND `webpage_vision_judge.accepted = true` → goal done, proceed to acceptance.
   - If 3 consecutive rounds with no new high score → STOP (stagnation guard above). Report the final score, the biggest remaining critical/major diffs from vision-judge, and any obvious blockers (dynamic content, missing asset). Hand off to delivery.
   - If you've completed 8 rounds without acceptance → STOP. Same handoff as the stagnation case.
   - Otherwise go back to step 1.

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

A working clone — whatever shape your stack produced — that passes `webpage_render`, plus the `mirror/` toolchain output preserved for downstream goals, with:

- All canonical text from the reference present verbatim (read from `page-ir.xml`)
- All images referenced by their local `mirror/images/` paths (or original URLs as fallback)
- Design tokens applied through whichever idiomatic mechanism the chosen stack uses (`:root` custom properties, Tailwind theme extension, design-token export, etc.) — never invented hex codes or font sizes
- `mirror/rendered.png` exists, was visually inspected against `mirror/reference.png`, and matches
- `webpage_vision_judge.accepted = true` AND `webpage_evaluate` score ≥ 95 (against the freshly-rendered screenshot)

Report the final score and `vision_judge` verdict, cite the render screenshot path in your goal_report, and list the sections that are still below pixel parity (usually dynamic content — rotating placeholders, ads, personalisation).
