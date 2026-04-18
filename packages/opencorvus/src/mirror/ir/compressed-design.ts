/**
 * Figma `CompressedDesign` IR — the boundary contract between the three
 * Figma tools (`figma/fetch-tree`, `figma/graph-analyze`, `figma/compile`).
 *
 * Shape mirrors `mirror/src/types.ts::CompressedDesign` verbatim so downstream
 * algorithms drop in without a remap layer. Field-level Zod schemas make
 * this contract the validation point at every tool boundary.
 */

import z from "zod"

// ─── Graph analysis subtypes ─────────────────────────────────────────────

const ConnectionEdgeSchema = z.object({
  groupId: z.number(),
  source: z.object({ name: z.string(), nodeId: z.string() }),
  target: z.object({ name: z.string(), nodeId: z.string() }),
})

const AnnotationEntrySchema = z.object({
  groupId: z.number(),
  kind: z.enum(["basic", "source"]),
  targetName: z.string(),
  targetNodeId: z.string(),
  specs: z.array(z.string()),
})

const ReuseReferenceSchema = z.object({
  raw: z.string(),
  library: z.string(),
  component: z.string(),
  variant: z.string(),
  nodeId: z.string(),
})

// ─── CompressedNode (recursive) ──────────────────────────────────────────

const CompressedNodeLayoutSchema = z.object({
  mode: z.string().optional(),
  wrap: z.string().optional(),
  primaryAlign: z.string().optional(),
  counterAlign: z.string().optional(),
  padding: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  gap: z.number().optional(),
  sizingH: z.string().optional(),
  sizingV: z.string().optional(),
})

const CompressedNodeConstraintsSchema = z.object({
  horizontal: z.string().optional(),
  vertical: z.string().optional(),
})

const CompressedNodeBoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
})

const CompressedNodeStyleSchema = z.object({
  bg: z.string().optional(),
  bgGradient: z.string().optional(),
  border: z.string().optional(),
  borderWidth: z.number().optional(),
  borderRadius: z.union([z.number(), z.array(z.number())]).optional(),
  opacity: z.number().optional(),
  shadow: z.string().optional(),
  blur: z.number().optional(),
  clipContent: z.boolean().optional(),
})

const CompressedNodeTextSchema = z.object({
  content: z.string(),
  font: z.string().optional(),
  size: z.number().optional(),
  weight: z.number().optional(),
  lineHeight: z.union([z.number(), z.string()]).optional(),
  letterSpacing: z.number().optional(),
  color: z.string().optional(),
  align: z.string().optional(),
  verticalAlign: z.string().optional(),
  decoration: z.string().optional(),
  textCase: z.string().optional(),
})

/**
 * Recursive `CompressedNode` schema.
 *
 * Zod's inference on recursive schemas is lossy; we explicitly type the
 * inferred shape and use `z.lazy` for the self-reference.
 */
export interface CompressedNode {
  id: string
  name: string
  type: string
  category?: "key" | "mark" | "repeat" | "leaf"
  layout?: z.infer<typeof CompressedNodeLayoutSchema>
  constraints?: z.infer<typeof CompressedNodeConstraintsSchema>
  bounds?: z.infer<typeof CompressedNodeBoundsSchema>
  style?: z.infer<typeof CompressedNodeStyleSchema>
  text?: z.infer<typeof CompressedNodeTextSchema>
  imageUrl?: string
  annotationImages?: string[]
  children?: CompressedNode[]
  componentId?: string
  componentName?: string
  description?: string
  repeatCount?: number
  repeatSample?: boolean
  annotations?: string[]
}

export const CompressedNodeSchema: z.ZodType<CompressedNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    category: z.enum(["key", "mark", "repeat", "leaf"]).optional(),
    layout: CompressedNodeLayoutSchema.optional(),
    constraints: CompressedNodeConstraintsSchema.optional(),
    bounds: CompressedNodeBoundsSchema.optional(),
    style: CompressedNodeStyleSchema.optional(),
    text: CompressedNodeTextSchema.optional(),
    imageUrl: z.string().optional(),
    annotationImages: z.array(z.string()).optional(),
    children: z.array(CompressedNodeSchema).optional(),
    componentId: z.string().optional(),
    componentName: z.string().optional(),
    description: z.string().optional(),
    repeatCount: z.number().optional(),
    repeatSample: z.boolean().optional(),
    annotations: z.array(z.string()).optional(),
  }),
)

// ─── PageGraph ───────────────────────────────────────────────────────────

export const GraphPageSchema = z.object({
  id: z.string(),
  label: z.string(),
  contentNodes: z.array(CompressedNodeSchema),
  annotations: z.array(AnnotationEntrySchema),
  reuseRefs: z.array(ReuseReferenceSchema),
  isDefault: z.boolean(),
})

export const PageGraphSchema = z.object({
  hasGraphStructure: z.boolean(),
  connections: z.array(ConnectionEdgeSchema),
  annotations: z.array(AnnotationEntrySchema),
  reuseRefs: z.array(ReuseReferenceSchema),
  pages: z.array(GraphPageSchema),
  sharedNodes: z.array(CompressedNodeSchema),
  externalComponents: z.array(
    z.object({
      library: z.string(),
      component: z.string(),
      variants: z.array(z.string()),
      stubName: z.string(),
    }),
  ),
})

// ─── Design tokens / components ──────────────────────────────────────────

export const TextStyleTokenSchema = z.object({
  name: z.string(),
  font: z.string(),
  size: z.number(),
  weight: z.number(),
  lineHeight: z.union([z.number(), z.string()]).optional(),
  letterSpacing: z.number().optional(),
  color: z.string(),
})

export const EffectTokenSchema = z.object({
  name: z.string(),
  type: z.string(),
  value: z.string(),
})

export const DesignTokensSchema = z.object({
  colors: z.record(z.string(), z.string()),
  gradients: z.array(z.string()),
  fonts: z.array(z.string()),
  textStyles: z.array(TextStyleTokenSchema),
  effects: z.array(EffectTokenSchema),
})

export const ComponentInfoSchema = z.object({
  name: z.string(),
  description: z.string(),
  key: z.string(),
})

export const ComponentSetInfoSchema = z.object({
  name: z.string(),
  description: z.string(),
})

// ─── Top-level CompressedDesign ──────────────────────────────────────────

export const CompressedDesignPageSchema = z.object({
  name: z.string(),
  frames: z.array(CompressedNodeSchema),
})

export const CompressedDesignStatsSchema = z.object({
  totalNodes: z.number(),
  compressedNodes: z.number(),
  imageCount: z.number(),
  compressionRatio: z.string(),
})

export const CompressedDesignCommentSchema = z.object({
  text: z.string(),
  nodeId: z.string().optional(),
  author: z.string().optional(),
})

export const CompressedDesignSchema = z.object({
  fileName: z.string(),
  lastModified: z.string(),
  figmaUrl: z.string(),
  pages: z.array(CompressedDesignPageSchema),
  components: z.record(z.string(), ComponentInfoSchema),
  componentSets: z.record(z.string(), ComponentSetInfoSchema),
  tokens: DesignTokensSchema,
  images: z.record(z.string(), z.string()),
  comments: z.array(CompressedDesignCommentSchema),
  stats: CompressedDesignStatsSchema,
  pageGraph: PageGraphSchema.optional(),
})

export type CompressedDesign = z.infer<typeof CompressedDesignSchema>
export type DesignTokens = z.infer<typeof DesignTokensSchema>
export type PageGraph = z.infer<typeof PageGraphSchema>
export type GraphPage = z.infer<typeof GraphPageSchema>
export type ConnectionEdge = z.infer<typeof ConnectionEdgeSchema>
export type AnnotationEntry = z.infer<typeof AnnotationEntrySchema>
export type ReuseReference = z.infer<typeof ReuseReferenceSchema>
