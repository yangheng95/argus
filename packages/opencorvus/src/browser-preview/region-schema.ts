import z from "zod"
import { BrowserPreviewViewportID } from "./viewport"

export const BrowserPreviewSourceReferenceArtifactID = z.enum(["reference.png", "web-clone-source/reference.png"])
export type BrowserPreviewSourceReferenceArtifactID = z.infer<typeof BrowserPreviewSourceReferenceArtifactID>

export const BrowserPreviewRegionBox = z
  .object({
    x: z.number().finite().nonnegative(),
    y: z.number().finite().nonnegative(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
  })
  .strict()
export type BrowserPreviewRegionBox = z.infer<typeof BrowserPreviewRegionBox>

export const BrowserPreviewRegionLocator = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("test-id"), value: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("data-oc-region"), value: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("role"), role: z.string().min(1), name: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("selector"), value: z.string().min(1), owner_file: z.string().min(1) }).strict(),
])
export type BrowserPreviewRegionLocator = z.infer<typeof BrowserPreviewRegionLocator>

export const BrowserPreviewRegionBinding = z
  .object({
    region_id: z.string().min(1),
    viewport_id: BrowserPreviewViewportID,
    state_id: z.string().min(1).default("default"),
    region_scope: z.enum(["page-section", "card", "content", "title", "chart", "table", "control", "navigation"]),
    source: z
      .object({
        reference_artifact_id: BrowserPreviewSourceReferenceArtifactID,
        bbox: BrowserPreviewRegionBox,
        semantic_role: z.string().min(1),
        text_anchors: z.array(z.string().min(1)).default([]),
        source_refs: z.array(z.string().min(1)).default([]),
      })
      .strict(),
    implementation: z
      .object({
        route: z.string().min(1).default("/"),
        locator: BrowserPreviewRegionLocator,
        component_files: z.array(z.string().min(1)).default([]),
      })
      .strict(),
    acceptance_refs: z.array(z.string().min(1)).default([]),
  })
  .strict()
export type BrowserPreviewRegionBinding = z.infer<typeof BrowserPreviewRegionBinding>
