import { createHash } from "node:crypto"
import { z } from "zod"
import { EngineArtifactTable } from "@/engine/engine.sql"
import { Identifier } from "@/id/id"
import { Database } from "@/storage/db"

export const DesignResourceKindSchema = z.enum([
  "image",
  "pdf",
  "html",
  "css",
  "json",
  "markdown",
  "figma_context",
  "figma_screenshot",
  "figma_metadata",
  "figma_variables",
  "webpage_capture",
  "browser_preview_evidence",
])
export type DesignResourceKind = z.infer<typeof DesignResourceKindSchema>

export const DesignResourceIntentSchema = z.enum([
  "visual_reference",
  "design_source",
  "interaction_reference",
  "design_tokens",
  "implementation_reference",
  "verification_evidence",
])
export type DesignResourceIntent = z.infer<typeof DesignResourceIntentSchema>

export const DesignResourceOriginSchema = z.enum([
  "attachment",
  "material",
  "figma_mcp",
  "url_screenshot",
  "webpage_evidence",
  "browser_preview",
])
export type DesignResourceOrigin = z.infer<typeof DesignResourceOriginSchema>

export const DesignResourceEntrySchema = z
  .object({
    id: z.string().min(1),
    kind: DesignResourceKindSchema,
    intent: DesignResourceIntentSchema,
    origin: DesignResourceOriginSchema,
    mime: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    canonical_ref: z.string().min(1),
    size: z.number().int().nonnegative(),
    materializer: z.string().min(1),
    related_entries: z.array(z.string().min(1)).default([]),
    artifact_paths: z.array(z.string().min(1)).default([]),
    viewport: z.string().min(1).optional(),
    region: z.string().min(1).optional(),
    created_at: z.number().int().nonnegative(),
  })
  .strict()
export type DesignResourceEntry = z.infer<typeof DesignResourceEntrySchema>

export const DesignResourceManifestSchema = z
  .object({
    version: z.literal(1),
    task_id: z.string().min(1),
    created_at: z.number().int().nonnegative(),
    entries: z.array(DesignResourceEntrySchema).min(1),
  })
  .strict()
export type DesignResourceManifest = z.infer<typeof DesignResourceManifestSchema>

export type DesignResourceFileRef = {
  sha: string
  url: string
  mime: string
  size: number
  filename?: string
  intent?: string
  source?: string
}

const FRONTEND_DESIGN_MATERIAL_MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  log: "text/plain",
  json: "application/json",
  jsonc: "application/json",
  yaml: "text/yaml",
  yml: "text/yaml",
  css: "text/css",
  scss: "text/css",
  less: "text/css",
  html: "text/html",
  htm: "text/html",
}

export function frontendDesignMaterialMime(filename: string): string {
  const ext = (filename.split(".").pop() || "").toLowerCase()
  const mime = FRONTEND_DESIGN_MATERIAL_MIME_BY_EXTENSION[ext]
  if (!mime) {
    throw new Error(
      `unsupported frontend_design material extension '${ext ? `.${ext}` : "(none)"}' for ${filename}. ` +
        `Supported design material types: ${Object.keys(FRONTEND_DESIGN_MATERIAL_MIME_BY_EXTENSION)
          .sort()
          .map((item) => `.${item}`)
          .join(", ")}.`,
    )
  }
  return mime
}

function resourceID(input: DesignResourceFileRef, index: number): string {
  const source = input.source?.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase() || "attachment"
  return `design-resource-${source}-${input.sha.slice(0, 12)}-${index + 1}`
}

function manifestSha(input: DesignResourceFileRef): string {
  const sha = input.sha.trim().toLowerCase()
  if (/^[a-f0-9]{64}$/i.test(sha)) return sha
  return createHash("sha256").update(`${input.url}\0${input.filename ?? ""}\0${input.mime}\0${input.size}`).digest("hex")
}

function inferOrigin(input: DesignResourceFileRef): DesignResourceOrigin {
  if (input.source === "figma-mcp") return "figma_mcp"
  if (input.source === "material") return "material"
  if (input.source === "url-screenshot") return "url_screenshot"
  if (input.source === "browser-preview") return "browser_preview"
  if (!input.source || input.source === "user" || input.source === "user-upload" || input.source === "figma") {
    return "attachment"
  }
  throw new Error(`unsupported design resource source '${input.source}' for ${input.filename ?? input.url}`)
}

function inferIntent(input: DesignResourceFileRef, kind: DesignResourceKind): DesignResourceIntent {
  if (kind === "figma_variables" || kind === "css" || kind === "json") return "design_tokens"
  if (kind === "browser_preview_evidence") return "verification_evidence"
  if (input.intent === "visual_reference") return "visual_reference"
  if (input.intent === "design_reference") return "design_source"
  if (input.intent === "browser_preview_evidence") return "verification_evidence"
  if (input.intent) {
    throw new Error(`unsupported design resource intent '${input.intent}' for ${input.filename ?? input.url}`)
  }
  return "design_source"
}

function inferFigmaKind(input: DesignResourceFileRef): DesignResourceKind | undefined {
  if (input.source !== "figma-mcp") return undefined
  if (input.mime.startsWith("image/")) return "figma_screenshot"
  const filename = (input.filename ?? "").toLowerCase()
  if (filename.includes("variable-defs")) return "figma_variables"
  if (filename.includes("metadata")) return "figma_metadata"
  if (filename.includes("design-context")) return "figma_context"
  return "figma_context"
}

export function inferDesignResourceKind(input: DesignResourceFileRef): DesignResourceKind {
  const figmaKind = inferFigmaKind(input)
  if (figmaKind) return figmaKind
  if (input.source === "url-screenshot") return "webpage_capture"
  if (input.source === "browser-preview") return "browser_preview_evidence"
  if (input.mime.startsWith("image/")) return "image"
  if (input.mime === "application/pdf") return "pdf"
  if (input.mime === "text/html") return "html"
  if (input.mime === "text/css") return "css"
  if (input.mime === "application/json") return "json"
  if (input.mime === "text/markdown") return "markdown"
  if (input.mime === "text/plain" || input.mime === "text/yaml") return "markdown"
  throw new Error(
    `unsupported design resource mime '${input.mime}' for ${input.filename ?? input.url}. ` +
      "Materialize it through an explicit design-resource provider before calling frontend_design.",
  )
}

export function createDesignResourceManifest(input: {
  taskID: string
  resources: readonly DesignResourceFileRef[]
  webpageEvidenceArtifacts?: readonly string[]
  now?: number
}): DesignResourceManifest {
  const createdAt = input.now ?? Date.now()
  const entries = input.resources.map((resource, index): DesignResourceEntry => {
    const kind = inferDesignResourceKind(resource)
    return {
      id: resourceID(resource, index),
      kind,
      intent: inferIntent(resource, kind),
      origin: inferOrigin(resource),
      mime: resource.mime,
      sha256: manifestSha(resource),
      canonical_ref: resource.url,
      size: resource.size,
      materializer: resource.source ?? "task-attachment",
      related_entries: [],
      artifact_paths: input.webpageEvidenceArtifacts ? Array.from(new Set(input.webpageEvidenceArtifacts)) : [],
      created_at: createdAt,
      ...(resource.filename ? { region: resource.filename } : {}),
    }
  })
  return DesignResourceManifestSchema.parse({
    version: 1,
    task_id: input.taskID,
    created_at: createdAt,
    entries,
  })
}

function fileRefSource(origin: DesignResourceOrigin): string {
  if (origin === "figma_mcp") return "figma-mcp"
  if (origin === "url_screenshot") return "url-screenshot"
  if (origin === "browser_preview") return "browser-preview"
  if (origin === "material") return "material"
  if (origin === "webpage_evidence") return "webpage-evidence"
  return "design-resource-manifest"
}

function fileRefIntent(intent: DesignResourceIntent): string {
  if (intent === "design_source") return "design_reference"
  if (intent === "verification_evidence") return "browser_preview_evidence"
  return intent
}

export function designResourceManifestFileRefs(manifest: DesignResourceManifest): DesignResourceFileRef[] {
  return manifest.entries.map((entry) => ({
    sha: entry.sha256,
    url: entry.canonical_ref,
    mime: entry.mime,
    size: entry.size,
    ...(entry.region ? { filename: entry.region } : {}),
    intent: fileRefIntent(entry.intent),
    source: fileRefSource(entry.origin),
  }))
}

export function recordDesignResourceManifest(input: {
  taskID: string
  manifest: DesignResourceManifest
  now?: number
}): string {
  const now = input.now ?? Date.now()
  const id = Identifier.ascending("artifact")
  Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id,
        task_id: input.taskID,
        run_id: null,
        goal_run_id: null,
        kind: "design_resource_manifest",
        label: "frontend_design-resource-manifest",
        payload: input.manifest as unknown as Record<string, unknown>,
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
  return id
}
