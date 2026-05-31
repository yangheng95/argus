import z from "zod"

export const WebCloneAssetKindSchema = z.enum([
  "css",
  "script",
  "svg-path-data",
  "data-uri",
  "image-data-uri",
  "large-attribute",
  "large-text",
])

export const WebCloneAssetUseSchema = z.object({
  nodeId: z.string(),
  tag: z.string().optional(),
  attribute: z.string().optional(),
  role: z.string().optional(),
})

export const WebCloneAssetSchema = z.object({
  id: z.string(),
  kind: WebCloneAssetKindSchema,
  path: z.string(),
  sha256: z.string().length(64),
  bytes: z.number().int().nonnegative(),
  chars: z.number().int().nonnegative(),
  mime: z.string().optional(),
  semanticRole: z.string(),
  preview: z.string(),
  usedBy: z.array(WebCloneAssetUseSchema),
})

export const WebCloneAttributeSchema = z.object({
  name: z.string(),
  value: z.string().optional(),
  assetId: z.string().optional(),
  classTokens: z.array(z.string()).optional(),
})

export const WebCloneBoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
})

export const WebCloneLayoutSchema = z.object({
  selector: z.string().optional(),
  role: z.string().optional(),
  bounds: WebCloneBoundsSchema.optional(),
  styles: z.record(z.string(), z.string()).optional(),
  text: z.string().optional(),
  imageSrc: z.string().optional(),
  imageAlt: z.string().optional(),
  href: z.string().optional(),
  matchConfidence: z.number().min(0).max(1).optional(),
})

export const WebCloneNodeSchema: z.ZodType<{
  id: string
  type: "document" | "element" | "text" | "comment" | "directive"
  sourcePath?: string
  tag?: string
  text?: string
  assetId?: string
  attrs?: z.infer<typeof WebCloneAttributeSchema>[]
  layout?: z.infer<typeof WebCloneLayoutSchema>
  children?: WebCloneNode[]
}> = z.lazy(() =>
  z.object({
    id: z.string(),
    type: z.enum(["document", "element", "text", "comment", "directive"]),
    sourcePath: z.string().optional(),
    tag: z.string().optional(),
    text: z.string().optional(),
    assetId: z.string().optional(),
    attrs: z.array(WebCloneAttributeSchema).optional(),
    layout: WebCloneLayoutSchema.optional(),
    children: z.array(WebCloneNodeSchema).optional(),
  }),
)

export const WebClonePageIrSchema = z.object({
  version: z.literal(1),
  purpose: z.literal("web-clone-structure-ir"),
  source: z.object({
    url: z.string().optional(),
    title: z.string().optional(),
    inputSha256: z.string().length(64),
  }),
  policy: z.object({
    preserved: z.string(),
    sidecar: z.string(),
  }),
  stats: z.object({
    nodes: z.number().int().nonnegative(),
    elements: z.number().int().nonnegative(),
    textNodes: z.number().int().nonnegative(),
    comments: z.number().int().nonnegative(),
    directives: z.number().int().nonnegative(),
    attributes: z.number().int().nonnegative(),
    sidecarAssets: z.number().int().nonnegative(),
    layoutElements: z.number().int().nonnegative().optional(),
    layoutMatchedElements: z.number().int().nonnegative().optional(),
  }),
  root: WebCloneNodeSchema,
})

export const WebCloneAssetGraphSchema = z.object({
  version: z.literal(1),
  purpose: z.literal("web-clone-asset-graph"),
  sourceIr: z.string(),
  assets: z.array(WebCloneAssetSchema),
})

export const WebCloneSegmentStrategySchema = z.enum([
  "dom-component",
  "asset-backed-component",
  "canvas-raster",
  "svg-inline",
  "mixed",
])

export const WebCloneSegmentNodeSummarySchema = z.object({
  id: z.string(),
  parentId: z.string().optional(),
  sourcePath: z.string().optional(),
  type: z.enum(["document", "element", "text", "comment", "directive"]),
  tag: z.string().optional(),
  text: z.string().optional(),
  attrs: z.array(WebCloneAttributeSchema).optional(),
  layout: WebCloneLayoutSchema.optional(),
})

export const WebCloneSegmentAssetSummarySchema = z.object({
  id: z.string(),
  kind: WebCloneAssetKindSchema,
  path: z.string(),
  bytes: z.number().int().nonnegative(),
  mime: z.string().optional(),
  semanticRole: z.string(),
  preview: z.string(),
  usedBy: z.array(WebCloneAssetUseSchema),
})

export const WebCloneSegmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  rootNodeId: z.string(),
  tag: z.string(),
  strategy: WebCloneSegmentStrategySchema,
  bounds: WebCloneBoundsSchema.optional(),
  layout: WebCloneLayoutSchema.optional(),
  nodeIds: z.array(z.string()),
  assetIds: z.array(z.string()),
  nodeOutline: z.array(WebCloneSegmentNodeSummarySchema),
  omittedNodeCount: z.number().int().nonnegative(),
  assetRefs: z.array(WebCloneSegmentAssetSummarySchema),
  textPreview: z.array(z.string()),
  childElementCount: z.number().int().nonnegative(),
})

export const WebCloneSegmentsSchema = z.object({
  version: z.literal(1),
  purpose: z.literal("web-clone-visual-segments"),
  sourceIr: z.string(),
  assetManifest: z.string(),
  segments: z.array(WebCloneSegmentSchema),
})

export const WebCloneCodegenContextSchema = z.object({
  version: z.literal(1),
  purpose: z.literal("web-clone-framework-codegen-context"),
  sourceIr: z.string(),
  assetManifest: z.string(),
  segmentsPath: z.string(),
  rules: z.array(z.string()),
  verificationGates: z.array(z.string()),
  segments: z.array(WebCloneSegmentSchema),
})

export type WebCloneAssetKind = z.infer<typeof WebCloneAssetKindSchema>
export type WebCloneAssetUse = z.infer<typeof WebCloneAssetUseSchema>
export type WebCloneAsset = z.infer<typeof WebCloneAssetSchema>
export type WebCloneAttribute = z.infer<typeof WebCloneAttributeSchema>
export type WebCloneBounds = z.infer<typeof WebCloneBoundsSchema>
export type WebCloneLayout = z.infer<typeof WebCloneLayoutSchema>
export type WebCloneNode = z.infer<typeof WebCloneNodeSchema>
export type WebClonePageIr = z.infer<typeof WebClonePageIrSchema>
export type WebCloneAssetGraph = z.infer<typeof WebCloneAssetGraphSchema>
export type WebCloneSegmentStrategy = z.infer<typeof WebCloneSegmentStrategySchema>
export type WebCloneSegmentNodeSummary = z.infer<typeof WebCloneSegmentNodeSummarySchema>
export type WebCloneSegmentAssetSummary = z.infer<typeof WebCloneSegmentAssetSummarySchema>
export type WebCloneSegment = z.infer<typeof WebCloneSegmentSchema>
export type WebCloneSegments = z.infer<typeof WebCloneSegmentsSchema>
export type WebCloneCodegenContext = z.infer<typeof WebCloneCodegenContextSchema>
