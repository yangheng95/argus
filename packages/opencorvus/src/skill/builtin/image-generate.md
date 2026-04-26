---
name: image-generate
description: Generate a high-fidelity clone of a reference webpage given a SCREENSHOT (no live URL). The image2code mirror toolchain (`webpage_image_extract` → `webpage_image_compile`) does vision-LLM structural inference on the screenshot to produce design tokens, element tree, and visible text; you implement the page in whatever tech stack the brief or surrounding goals call for; then iterate against `webpage_render` + `webpage_evaluate` + `webpage_vision_judge` until the score meets target. Activate when the user provides ONLY a reference image (no URL) and asks to clone, copy, reproduce, replicate, mirror, 复刻, 克隆, 模仿, or "make a page that looks like" the screenshot. Treat the inferred ImageAnalysis as estimates; the screenshot itself is the final visual ground truth.
stage: build
auto_detect:
  task_signals:
    has_attachment_image: true
    request_contains_url: false
    request_contains_figma_url: false
priority: 60
required_tools:
  - webpage_image_extract
  - webpage_image_compile
  - webpage_image_analyze
  - webpage_render
  - webpage_evaluate
  - webpage_vision_judge
---

# Image Generate Skill

You produce a **high-fidelity visual clone** of a reference screenshot (no live URL available). The image2code mirror toolchain runs a vision-LLM over the screenshot to infer structure / tokens / text deterministically; you implement the page; you iterate against the visual judge until acceptance.

Sister skill to `webpage-generate` — same loop shape, same downstream evaluation tools, different upstream extraction (vision-LLM instead of puppeteer DOM).

## Tech-stack policy — adaptive

This skill is tech-stack-neutral. Pick what best fits the brief and the surrounding repo:

- **Static single-file** (`index.html` + inline `<style>`): default — fastest convergence for landing-page-shaped clones.
- **Framework + bundler** (React+Vite, Vue, Solid, Svelte, etc.): when an upstream goal mandates one.
- **CSS approach**: vanilla CSS, Tailwind, CSS modules — whatever is idiomatic for the chosen stack.
- **Backend**: include only if dynamic data is genuinely required.

Non-negotiable regardless of stack:

- The deliverable MUST be loadable by `webpage_render` (static `index.html` at the worktree root, or a live server you start yourself).
- Design tokens (palette / fonts / sizes) come from `mirror/image-analysis.json` — do not invent hex codes or font sizes the analysis did not report.
- Visible text comes from the analysis tree's `<Text content="…">` leaves — copy verbatim.
- The screenshot itself (`mirror/reference.png`) is the final visual ground truth. When the inferred analysis disagrees with what you see in the pixels, trust the pixels.

## Critical rules

- Steps 1–3 are **strictly serial**. Each consumes the previous step's output (`image-analysis.json` → `page-ir.xml` → `scaffold.json` + `design-tokens.ts` + `shared-context.md`); never batch them in the same response.
- Do NOT delete `mirror/` artifacts — downstream goals + delivery agents read them.
- Do NOT mark the goal `passed` without the visual-acceptance gate (see "Hard acceptance gate").
- Do NOT invent text or palette values not present in the analysis output. If the analysis missed something visible in the screenshot, edit `mirror/image-analysis.json` to record it (the analysis is an estimate; the screenshot is the ground truth) and re-run compile.

## Activation

Use this skill when the user provides a reference image and asks to reproduce its look — e.g. "Clone this design", "复刻这张图", "Make a page that looks like the attached screenshot".

Do NOT use it when the user provided a live URL — that path goes through `webpage-generate`.

## Step 1 — Vision-extract the reference

Call `webpage_image_extract` with `images=["references/<filename>"]` — the host already staged every user-attached image into your worktree's `references/` subdirectory before you started, so use those worktree-relative paths verbatim. The "Staged Reference Files" section in your user message lists the exact paths to pass; do NOT `cp` or `glob` the files yourself. Multiple images supported when several mockups were attached — they merge into one analysis.

Artifacts land under `mirror/`:

- `mirror/reference.png` — the canonical pixel target for `webpage_render` / `webpage_evaluate`
- `mirror/image-analysis.json` — full ImageAnalysis (tokens + element tree + viewport)

LLM-driven (no network). Token usage scales with screenshot complexity.

### Hard rule: no fabricated extraction

If the model returns an empty tree, refuses the image, or the schema validation fails, **STOP and escalate to the user** — report the specific failure mode and ask for a different screenshot or a clearer reference. You MUST NOT:

- Hand-write an `index.html` from the brief text alone, ignoring the failure.
- Fabricate an `image-analysis.json` payload to unblock the compile step.
- Call any submit / accept verdict on a deliverable whose extraction never produced a valid analysis.

"Static scaffold because vision extraction failed" is a hard-no.

## Step 2 — Compile the IR

Call `webpage_image_compile` (no args needed — defaults read `mirror/image-analysis.json` and write `mirror/page-ir.xml`). Pure transformation, no LLM.

## Step 3 — Analyze tokens + scaffold

Call `webpage_image_analyze` (no args needed — defaults read `mirror/image-analysis.json` and write `mirror/scaffold.json` + `mirror/design-tokens.ts` + `mirror/App.tsx` + `mirror/shared-context.md`). Same artifact filenames the URL flow's `webpage_analyze` produces — downstream codegen reads the same files regardless of source. Pure transformation, no LLM.

## Step 4 — Read the artefacts BEFORE writing

`read` (the actual file contents):

- `mirror/page-ir.xml` — element structure + visible text (your section catalogue)
- `mirror/shared-context.md` — token + section summary
- `mirror/design-tokens.ts` — palette / fonts / spacing / radii constants
- `mirror/scaffold.json` — full ProjectScaffold (sections, FileContracts) for fine-grained reference
- `mirror/reference.png` — the visual target

Quote the exact strings, copy the exact hex codes from `mirror/design-tokens.ts`, follow section ordering from `page-ir.xml`. Do not paraphrase headings, nav labels, or button text — and do not invent palette values not in the tokens file.

## Step 5 — Implement the page

Whatever shape you pick, the deliverable must:

- Match section structure from `page-ir.xml` — section ordering, nesting, approximate bounds.
- Use exact text from `<Text>` leaves — no paraphrasing.
- Wire colours / fonts / sizes through whatever convention the chosen stack uses (CSS custom properties under `:root`, Tailwind theme extension, design-token export).
- Reference any image leaves by `name` / `alt`; this skill does not download asset URLs (image2code has no source URL to scrape from), so substitute inline SVG, CSS gradients, or solid-colour placeholders for visual elements the screenshot shows but no asset file exists for.

## Step 6 — Render

Call `webpage_render` (defaults render `<worktree>/index.html` and write `mirror/rendered.png`). Returns render time + any console errors.

## Step 7 — Evaluate

### 7a. Visual judge (THE acceptance gate)

Call `webpage_vision_judge`. Single-shot vision-LLM comparison of `mirror/reference.png` vs `mirror/rendered.png`. Output `mirror/vision-judge.json`:

- `accepted: true|false` — the acceptance signal
- `differences[]` — ranked list with `severity` + `region` + `observed` + `expected` + concrete `fix_hint`

### 7b. SSIM score (progress + regression signal)

Call `webpage_evaluate reference=reference.png rendered=rendered.png` (both inside `mirror/`). Returns 0–100 score.

## Step 8 — Iterate

**Target:** `webpage_evaluate` overall score **≥ 95** AND `webpage_vision_judge.accepted = true`.

**Stagnation guard (HARD STOP):** if **3 consecutive iterations** fail to raise the score above the previous best, STOP and proceed to acceptance with the best snapshot. Vision extraction is inherently lossy — some gaps are unrecoverable without the original DOM.

For each round (up to **8**, count explicitly):

1. **Diagnose** in this order:
   - Open both PNGs with `read` and look at them yourself.
   - `webpage_vision_judge` — `differences[]` is your work queue, severity-ordered.
2. **Edit** the deliverable (targeted patches; don't rewrite the whole file once it's workable):
   - Apply each `fix_hint` from vision-judge.
   - Reference tokens via the stack's idiomatic mechanism — never invent hex values.
   - Preserve every element + rule that already renders correctly.
3. Re-run `webpage_render`.
4. Re-run `webpage_vision_judge` AND `webpage_evaluate`.
5. **Decide:** accepted → done; 3-stagnation → handoff; 8 rounds → handoff; else loop.

## Cross-goal artifact sharing — DO NOT delete `mirror/`

Subsequent goals + delivery agents read `mirror/image-analysis.json`, `mirror/page-ir.xml`, and `mirror/reference.png`. Leave them in place. The deliverable is `index.html` (or your framework's equivalent); mirror artefacts are git-tracked scratch.

## Hard acceptance gate — render screenshot is mandatory

You MUST NOT mark the goal `passed` until you have:

1. Run `webpage_render` and produced `mirror/rendered.png` for the CURRENT deliverable (re-run after every edit pass — a stale render does NOT count).
2. Run `webpage_vision_judge` and confirmed `mirror/vision-judge.json` reports `accepted: true`.
3. Read `mirror/rendered.png` and visually compared it against `mirror/reference.png`.
4. Run `webpage_evaluate` and recorded the score.

The render screenshot is THE source of truth for "does this look like the reference". Structural / text-presence checks are sanity gates, never substitutes for inspecting the rendered image.

## What success looks like

- `webpage_image_extract` produced a non-empty tree
- `webpage_image_compile` produced `mirror/page-ir.xml`
- All canonical text from the analysis present verbatim in the deliverable
- `mirror/rendered.png` exists, was visually inspected, and matches the reference
- `webpage_vision_judge.accepted = true` AND `webpage_evaluate` score ≥ 95

Report the final score and `vision_judge` verdict in your goal_report. List any remaining structural gaps the vision extraction could not recover.
