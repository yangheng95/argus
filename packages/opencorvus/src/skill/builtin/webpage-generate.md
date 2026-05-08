---
name: webpage-generate
description: 'Generate a high-fidelity clone of a reference webpage. The mirror toolchain (`webpage_extract` → `webpage_compile` → `webpage_analyze`) extracts structure, design tokens, copy, assets, and generated React source deterministically; you refine that generated source; then iterate against `webpage_render` + `webpage_vision_judge` until the vision verdict accepts. Call `webpage_render` with the exact HTTP route for the running app. Activate when the user asks to clone, copy, reproduce, replicate, mirror, 复刻, 克隆, 模仿, or "make a page that looks like" another webpage; or when the brief cites a reference design (specific URL, screenshot). Always pull palette / text / structure from the mirror artifacts and generated source — never invent hex codes, copy, or section structure.'
stage: build
auto_detect:
  task_signals:
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

You produce a **high-fidelity visual clone** of a reference webpage. The mirror toolchain extracts structure, tokens, and text deterministically; you implement the page; you iterate until the visual judge accepts the rendered pixels.

## Tech-stack policy — adaptive

This skill is tech-stack-neutral. Pick the shape that best fits the brief, the surrounding goals, and the project files already on disk:

- **Generated React source**: `webpage_analyze` writes the source paths declared by `mirror/scaffold.json` and returns them as `sourcePaths`. Refine those files in place.
- **Project shell** (Vite or the surrounding project framework): create or reuse the minimal shell required to run the generated React source over loopback HTTP.
- **CSS approach**: use the project convention, but values must come from generated design tokens and mirror artifacts.
- **Backend (Express / Hono / Fastify / etc.)**: include only if the page genuinely depends on dynamic data (search APIs, hot-search feeds, autocomplete) AND inlining canonical sample data into the page is not acceptable for the brief.

What is NOT optional regardless of stack:

- The deliverable MUST expose an explicit HTTP URL for `webpage_render` from the project dev script.
- Design tokens (colours, fonts, spacing, radii) come from the generated token file declared by `mirror/scaffold.json` — do not invent hex codes, font sizes, or spacing values.
- Visible text comes verbatim from `mirror/page-ir.xml` `<Text>` nodes / `Section Text` catalog — do not paraphrase.
- Images come from `mirror/images/`. If extraction did not produce a required image, stop and fix the extraction/materialization issue instead of substituting a different source.

## Rendering the result for evaluation

`webpage_render` is URL-only. Start the project dev server according to the project-owned instructions and pass the exact HTTP route URL. Do not ask `webpage_render` to infer directories, start servers, or choose a runtime.

The skill exposes no "magic compile" tool that emits the page — you implement it (rule 22, single source of truth for generation strategy is your code, not a hidden compiler).

## Reuse on re-entry

This skill is idempotent on `mirror/` and generated source paths. On re-entry:

- `mirror/extracted-page.json` — DOM tree + ~33 computed CSS properties per element
- `mirror/page-ir.xml` — compact XML IR (text catalogue, section structure)
- `mirror/scaffold.json` — section list + pattern catalog + design-token system
- `mirror/shared-context.md` — compact prompt-ready summary
- `mirror/images/img-N.{png,jpg,svg}` — downloaded image assets
- `mirror/reference.png` — the pixel target for SSIM scoring
- The generated deliverable source paths declared by `mirror/scaffold.json` plus the dev-server entry.
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

- Continue by reading `mirror/scaffold.json` + writing an invented page outside the generated React source.
- Fabricate screenshots, DOM snapshots, or `webpage_evaluate` scores.
- Call any submit / accept verdict on a deliverable whose build artefact cannot be rendered.

"Static scaffold because dynamic capture failed" is a hard-no.

## Step 2 — Compile the IR

Call `webpage_compile` (no args needed — defaults read `mirror/extracted-page.json` and write `mirror/page-ir.xml`). Pure transformation, no network.

## Step 3 — Analyze tokens + scaffold

Call `webpage_analyze` (no args needed). Writes:

- `mirror/scaffold.json` — `ProjectScaffold` (sections + patterns + token system)
- `mirror/shared-context.md` — concise prompt-ready summary
- Generated React source paths from `mirror/scaffold.json` / analyze `sourcePaths` — refine these in place

## Step 4 — Read the artefacts BEFORE writing

`read` (the actual file contents):

- `mirror/page-ir.xml` — exact text + element structure (your section catalogue)
- `mirror/shared-context.md` — design-token / pattern summary
- The generated token file declared by `mirror/scaffold.json` — palette / typography
- `mirror/reference.png` — the visual target

Quote the exact strings, use the exact token values from the generated token file, follow the section ordering from `page-ir.xml`. Do not paraphrase headings, nav labels, or button text.

## Step 5 — Implement the page

Refine the generated React source. The deliverable must:

- Match section structure verbatim from `page-ir.xml` — section ordering, nesting, and approximate bounds.
- Use exact text from the `Section Text` catalog — no paraphrasing.
- Wire colours / fonts / spacing through the generated token file. Don't invent values.
- Reference image assets via `mirror/images/<name>`.

Bounds: match approximately via flex/grid + sizing tokens — pixel-exact placement is not required, structural similarity is.

## Step 6 — Render

Call `webpage_render url=<explicit HTTP URL>` and write `mirror/rendered.png`. Returns render time + any console errors.

## Step 7 — Evaluate

### 7a. Visual judge (THE acceptance gate)

Call `webpage_vision_judge` (no args needed — defaults read `mirror/reference.png` + `mirror/rendered.png`). It does a single-shot vision-LLM call with no system prompt and no tool list — just the two images and a request to enumerate visible differences. Output goes to `mirror/vision-judge.json` and includes:

- `accepted: true|false` — the acceptance signal you trust
- `differences[]` — ranked list with `severity` (critical/major/minor), `region`, `observed`, `expected`, and a concrete `fix_hint` per item

Why this is the gate: SSIM numbers and pixel-diff heatmaps are proxies that let the agent skip looking at pixels (score plateau at ~94 with logo, search-box layout, and floating buttons visibly wrong). Vision-judge forces an actual visual comparison every round.

### 7b. SSIM score (diagnostic signal)

Call `webpage_evaluate reference=reference.png rendered=rendered.png` (both inside `mirror/`). Writes `mirror/eval-result.json`. Returns a 0–100 score (`round(ssim × 50 + (100 − pixelDiff%) × 0.5)`).

Track the score across iterations: rising = your edits are helping, falling = a refactor regressed something. The score alone cannot decide acceptance — vision-judge does that — but a sudden drop is a real signal worth investigating.

## Step 8 — Iterate on specific gaps

**Target:** `webpage_vision_judge.accepted = true`. `webpage_evaluate` is a diagnostic trend signal only.

**Stagnation guard (HARD STOP):** if **3 consecutive iterations** repeat the same blocking vision-judge differences, STOP iterating and report those differences. The remaining gap is either dynamic content, a missing asset, or a structural decision the next pass (delivery / orchestrator) needs to handle. Do not burn rounds 4–8 grinding on the same plateau — record the final verdict and hand off.

For each round (up to **8**, count explicitly):

1. **Diagnose** in this order:
   - Open `mirror/reference.png` and `mirror/rendered.png` with the `read` tool and look at them yourself first. The score by itself can plateau in the 90s while structural elements are still wrong.
   - `webpage_vision_judge` — the structured `differences[]` list IS your work queue. Each entry already has a `fix_hint`. Address `severity: "critical"` items first, then `major`, then `minor`.
   - `webpage_text_diff url=<explicit HTTP URL>` — list of reference strings absent from your render. Reliable signal for missing copy / hot-search rows / nav labels.
2. **Edit** generated `src/` source files with the `edit` tool (targeted patches; do NOT rewrite the whole file once it's at a workable state):
   - Apply the `fix_hint` for each diff vision-judge listed (severity-ordered).
   - Insert any strings reported by `webpage_text_diff`, in the right section per `page-ir.xml`'s `Section Text` catalogue. Keep wording verbatim.
   - Add or refine CSS rules for color drift / spacing / typography. Reference tokens via `var(--…)` only — do not invent hex values.
   - If a required `mirror/images/` asset is missing, stop and fix extraction/materialization before continuing.
   - Preserve every element + CSS rule that is already rendering correctly. Deleting correct markup costs points you won't recover.
3. Re-run `webpage_render url=<explicit URL>`.
4. Re-run `webpage_vision_judge` AND `webpage_evaluate`.
5. **Decide:**
   - If `webpage_vision_judge.accepted = true` → goal done, proceed to acceptance.
   - If 3 consecutive rounds repeat the same blocking vision-judge differences → STOP (stagnation guard above). Report the final diagnostic score, the biggest remaining critical/major diffs from vision-judge, and any obvious blockers (dynamic content, missing asset). Hand off to delivery.
   - If you've completed 8 rounds without acceptance → STOP. Same handoff as the stagnation case.
   - Otherwise go back to step 1.

## Cross-goal artifact sharing — DO NOT delete `mirror/`

The mirror toolchain output MUST stay in the worktree. Subsequent goals + delivery agents read these artifacts to verify and refine your work; the build runtime ff-only merges your goal branch back into primary HEAD so the next worktree inherits them via git (rule 22 — single source of truth lives in git, not regenerated per goal). The deliverable is the generated React source plus the project shell; mirror artefacts are git-tracked scratch — leave them in place.

## Hard acceptance gate — render screenshot is mandatory

You MUST NOT mark the goal `passed` or call `goal_report` / `StructuredOutput` until you have:

1. Run `webpage_render url=<explicit URL>` and produced `mirror/rendered.png` for the CURRENT deliverable (re-run after every edit pass — a stale rendered.png from before your last edit does NOT count).
2. Run `webpage_vision_judge` against the freshly-rendered `mirror/rendered.png` and confirmed the verdict file `mirror/vision-judge.json` reports `accepted: true`. This is the SINGLE primary acceptance signal — SSIM scores alone are NOT enough.
3. Read `mirror/rendered.png` (the actual image, not just its bytes count) and visually compared it against `mirror/reference.png`. Confirm in your structured output that you inspected both images.
4. Run `webpage_evaluate` against the freshly-rendered `mirror/rendered.png` and recorded the score in `mirror/eval-result.json` (secondary trend signal).

The render screenshot is the SINGLE source of truth for "does this look like the reference". DOM diffs, text-presence checks, file-existence asserts, and DOCTYPE greps are sanity checks — they are NEVER a substitute for looking at the rendered image. A goal that compiled, committed, and passes every textual check but renders to a blank page or a broken layout is a FAILED goal regardless of what the structural checks say. Catch that before delivery does.

If `webpage_render` fails (port collision, puppeteer crash, missing assets) — fix the root cause and re-run; do NOT ship without a successful render.

## What success looks like

A working clone — whatever shape your stack produced — that passes `webpage_render`, plus the `mirror/` toolchain output preserved for downstream goals, with:

- All canonical text from the reference present verbatim (read from `page-ir.xml`)
- All images referenced by their local `mirror/images/` paths
- Design tokens applied through whichever idiomatic mechanism the chosen stack uses (`:root` custom properties, Tailwind theme extension, design-token export, etc.) — never invented hex codes or font sizes
- `mirror/rendered.png` exists, was visually inspected against `mirror/reference.png`, and matches
- `webpage_vision_judge.accepted = true` against the freshly-rendered screenshot; `webpage_evaluate` is recorded only as a diagnostic trend

Report the final score and `vision_judge` verdict, cite the render screenshot path in your goal_report, and list the sections that are still below pixel parity (usually dynamic content — rotating placeholders, ads, personalisation).
