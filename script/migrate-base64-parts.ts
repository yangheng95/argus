/**
 * One-shot migration: rewrite legacy inline-base64 image URLs in
 * `part.data` to `AttachmentStore` refs.
 *
 * Background: specs/delivery-attachment-store-single-source-2026-05-11.md.
 * Before the delivery-tool-result migration, `compare_visual_artifacts`
 * and MCP image content paths persisted attachments as
 * `data:<mime>;base64,...` strings inline in `part.data`. The forensic
 * pass found 92 such rows totalling 54 MB across 46 sessions, with only
 * 3 distinct images underneath. This script converts each inline copy
 * into a content-addressed `<worktree>/.opencorvus/attachments/<sha>.<ext>`
 * file and rewrites `part.data` to point at the canonical
 * `/attachment/<projectID>/<sha>.<ext>` URL.
 *
 * Self-contained: does not bootstrap the engine. Talks to the DB and the
 * filesystem directly so it can run before `bun run opencorvus serve` (and
 * before the Session.updatePart inline-base64 guard rejects new writes).
 *
 * Usage:
 *   bun run script/migrate-base64-parts.ts          # dry-run, prints stats
 *   bun run script/migrate-base64-parts.ts --apply  # apply changes
 *
 * Idempotent: a second run with --apply finds no matches and exits 0.
 */
import crypto from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Database } from "bun:sqlite"

// Default DB path mirrors the engine's resolved path (xdg-state-home /
// opencorvus / opencorvus.db on Linux, AppData/Local on Windows). Tests
// and unusual installs override via OPENCORVUS_DB_PATH so the script
// does not hardcode a Windows-only path (rule 10).
function defaultDbPath(): string {
  if (process.env.OPENCORVUS_DB_PATH) return process.env.OPENCORVUS_DB_PATH
  const xdgState = process.env.XDG_STATE_HOME
  if (xdgState) return path.join(xdgState, "opencorvus", "opencorvus.db")
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local")
    return path.join(localAppData, "opencorvus", ".opencorvus", "opencorvus.db")
  }
  return path.join(os.homedir(), ".local", "state", "opencorvus", "opencorvus.db")
}
const DB_PATH = defaultDbPath()

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
}

function extensionFor(mime: string): string {
  return MIME_EXT[mime.toLowerCase()] ?? "bin"
}

interface PartRow {
  id: string
  session_id: string
  data: unknown
  project_id: string | null
  worktree: string | null
}

interface RewriteStats {
  partsScanned: number
  partsRewritten: number
  inlineUrlsFound: number
  bytesFreedFromInline: number
  bytesWrittenToDisk: number
  uniqueShasWritten: Set<string>
}

const args = process.argv.slice(2)
const apply = args.includes("--apply")
const forceLiveEngine = args.includes("--force-live-engine")

// Refuse to run --apply if the engine looks live: a recently-modified
// `*-shm`/`*-wal` companion file is the SQLite signal that another
// process is writing. Two concurrent writers serialize at SQLite, but
// the engine's drizzle ORM caches `part.data` reads in memory — so a
// migration write that lands while the engine is up would NOT invalidate
// those caches and the engine would serve stale base64 URLs back through
// `toModelOutput` until restart. `--force-live-engine` bypasses for ops
// who know the engine is paused but left WAL files behind.
if (apply && !forceLiveEngine) {
  const probes = [DB_PATH + "-shm", DB_PATH + "-wal"]
  for (const probe of probes) {
    try {
      const stat = await fs.stat(probe)
      const ageMs = Date.now() - stat.mtimeMs
      if (ageMs < 10_000) {
        console.error(
          `[abort] ${path.basename(probe)} was modified ${Math.round(ageMs / 1000)}s ago — the engine looks live.\n` +
            `Stop opencorvus before applying, or pass --force-live-engine if you are sure the WAL is stale.`,
        )
        process.exit(2)
      }
    } catch {
      // ENOENT — no WAL companion, engine isn't running.
    }
  }
}

const db = new Database(DB_PATH, { readonly: !apply })
if (apply) db.exec("PRAGMA journal_mode = WAL")

const rows = db
  .query(
    `SELECT p.id AS id,
            p.session_id AS session_id,
            p.data AS data,
            s.project_id AS project_id,
            pr.worktree AS worktree
     FROM part p
     LEFT JOIN session s ON s.id = p.session_id
     LEFT JOIN project pr ON pr.id = s.project_id
     WHERE p.data LIKE '%data:image/%base64,%'`,
  )
  .all() as PartRow[]

const stats: RewriteStats = {
  partsScanned: rows.length,
  partsRewritten: 0,
  inlineUrlsFound: 0,
  bytesFreedFromInline: 0,
  bytesWrittenToDisk: 0,
  uniqueShasWritten: new Set<string>(),
}

const updateStmt = db.prepare("UPDATE part SET data = ?, time_updated = ? WHERE id = ?")

// Walk a serialized part.data object and rewrite every `data:<mime>;base64,...`
// string to a canonical AttachmentStore ref URL. The walk is depth-first and
// in-place; values that are not strings or objects pass through untouched.
async function rewriteInlineUrls(
  value: unknown,
  ctx: { projectID: string; worktree: string },
): Promise<unknown> {
  if (typeof value === "string") {
    const m = value.match(/^data:([^;]+);base64,(.+)$/s)
    if (!m) return value
    const mime = m[1]
    const base64 = m[2]
    const bytes = Buffer.from(base64, "base64")
    const sha = crypto.createHash("sha256").update(bytes).digest("hex")
    const ext = extensionFor(mime)
    const name = `${sha}.${ext}`
    const attachmentsDir = path.join(ctx.worktree, ".opencorvus", "attachments")
    const abs = path.join(attachmentsDir, name)
    if (apply) {
      await fs.mkdir(attachmentsDir, { recursive: true })
      const exists = await fs.stat(abs).catch(() => null)
      if (!exists) {
        await fs.writeFile(abs, bytes)
        stats.bytesWrittenToDisk += bytes.byteLength
      }
    }
    stats.uniqueShasWritten.add(sha)
    stats.inlineUrlsFound++
    stats.bytesFreedFromInline += value.length
    return `/attachment/${ctx.projectID}/${name}`
  }
  if (Array.isArray(value)) {
    const out: unknown[] = []
    for (const item of value) out.push(await rewriteInlineUrls(item, ctx))
    return out
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      out[k] = await rewriteInlineUrls(v, ctx)
    }
    return out
  }
  return value
}

for (const row of rows) {
  if (!row.project_id || !row.worktree) {
    console.warn(`skip part ${row.id}: session ${row.session_id} has no project_id/worktree`)
    continue
  }
  // bun:sqlite returns TEXT columns as raw JSON strings — drizzle ORM
  // does the JSON parse on read elsewhere. Mirror that here so the
  // rewrite walks the actual object tree rather than the string.
  const parsed: unknown =
    typeof row.data === "string" ? JSON.parse(row.data) : row.data
  const before = JSON.stringify(parsed)
  const after = await rewriteInlineUrls(parsed, { projectID: row.project_id, worktree: row.worktree })
  const afterStr = JSON.stringify(after)
  if (before === afterStr) continue
  stats.partsRewritten++
  if (apply) {
    updateStmt.run(afterStr, Date.now(), row.id)
  }
}

// Post-migration cleanup: the legacy `.opencorvus/delivery-screenshots/`
// directory was the parallel sink for delivery's screenshot /
// verify_page_integrity tools (specs/delivery-attachment-store-single-source-2026-05-11.md
// rule 8). With the part data now routed through AttachmentStore, this
// directory is dead double-source storage (rule 16). Remove it for every
// affected project after a successful apply.
const cleanedDirs: string[] = []
if (apply && stats.partsRewritten > 0) {
  const seenWorktrees = new Set<string>()
  for (const row of rows) {
    if (!row.worktree || seenWorktrees.has(row.worktree)) continue
    seenWorktrees.add(row.worktree)
    const legacyDir = path.join(row.worktree, ".opencorvus", "delivery-screenshots")
    const removed = await fs.rm(legacyDir, { recursive: true, force: true }).then(() => true).catch(() => false)
    if (removed) cleanedDirs.push(legacyDir)
  }
}

console.log("")
console.log(apply ? "[APPLIED]" : "[DRY-RUN — pass --apply to commit changes]")
console.log("DB path:                 ", DB_PATH)
console.log("parts scanned:           ", stats.partsScanned)
console.log("parts rewritten:         ", stats.partsRewritten)
console.log("inline urls rewritten:   ", stats.inlineUrlsFound)
console.log("bytes freed from part.data:", stats.bytesFreedFromInline.toLocaleString())
console.log("bytes written to disk:   ", stats.bytesWrittenToDisk.toLocaleString())
console.log("distinct shas:           ", stats.uniqueShasWritten.size)
console.log("legacy dirs removed:     ", cleanedDirs.length)
for (const d of cleanedDirs) console.log("  -", d)
