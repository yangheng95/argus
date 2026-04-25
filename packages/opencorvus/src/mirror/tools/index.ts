/**
 * Mirror tool wrappers — thin `Tool.define` shells over the pure algorithms
 * in `src/mirror/`. Registered in `src/tool/registry.ts`.
 *
 * Exposed tools:
 *   - webpage_extract       URL → ExtractedPage + reference screenshot
 *   - webpage_compile       ExtractedPage → XML IR (compact prompt-friendly)
 *   - webpage_analyze       ExtractedPage → ProjectScaffold + pre-generated files
 *   - webpage_render        index.html → PNG screenshot
 *   - webpage_evaluate      (reference, rendered) → score + diff PNG
 *   - webpage_text_diff     reference DOM vs rendered DOM → missing tokens
 *   - webpage_vision_judge  (reference, rendered) → vision-LLM verdict + ranked diffs
 *
 * A skill (\`src/skill/builtin/webpage-generate.md\`) composes them for the
 * agent; no tool calls another tool internally. The deliverable `index.html`
 * is hand-written by the LLM using vanilla CSS — see `src/mirror/url/prompt.ts`
 * for the single-source prompt contract shared with benchmark scripts.
 */

export { WebpageExtractTool } from "./webpage-extract"
export { WebpageCompileTool } from "./webpage-compile"
export { WebpageAnalyzeTool } from "./webpage-analyze"
export { WebpageRenderTool } from "./webpage-render"
export { WebpageEvaluateTool } from "./webpage-evaluate"
export { WebpageTextDiffTool } from "./webpage-text-diff"
export { WebpageVisionJudgeTool } from "./webpage-vision-judge"
