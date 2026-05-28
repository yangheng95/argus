/**
 * Single source of the webpage-clone prompt + feedback — consumed by both
 * the `mirror-*-clone` benchmark scripts and the `webpage-generate` skill.
 *
 * Output contract: generated semantic View source paths declared by
 * ProjectScaffold and returned by the analyze tool. Business code wraps these
 * Views instead of hand-writing a parallel visual DOM.
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
  const sourcePaths = generatedSourcePaths(input.scaffold)
  const sourcePathList = sourcePaths.length > 0
    ? sourcePaths.map((filePath) => `  - \`${filePath}\``).join("\n")
    : "  - (no generated source paths declared)"
  const tokenPath = input.scaffold.tokensFile.filePath
  const surfaceList = input.scaffold.surfaces
    .map((s) => `- ${s.name} (${s.kind}, ${s.bounds.w}×${s.bounds.h}px)`)
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
      ? `You are cloning ${input.referenceUrl} by refining generated React source.`
      : `Iteration ${input.iter}. The previous attempt had visual differences. **Add missing elements and rules with \`edit\`** — do NOT rewrite whole files. Preserve every visual surface that already matches.`

  return `
${iterationHeader}

# Goal
Refine the generated View source paths declared by \`visual-surface-scaffold.json\` so the
running app visually reproduces ${input.referenceUrl}. The acceptance source is
\`webpage_evaluate.overallScore >= ${input.targetScore}\` and
\`webpage_vision_judge.accepted = true\` after rendering the deliverable with an
explicit browser URL. Do not invent a higher score target.

# Viewport
${input.viewport.width} × ${input.viewport.height} (logical).

# Working directory
${input.outputDir}

# Deterministic artefacts already on disk (do NOT regenerate these from scratch)
- \`page-ir.xml\`           — ${input.xmlIRBytes} bytes of structured XML IR describing the page
- \`shared-context.md\`     — concise design-token + pattern summary
- \`visual-surface-scaffold.json\` — ProjectScaffold (semantic surface View paths + contracts)
- \`reference.png\`         — pixel-perfect reference screenshot

# Generated View source paths from visual-surface-scaffold.json
${sourcePathList}

# Rules
1. **Generated source only**: edit the generated source paths listed above. Do
   not create a parallel deliverable outside those paths.
2. **Design tokens**: use every COLORS / FONTS / SPACING / RADII value from
   \`${tokenPath}\`. Do not hard-code hex values that bypass tokens.
3. **CSS hygiene**: include a real reset
   (\`*, *::before, *::after { box-sizing: border-box }\`, \`body { margin: 0 }\`),
   set \`font-family\` on \`body\`, write media queries when the reference uses them.
4. **Rendered text**: every visible text node from the reference appears in the
   generated React tree so the browser render exposes the content.
5. Use **exact text** from the XML IR (\`<Text …>content</Text>\`) and \`Surface
   Text\` catalogs. Do not paraphrase headings, nav labels, or button text.
6. Use **exact image paths**: \`Surface Images\` catalogs list \`img-N: path\`.
   Reference the local paths where present. If a selected image path is missing,
   stop and report the missing asset instead of linking remote originals.
7. Structure must match the semantic visual surface list exactly (in order, with matching bounds).
8. Do not fetch \`${input.referenceUrl}\` at runtime; the clone must render from local source.
9. Before editing generated source, \`read\` \`page-ir.xml\` and at least
    \`shared-context.md\`.

# Visual surface summary
${surfaceList || "- (no visual surfaces)"}

# Detected component patterns
${patternList || "- (none)"}

${input.previousFeedback ? `# Diff feedback from previous iteration\n${input.previousFeedback}\n` : ""}
# Deliverable
Refine generated source. When finished, reply briefly with the list of top-level
visual surfaces you modified and any known gaps.
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
      ? `Missing textual content (these strings appear in the reference but NOT in your rendered app):\n${missing
          .map((t) => `  - "${t}"`)
          .join("\n")}\n\nAdd every missing string to generated source in its correct visual surface. Use the \`Surface Text\` catalog in \`page-ir.xml\` to find the right parent node for each.`
      : "Text coverage is complete — remaining gap is structural/visual only."

  const regressionWarning =
    input.bestScore > r.overallScore
      ? `\n**Regression guard**: a previous iteration scored ${input.bestScore}/100. Do NOT rewrite whole files with \`write\` — use \`edit\` to ADD missing elements and CSS rules. Deleting existing correct markup has cost us points before.\n`
      : ""

  const stagnationWarning =
    input.consecutiveNoImprovement >= 3
      ? `\n**Stagnation HARD STOP**: ${input.consecutiveNoImprovement} consecutive numeric-score iterations failed to raise the best score (${input.bestScore}/100). Stop score-chasing and hand off the current blocking visual differences for \`webpage_vision_judge\` review.\n`
      : input.consecutiveNoImprovement >= 1
        ? `\n**Stagnation watch**: ${input.consecutiveNoImprovement}/3 numeric-score iterations with no new high score. Use the visual judge differences as the work queue.\n`
        : ""

  return `
Previous iteration numeric score: ${r.overallScore}/100.
Best numeric score so far: ${input.bestScore}/100. Numeric threshold: ${input.targetScore}/100. Numeric-score iterations without improvement: ${input.consecutiveNoImprovement}/3.

Metrics (track them across iterations as a progress / regression signal):
  - SSIM structural similarity: ${r.ssimScore.toFixed(3)}
  - Pixel diff: ${r.pixelDiffPercent.toFixed(2)}% (${r.mismatchedPixels}/${r.totalPixels} px)
  - Dimension match: ${r.dimensionsMatch}

Required visual review:
  - Reference screenshot: ${input.referencePath}
  - Your render:          ${renderedPath}
  Open BOTH images and compare them yourself before editing. The score by itself
  cannot tell you whether structural elements (button placement, search box
  layout, visual surface ordering) are correct — only the side-by-side comparison can.
${regressionWarning}${stagnationWarning}
${missingLines}

Operating guidance:
   1. Use \`edit\` (NOT \`write\`) to append missing elements / add CSS rules to
     the generated source.
  2. Do NOT remove any element or CSS rule that is already rendering correctly.
  3. Pick the most visually-impactful gap first (wrong layout / wrong colour /
     wrong icon). Don't chase pixel-level shimmer.
  4. Colours MUST come from the generated token module (COLORS constant) —
     reference them via the \`var(--…)\` custom properties you injected at
     \`:root\`. Do not invent hex values.

Make targeted edits, then stop. Reply with a list of the specific visual surfaces you
modified.
`.trim()
}

function generatedSourcePaths(scaffold: ProjectScaffold): string[] {
  const paths = [
    scaffold.tokensFile.filePath,
    scaffold.appFile.filePath,
    ...scaffold.sharedViews.map((file) => file.filePath.replace(/\.tsx$/, ".view.tsx")),
    ...scaffold.surfaces.map((surface) => surface.view.filePath.replace(/\.tsx$/, ".view.tsx")),
  ]
  return Array.from(new Set(paths.filter(Boolean)))
}
