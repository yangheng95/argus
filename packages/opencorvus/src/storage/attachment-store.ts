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
   * Persist an attachment under `<project.worktree>/.opencorvus/attachments/<sha>.<ext>`.
   * Content-addressed: identical payloads deduplicate to the same file. Returns
   * a reference carrying the HTTP URL that AttachmentRoutes serves.
   *
   * The storage directory is derived from `Project.get(projectID).worktree` —
   * this is the SOLE source of truth for attachment locations. Callers must
   * not pass a directory; doing so previously created a double-source bug
   * where writers used `Instance.directory` (cwd-prone) while readers used
   * `project.worktree`, leaving registered-but-missing files when the two
   * diverged.
   */
  export async function write(
    projectID: string,
    data: Buffer,
    mime: string,
    filename?: string,
  ): Promise<Reference> {
    if (!mime) throw new Error("AttachmentStore.write requires a non-empty mime type")
    const project = Project.get(projectID)
    if (!project) throw new Error(`AttachmentStore.write: unknown project ${projectID}`)
    const sha = crypto.createHash("sha256").update(data).digest("hex")
    const ext = extensionFor(mime, filename)
    const name = `${sha}.${ext}`
    const dir = storageDir(project.worktree)
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

  /** Shape of an inline user-message file part — matches `PromptInput.parts`
   *  / `RunAgentSessionInput.buildUserParts` so it can be spliced directly
   *  into the user message without further translation. */
  export type InlineFilePart = {
    type: "file"
    url: string
    mime: string
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
   * Read the bytes for each multimodal-supported attachment and return user-message
   * `type:"file"` parts (data-URL form) ready to splice directly into a
   * `PromptInput.parts` / `RunAgentSessionInput.buildUserParts` array.
   *
   * Single source of truth (rule 22): every producer-agent (orchestrator /
   * design-analyst / requirements / delivery) used to roll its own
   * partition+read+base64 pipeline AND mis-decoded the prior `loadFileParts`
   * result shape (`"image" in fp` / `"file" in fp` checks that never matched
   * the actual return value), silently dropping every multimodal attachment
   * — the LLM was hallucinating from prompt text alone. This helper is the
   * single conversion path; callers must not re-wrap its output.
   *
   * Skips non-multimodal MIMEs (those go through `renderReferenceList`).
   * Throws if any URL is unresolvable — partial attachment delivery would
   * mislead the agent (it would believe it saw all references).
   */
  export async function inlineFileParts(
    attachments: readonly AttachmentLike[] | undefined,
  ): Promise<InlineFilePart[]> {
    const { multimodal } = partition(attachments)
    if (multimodal.length === 0) return []
    return Promise.all(multimodal.map(async (a) => {
      const located = nameFromUrl(String(a.url ?? ""))
      if (!located) throw new Error(`attachment has no resolvable url: ${a.filename ?? a.sha}`)
      const bytes = await read(located.projectID, located.name)
      const mime = String(a.mime)
      return {
        type: "file" as const,
        url: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`,
        mime,
        ...(a.filename ? { filename: a.filename } : {}),
      }
    }))
  }

  /** A staged attachment — the result of copying a content-addressed task
   *  attachment into a build worktree's `references/` subdirectory so the
   *  build agent sees a worktree-LOCAL relative path it can pass to tools
   *  whose sandbox checks reject paths escaping the worktree (rule 1: the
   *  sandbox refuses every path outside the worktree; the staging step is
   *  what gives the agent a path inside it). */
  export interface StagedAttachment {
    /** Path relative to the worktree (e.g. `references/screenshot.png`). */
    relPath: string
    /** Absolute path inside the worktree. */
    absPath: string
    /** MIME type carried over from the source reference. */
    mime: string
    /** Original filename (when present), preserved verbatim before staging. */
    originalFilename?: string
  }

  /** Subdirectory under each build worktree where staged user-contract
   *  attachments live. Single source — all callers (build agent, skill
   *  text, image-generate prompt) reference this constant. */
  export const STAGED_REFERENCES_SUBDIR = "references"

  /**
   * Copy each multimodal task attachment into `<worktreeDir>/references/<file>`
   * so the build agent can pass worktree-LOCAL relative paths to sandboxed
   * tools (e.g. `webpage_image_extract` rejects any path outside the worktree
   * via `loadImage`'s sandbox check).
   *
   * Why copy not symlink: cross-FS robustness on Windows (symlinks need admin
   * by default) and content-addressed inputs are small enough that a copy
   * costs nothing. Existing files at the destination are skipped silently —
   * staging is idempotent and re-entrant across goal retries.
   *
   * Filename policy: prefer the attachment's original `filename` when it's
   * shell-safe (ASCII alphanumerics + `._-` + spaces preserved as-is — we
   * only ban shell metacharacters and path separators). Otherwise fall back
   * to `attachment-<index>-<sha-prefix>.<ext>` so the LLM still gets a stable
   * reference. CJK filenames pass through (filesystem accepts them; the
   * sandbox check looks at path containment, not character set).
   *
   * Returns the staged metadata in the same order as `attachments`. Empty
   * input returns `[]` without creating the `references/` directory.
   */
  export async function stageToWorktree(
    projectID: string,
    attachments: readonly AttachmentLike[] | undefined,
    worktreeDir: string,
  ): Promise<StagedAttachment[]> {
    const { multimodal } = partition(attachments)
    if (multimodal.length === 0) return []

    const refsDir = path.join(worktreeDir, STAGED_REFERENCES_SUBDIR)
    await fs.mkdir(refsDir, { recursive: true })

    const staged: StagedAttachment[] = []
    for (let i = 0; i < multimodal.length; i++) {
      const a = multimodal[i]
      const located = nameFromUrl(String(a.url ?? ""))
      if (!located) {
        throw new Error(
          `AttachmentStore.stageToWorktree: attachment ${a.filename ?? a.sha ?? `#${i}`} has no resolvable url`,
        )
      }
      const sourceAbs = resolveAbsolute(located.projectID, located.name)
      if (!sourceAbs) {
        throw new Error(
          `AttachmentStore.stageToWorktree: attachment ${located.projectID}/${located.name} not resolvable on disk`,
        )
      }

      const filename = chooseStagedFilename({
        original: a.filename,
        mime: typeof a.mime === "string" ? a.mime : "",
        sha: a.sha,
        index: i,
      })
      const destAbs = path.join(refsDir, filename)

      // Idempotent — skip when destination already exists. Content-addressed
      // sources mean re-running staging on a re-entered worktree (goal retry)
      // is a no-op.
      const existing = await fs.stat(destAbs).catch(() => null)
      if (!existing) {
        await fs.copyFile(sourceAbs, destAbs)
      }

      staged.push({
        relPath: `${STAGED_REFERENCES_SUBDIR}/${filename}`,
        absPath: destAbs,
        mime: typeof a.mime === "string" ? a.mime : "application/octet-stream",
        originalFilename: a.filename,
      })
    }
    return staged
  }

  /** Render a markdown bullet list of staged attachment paths for the
   *  build agent's user message — appended alongside / instead of the URL
   *  reference list when staging happened. */
  export function renderStagedList(staged: readonly StagedAttachment[]): string {
    if (staged.length === 0) return ""
    const lines = staged
      .map((s) => `- \`${s.relPath}\` — ${s.mime}` + (s.originalFilename ? ` (originally \`${s.originalFilename}\`)` : ""))
      .join("\n")
    return (
      `\n\n## Staged Reference Files (already inside this worktree)\n` +
      `These files were copied here so you can pass them to tools that reject paths outside the worktree.\n` +
      `Use the relative paths verbatim — do NOT \`cp\` them again to other locations.\n${lines}`
    )
  }

  // ASCII-printable + space; reject shell metacharacters and path separators.
  const SAFE_FILENAME_RE = /^[A-Za-z0-9._\-一-鿿 ]+$/
  function chooseStagedFilename(input: {
    original?: string
    mime: string
    sha?: string
    index: number
  }): string {
    if (input.original && SAFE_FILENAME_RE.test(input.original)) return input.original
    const ext = extensionFor(input.mime, input.original)
    const shaPrefix = (input.sha ?? "").slice(0, 8) || "noref"
    return `attachment-${input.index + 1}-${shaPrefix}.${ext}`
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
