import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { Project } from "@/project/project"

// Map MIME types to the canonical file extension used when we lay attachments
// down inside a project's .opencorvus/attachments directory. The list only
// covers MIME types that a provider might send back as multimodal content.
// Anything not in this table falls back to the filename's own extension, and
// only if that is also missing do we store a raw ".bin" (explicit enough that
// a human or tool can still inspect the file).
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
  "application/json": "json",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/webm": "weba",
  "audio/ogg": "oga",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
}

function extensionFor(mime: string, filename?: string): string {
  if (filename) {
    const raw = path.extname(filename).replace(/^\./, "").toLowerCase()
    if (raw) return raw
  }
  const key = (mime || "").toLowerCase()
  return MIME_EXT[key] ?? "bin"
}

function storageDir(projectDir: string): string {
  return path.join(projectDir, ".opencorvus", "attachments")
}

export namespace AttachmentStore {
  export const ROUTE_PREFIX = "/attachment"

  export type Reference = {
    sha: string
    url: string
    mime: string
    size: number
    filename?: string
    /** Semantic role for downstream evaluator gates. See TaskAttachment.intent. */
    intent?: string
    /** Provenance of the attachment (user-upload / figma / url-screenshot / …). */
    source?: string
  }

  /**
   * Persist an attachment under `<projectDir>/.opencorvus/attachments/<sha>.<ext>`.
   * Content-addressed: identical payloads deduplicate to the same file. Returns
   * a reference carrying the HTTP URL that AttachmentRoutes serves.
   */
  export async function write(
    projectID: string,
    projectDir: string,
    data: Buffer,
    mime: string,
    filename?: string,
  ): Promise<Reference> {
    if (!mime) throw new Error("AttachmentStore.write requires a non-empty mime type")
    const sha = crypto.createHash("sha256").update(data).digest("hex")
    const ext = extensionFor(mime, filename)
    const name = `${sha}.${ext}`
    const dir = storageDir(projectDir)
    await fs.mkdir(dir, { recursive: true })
    const abs = path.join(dir, name)
    const existing = await fs.stat(abs).catch(() => null)
    if (!existing) {
      await fs.writeFile(abs, data)
    }
    return {
      sha,
      url: `${ROUTE_PREFIX}/${projectID}/${name}`,
      mime,
      size: data.byteLength,
      filename,
    }
  }

  /** Resolve a stored filename back to its absolute path for the given project. */
  export function resolveAbsolute(projectID: string, name: string): string | undefined {
    const project = Project.get(projectID)
    if (!project) return undefined
    const dir = storageDir(project.worktree)
    const abs = path.normalize(path.join(dir, name))
    if (!abs.startsWith(path.normalize(dir))) return undefined
    return abs
  }

  /** Read an attachment's raw bytes for LLM multimodal delivery. */
  export async function read(projectID: string, name: string): Promise<Buffer> {
    const abs = resolveAbsolute(projectID, name)
    if (!abs) throw new Error(`attachment ${projectID}/${name} is not resolvable`)
    return await fs.readFile(abs)
  }

  /**
   * Whether a MIME type can be sent as an LLM multimodal file part.
   *
   * AI SDK provider wrappers (notably the openai-compatible one used by Kimi /
   * Alibaba models) only accept image, audio, video, and PDF as inline `file`
   * parts; text/* and application/json are silently rejected by the upstream
   * API and surface as "No output generated" errors. Callers must route
   * non-multimodal attachments through their URL/filename in the prompt and
   * let the agent fetch them via the read tool.
   *
   * Image MIME family is intentionally permissive: modern vision-capable
   * models (Claude Sonnet/Opus 4.6, GPT-4o, Gemini) accept HEIC/HEIF/AVIF/WEBP
   * in addition to the legacy PNG/JPEG. Restricting to a hardcoded list would
   * silently strip mobile-camera uploads.
   */
  export function isMultimodalSupported(mime: string): boolean {
    if (!mime) return false
    const m = mime.toLowerCase()
    if (m === "application/pdf") return true
    return m.startsWith("image/") || m.startsWith("audio/") || m.startsWith("video/")
  }

  // ── LLM-side packaging ─────────────────────────────────────────────────
  // Producer-agent code (orchestrator / requirements / design-analyst /
  // delivery) historically had three near-identical copies of the
  // "split attachments by mime, inline the multimodal ones, list the
  // text/* ones by URL" routine. The duplication kept drifting (e.g. one
  // copy filtered `image/*` only, dropping PDF — see C3 audit). The
  // helpers below are the single source of truth so any future tweak
  // applies uniformly.

  type AttachmentLike = {
    sha?: string
    url?: string
    mime?: string
    size?: number
    filename?: string
  }

  type FilePart = {
    type: "file"
    data: Buffer
    mediaType: string
    filename?: string
  }

  /**
   * Bucket attachments into:
   *   • `multimodal` — provider-supported MIMEs the agent can inline as
   *     AI-SDK file parts (image / audio / video / pdf).
   *   • `referenceOnly` — text/* / json / etc. The agent must read these
   *     via the read tool using the canonical /attachment/<projectID>/<sha>.<ext>
   *     URL (or the attachment:<sha>.<ext> shorthand), since openai-compatible
   *     providers reject non-multimodal MIMEs as inline file parts.
   */
  export function partition<T extends AttachmentLike>(attachments: readonly T[] | undefined): {
    multimodal: T[]
    referenceOnly: T[]
  } {
    if (!attachments?.length) return { multimodal: [], referenceOnly: [] }
    const multimodal: T[] = []
    const referenceOnly: T[] = []
    for (const a of attachments) {
      if (isMultimodalSupported(typeof a.mime === "string" ? a.mime : "")) multimodal.push(a)
      else referenceOnly.push(a)
    }
    return { multimodal, referenceOnly }
  }

  /**
   * Render the URL-only attachment list as a markdown section appended to
   * the agent's user message. Returns "" when nothing to surface so the
   * caller can `text + section` unconditionally.
   */
  export function renderReferenceList(referenceOnly: readonly AttachmentLike[]): string {
    if (referenceOnly.length === 0) return ""
    const lines = referenceOnly.map((a) => {
      const sizeKb = typeof a.size === "number" ? `${Math.max(1, Math.round(a.size / 1024))} KB, ` : ""
      const name = a.filename ?? a.sha ?? "(unnamed)"
      const mime = a.mime ?? "application/octet-stream"
      return `- ${name} — ${mime} — ${sizeKb}url: ${a.url}`
    }).join("\n")
    return `\n\n## Task Attachments (read via the \`read\` tool when you need their content)\n${lines}`
  }

  /**
   * Read the bytes for each multimodal attachment and return AI-SDK FilePart
   * objects ready to splice into the user message content array. Throws if
   * any URL is unresolvable — partial attachment delivery would silently
   * mislead the agent (it would believe it saw all references).
   */
  export async function loadFileParts(multimodal: readonly AttachmentLike[]): Promise<FilePart[]> {
    if (multimodal.length === 0) return []
    return Promise.all(multimodal.map(async (a) => {
      const located = nameFromUrl(String(a.url ?? ""))
      if (!located) throw new Error(`attachment has no resolvable url: ${a.filename ?? a.sha}`)
      const bytes = await read(located.projectID, located.name)
      return {
        type: "file" as const,
        data: bytes,
        mediaType: String(a.mime),
        ...(a.filename ? { filename: a.filename } : {}),
      }
    }))
  }

  /** Extract the stored filename (`<sha>.<ext>`) from a reference URL. */
  export function nameFromUrl(url: string): { projectID: string; name: string } | undefined {
    const prefix = `${ROUTE_PREFIX}/`
    if (!url.startsWith(prefix)) return undefined
    const rest = url.slice(prefix.length)
    const slash = rest.indexOf("/")
    if (slash <= 0) return undefined
    const projectID = rest.slice(0, slash)
    const name = rest.slice(slash + 1)
    if (!projectID || !name || name.includes("/") || name.includes("\\")) return undefined
    return { projectID, name }
  }
}
