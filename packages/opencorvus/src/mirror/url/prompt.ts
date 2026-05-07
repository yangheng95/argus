/**
 * Single source of the webpage-clone prompt + feedback — consumed by both
 * the `mirror-*-clone` benchmark scripts and the `webpage-generate` skill.
 *
 * Output contract: a single `index.html` written by the LLM, vanilla CSS
 * only (one `<style>` block, design tokens injected as `:root` custom
 * properties, real cascading selectors). No framework, no CDN, no JS
 * runtime — keeps the deliverable generic (rule 15) and the skill's
 * generation strategy single-sourced (rule 22).
 */
import type { ProjectScaffold } from "../ir/scaffold"
import type { EvaluationReport } from "../visual/evaluate"

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
    .map(
      (p) =>
        `- ${p.name} × ${p.instanceCount}${p.props.length > 0 ? ` — props: ${p.props.map((pp) => `${pp.name}: ${pp.type}`).join(", ")}` : ""}`,
    )
    .join("\n")

  const iterationHeader =
    input.iter === 1
      ? `You are cloning ${input.referenceUrl} as a single-file static HTML page with vanilla CSS.`
      : `Iteration ${input.iter}. The previous attempt had visual differences. **Add missing elements and rules with \`edit\`** — do NOT rewrite the whole file. Preserve every section that already matches.`

  return `
${iterationHeader}

# Goal
Produce an \`index.html\` at the root of the working directory that visually reproduces
${input.referenceUrl}. The acceptance source is \`webpage_vision_judge.accepted = true\`
after rendering the deliverable with an explicit browser URL. SSIM/pixel scores are
diagnostic progress signals only.

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
   selectors and cascading rules — do NOT inline styles on every element.
2. **Vanilla CSS only**: NO Tailwind. NO external CSS framework. NO CDN. NO JS
   framework. NO build step. NO \`<script>\` tag. Only standard HTML5 + CSS3.
3. **Design tokens via custom properties**: inject every COLORS / FONTS /
   SPACING / RADII value from \`design-tokens.ts\` as a CSS custom property under
   \`:root { --color-primary: …; }\` and reference them via \`var(--…)\`. Do not
   hard-code hex values inside selectors — every colour reference goes through a
   token.
4. **CSS hygiene**: include a real reset
   (\`*, *::before, *::after { box-sizing: border-box }\`, \`body { margin: 0 }\`),
   set \`font-family\` on \`body\`, write media queries when the reference uses them.
5. **Static text**: every visible text node from the reference appears as raw
   HTML so a non-executing reader sees the content. NO client-side rendering.
6. Use **exact text** from the XML IR (\`<Text …>content</Text>\`) and \`Section
   Text\` catalogs. Do not paraphrase headings, nav labels, or button text.
7. Use **exact image paths**: \`Section Images\` catalogs list \`img-N: path\`.
   Reference the local paths where present. If a selected image path is missing,
   stop and report the missing asset instead of linking remote originals.
8. Structure must match the section list exactly (in order, with matching bounds).
9. Do not fetch \`${input.referenceUrl}\` at runtime; the clone must be fully static.
10. Before writing \`index.html\`, \`read\` \`page-ir.xml\` and at least
    \`shared-context.md\`.

# Section summary
${sectionList || "- (no sections)"}

# Detected component patterns
${patternList || "- (none)"}

${input.previousFeedback ? `# Diff feedback from previous iteration\n${input.previousFeedback}\n` : ""}
# Deliverable
Write \`index.html\`. When finished, reply briefly with the list of top-level
sections you rendered and any known gaps.
`.trim()
}

export interface BuildCloneFeedbackInput {
  iter: number
  evalReport: EvaluationReport
  referencePath: string
  targetScore: number
  bestScore: number
  /** How many consecutive iterations have failed to raise the best score. */
  consecutiveNoImprovement: number
  missingTokens: string[]
}

export function buildCloneFeedback(input: BuildCloneFeedbackInput): string {
  const r = input.evalReport
  const renderedPath = input.referencePath.replace("reference.png", `rendered-${input.iter}.png`)
  const missing = input.missingTokens.slice(0, 30)
  const missingLines =
    missing.length > 0
      ? `Missing textual content (these strings appear in the reference but NOT in your rendered \`index.html\`):\n${missing
          .map((t) => `  - "${t}"`)
          .join("\n")}\n\nAdd every missing string to \`index.html\` in its correct section. Use the \`Section Text\` catalog in \`page-ir.xml\` to find the right parent node for each.`
      : "Text coverage is complete — remaining gap is structural/visual only."

  const regressionWarning =
    input.bestScore > r.overallScore
      ? `\n**Regression guard**: a previous iteration scored ${input.bestScore}/100, and we restored \`index.html\` to that best version. Do NOT rewrite the whole file with \`write\` — use \`edit\` to ADD missing elements and CSS rules. Deleting existing correct markup has cost us points before.\n`
      : ""

  const stagnationWarning =
    input.consecutiveNoImprovement >= 3
      ? `\n**Stagnation HARD STOP**: ${input.consecutiveNoImprovement} consecutive diagnostic-score iterations failed to raise the best score (${input.bestScore}/100). Stop score-chasing and hand off the current blocking visual differences for \`webpage_vision_judge\` review.\n`
      : input.consecutiveNoImprovement >= 1
        ? `\n**Stagnation watch**: ${input.consecutiveNoImprovement}/3 diagnostic-score iterations with no new high score. Use the visual judge differences as the work queue.\n`
        : ""

  return `
Previous iteration diagnostic score: ${r.overallScore}/100.
Best diagnostic score so far: ${input.bestScore}/100. Diagnostic-score iterations without improvement: ${input.consecutiveNoImprovement}/3.

Metrics (track them across iterations as a progress / regression signal):
  - SSIM structural similarity: ${r.ssimScore.toFixed(3)}
  - Pixel diff: ${r.pixelDiffPercent.toFixed(2)}% (${r.mismatchedPixels}/${r.totalPixels} px)
  - Dimension match: ${r.dimensionsMatch}

Required visual review:
  - Reference screenshot: ${input.referencePath}
  - Your render:          ${renderedPath}
  Open BOTH images and compare them yourself before editing. The score by itself
  cannot tell you whether structural elements (button placement, search box
  layout, section ordering) are correct — only the side-by-side comparison can.
${regressionWarning}${stagnationWarning}
${missingLines}

Operating guidance:
  1. Use \`edit\` (NOT \`write\`) to append missing elements / add CSS rules to
     the existing \`index.html\`.
  2. Do NOT remove any element or CSS rule that is already rendering correctly.
  3. Pick the most visually-impactful gap first (wrong layout / wrong colour /
     wrong icon). Don't chase pixel-level shimmer.
  4. Colours MUST come from \`design-tokens.ts\` (COLORS constant) — reference
     them via the \`var(--…)\` custom properties you injected at \`:root\`. Do not
     invent hex values.

Make targeted edits, then stop. Reply with a list of the specific sections you
modified.
`.trim()
}
