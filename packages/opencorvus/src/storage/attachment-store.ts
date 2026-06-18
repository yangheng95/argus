import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { Project } from "@/project/project"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { Database } from "@/storage/db"
import { PartTable } from "@/session/session.sql"
import { EngineTaskTable } from "@/engine/engine.sql"
import { Log } from "@/util/log"

// Map MIME types to the canonical file extension used when we lay attachments
// down inside a project's .opencorvus/r attachment blob store. The list only
// covers MIME types that a provider might send back as multimodal content.
// Anything not in this table uses the filename's own extension, and
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

// Reverse of MIME_EXT — built once at module load so writeFromPath can infer
// MIME from a tool-produced PNG path without callers spelling out the MIME
// string at every call site. Unknown extensions throw at write time (rule 1:
// no silent application/octet-stream fallback for content the LLM is meant
// to look at).
const EXT_TO_MIME: Record<string, string> = (() => {
  const out: Record<string, string> = {}
  for (const [mime, ext] of Object.entries(MIME_EXT)) {
    // First-write wins so canonical jpg → image/jpeg (not the duplicate
    // jpg-only entry, if one were added later).
    if (!(ext in out)) out[ext] = mime
  }
  return out
})()

function mimeFromPath(absPath: string): string {
  const ext = path.extname(absPath).replace(/^\./, "").toLowerCase()
  const mime = EXT_TO_MIME[ext]
  if (!mime) {
    throw new Error(
      `AttachmentStore.writeFromPath: unsupported extension '.${ext}' at ${absPath} — pass an explicit mime`,
    )
  }
  return mime
}

function storageDir(projectDir: string): string {
  return ProjectRuntimePaths.attachmentBlobRoot(projectDir)
}

const log = Log.create({ service: "attachment-store" })

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
   * Persist an attachment under `<project.worktree>/.opencorvus/r/b/a/<sha>.<ext>`.
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
  export async function write(projectID: string, data: Buffer, mime: string, filename?: string): Promise<Reference> {
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

  /**
   * Convenience: read a file from absolute path and persist into the
   * content-addressed store. Single source for tool producers (acceptance
   * screenshot/verify, future MCP image migration) so callers never roll
   * their own readFile + base64 + data-URL pipeline (which was the OOM
   * driver — see specs/acceptance-attachment-store-single-source-2026-05-11.md).
   */
  export async function writeFromPath(
    projectID: string,
    absPath: string,
    mime?: string,
    filename?: string,
  ): Promise<Reference> {
    const bytes = await fs.readFile(absPath)
    const resolvedMime = mime ?? mimeFromPath(absPath)
    const resolvedFilename = filename ?? path.basename(absPath)
    return await write(projectID, bytes, resolvedMime, resolvedFilename)
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

  /** Read an attachment's raw bytes for LLM multimodal acceptance. */
  export async function read(projectID: string, name: string): Promise<Buffer> {
    const abs = resolveAbsolute(projectID, name)
    if (!abs) throw new Error(`attachment ${projectID}/${name} is not resolvable`)
    return await fs.readFile(abs)
  }

  /** Convert a canonical `/attachment/<projectID>/<sha>.<ext>` reference into an AI-SDK data URL. */
  export async function dataUrlFromReference(url: string, mime: string): Promise<string | undefined> {
    const located = nameFromUrl(url)
    if (!located) return undefined
    const bytes = await read(located.projectID, located.name)
    return `data:${mime};base64,${bytes.toString("base64")}`
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
  // Producer-agent code (orchestrator / requirements / frontend-design /
  // acceptance) historically had three near-identical copies of the
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
  export function partition<T extends AttachmentLike>(
    attachments: readonly T[] | undefined,
  ): {
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

  // Note: the previous helper `renderReferenceList(referenceOnly)` listed only
  // the non-multimodal subset. It conflated "I don't have a `read` tool"
  // (orchestrator) with "I do have one" (sub-agents) into a single string and
  // — worse — left multimodal attachments completely absent from the prompt
  // text, so models silently ignored uploaded screenshots. Replaced by
  // `renderAttachmentInventory` below which surfaces every attachment with an
  // explicit per-item kind tag.

  /**
   * Render an explicit textual inventory of EVERY task attachment — both the
   * multimodal ones already inlined as file parts in the user message AND the
   * reference-only ones the agent must fetch via the `read` tool.
   *
   * Why list multimodals in text too: image / pdf bytes ARE in the LLM's
   * context window once `inlineFileParts` splices them as file parts, but
   * without an accompanying textual mention the model frequently fails to
   * acknowledge their existence (observed in benchmark: orchestrator
   * dispatched architect / requirements without ever citing the user-uploaded
   * screenshot, sub-agents then hallucinated layouts from the request prose
   * alone). The text inventory anchors the file parts in the prompt's
   * narrative so the model knows it has them and reasons about them
   * explicitly.
   *
   * Returns "" when nothing to surface so the caller can `text + section`
   * unconditionally. Section header / hint string is configurable so the
   * orchestrator can swap the default "you can read these" wording for its
   * own "forwarded to sub-agents — cite by filename in your dispatch".
   */
  export function renderAttachmentInventory(
    attachments: readonly AttachmentLike[] | undefined,
    opts: {
      header?: string
      hint?: string
    } = {},
  ): string {
    if (!attachments?.length) return ""
    const { multimodal, referenceOnly } = partition(attachments)
    const header = opts.header ?? "## Task Attachments"
    const hint =
      opts.hint ??
      "Multimodal attachments (image / pdf / audio / video) are already in your context as file parts. " +
        "Reference-only attachments (text / json) are not inlined — fetch them via the `read` tool using the listed url."
    const formatRow = (a: AttachmentLike, kind: "inline" | "reference", index: number) => {
      const sizeKb = typeof a.size === "number" ? `${Math.max(1, Math.round(a.size / 1024))} KB, ` : ""
      // displayFilename gives a generated readable name when the upload path
      // omitted the original filename — never let a 64-char sha surface
      // as the user-visible name for the attachment.
      const name = displayFilename({ filename: a.filename, mime: a.mime, sha: a.sha, index })
      const mime = a.mime ?? "application/octet-stream"
      const tag = kind === "inline" ? "[inlined as file part]" : "[reference — read via tool]"
      return `- ${name} — ${mime} — ${sizeKb}${tag} url: ${a.url}`
    }
    const lines = [
      ...multimodal.map((a, i) => formatRow(a, "inline", i)),
      ...referenceOnly.map((a, i) => formatRow(a, "reference", multimodal.length + i)),
    ].join("\n")
    return `\n\n${header}\n${hint}\n\n${lines}`
  }

  /** Subset of `Provider.Model.capabilities` needed for vision gating.
   *  Kept structural (not a hard import) so this storage module doesn't
   *  cycle through the provider layer. The fields match the Provider.Model
   *  zod schema 1:1; if the schema grows new input modalities, extend here. */
  export interface InputCapabilities {
    input: {
      text?: boolean
      audio: boolean
      image: boolean
      video: boolean
      pdf: boolean
    }
  }

  function mimeAcceptedByCapabilities(mime: string, caps: InputCapabilities): boolean {
    const m = (mime || "").toLowerCase()
    if (m.startsWith("image/")) return caps.input.image
    if (m === "application/pdf") return caps.input.pdf
    if (m.startsWith("audio/")) return caps.input.audio
    if (m.startsWith("video/")) return caps.input.video
    return false
  }

  /**
   * Read the bytes for each multimodal-supported attachment and return user-message
   * `type:"file"` parts (data-URL form) ready to splice directly into a
   * `PromptInput.parts` / `RunAgentSessionInput.buildUserParts` array.
   *
   * Single source of truth (rule 22): every producer-agent (orchestrator /
   * frontend-design / requirements / acceptance) used to roll its own
   * partition+read+base64 pipeline AND mis-decoded the prior `loadFileParts`
   * result shape (`"image" in fp` / `"file" in fp` checks that never matched
   * the actual return value), silently dropping every multimodal attachment
   * — the LLM was hallucinating from prompt text alone. This helper is the
   * single conversion path; callers must not re-wrap its output.
   *
   * Skips non-multimodal MIMEs (those surface as `[reference]` rows in
   * `renderAttachmentInventory`).
   * When `opts.capabilities` is supplied, additionally filters out
   * multimodal MIMEs that the resolved model cannot accept on input
   * (e.g. text-only coding endpoints like dashscope coding). Without this
   * gate, the openai-compatible provider wrapper would forward the file
   * part to the upstream API which silently strips it, leaving the
   * orchestrator to confabulate visual context it never saw. The skip is
   * logged with `agent` + `mime` + `filename` so operators can see when an
   * attachment is being dropped due to model incapability.
   * Throws if any URL is unresolvable — partial attachment acceptance would
   * mislead the agent (it would believe it saw all references).
   */
  export async function inlineFileParts(
    attachments: readonly AttachmentLike[] | undefined,
    opts?: { capabilities?: InputCapabilities; agent?: string },
  ): Promise<InlineFilePart[]> {
    const { multimodal } = partition(attachments)
    if (multimodal.length === 0) return []
    const caps = opts?.capabilities
    const accepted = caps
      ? multimodal.filter((a) => {
          const ok = mimeAcceptedByCapabilities(String(a.mime ?? ""), caps)
          if (!ok) {
            log.warn("skipping multimodal attachment — model lacks input capability", {
              agent: opts?.agent,
              mime: a.mime,
              filename: a.filename,
              sha: a.sha,
            })
          }
          return ok
        })
      : multimodal
    return Promise.all(
      accepted.map(async (a) => {
        const located = nameFromUrl(String(a.url ?? ""))
        if (!located) throw new Error(`attachment has no resolvable url: ${a.filename ?? a.sha}`)
        const mime = String(a.mime)
        const url = await dataUrlFromReference(String(a.url ?? ""), mime)
        if (!url) throw new Error(`attachment has no resolvable url: ${a.filename ?? a.sha}`)
        return {
          type: "file" as const,
          url,
          mime,
          ...(a.filename ? { filename: a.filename } : {}),
        }
      }),
    )
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
   *  attachments live. Single source for build-reference staging. */
  export const STAGED_REFERENCES_SUBDIR = "references"

  /**
   * Copy each multimodal task attachment into `<worktreeDir>/references/<file>`
   * so the build agent can pass worktree-LOCAL relative paths to sandboxed
   * tools that require worktree-local paths.
   *
   * Why copy not symlink: cross-FS robustness on Windows (symlinks need admin
   * by default) and content-addressed inputs are small enough that a copy
   * costs nothing. Existing files at the destination are skipped silently —
   * staging is idempotent and re-entrant across goal retries.
   *
   * Filename policy: prefer the attachment's original `filename` when it's
   * shell-safe (ASCII alphanumerics + `._-` + spaces preserved as-is — we
   * only ban shell metacharacters and path separators). Otherwise use
   * `attachment-<index>-<sha-prefix>.<ext>` so the LLM still gets a stable
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
      if (located.projectID !== projectID) {
        throw new Error(
          `AttachmentStore.stageToWorktree: attachment ${a.filename ?? a.sha ?? `#${i}`} belongs to project ${located.projectID}, expected ${projectID}`,
        )
      }
      const sourceAbs = resolveAbsolute(located.projectID, located.name)
      if (!sourceAbs) {
        throw new Error(
          `AttachmentStore.stageToWorktree: attachment ${located.projectID}/${located.name} not resolvable on disk`,
        )
      }

      const filename = displayFilename({
        filename: a.filename,
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
      .map(
        (s) => `- \`${s.relPath}\` — ${s.mime}` + (s.originalFilename ? ` (originally \`${s.originalFilename}\`)` : ""),
      )
      .join("\n")
    return (
      `\n\n## Staged Reference Files (already inside this worktree)\n` +
      `These files were copied here so you can pass them to tools that reject paths outside the worktree.\n` +
      `Use the relative paths verbatim — do NOT \`cp\` them again to other locations.\n${lines}`
    )
  }

  // ASCII-printable + space; reject shell metacharacters and path separators.
  const SAFE_FILENAME_RE = /^[A-Za-z0-9._\-一-鿿 ]+$/

  /**
   * Single source of truth for "what name should the LLM / user see for
   * this attachment?" (CLAUDE.md rule 9). Use this everywhere a sha-based
   * raw storage handle would otherwise show through — `renderAttachmentInventory`
   * for sub-agent prompts, `task-api` for user-facing message lists, and
   * the `stageToWorktree` copy step (a stable name for tools that resolve
   * paths inside the worktree).
   *
   * Generated display-name policy when `original` is missing or contains
   * shell-unsafe characters:
   *   1. `attachment-{index+1}-{sha8}.{ext}` — preserves task-relative
   *      ordering and traces back to storage; readable at a glance.
   *   2. With no sha:  `attachment-{index+1}-noref.{ext}` — signals the
   *      missing provenance instead of letting the caller invent one.
   *
   * Never returns a 64-char sha alone: that is the storage filename, not
   * a UI / LLM filename, and surfacing it directly was the bug a previous
   * commit tried to fix only for the staging path.
   */
  export function displayFilename(input: { filename?: string; mime?: string; sha?: string; index?: number }): string {
    if (input.filename && SAFE_FILENAME_RE.test(input.filename)) return input.filename
    const ext = extensionFor(input.mime ?? "", input.filename)
    const shaPrefix = (input.sha ?? "").slice(0, 8) || "noref"
    const idx = typeof input.index === "number" ? input.index + 1 : 1
    return `attachment-${idx}-${shaPrefix}.${ext}`
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
    if (!projectID || !name || /[/\\?#]/.test(name)) return undefined
    return { projectID, name }
  }

  // ── Garbage collection ────────────────────────────────────────────────
  //
  // AttachmentStore.write is content-addressed and write-only: identical
  // payloads dedupe to the same `<sha>.<ext>` file. Before the GC pass
  // added below, nothing ever deleted those files — every removed part /
  // session / task left its referenced bytes behind on disk. The first
  // OOM forensic pass (specs/acceptance-attachment-store-single-source-2026-05-11.md)
  // found that screenshot tools were bloating `part.data` with
  // inline base64 instead of using the store at all. As the migration
  // moves them onto the store, the on-disk directory becomes the single
  // source — and that source needs reaping.
  //
  // Strategy: on engine boot (wired in `Instance.provide` bootstrap),
  // collect every `<sha>` referenced by any persisted `part.data`, then
  // delete on-disk files whose sha is not in that set. Skip files newer
  // than GC_MIN_AGE_MS so a sweep racing a fresh write does not delete a
  // file before the part row that references it lands.

  /** Files younger than this are skipped by sweep() so a write racing the
   *  sweep is not deleted before its part row lands. */
  const GC_MIN_AGE_MS = 60_000

  const REFERENCE_RE = /\/attachment\/[^/"\s]+\/([0-9a-f]{64})\.[0-9a-z]+/gi

  /**
   * Enumerate every `<sha>.<ext>` currently on disk under the project's
   * `.opencorvus/r/b/a/` directory. Returns `[]` when the directory
   * does not exist (no attachments have ever been written for this project).
   */
  export async function listOnDisk(projectID: string): Promise<
    {
      sha: string
      name: string
      abs: string
      size: number
      mtimeMs: number
    }[]
  > {
    const project = Project.get(projectID)
    if (!project) throw new Error(`AttachmentStore.listOnDisk: unknown project ${projectID}`)
    const dir = storageDir(project.worktree)
    const entries = await fs.readdir(dir).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return [] as string[]
      throw err
    })
    const out: { sha: string; name: string; abs: string; size: number; mtimeMs: number }[] = []
    for (const name of entries) {
      const m = name.match(/^([0-9a-f]{64})\./i)
      if (!m) continue
      const abs = path.join(dir, name)
      const stat = await fs.stat(abs).catch(() => null)
      if (!stat || !stat.isFile()) continue
      out.push({ sha: m[1].toLowerCase(), name, abs, size: stat.size, mtimeMs: stat.mtimeMs })
    }
    return out
  }

  /**
   * Sha-extraction primitive shared by every contributor to the live set:
   * stringify whatever JSON-shaped payload we got, run the canonical
   * `/attachment/<projectID>/<sha>.<ext>` regex over it, accumulate into the
   * per-project Map. Keeping the discovery rule in a single function is rule 8
   * (no double source): the regex + URL parser pair is the only place that
   * decides "is this a sha reference, and which project does it belong to".
   *
   * Callers pass any JSON-serializable value (drizzle gives us already-parsed
   * objects for json-mode columns). Null / undefined payloads short-circuit
   * so a nullable JSON column never costs an extra branch at every call site.
   */
  function harvestReferences(payload: unknown, byProject: Map<string, Set<string>>) {
    if (payload === null || payload === undefined) return
    const json = typeof payload === "string" ? payload : JSON.stringify(payload)
    for (const match of json.matchAll(REFERENCE_RE)) {
      const located = nameFromUrl(match[0])
      if (!located) continue
      const set = byProject.get(located.projectID) ?? new Set<string>()
      set.add(match[1].toLowerCase())
      byProject.set(located.projectID, set)
    }
  }

  /**
   * Return the deduplicated set of shas that are still live, grouped by
   * project. A sha is live iff at least one of its three legitimate retain
   * surfaces still references it:
   *
   *   • `part.data`                         (session conversation parts)
   *   • `engine_task.attachments`           (USER-CONTRACT files: user uploads,
   *                                          figma-mcp frames the user pointed
   *                                          us at)
   *   • `engine_task.system_artifacts`      (SYSTEM-GENERATED evidence: URL
   *                                          screenshots, rendered.png, local
   *                                          material reads)
   *
   * Walking only `part.data` (the pre-fix behaviour) violated rule 8: shas
   * registered through `appendTaskAttachment` / `appendTaskSystemArtifact`
   * looked orphan to sweep() between registration and the first session-part
   * that referenced them, so any visual reference older than `GC_MIN_AGE_MS`
   * got unlinked and the build agent ENOENTed on stageToWorktree() copy.
   *
   * All three sources share the canonical URL shape, so a single regex over
   * the serialized JSON (see `harvestReferences`) covers every retain surface
   * — no per-source parsing, no row-shape assumptions to drift.
   */
  export function collectReferencedShas(): Map<string, Set<string>> {
    const byProject = new Map<string, Set<string>>()
    Database.use((db) => {
      for (const row of db.select({ data: PartTable.data }).from(PartTable).all()) {
        harvestReferences(row.data, byProject)
      }
      for (const row of db
        .select({
          attachments: EngineTaskTable.attachments,
          system_artifacts: EngineTaskTable.system_artifacts,
        })
        .from(EngineTaskTable)
        .all()) {
        harvestReferences(row.attachments, byProject)
        harvestReferences(row.system_artifacts, byProject)
      }
    })
    return byProject
  }

  /**
   * Delete on-disk files in the project's attachment directory whose sha
   * is not referenced by any persisted part. Files younger than
   * `GC_MIN_AGE_MS` are skipped so a sweep racing a concurrent write does
   * not delete a file before the part row that references it lands.
   *
   * Returns the count and total byte size of deleted orphans for logging.
   * Idempotent: running twice in a row deletes 0 the second time.
   */
  export async function sweep(projectID: string): Promise<{
    deleted: number
    bytesFreed: number
    skippedYoung: number
    kept: number
  }> {
    const files = await listOnDisk(projectID)
    if (files.length === 0) return { deleted: 0, bytesFreed: 0, skippedYoung: 0, kept: 0 }
    const referenced = collectReferencedShas().get(projectID) ?? new Set<string>()
    const now = Date.now()
    let deleted = 0
    let bytesFreed = 0
    let skippedYoung = 0
    let kept = 0
    for (const f of files) {
      if (referenced.has(f.sha)) {
        kept++
        continue
      }
      if (now - f.mtimeMs < GC_MIN_AGE_MS) {
        skippedYoung++
        continue
      }
      await fs.unlink(f.abs).catch((err: NodeJS.ErrnoException) => {
        // EBUSY / EPERM on Windows when another process holds the handle —
        // skip this round, next sweep will retry.
        if (err.code === "EBUSY" || err.code === "EPERM" || err.code === "ENOENT") return
        throw err
      })
      deleted++
      bytesFreed += f.size
    }
    log.info("AttachmentStore.sweep", {
      projectID,
      deleted,
      bytesFreed,
      skippedYoung,
      kept,
    })
    return { deleted, bytesFreed, skippedYoung, kept }
  }
}
