/**
 * Mirror tool wrappers — thin `Tool.define` shells over the pure algorithms
 * in `src/mirror/`. Registered in `src/tool/registry.ts`.
 *
 * Exposed tools:
 *   - webpage_extract       URL → ExtractedPage + reference screenshot
 *   - webpage_compile       ExtractedPage → XML IR (compact prompt-friendly)
 *   - webpage_compile_html  ExtractedPage → static index.html (deliverable)
 *   - webpage_analyze       ExtractedPage → ProjectScaffold + pre-generated files
 *   - webpage_render        index.html → PNG screenshot
 *   - webpage_evaluate      (reference, rendered) → score + diff PNG
 *   - webpage_text_diff     reference DOM vs rendered DOM → missing tokens
 *
 * A skill (\`src/skill/builtin/webpage-generate.md\`) composes them for the
 * agent; no tool calls another tool internally.
 */

export { WebpageExtractTool } from "./webpage-extract"
export { WebpageCompileTool } from "./webpage-compile"
export { WebpageCompileHtmlTool } from "./webpage-compile-html"
export { WebpageAnalyzeTool } from "./webpage-analyze"
export { WebpageRenderTool } from "./webpage-render"
export { WebpageEvaluateTool } from "./webpage-evaluate"
export { WebpageTextDiffTool } from "./webpage-text-diff"
