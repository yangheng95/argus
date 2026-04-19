/**
 * Mirror tool wrappers — thin `Tool.define` shells over the pure algorithms
 * in `src/mirror/`. Registered in `src/tool/registry.ts`.
 *
 * Exposed tools:
 *   - webpage_extract     URL → ExtractedPage + reference screenshot
 *   - webpage_compile     ExtractedPage → XML IR
 *   - webpage_analyze     ExtractedPage → ProjectScaffold + pre-generated files
 *   - webpage_render      index.html → PNG screenshot
 *   - webpage_evaluate    (reference, rendered) → score + diff PNG
 *
 * A skill (\`src/skill/builtin/webpage-clone.md\`) composes them for the
 * agent; no tool calls another tool internally.
 */

export { WebpageExtractTool } from "./webpage-extract"
export { WebpageCompileTool } from "./webpage-compile"
export { WebpageAnalyzeTool } from "./webpage-analyze"
export { WebpageRenderTool } from "./webpage-render"
export { WebpageEvaluateTool } from "./webpage-evaluate"
export { WebpageTextDiffTool } from "./webpage-text-diff"
