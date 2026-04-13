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
