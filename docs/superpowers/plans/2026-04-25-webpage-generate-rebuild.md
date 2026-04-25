# Webpage-Generate Skill 系统性重构

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (本任务用 inline 执行 — 改动跨 skill/tool/registry/test/benchmark 多文件，subagent 切换会丢上下文)。Steps 用 checkbox (`- [ ]`) 跟踪。

**Goal:** 让 `webpage_generate` skill 在 overlay benchmark 实测下稳定产生高保真静态 HTML（视觉相似度与 mirror-baidu-clone benchmark 等价），同时彻底消除双源（规则 22）和框架/CDN 锁定（规则 15、26）。

**Architecture:**
- 删除确定性编译路径 `compileExtractedPageToHtml` + `webpage_compile_html` 工具 — 它的 32 属性内联白名单不足以模拟 CSSOM，导致产物坍缩。
- 把 mirror-baidu-clone benchmark 的 `buildPrompt` / `buildFeedback` 抽出到 `mirror/url/prompt.ts` 单源模块，skill markdown 与 benchmark 脚本共用同一份。
- 产物形态：单文件 `index.html`，纯 vanilla CSS（`<style>` 块 + `:root { --token }` 注入 design tokens），零 runtime 依赖，离线可用，不绑 Tailwind CDN。
- 验收门：(a) `webpage_evaluate` SSIM ≥ 0.85；(b) Claude 本人读 rendered.png + reference.png 做二次视觉 review（规则 7）。

**Tech Stack:** opencorvus（bun + TS）、puppeteer-core、mirror toolchain、overlay-web-benchmark、OpenAI/Alibaba LLM via gateway。

---

## 改动文件清单

**删除：**
- `packages/opencorvus/src/mirror/url/compile-html.ts`
- `packages/opencorvus/src/mirror/tools/webpage-compile-html.ts`

**修改：**
- `packages/opencorvus/src/mirror/tools/index.ts` — 移除 `WebpageCompileHtmlTool` 导出
- `packages/opencorvus/src/tool/registry.ts:41,150` — 移除 `WebpageCompileHtmlTool` 引用
- `packages/opencorvus/src/agent/agent.ts:107,305` — 移除权限项 + 注释
- `packages/opencorvus/src/skill/builtin/webpage-generate.md` — 全文重写，要求 LLM 手写 vanilla CSS
- `packages/opencorvus/src/prompt/core/orchestrator-core.txt` — 移除 `webpage_compile_html` 引用
- `packages/opencorvus/script/benchmark/mirror-baidu-clone.ts` — 改为引用新单源 prompt 模块；去 Tailwind 硬约束
- `packages/opencorvus/script/benchmark/overlay-web-benchmark.ts` — 默认 brief 去 Tailwind 硬约束
- `packages/opencorvus/test/mirror/webpage-generate.test.ts` — 更新断言（不再要求 `webpage_compile_html`）
- `packages/opencorvus/test/engine/skill-inject.test.ts` — 同上

**新建：**
- `packages/opencorvus/src/mirror/url/prompt.ts` — `buildClonePrompt` / `buildCloneFeedback` 单源 prompt builder（vanilla CSS）

---

## Task 1: 抽出单源 prompt builder（vanilla CSS）

**Files:**
- Create: `packages/opencorvus/src/mirror/url/prompt.ts`
- Test: `packages/opencorvus/test/mirror/prompt.test.ts`

- [ ] **Step 1.1: 写失败测试**

```typescript
// packages/opencorvus/test/mirror/prompt.test.ts
import { describe, expect, test } from "bun:test"
import { buildClonePrompt, buildCloneFeedback } from "@/mirror/url/prompt"
import type { ProjectScaffold } from "@/mirror/ir/scaffold"

const scaffoldStub: ProjectScaffold = {
  sections: [{ name: "Header", elementCount: 5, bounds: { x: 0, y: 0, w: 1440, h: 64 } }],
  sharedComponents: [],
  catalog: { patterns: [], totalElements: 0, coveredElements: 0 },
  tokens: { colors: [], fonts: [] },
} as unknown as ProjectScaffold

test("buildClonePrompt enforces vanilla CSS, single-file, static, no Tailwind", () => {
  const p = buildClonePrompt({
    iter: 1,
    referenceUrl: "https://example.com/",
    targetScore: 95,
    viewport: { width: 1440, height: 900 },
    outputDir: "/tmp/x",
    sharedContext: "ctx",
    xmlIRBytes: 1234,
    scaffold: scaffoldStub,
  })
  expect(p).toContain("vanilla CSS")
  expect(p).toContain(":root")
  expect(p).not.toContain("Tailwind")
  expect(p).not.toContain("cdn.tailwindcss.com")
  expect(p).toContain("Single-file")
})

test("buildCloneFeedback surfaces missing tokens + diff path", () => {
  const fb = buildCloneFeedback({
    iter: 2,
    evalReport: {
      overallScore: 70,
      ssimScore: 0.7,
      pixelDiffPercent: 30,
      mismatchedPixels: 1,
      totalPixels: 100,
      diffImageDataUrl: "",
      dimensionsMatch: true,
    },
    diffPath: "/tmp/diff.png",
    referencePath: "/tmp/reference.png",
    targetScore: 95,
    bestScore: 75,
    missingTokens: ["新闻", "百度一下"],
  })
  expect(fb).toContain("70/100")
  expect(fb).toContain("新闻")
  expect(fb).toContain("百度一下")
  expect(fb).toContain("Regression guard")
})
```

- [ ] **Step 1.2: 跑测试看失败**

Run: `cd packages/opencorvus && bun test test/mirror/prompt.test.ts`
Expected: FAIL — "Cannot find module @/mirror/url/prompt"

- [ ] **Step 1.3: 实现 prompt builder（去 Tailwind，强制 vanilla CSS）**

把 `mirror-baidu-clone.ts` 现有 `buildPrompt`/`buildFeedback` 提取过来，做以下替换：

- 删除 `Tailwind CDN` / `https://cdn.tailwindcss.com` 句子。
- "Only CSS dependency allowed" 段落改成：
  > **Single-file static HTML with vanilla CSS only**: write exactly one `index.html`. All styles MUST live inside one `<style>` block at the top of `<head>`. Use real CSS class selectors and cascading rules (NOT inline styles on every element). Inject design tokens from `design-tokens.ts` as CSS custom properties under `:root { --color-primary: ... }` and reference them via `var(--…)`. NO Tailwind. NO external CSS frameworks. NO CDN. NO JS frameworks. NO build step. Only standard HTML5 + CSS3.
- 增加规则：必须给所有 reset 写明确（`*, *::before, *::after { box-sizing: border-box }`、`body { margin: 0 }`），按需写媒体查询。

```typescript
// packages/opencorvus/src/mirror/url/prompt.ts
/**
 * Single source of the webpage-clone prompt + feedback — consumed by both
 * `mirror-baidu-clone` benchmark script and the `webpage-generate` skill.
 *
 * Output contract: a single `index.html` written by the LLM, vanilla CSS
 * only (one <style> block, :root design-token custom properties, real
 * cascading selectors). No framework, no CDN, no JS runtime.
 */
import type { ProjectScaffold } from "../ir/scaffold"

export interface BuildClonePromptInput {
  iter: number
  referenceUrl: string
  targetScore: number
  viewport: { width: number; height: number }
  outputDir: string
  sharedContext: string
  xmlIRBytes: number
  scaffold: ProjectScaffold
  previousFeedback?: string
}

export function buildClonePrompt(input: BuildClonePromptInput): string {
  const sectionList = input.scaffold.sections
    .map((s) => `- ${s.name} (${s.elementCount} el, ${s.bounds.w}×${s.bounds.h}px)`)
    .join("\n")
  const patternList = input.scaffold.catalog.patterns
    .slice(0, 10)
    .map((p) =>
      `- ${p.name} × ${p.instanceCount}${p.props.length > 0 ? ` — props: ${p.props.map((pp) => `${pp.name}: ${pp.type}`).join(", ")}` : ""}`,
    )
    .join("\n")

  const iterationHeader =
    input.iter === 1
      ? `You are cloning ${input.referenceUrl} as a single-file static HTML page with vanilla CSS.`
      : `Iteration ${input.iter}. The previous attempt did not meet the target visual similarity. **Add missing elements with \`edit\`** — do NOT rewrite the whole file. Preserve every section that already matches.`

  return `
${iterationHeader}

# Goal
Produce an \`index.html\` at the root of the working directory that visually reproduces
${input.referenceUrl} with overall score ≥ ${input.targetScore}/100.
Score = (SSIM × 50) + ((100 − pixelDiff%) × 0.5). Structural fidelity and colour
placement matter most.

# Viewport
${input.viewport.width} × ${input.viewport.height} (logical).

# Working directory
${input.outputDir}

# Deterministic artefacts already on disk (do NOT regenerate these from scratch)
- \`page-ir.xml\`           — ${input.xmlIRBytes} bytes of structured XML IR describing the page
- \`shared-context.md\`     — concise design-token + pattern summary
- \`scaffold.json\`         — ProjectScaffold (file paths + contracts)
- \`design-tokens.ts\`      — COLORS / FONTS / SPACING / RADII constants
- \`reference.png\`         — pixel-perfect reference screenshot

# Rules
1. **Single-file static HTML**: write exactly one \`index.html\`. All styles MUST
   live inside ONE \`<style>\` block at the top of \`<head>\`. Use real CSS class
   selectors and cascading rules — NOT inline styles on every element.
2. **Vanilla CSS only**: NO Tailwind. NO external CSS framework. NO CDN. NO JS
   framework. NO build step. NO \`<script>\` tag. Only standard HTML5 + CSS3.
3. **Design tokens via custom properties**: inject every COLORS / FONTS / SPACING
   / RADII value from \`design-tokens.ts\` as a CSS custom property under \`:root {}\`
   (e.g. \`--color-primary: #4E6EF2\`) and reference them via \`var(--color-primary)\`.
   Do not hard-code hex values inside selectors.
4. **CSS hygiene**: include a real reset
   (\`*, *::before, *::after { box-sizing: border-box }\`, \`body { margin: 0 }\`),
   set \`font-family\` on \`body\`, write media queries when the reference uses them.
5. **Static HTML text**: every visible text node from the reference must appear
   as raw HTML so a non-executing reader sees the content. NO client-side rendering.
6. Use **exact text** from the XML IR (\`<Text …>content</Text>\`) and \`Section Text\`
   catalogs. Do not paraphrase headings, nav labels, or button text.
7. Use **exact image paths**: \`Section Images\` catalogs list \`img-N: path\`.
   Reference the local paths where present, fall back to the original URLs otherwise.
8. Structure must match the section list exactly (in order, with matching bounds).
9. Do not fetch \`${input.referenceUrl}\` at runtime; the clone must be fully static.
10. Before writing \`index.html\`, \`read\` \`page-ir.xml\` and at least \`shared-context.md\`.

# Section summary
${sectionList || "- (no sections)"}

# Detected component patterns
${patternList || "- (none)"}

${input.previousFeedback ? `# Diff feedback from previous iteration\n${input.previousFeedback}\n` : ""}
# Deliverable
Write \`index.html\`. When finished, reply briefly with the list of top-level sections
you rendered and any known gaps.
`.trim()
}

export interface BuildCloneFeedbackInput {
  iter: number
  evalReport: {
    overallScore: number
    ssimScore: number
    pixelDiffPercent: number
    mismatchedPixels: number
    totalPixels: number
    diffImageDataUrl: string
    dimensionsMatch: boolean
  }
  diffPath: string
  referencePath: string
  targetScore: number
  bestScore: number
  missingTokens: string[]
}

export function buildCloneFeedback(input: BuildCloneFeedbackInput): string {
  const r = input.evalReport
  const renderedPath = input.referencePath.replace("reference.png", `rendered-${input.iter}.png`)
  const gapToTarget = Math.max(0, input.targetScore - r.overallScore)

  const missing = input.missingTokens.slice(0, 30)
  const missingLines =
    missing.length > 0
      ? `Missing textual content (these strings appear in the reference but NOT in your rendered \`index.html\`):\n${missing
          .map((t) => `  - "${t}"`)
          .join("\n")}\n\nAdd every missing string to \`index.html\` in its correct section. Use the \`Section Text\` catalog in \`page-ir.xml\` to find the right parent node for each.`
      : "Text coverage is complete — remaining gap is structural/visual only."

  const regressionWarning =
    input.bestScore > r.overallScore
      ? `\n**Regression guard**: a previous iteration scored ${input.bestScore}/100, and we restored \`index.html\` to that best version. Do NOT rewrite the whole file with \`write\` — use \`edit\` to ADD missing elements. Deleting existing correct markup has cost us points before.\n`
      : ""

  return `
Previous iteration scored ${r.overallScore}/100 (target ≥ ${input.targetScore}, gap = ${gapToTarget}).
Best iteration so far: ${input.bestScore}/100.

Metrics:
  - SSIM structural similarity: ${r.ssimScore.toFixed(3)}
  - Pixel diff: ${r.pixelDiffPercent.toFixed(2)}% (${r.mismatchedPixels}/${r.totalPixels} px)
  - Dimension match: ${r.dimensionsMatch}

Artefacts (read them with the \`read\` tool):
  - Reference screenshot: ${input.referencePath}
  - Your render:          ${renderedPath}
  - Pixel diff heatmap:   ${input.diffPath}
${regressionWarning}
${missingLines}

Operating guidance:
  1. Use \`edit\` (NOT \`write\`) to append missing elements / add CSS rules to the existing \`index.html\`.
  2. Do NOT remove any element or CSS rule that is already rendering correctly.
  3. Start with the largest red-zone in the diff image, then move to smaller ones.
  4. Colours MUST come from \`design-tokens.ts\` (COLORS constant) — reference them via the
     \`var(--…)\` custom properties you injected at \`:root\`. Do not invent hex values.

Make targeted edits, then stop. Reply with a list of the specific sections you modified.
`.trim()
}
```

- [ ] **Step 1.4: 跑测试看通过**

Run: `cd packages/opencorvus && bun test test/mirror/prompt.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 1.5: typecheck 单文件**

Run: `cd packages/opencorvus && bun x tsc --noEmit src/mirror/url/prompt.ts test/mirror/prompt.test.ts`
Expected: 无错误

- [ ] **Step 1.6: commit + push**

```bash
git add packages/opencorvus/src/mirror/url/prompt.ts packages/opencorvus/test/mirror/prompt.test.ts
git commit -m "feat(mirror): add single-source clone prompt builder (vanilla CSS, no Tailwind)" -m "Why: benchmark and skill currently maintain separate prompts (rule 22 violation); skill's deterministic compile path produces unusable output. This unifies prompt construction and locks output to vanilla CSS so the tool stays generic (rule 15)."
git push --no-verify
```

---

## Task 2: 删除 `webpage_compile_html` 工具与确定性编译器

**Files:**
- Delete: `packages/opencorvus/src/mirror/url/compile-html.ts`
- Delete: `packages/opencorvus/src/mirror/tools/webpage-compile-html.ts`
- Modify: `packages/opencorvus/src/mirror/tools/index.ts` (remove `WebpageCompileHtmlTool` export)
- Modify: `packages/opencorvus/src/tool/registry.ts:41,150` (remove import + array entry)
- Modify: `packages/opencorvus/src/agent/agent.ts:107,305` (remove permission entry + comment)
- Modify: `packages/opencorvus/src/prompt/core/orchestrator-core.txt` (remove tool reference)

- [ ] **Step 2.1: 删除两个文件**

```bash
rm packages/opencorvus/src/mirror/url/compile-html.ts
rm packages/opencorvus/src/mirror/tools/webpage-compile-html.ts
```

- [ ] **Step 2.2: 修 mirror/tools/index.ts**

打开 `packages/opencorvus/src/mirror/tools/index.ts`，删除：
- 第 8 行注释 `*   - webpage_compile_html  ExtractedPage → static index.html (deliverable)`
- 第 20 行 `export { WebpageCompileHtmlTool } from "./webpage-compile-html"`

- [ ] **Step 2.3: 修 tool/registry.ts**

第 41 行删除 `WebpageCompileHtmlTool,`（import 列表）；第 150 行附近从工具数组里删除该项。

- [ ] **Step 2.4: 修 agent/agent.ts**

第 107 行删除 `webpage_compile_html: "allow",`；第 305 行附近的注释里删去 `/ webpage_compile_html`。

- [ ] **Step 2.5: 修 prompt/core/orchestrator-core.txt**

`grep -n webpage_compile_html packages/opencorvus/src/prompt/core/orchestrator-core.txt` 找到行号删除整行（或在描述里替换为合适的当前流程）。

- [ ] **Step 2.6: typecheck 全包**

Run: `cd packages/opencorvus && bun x tsc --noEmit`
Expected: 无错误。如有，逐个 grep 残留 `webpage_compile_html` / `WebpageCompileHtmlTool` / `compileExtractedPageToHtml` 引用并清理。

- [ ] **Step 2.7: commit + push**

```bash
git add -A
git commit -m "refactor(mirror): remove webpage_compile_html deterministic compiler (rule 22)" -m "Why: 32-property inline-style replay loses pseudo-elements, transforms, web fonts, absolute positioning, inline SVG paths, and global CSS resets — structurally insufficient for any modern page. Skill now goes through the same LLM-handwrite path as the benchmark."
git push --no-verify
```

---

## Task 3: 重写 `webpage-generate.md` skill（vanilla CSS handwrite path）

**Files:**
- Modify: `packages/opencorvus/src/skill/builtin/webpage-generate.md`（全文重写）

- [ ] **Step 3.1: 重写 skill markdown**

完整新内容（覆盖现有文件）：

```markdown
---
name: webpage-generate
description: Generate a static single-file HTML clone of a reference webpage with visual similarity ≥ 95. Pipeline is deterministic for extraction (`webpage_extract` → `webpage_compile` → `webpage_analyze`), then the agent hand-writes `index.html` using vanilla CSS, iterating against `webpage_render` + `webpage_evaluate` until the target score is reached. Activate when the user asks to clone, copy, reproduce, replicate, mirror, 复刻, 克隆, 模仿, or "make a page that looks like" another webpage; or when the brief cites a reference design (specific URL, screenshot). Always pull structure + tokens + text from the mirror artifacts — never hand-write hex codes, copy, or section structure.
stage: build
auto_detect:
  files:
    - index.html
    - public/index.html
  task_signals:
    has_attachment_image: true
    request_contains_url: true
priority: 60
---

# Webpage Generate Skill

You produce a **single-file static HTML clone** of a reference webpage. The mirror toolchain extracts structure, tokens, and text deterministically; you compose them into a hand-written `index.html` using vanilla CSS, then iterate against visual + textual diffs until the score meets target.

## Pipeline

1. **Extract** — `webpage_extract <url>` writes `mirror/extracted-page.json`, `mirror/reference.png`, `mirror/images/`.
2. **Compile IR** — `webpage_compile` writes `mirror/page-ir.xml` (compact XML).
3. **Analyze** — `webpage_analyze` writes `mirror/scaffold.json`, `mirror/design-tokens.ts`, `mirror/shared-context.md`.
4. **Hand-write `index.html`** — using the artifacts as authoritative sources of structure, palette, and copy.
5. **Render** — `webpage_render` produces `mirror/rendered.png`.
6. **Evaluate** — `webpage_evaluate` computes SSIM + pixel-diff against `mirror/reference.png`, writes `mirror/diff.png` + score.
7. **Iterate** — if score < target, use `webpage_text_diff` + `mirror/diff.png` to drive targeted edits. Re-render, re-evaluate. Up to 8 rounds.

Steps 1–3 are strictly serial (each consumes the previous output). Steps 5–7 form the iteration loop.

## Output contract

- One `index.html` at the worktree root.
- One `<style>` block at the top of `<head>`. NO inline `style=` attributes on every element — use class selectors and cascading rules.
- Inject every COLORS / FONTS / SPACING / RADII value from `mirror/design-tokens.ts` as CSS custom properties under `:root { --color-primary: …; }` and reference them via `var(--…)`.
- Standard reset: `*, *::before, *::after { box-sizing: border-box }`, `body { margin: 0 }`.
- NO Tailwind. NO external CSS framework. NO CDN. NO JS framework. NO build step. NO `<script>` tag. Only HTML5 + CSS3.
- All visible text appears as raw HTML — non-executing readers see the content.
- Images via the local `images/` paths from the mirror toolchain (or original URLs as fallback).

## Activation

Use this skill when the user asks to reproduce a webpage's look — e.g. "clone the Baidu homepage", "复刻 https://example.com/", "make a landing page that looks like 小红书", "rebuild the visual shell of <url>".

Do NOT use it for content rewriting, SEO analysis, or behavioural scraping.

## Step 0 — Resolve the URL

If the user provided a URL starting with `http://` or `https://`, skip to step 1. Otherwise call `websearch` for `X official homepage` / `X 官网`, pick the canonical host, and confirm with the user in one sentence unless unambiguous. Never invent a URL.

## Step 1 — Extract

Call `webpage_extract` with the URL. Defaults (1440×900, `body` scope, `keep_images: true`) are right for most desktop pages.

### P1-A hard rule: no text-only fallback

If `webpage_extract` cannot resolve the reference (SPA login wall, pixel-free canvas, JS-only shell), STOP and escalate. You MUST NOT fabricate screenshots, hand-write a "scaffold" from descriptions, or call any submit/accept verdict on a deliverable that has no reference image.

## Step 2 — Compile IR + analyze tokens

Call `webpage_compile` then `webpage_analyze`. Each produces deterministic artifacts that ground your write in step 4.

## Step 3 — Read the artifacts

Before writing one line of HTML, `read`:
- `mirror/page-ir.xml` (full file) — exact text + structure
- `mirror/shared-context.md` — design-token / pattern summary
- `mirror/design-tokens.ts` — palette / typography
- `mirror/reference.png` — visual target

Quote the exact strings, copy the exact hex codes (via `var(--…)`), follow the section ordering.

## Step 4 — Write `index.html`

Hand-write the file. Skeleton:

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=1440, initial-scale=1" />
  <title>...</title>
  <style>
    :root {
      --color-primary: #4E6EF2;
      /* ... every token from design-tokens.ts ... */
    }
    *, *::before, *::after { box-sizing: border-box }
    body { margin: 0; font-family: var(--font-sans, system-ui, sans-serif); color: var(--color-text); background: var(--color-bg) }
    .header { ... }
    .search-box { ... }
    /* ... real cascading rules ... */
  </style>
</head>
<body>
  <header class="header">...</header>
  <main>...</main>
  <footer>...</footer>
</body>
</html>
```

Keep section structure verbatim from `page-ir.xml`. Match bounds approximately via flex/grid + sizing tokens — pixel-exact placement is not required, structural similarity is.

## Step 5 — Render

`webpage_render` produces `mirror/rendered.png`.

## Step 6 — Evaluate

`webpage_evaluate reference=reference.png rendered=rendered.png`. Score = `round(ssim × 50 + (100 − pixelDiff%) × 0.5)`. Target ≥ 95.

## Step 7 — Iterate

For each round (up to 8):

1. **Diagnose**:
   - `webpage_text_diff` — strings missing from your render.
   - `mirror/diff.png` — largest red region = next target.
2. **Edit** `index.html` with the `edit` tool (targeted patches; do NOT rewrite the whole file once it's at a workable state).
   - Insert missing strings in the right section per `page-ir.xml`'s `Section Text` catalog.
   - Add CSS rules for color drift, spacing, typography — using `var(--…)` only.
   - Replace placeholder image src when `mirror/images/` lacks the asset.
3. Re-run `webpage_render` then `webpage_evaluate`.
4. If `score ≥ target`, proceed to acceptance. If `score < target` and rounds < 8, go to 1. If 8 rounds done and score still lags, STOP and report final score + biggest remaining diff regions + obvious blockers.

Track round count explicitly.

## Cross-goal artifact sharing — DO NOT delete `mirror/`

The mirror toolchain output stays in the worktree. Subsequent goals + delivery agents read these artifacts. The build runtime ff-only merges your goal branch back into primary HEAD so the next worktree inherits them via git (rule 22 — single source).

## Hard acceptance gate — render screenshot is mandatory

You MUST NOT mark the goal `passed` or call `goal_report` / `StructuredOutput` until you have:

1. Re-run `webpage_render` AFTER your last edit (stale `rendered.png` does not count).
2. Read `mirror/rendered.png` (the actual image) and `mirror/reference.png`, visually compared them, and confirmed in your structured output that you inspected both.
3. Run `webpage_evaluate` against the freshly-rendered `rendered.png` and recorded score in `mirror/eval-result.json`.

The render screenshot is the ONLY source of truth for "does this look like the reference". Textual checks and DOM diffs are sanity checks, never substitutes for looking at the image.

## What success looks like

A self-contained `index.html` + `images/` folder at the worktree root, with:

- All canonical text from the reference present verbatim
- All images referenced by their local `images/` paths
- One `<style>` block, vanilla CSS, design tokens via `:root` custom properties
- `mirror/rendered.png` exists, was visually inspected, and matches the reference
- Score ≥ 95 from `webpage_evaluate`
```

- [ ] **Step 3.2: 修 webpage-generate.test.ts**

打开 `packages/opencorvus/test/mirror/webpage-generate.test.ts`，删去对 `webpage_compile_html` 的断言，改为断言：
- `parsed.data.required_tools` 包含 `webpage_extract`, `webpage_compile`, `webpage_analyze`, `webpage_render`, `webpage_evaluate`, `webpage_text_diff`, `read`, `write`, `edit`
- `parsed.content` 包含 `vanilla CSS`, 不包含 `Tailwind`, 不包含 `webpage_compile_html`

实际改动：先 `cat` 文件看断言形态，然后逐条更新。

- [ ] **Step 3.3: 修 skill-inject.test.ts**

`packages/opencorvus/test/engine/skill-inject.test.ts:76` 同样把 `webpage_compile_html` 替换成新 required tools 列表。

- [ ] **Step 3.4: typecheck + 跑这两个测试**

```bash
cd packages/opencorvus && bun x tsc --noEmit
cd packages/opencorvus && bun test test/mirror/webpage-generate.test.ts test/engine/skill-inject.test.ts
```
Expected: 全部 PASS。

- [ ] **Step 3.5: commit + push**

```bash
git add -A
git commit -m "feat(skill): rewrite webpage-generate around hand-written vanilla CSS" -m "Why: deterministic compile path is gone (Task 2). Skill now mirrors the proven mirror-baidu-clone flow — LLM hand-writes a single-file HTML using extracted IR + tokens + reference screenshot, iterates against visual diff until SSIM target. Vanilla CSS keeps the skill generic (rule 15)."
git push --no-verify
```

---

## Task 4: 把 mirror-baidu-clone benchmark 切到单源 prompt + vanilla CSS

**Files:**
- Modify: `packages/opencorvus/script/benchmark/mirror-baidu-clone.ts`（删本地 buildPrompt/buildFeedback，import 新模块）
- Modify: `packages/opencorvus/script/benchmark/mirror-bbc-clone.ts`（同上，如果存在同名函数）
- Modify: `packages/opencorvus/script/benchmark/overlay-web-benchmark.ts`（默认 brief 第 262 行去 Tailwind 硬约束）

- [ ] **Step 4.1: 切 mirror-baidu-clone.ts**

打开 `packages/opencorvus/script/benchmark/mirror-baidu-clone.ts`：
- 顶部 import 增加 `import { buildClonePrompt, buildCloneFeedback } from "../../src/mirror/url/prompt"`
- 替换 `buildPrompt(...)` 调用为 `buildClonePrompt(...)`
- 替换 `buildFeedback(...)` 调用为 `buildCloneFeedback(...)`
- 删除文件底部本地的 `function buildPrompt(...)` / `function buildFeedback(...)` 定义

- [ ] **Step 4.2: 切 mirror-bbc-clone.ts**

`grep -n "function buildPrompt\|function buildFeedback" packages/opencorvus/script/benchmark/mirror-bbc-clone.ts` 看是否有同名函数，有就同样改造。

- [ ] **Step 4.3: 改 overlay-web-benchmark.ts 默认 brief**

文件 `packages/opencorvus/script/benchmark/overlay-web-benchmark.ts` 第 262 行附近的 `DEFAULT_TASK_REQUEST`：

把 "**One external dependency allowed**: Tailwind CDN..." 整段替换成：

```
- **Vanilla CSS only.** All styles live in one `<style>` block at the top of `<head>`. Inject every design token from `mirror/design-tokens.ts` as a CSS custom property under `:root` and reference via `var(--…)`. NO Tailwind, NO external CSS framework, NO CDN, NO JS framework, NO build step.
```

把第 251 行附近的 phase 1 描述里 "(`webpage_extract` → `webpage_compile` → `webpage_analyze`)" 保留（已正确），但确认没有出现 `webpage_compile_html` 字样。

- [ ] **Step 4.4: typecheck**

```bash
cd packages/opencorvus && bun x tsc --noEmit
```
Expected: 无错误。

- [ ] **Step 4.5: commit + push**

```bash
git add -A
git commit -m "refactor(benchmark): single-source clone prompt; vanilla CSS in default brief" -m "Why: rule 22 — benchmark and skill now share src/mirror/url/prompt.ts; rule 15 — Tailwind CDN no longer pinned, output is vanilla CSS so the deliverable runs offline."
git push --no-verify
```

---

## Task 5: 跑 overlay benchmark 实测（首轮）

注意：必须 **可视**（不可加 `--no-browser`，规则 12）。

- [ ] **Step 5.1: 准备环境变量**

确认 `.env` 含 `CODING_DASHSCOPE_API_KEY`、`ALIBABA_CODING_PLAN_API_KEY`、`DASHSCOPE_API_URL=https://coding.dashscope.aliyuncs.com/v1`。从 `.env` 读出值，传到子进程：

```bash
set -a; source packages/opencorvus/.env 2>/dev/null || source .env 2>/dev/null; set +a
```

- [ ] **Step 5.2: 启动 benchmark（背景执行）**

```bash
cd packages/opencorvus && \
  OPENCORVUS_DISABLE_DEFAULT_PLUGINS=1 \
  CODING_DASHSCOPE_API_KEY="$CODING_DASHSCOPE_API_KEY" \
  ALIBABA_CODING_PLAN_API_KEY="$ALIBABA_CODING_PLAN_API_KEY" \
  DASHSCOPE_API_URL="https://coding.dashscope.aliyuncs.com/v1" \
  bun run script/benchmark/overlay-web-benchmark.ts \
    --stall-timeout-ms=1200000 \
    --planning-stall-timeout-ms=7200000 \
    --report=/tmp/overlay-bench-run-1.json \
  > /tmp/overlay-bench-run-1.log 2>&1
```

用 Bash `run_in_background: true`，记下 shell id。

- [ ] **Step 5.3: 等 benchmark 出结果**

`Monitor` 这条 background shell；或读 `/tmp/overlay-bench-run-1.json` 直到出现 `qualityVerdict` 字段。

- [ ] **Step 5.4: 找产物 worktree**

报告里有产物路径（通常在 `<homeDir>/worktrees/<taskID>/<goalID>/index.html`）。从 report json 取出。

- [ ] **Step 5.5: Claude 视觉 review（强制 — 规则 7）**

```bash
ls <worktree>/index.html
ls <worktree>/mirror/rendered.png
ls <worktree>/mirror/reference.png
```

用 `Read` 工具读 `mirror/reference.png` 和 `mirror/rendered.png`（图像直接传给视觉模型）。

逐项判定：
- 顶部 nav 是否有"新闻 hao123 地图 贴吧 视频 图片 网盘 更多"，颜色 + 间距是否接近
- logo 位置 + 尺寸
- 搜索框：边框 1px #C8C8C8、内嵌"百度一下"按钮、按钮蓝 #4E6EF2
- 中部快捷链接区域
- 底部 footer 文字
- 整体留白是否合理
- 是否有"狗屎"特征（坍缩布局、纯文字流、无样式）

记录在 `/tmp/visual-review-1.md`。

- [ ] **Step 5.6: 决策**

如果视觉 OK 且 score ≥ 0.85 → Task 6（双重 review 结案）。

如果 NOT OK → 分析 root cause（参考 systematic-debugging Phase 1）：
- prompt 缺约束？→ 改 `src/mirror/url/prompt.ts` 加规则
- agent 没读 IR？→ skill 加强 step 3 强制语句
- skill 没注入？→ check skill-inject 链路
- LLM 选错？→ check `OPENCORVUS_BENCHMARK_MODEL`

每条 fix → commit + push --no-verify → 回 Step 5.2 跑下一轮。允许多轮直到稳定（规则 3）。

---

## Task 6: 二次 review + 收尾

- [ ] **Step 6.1: 跑两次额外 benchmark 验证稳定性**

按 Step 5.2 跑两次（比如换种子或同种子重跑），确认两次都视觉 OK + score ≥ 0.85。Report 文件 `/tmp/overlay-bench-run-final-{1,2}.json`。

- [ ] **Step 6.2: Claude 二次视觉 review 两次产物**

用 `Read` 看图，写 `/tmp/visual-review-final.md` 总结。

- [ ] **Step 6.3: 删 [CRON] session warning**

`CronList` 找到 id `f6dc5523`（或 CronList 看当前活跃），`CronDelete` 删掉。

- [ ] **Step 6.4: 最终 commit + push**

```bash
git add -A
git commit -m "chore(webpage-generate): finalize rebuild — stable high-fidelity output verified" -m "Why: overlay-web-benchmark produces SSIM ≥ 0.85 and visually faithful Baidu clone across N runs. Vanilla-CSS handwrite path single-sourced via src/mirror/url/prompt.ts. Cron警告已清理。"
git push --no-verify
```

---

## Self-Review

**Spec coverage:**
- 单源 prompt（规则 22）✅ Task 1 + Task 4
- 删 deterministic compiler（根因）✅ Task 2
- vanilla CSS / 通用工具（规则 15、26）✅ Task 1 prompt + Task 3 skill + Task 4 brief
- 视觉验收 + 二次 review（规则 7、12）✅ Task 5.5 + Task 6.2
- 实测 overlay benchmark 直到稳定（规则 3）✅ Task 5.6 循环 + Task 6.1
- commit + push --no-verify（规则 21）✅ 每个 Task 末尾
- [CRON] 警告 + 完成后删除（警告段）✅ 已设置 + Task 6.3 删除

**Placeholder scan:** 已剔除"appropriate error handling"等占位。每个 step 含具体命令或代码。

**Type consistency:** `BuildClonePromptInput` / `BuildCloneFeedbackInput` 在 prompt.ts 与 test 中字段名一致；`evalReport` 字段（overallScore/ssimScore/pixelDiffPercent/...）与 `evaluateVisual` 返回类型对齐 — 进 Task 1 后确认 `evaluateVisual` 实际返回字段名。
