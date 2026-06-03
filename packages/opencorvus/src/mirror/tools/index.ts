/**
 * Mirror tool wrappers — thin `Tool.define` shells over the pure algorithms
 * in `src/mirror/`. Registered in `src/tool/registry.ts`.
 *
 * Exposed tools:
 *   - webpage_extract         URL → ExtractedPage + reference screenshot
 *   - webpage_compile         ExtractedPage → XML IR (compact prompt-friendly)
 *   - webpage_analyze         ExtractedPage → ProjectScaffold + pre-generated files
 *   - webpage_runtime_state   URL → browser scroll/runtime state evidence
 *   - webpage_image_extract   Image(s) → ImageAnalysis (vision-LLM)
 *   - webpage_image_compile   ImageAnalysis → XML IR (same dialect as URL flow)
 *   - webpage_render          explicit browser URL → PNG screenshot
 *   - webpage_evaluate        (reference, rendered) → numeric score + 85/100 verdict
 *   - webpage_text_diff       reference DOM vs rendered DOM → missing tokens
 *   - webpage_vision_judge    (reference, rendered) → acceptance verdict + ranked diffs
 *
 * Figma references are materialized by frontend_design through the connected
 * Figma MCP server. This package does not expose Figma REST mirror tools.
 *
 * Two skills compose them for the build agent:
 *   - \`src/skill/builtin/webpage-generate.md\`  URL → clone (DOM extract path)
 *   - \`src/skill/builtin/image-generate.md\`    Image → clone (vision-extract path)
 *
 * No tool calls another tool internally. The deliverable is hand-written by
 * the LLM using whatever stack the brief calls for — see
 * \`src/mirror/url/prompt.ts\` (URL) and \`src/mirror/image/prompt.ts\`
 * (image) for the single-source extract prompts.
 */

export { WebpageExtractTool } from "./webpage-extract"
export { WebpageCompileTool } from "./webpage-compile"
export { WebpageAnalyzeTool } from "./webpage-analyze"
export { WebpageRuntimeStateTool } from "./webpage-runtime-state"
export { WebpageImageExtractTool } from "./webpage-image-extract"
export { WebpageImageCompileTool } from "./webpage-image-compile"
export { WebpageImageAnalyzeTool } from "./webpage-image-analyze"
export { WebpageRenderTool } from "./webpage-render"
export { WebpageEvaluateTool } from "./webpage-evaluate"
export { WebpageTextDiffTool } from "./webpage-text-diff"
export { WebpageVisionJudgeTool } from "./webpage-vision-judge"
