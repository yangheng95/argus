#!/usr/bin/env bun
/**
 * Removes files whose basename matches a Windows reserved device name
 * (nul/NUL, con, prn, aux, com1-9, lpt1-9). MSYS bash on Windows happily
 * creates a real file when an LLM-generated command uses a redirect like
 * `... 2>nul` from inside a bash shell — git then refuses to index it
 * with "short read while indexing nul" and aborts every subsequent
 * baseline/delivery commit. The same pattern leaks into packaged
 * artifacts under packages/<name>/dist/... after benchmark runs.
 *
 * The .gitignore side of this mitigation lives in
 * `packages/opencorvus/src/engine/git.ts` (GITIGNORE_ESSENTIALS); this
 * script is the curative half — it deletes any instances already on
 * disk. Reserved names cannot be opened through normal Win32 paths, so
 * deletion goes through the `\\?\` long-path prefix.
 */
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const RESERVED = new Set<string>([
  "nul", "con", "prn", "aux",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
])

const SKIP_DIRS = new Set<string>(["node_modules", ".git"])

function toWin32LongPath(p: string): string {
  if (process.platform !== "win32") return p
  const abs = path.resolve(p).replace(/\//g, "\\")
  if (abs.startsWith("\\\\?\\")) return abs
  if (abs.startsWith("\\\\")) return `\\\\?\\UNC\\${abs.slice(2)}`
  return `\\\\?\\${abs}`
}

async function unlinkReserved(p: string): Promise<void> {
  await fs.unlink(toWin32LongPath(p))
}

async function walk(dir: string, found: string[]): Promise<void> {
  let entries: import("node:fs").Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      await walk(full, found)
    } else if (RESERVED.has(e.name.toLowerCase())) {
      found.push(full)
    }
  }
}

const matches: string[] = []
await walk(repoRoot, matches)

let removed = 0
let failed = 0
for (const p of matches) {
  try {
    await unlinkReserved(p)
    removed += 1
    console.log(`✓ ${path.relative(repoRoot, p)}`)
  } catch (e) {
    failed += 1
    console.error(`✗ ${path.relative(repoRoot, p)}: ${(e as Error).message}`)
  }
}
console.log(`\n${removed} reserved-name file(s) removed${failed ? `, ${failed} failed` : ""}.`)
process.exit(failed > 0 ? 1 : 0)
