/**
 * Plan / generated-file contracts plus the semantic visual-surface scaffold.
 *
 * `ProjectScaffold` is the final downstream mirror contract. It deliberately
 * exposes semantic `surfaces`, not mechanical extraction sections. Extraction
 * chunking stays inside source-specific analyzers; generated source and
 * downstream agents consume only validated visual surfaces.
 */

import z from "zod"

export const PlanFileContractsSchema = z.object({
  /** Named exports the file produces. */
  exports: z.array(z.string()),
  /** Verbatim TypeScript interface text, if any. */
  types: z.string().optional(),
  /** Import graph — map of import path → names consumed. */
  imports: z.record(z.string(), z.array(z.string())).optional(),
}).strict()

export const PlanFileSchema = z.object({
  /** Free-form description of the file's responsibility. */
  file_info: z.string(),
  /** Path relative to the output root. */
  file_path: z.string(),
  /** Implementation hints for the codegen agent. */
  notes: z.string(),
  /**
   * Per-file visual references — when present, only these images are fed to
   * codegen for this file (not the global image pool).
   */
  images: z.array(z.string()).optional(),
  /**
   * Cross-file contract: what this file exports and what it imports. Allows
   * `tier-graph::buildTiers` to topologically sort for parallel codegen.
   */
  contracts: PlanFileContractsSchema.optional(),
}).strict()

export const GeneratedFileSchema = z.object({
  file_path: z.string(),
  code: z.string(),
}).strict()

export type PlanFile = z.infer<typeof PlanFileSchema>
export type PlanFileContracts = z.infer<typeof PlanFileContractsSchema>
export type GeneratedFile = z.infer<typeof GeneratedFileSchema>

// ─── Design Token System ────────────────────────────────────────────────

export const TokenColorSemanticSchema = z.enum([
  "surface",
  "background",
  "text",
  "text-muted",
  "border",
])

export const TokenColorSchema = z.object({
  value: z.string(),
  frequency: z.number(),
  semantic: TokenColorSemanticSchema.optional(),
}).strict()

export const TokenSpacingSchema = z.object({
  px: z.number(),
  frequency: z.number(),
  tailwind: z.string().optional(),
}).strict()

export const TokenFontSchema = z.object({
  family: z.string(),
  weights: z.array(z.number()),
  sizes: z.array(z.number()),
  tailwind: z.string().optional(),
}).strict()

export const TokenRadiusSchema = z.object({
  px: z.number(),
  frequency: z.number(),
  tailwind: z.string().optional(),
}).strict()

export const TokenShadowSchema = z.object({
  value: z.string(),
  frequency: z.number(),
}).strict()

export const DesignTokenSystemSchema = z.object({
  colors: z.array(TokenColorSchema),
  spacing: z.array(TokenSpacingSchema),
  fonts: z.array(TokenFontSchema),
  radii: z.array(TokenRadiusSchema),
  shadows: z.array(TokenShadowSchema),
  customProperties: z.record(z.string(), z.string()),
}).strict()

export type TokenColor = z.infer<typeof TokenColorSchema>
export type TokenSpacing = z.infer<typeof TokenSpacingSchema>
export type TokenFont = z.infer<typeof TokenFontSchema>
export type TokenRadius = z.infer<typeof TokenRadiusSchema>
export type TokenShadow = z.infer<typeof TokenShadowSchema>
export type DesignTokenSystem = z.infer<typeof DesignTokenSystemSchema>

// ─── Component Catalog ──────────────────────────────────────────────────

export const InferredPropSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "image", "href"]),
  required: z.boolean(),
  samples: z.array(z.string()),
}).strict()

export const PatternInstanceSchema = z.object({
  elementIndex: z.number(),
  /** The raw ExtractedElement — kept `unknown` to avoid importing the recursive schema here. */
  element: z.unknown(),
  propValues: z.record(z.string(), z.string().optional()),
}).strict()

export const ComponentPatternSchema = z.object({
  name: z.string(),
  fingerprint: z.string(),
  instanceCount: z.number(),
  props: z.array(InferredPropSchema),
  instances: z.array(PatternInstanceSchema),
  /** The template ExtractedElement picked from the first cluster member. */
  templateElement: z.unknown(),
  structuralSimilarity: z.number(),
}).strict()

export const ComponentCatalogSchema = z.object({
  patterns: z.array(ComponentPatternSchema),
  totalElements: z.number(),
  coveredElements: z.number(),
}).strict()

export type InferredProp = z.infer<typeof InferredPropSchema>
export type PatternInstance = z.infer<typeof PatternInstanceSchema>
export type ComponentPattern = z.infer<typeof ComponentPatternSchema>
export type ComponentCatalog = z.infer<typeof ComponentCatalogSchema>

// ─── Semantic visual surface scaffold ───────────────────────────────────

export const FileContractSchema = z.object({
  filePath: z.string(),
  exportName: z.string(),
  isDefaultExport: z.boolean(),
  propsInterface: z.string(),
  imports: z.record(z.string(), z.array(z.string())),
  patterns: z.array(z.string()),
  surfaceIR: z.string().optional(),
}).strict()

export const SurfaceBoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
}).strict()

export const SourceRefSchema = z.object({
  source: z.enum(["url", "image", "figma"]),
  path: z.string(),
  selector: z.string().optional(),
  bounds: SurfaceBoundsSchema.optional(),
}).strict()

export const VisualSurfaceKindSchema = z.enum([
  "navigation",
  "hero",
  "search",
  "form",
  "feed",
  "list",
  "table",
  "data-grid",
  "chart-panel",
  "detail-card",
  "media",
  "modal",
  "footer",
  "floating-tools",
  "content",
])

export const VisualSlotKindSchema = z.enum([
  "text",
  "image-src",
  "image-alt",
  "href",
  "node",
  "collection",
])

export const VisualSlotContractSchema = z.object({
  name: z.string().min(1),
  kind: VisualSlotKindSchema,
  required: z.boolean(),
  defaultValue: z.string().optional(),
  sourceRefs: z.array(SourceRefSchema).min(1),
  itemShape: z.record(z.string(), z.enum(["text", "image-src", "image-alt", "href"])).optional(),
}).strict()

export const PatternRefSchema = z.object({
  name: z.string().min(1),
  instanceCount: z.number().int().nonnegative(),
}).strict()

export const InteractionContractSchema = z.object({
  name: z.string().min(1),
  trigger: z.string().min(1),
  effect: z.string().min(1),
}).strict()

export const BusinessContainerContractSchema = z.object({
  owner: z.literal("business-container"),
  dataModel: z.string().optional(),
  states: z.array(z.enum(["loading", "error", "empty", "ready"])).min(1),
  interactions: z.array(InteractionContractSchema),
  unknowns: z.array(z.string()),
}).strict()

export const VisualSurfaceContractSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: VisualSurfaceKindSchema,
  role: z.string().optional(),
  bounds: SurfaceBoundsSchema,
  sourceRefs: z.array(SourceRefSchema).min(1),
  view: FileContractSchema,
  slots: z.array(VisualSlotContractSchema),
  repeatedPatterns: z.array(PatternRefSchema),
  containerContract: BusinessContainerContractSchema,
}).strict()

export const ProjectScaffoldSchema = z.object({
  version: z.literal(2),
  tokensFile: FileContractSchema,
  sharedViews: z.array(FileContractSchema),
  surfaces: z.array(VisualSurfaceContractSchema),
  appFile: FileContractSchema,
  tokens: DesignTokenSystemSchema,
  catalog: ComponentCatalogSchema,
}).strict()

export type FileContract = z.infer<typeof FileContractSchema>
export type SourceRef = z.infer<typeof SourceRefSchema>
export type VisualSurfaceKind = z.infer<typeof VisualSurfaceKindSchema>
export type VisualSlotKind = z.infer<typeof VisualSlotKindSchema>
export type VisualSlotContract = z.infer<typeof VisualSlotContractSchema>
export type PatternRef = z.infer<typeof PatternRefSchema>
export type InteractionContract = z.infer<typeof InteractionContractSchema>
export type BusinessContainerContract = z.infer<typeof BusinessContainerContractSchema>
export type VisualSurfaceContract = z.infer<typeof VisualSurfaceContractSchema>
export type ProjectScaffold = z.infer<typeof ProjectScaffoldSchema>

// ─── Candidate and binding artifacts ────────────────────────────────────

export const VisualSurfaceCandidateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: VisualSurfaceKindSchema,
  role: z.string().optional(),
  bounds: SurfaceBoundsSchema,
  sourceRefs: z.array(SourceRefSchema).min(1),
  slotCandidates: z.array(VisualSlotContractSchema),
  repeatedPatterns: z.array(PatternRefSchema),
  evidence: z.array(z.string()),
}).strict()

export const VisualSurfaceCandidateSetSchema = z.object({
  version: z.literal(1),
  purpose: z.literal("semantic-visual-surface-candidates"),
  candidates: z.array(VisualSurfaceCandidateSchema),
}).strict()

export const VisualBindingSlotKindSchema = z.enum(["text", "image-src", "image-alt", "href"])

export const VisualBindingSlotSchema = z.object({
  name: z.string().min(1),
  kind: VisualBindingSlotKindSchema,
  defaultValue: z.string(),
  sourceName: z.string().optional(),
  sourcePath: z.string(),
}).strict()

export const VisualBindingComponentSchema = z.object({
  sourceExportName: z.string().min(1),
  viewExportName: z.string().min(1),
  filePath: z.string().min(1),
  slots: z.array(VisualBindingSlotSchema),
}).strict()

export const VisualBindingManifestSchema = z.object({
  version: z.literal(1),
  purpose: z.literal("visual-presentational-bindings"),
  components: z.array(VisualBindingComponentSchema),
}).strict()

export type VisualSurfaceCandidate = z.infer<typeof VisualSurfaceCandidateSchema>
export type VisualSurfaceCandidateSet = z.infer<typeof VisualSurfaceCandidateSetSchema>
export type VisualBindingSlotKind = z.infer<typeof VisualBindingSlotKindSchema>
export type VisualBindingSlot = z.infer<typeof VisualBindingSlotSchema>
export type VisualBindingComponent = z.infer<typeof VisualBindingComponentSchema>
export type VisualBindingManifest = z.infer<typeof VisualBindingManifestSchema>
