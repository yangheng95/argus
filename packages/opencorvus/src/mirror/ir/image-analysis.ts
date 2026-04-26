/**
 * `ImageAnalysis` — vision-LLM derived structural snapshot of one or more
 * screenshots. The image2code analogue of `ExtractedPage` (URL) and
 * `CompressedDesign` (Figma). All numeric values are visually inferred
 * estimates — there is no DOM or computed style to ground them.
 *
 * Lives under `mirror/ir/` so `image/extract.ts` (LLM call) and
 * `image/compile.ts` (deterministic XML) share one boundary type without
 * cross-importing each other (README invariant: figma ⊥ url ⊥ image,
 * communication only via `ir/` schemas).
 */

import z from "zod"

// ─── Element tree ────────────────────────────────────────────────────────

export const ImageElementBoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
})
export type ImageElementBounds = z.infer<typeof ImageElementBoundsSchema>

export const ImageElementLayoutSchema = z.object({
  direction: z.enum(["horizontal", "vertical", "grid"]),
  align: z.string().optional(),
  crossAlign: z.string().optional(),
  gap: z.number().optional(),
  wrap: z.boolean().optional(),
  gridCols: z.number().optional(),
})
export type ImageElementLayout = z.infer<typeof ImageElementLayoutSchema>

export const ImageElementStyleSchema = z.object({
  bg: z.string().optional(),
  bgGradient: z.string().optional(),
  border: z.string().optional(),
  borderRadius: z.union([z.number(), z.string()]).optional(),
  shadow: z.string().optional(),
  opacity: z.number().optional(),
  /** [top, right, bottom, left] in CSS pixels. */
  padding: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
})
export type ImageElementStyle = z.infer<typeof ImageElementStyleSchema>

export const ImageElementTextSchema = z.object({
  content: z.string(),
  font: z.string().optional(),
  size: z.number().optional(),
  weight: z.number().optional(),
  color: z.string().optional(),
  lineHeight: z.number().optional(),
  align: z.string().optional(),
})
export type ImageElementText = z.infer<typeof ImageElementTextSchema>

export const ImageElementImageSchema = z.object({
  alt: z.string(),
  aspectRatio: z.string().optional(),
})
export type ImageElementImage = z.infer<typeof ImageElementImageSchema>

export const ImageElementRoleSchema = z.enum([
  "header", "nav", "main", "section", "aside", "footer",
  "card", "form", "list", "hero", "grid", "button", "input",
])
export type ImageElementRole = z.infer<typeof ImageElementRoleSchema>

// Recursive node — z.lazy + manual ZodType annotation.
export interface ImageElement {
  name: string
  role?: ImageElementRole
  bounds: ImageElementBounds
  layout?: ImageElementLayout
  style?: ImageElementStyle
  text?: ImageElementText
  image?: ImageElementImage
  repeatCount?: number
  componentHint?: string
  children?: ImageElement[]
}

export const ImageElementSchema: z.ZodType<ImageElement> = z.lazy(() =>
  z.object({
    name: z.string(),
    role: ImageElementRoleSchema.optional(),
    bounds: ImageElementBoundsSchema,
    layout: ImageElementLayoutSchema.optional(),
    style: ImageElementStyleSchema.optional(),
    text: ImageElementTextSchema.optional(),
    image: ImageElementImageSchema.optional(),
    repeatCount: z.number().optional(),
    componentHint: z.string().optional(),
    children: z.array(ImageElementSchema).optional(),
  }),
)

// ─── Tokens ──────────────────────────────────────────────────────────────

export const ImageTextStyleSchema = z.object({
  name: z.string(),
  font: z.string().optional(),
  size: z.number(),
  weight: z.number(),
  color: z.string(),
  lineHeight: z.number().optional(),
})
export type ImageTextStyle = z.infer<typeof ImageTextStyleSchema>

export const ImageTokensSchema = z.object({
  /** Hex values keyed by semantic name (e.g. `primary: "#1890ff"`). */
  colors: z.record(z.string(), z.string()),
  fonts: z.array(z.string()),
  textStyles: z.array(ImageTextStyleSchema),
})
export type ImageTokens = z.infer<typeof ImageTokensSchema>

export const ImageViewportSchema = z.object({
  width: z.number(),
  height: z.number(),
})
export type ImageViewport = z.infer<typeof ImageViewportSchema>

// ─── Top-level ──────────────────────────────────────────────────────────

export const ImageAnalysisSchema = z.object({
  /** One- or two-sentence overall page description. */
  description: z.string(),
  /** Inferred CSS-pixel viewport (defaults to 1440×900 if not stated). */
  viewport: ImageViewportSchema,
  tokens: ImageTokensSchema,
  /** Top-level element forest. Empty `tree` is rejected — vision-LLM
   *  refusals / silent failures should surface as a typed error upstream
   *  instead of an empty payload (rule 1). */
  tree: z.array(ImageElementSchema).min(1),
  /** Self-reported confidence 0–1. Informational only — no acceptance
   *  gate keys on it (rule 11). */
  confidence: z.number().min(0).max(1),
})
export type ImageAnalysis = z.infer<typeof ImageAnalysisSchema>
