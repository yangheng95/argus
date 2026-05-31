/**
 * Vision-LLM extract prompt for image2code.
 *
 * Single-source prompt — both `image/extract.ts` (production) and any future
 * benchmark / smoke harness consume this exact text. Mirrors `mirror/url/prompt.ts`
 * (single-source for url2code) so changes to either flow stay version-controlled
 * in one place per pipeline (rule 22).
 *
 * Ported from `opencode-private/packages/mirror/src/prompt/image.ts` with
 * adaptations:
 *   - Output is consumed by AI SDK `streamText({ output: Output.object(...) })`,
 *     so the upstream "wrap in ```json fences" instruction is removed — the
 *     SDK enforces strict JSON via the model's tool-use / structured-output
 *     channel and the schema rejects shape drift instead.
 *   - Locale is applied by the caller (`image/extract.ts`) by composing the
 *     final system text — keeps this module dependency-free.
 *   - Returns multimodal `parts` ready to splice into the AI SDK's
 *     `messages[0].content` array.
 */

export const IMAGE_EXTRACT_SYSTEM = `You are a UI frontend design. Infer a webpage's complete structure from one or more screenshots through visual analysis only — there is no DOM or computed style available.

Output a single ImageAnalysis JSON value (the host validates against a strict schema; missing or wrong-shape fields fail the call):

interface ImageAnalysis {
  description: string                          // 1-2 sentence overall page description
  viewport: { width: number; height: number }  // estimated CSS-pixel viewport
  tokens: {
    colors: Record<string, string>             // semantic name → exact hex (e.g. "primary": "#1890ff")
    fonts: string[]
    textStyles: Array<{
      name: string; font?: string; size: number
      weight: number; color: string; lineHeight?: number
    }>
  }
  tree: ImageElement[]                         // recursive element tree
  confidence: number                           // 0-1
}

interface ImageElement {
  name: string                                 // semantic name (e.g. "hero-section", "nav-logo")
  role?: "header"|"nav"|"main"|"section"|"aside"|"footer"|"card"|"form"|"list"|"hero"|"grid"|"button"|"input"
  bounds: { x: number; y: number; w: number; h: number }   // estimated px bounds
  layout?: { direction: "horizontal"|"vertical"|"grid"; align?: string; crossAlign?: string; gap?: number; wrap?: boolean; gridCols?: number }
  style?: { bg?: string; bgGradient?: string; border?: string; borderRadius?: number; shadow?: string; opacity?: number; padding?: [number,number,number,number] }
  text?: { content: string; font?: string; size?: number; weight?: number; color?: string; lineHeight?: number; align?: string }
  image?: { alt: string; aspectRatio?: string }
  repeatCount?: number                         // for repeated children (cards, list items)
  componentHint?: string                       // optional UI-library hint (e.g. "antd:Card")
  children?: ImageElement[]
}

## Analysis steps

1. Identify top-level regions: header / hero / content sections / sidebar / footer.
2. Recurse into each region — containers, text blocks, images, interactive elements.
3. Estimate every bounds value in INTEGER CSS pixels. These values feed code generation directly — be precise.
4. Extract the palette as exact hex values, not approximations. Name colours semantically (primary / secondary / bg / text / accent / etc.).
5. Identify the typographic system: families, hierarchy (h1 / h2 / body / caption), weights, colours, exact px sizes.
6. Infer flex direction, alignment, and gap (px) for each container.
7. For repeated elements (grid cards, list rows), set \`repeatCount\` AND list EVERY visible child item under \`children\` — text, labels, ranks, prices. Do not abbreviate; the codegen pass copies these verbatim.
8. Tag known UI patterns via \`componentHint\` when matched.
9. Completeness pass: every visible element in the screenshot must appear somewhere in \`tree\`. No silent drops.

## Resolution policy

Screenshots may be 2x Retina. Report all bounds in 1x CSS pixels. If the rendered text appears small but a 32px+ size is required to be readable, the image is 2x — halve linear dimensions.`

export interface ImageExtractPromptInput {
  /** Pre-loaded image bytes + media types. Caller resolves paths / data URLs;
   *  this module never touches the filesystem. */
  images: Array<{ data: Buffer | Uint8Array; mediaType: string }>
  pageHint?: string
  componentLibrary?: string
}

export interface UserPart {
  role: "user"
  content: Array<
    | { type: "text"; text: string }
    | { type: "file"; data: Buffer | Uint8Array; mediaType: string }
  >
}

/**
 * Build the AI SDK `messages` array (system + single user message with
 * interleaved text + image parts). The caller sets the model + schema and
 * passes the result straight to `streamText` object output (rule 27 —
 * streaming-only; the SDK enforces the schema as the structured-output contract so no
 * post-stream defensive parsing is needed).
 */
export function imageExtractMessages(input: ImageExtractPromptInput): {
  system: string
  messages: UserPart[]
} {
  if (input.images.length === 0) {
    throw new Error("imageExtractMessages: at least one image is required")
  }

  const intro: string[] = ["Analyze the following screenshot(s) and emit one ImageAnalysis JSON value."]

  if (input.pageHint) {
    intro.push("", "## Page hint", "", input.pageHint)
  }

  if (input.componentLibrary) {
    intro.push(
      "",
      "## Component library",
      "",
      `Target component library: ${input.componentLibrary}. When you spot a matching pattern, set componentHint to "${input.componentLibrary}:ComponentName".`,
    )
  }

  const content: UserPart["content"] = [{ type: "text", text: intro.join("\n") }]
  for (let i = 0; i < input.images.length; i++) {
    content.push({ type: "text", text: `\n--- Image ${i + 1}/${input.images.length} ---\n` })
    content.push({ type: "file", data: input.images[i].data, mediaType: input.images[i].mediaType })
  }

  return {
    system: IMAGE_EXTRACT_SYSTEM,
    messages: [{ role: "user", content }],
  }
}
