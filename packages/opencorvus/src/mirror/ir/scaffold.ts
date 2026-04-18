/**
 * Plan / generated-file contracts.
 *
 * `PlanFile` and `GeneratedFile` are the minimal boundary shapes that cross
 * between codegen-adjacent tools. `tier-graph` already operates on any
 * `PlanFile`-shaped object via its structural `TierPlanFile` interface.
 *
 * The richer `ProjectScaffold` / `ComponentCatalog` / `DesignTokenSystem`
 * types (produced by `url/pattern/*::analyzePage`) are intentionally NOT
 * declared here. Mirror imports them from `src/types.js` but never declares
 * them — mirror's tsc runs loose. We defer them to Phase F where the real
 * shapes can be derived from the `generateScaffold` implementation instead
 * of speculated.
 */

import z from "zod"

export const PlanFileContractsSchema = z.object({
  /** Named exports the file produces. */
  exports: z.array(z.string()),
  /** Verbatim TypeScript interface text, if any. */
  types: z.string().optional(),
  /** Import graph — map of import path → names consumed. */
  imports: z.record(z.string(), z.array(z.string())).optional(),
})

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
})

export const GeneratedFileSchema = z.object({
  file_path: z.string(),
  code: z.string(),
})

export type PlanFile = z.infer<typeof PlanFileSchema>
export type PlanFileContracts = z.infer<typeof PlanFileContractsSchema>
export type GeneratedFile = z.infer<typeof GeneratedFileSchema>

// ─── Design Token System (emitted by url/pattern/tokens) ─────────────────
//
// Mirror imports `DesignTokenSystem` / `TokenColor` / `TokenSpacing` /
// `TokenFont` from `../../types.js` but never declares them — mirror runs
// with loose tsc. We synthesise the shape from `extractTokenSystem`'s
// return statement (`pattern/tokens.ts`).

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
})

export const TokenSpacingSchema = z.object({
  px: z.number(),
  frequency: z.number(),
  tailwind: z.string().optional(),
})

export const TokenFontSchema = z.object({
  family: z.string(),
  weights: z.array(z.number()),
  sizes: z.array(z.number()),
  tailwind: z.string().optional(),
})

export const TokenRadiusSchema = z.object({
  px: z.number(),
  frequency: z.number(),
  tailwind: z.string().optional(),
})

export const TokenShadowSchema = z.object({
  value: z.string(),
  frequency: z.number(),
})

export const DesignTokenSystemSchema = z.object({
  colors: z.array(TokenColorSchema),
  spacing: z.array(TokenSpacingSchema),
  fonts: z.array(TokenFontSchema),
  radii: z.array(TokenRadiusSchema),
  shadows: z.array(TokenShadowSchema),
  customProperties: z.record(z.string(), z.string()),
})

export type TokenColor = z.infer<typeof TokenColorSchema>
export type TokenSpacing = z.infer<typeof TokenSpacingSchema>
export type TokenFont = z.infer<typeof TokenFontSchema>
export type TokenRadius = z.infer<typeof TokenRadiusSchema>
export type TokenShadow = z.infer<typeof TokenShadowSchema>
export type DesignTokenSystem = z.infer<typeof DesignTokenSystemSchema>

// ─── Component Catalog (emitted by url/pattern/detect) ───────────────────
//
// Shapes derived from `mirror/src/infra/pattern/detect.ts::detectPatterns`
// return statement plus `ComponentPattern` construction. Mirror imports
// these types from `types.ts` but never declares them.

export const InferredPropSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "image", "href"]),
  required: z.boolean(),
  samples: z.array(z.string()),
})

export const PatternInstanceSchema = z.object({
  elementIndex: z.number(),
  /** The raw ExtractedElement — kept `unknown` to avoid importing the recursive schema here. */
  element: z.unknown(),
  propValues: z.record(z.string(), z.string().optional()),
})

export const ComponentPatternSchema = z.object({
  name: z.string(),
  fingerprint: z.string(),
  instanceCount: z.number(),
  props: z.array(InferredPropSchema),
  instances: z.array(PatternInstanceSchema),
  /** The template ExtractedElement picked from the first cluster member. */
  templateElement: z.unknown(),
  structuralSimilarity: z.number(),
})

export const ComponentCatalogSchema = z.object({
  patterns: z.array(ComponentPatternSchema),
  totalElements: z.number(),
  coveredElements: z.number(),
})

export type InferredProp = z.infer<typeof InferredPropSchema>
export type PatternInstance = z.infer<typeof PatternInstanceSchema>
export type ComponentPattern = z.infer<typeof ComponentPatternSchema>
export type ComponentCatalog = z.infer<typeof ComponentCatalogSchema>

// ─── Project Scaffold (emitted by url/pattern/contract + analyzePage) ────
//
// Shapes derived from `mirror/src/infra/pattern/contract.ts::generateScaffold`
// and `buildSectionContract` return types. These never appear in mirror's
// types.ts — reconstructed from usage.

export const FileContractSchema = z.object({
  filePath: z.string(),
  exportName: z.string(),
  isDefaultExport: z.boolean(),
  propsInterface: z.string(),
  imports: z.record(z.string(), z.array(z.string())),
  patterns: z.array(z.string()),
  sectionIR: z.string().optional(),
})

export const SectionBoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
})

export const SectionContractSchema = z.object({
  name: z.string(),
  role: z.string().optional(),
  bounds: SectionBoundsSchema,
  file: FileContractSchema,
  subComponents: z.array(FileContractSchema),
  elementCount: z.number(),
})

export const ProjectScaffoldSchema = z.object({
  tokensFile: FileContractSchema,
  sharedComponents: z.array(FileContractSchema),
  sections: z.array(SectionContractSchema),
  appFile: FileContractSchema,
  tokens: DesignTokenSystemSchema,
  catalog: ComponentCatalogSchema,
})

export type FileContract = z.infer<typeof FileContractSchema>
export type SectionContract = z.infer<typeof SectionContractSchema>
export type ProjectScaffold = z.infer<typeof ProjectScaffoldSchema>
