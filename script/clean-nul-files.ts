#!/usr/bin/env bun
/**
 * Removes files whose basename matches a Windows reserved device name
 * (nul/NUL, con, prn, aux, com1-9, lpt1-9). MSYS bash on Windows happily
 * creates a real file when an LLM-generated command uses a redirect like
 * `... 2>nul` from inside a bash shell — git then refuses to index it
 * with "short read while indexing nul" and aborts every subsequent
 * baseline/acceptance commit.
 *
 * Reserved names cannot be opened through normal Win32 paths, so
 * deletion goes through the `\\?\` long-path prefix.
 *
 * Usage:
 *   bun clean:nul                      # scan the current drive root (e.g. C:\)
 *   bun clean:nul -- D:\some\subtree   # scan a specific tree
 *
 * Symlinks/junctions are not followed (loop + protected-tree guard) and
 * common Windows-internal trees are skipped to keep whole-disk scans
 * tolerable.
 */
import fs from "node:fs/promises"
import path from "node:path"

const RESERVED = new Set<string>([
  "nul", "con", "prn", "aux",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
])

const SKIP_DIRS = new Set<string>([
  "node_modules",
  ".git",
  "$Recycle.Bin",
  "System Volume Information",
  "Windows.old",
])

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
    if (e.isSymbolicLink()) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      await walk(full, found)
    } else if (RESERVED.has(e.name.toLowerCase())) {
      found.push(full)
    }
  }
}

function resolveScanRoot(arg: string | undefined): string {
  if (!arg) return path.parse(process.cwd()).root
  // Bare drive letter ("D:") → drive root ("D:\"). Node treats "D:" as a
  // drive-relative path and resolves against D:'s per-drive cwd, falling
  // back to process.cwd() — which silently scans the wrong tree.
  if (/^[a-zA-Z]:$/.test(arg)) return `${arg}\\`
  return path.resolve(arg)
}

const scanRoot = resolveScanRoot(process.argv[2])

// Bash on Windows eats backslashes (`C:\Users\foo` → `C:Usersfoo`), and a
// missing directory used to silently scan nothing. Fail fast with a hint.
try {
  const st = await fs.stat(scanRoot)
  if (!st.isDirectory()) {
    console.error(`scan root is not a directory: ${scanRoot}`)
    process.exit(2)
  }
} catch {
  console.error(`scan root does not exist: ${scanRoot}`)
  console.error(`hint: bash eats backslashes — use forward slashes (C:/Users/...) or single-quote the path`)
  process.exit(2)
}

console.log(`scanning ${scanRoot}`)

const matches: string[] = []
await walk(scanRoot, matches)

let removed = 0
let failed = 0
for (const p of matches) {
  try {
    await unlinkReserved(p)
    removed += 1
    console.log(`✓ ${path.relative(scanRoot, p)}`)
  } catch (e) {
    failed += 1
    console.error(`✗ ${path.relative(scanRoot, p)}: ${(e as Error).message}`)
  }
}
console.log(`\n${removed} reserved-name file(s) removed${failed ? `, ${failed} failed` : ""}.`)
process.exit(failed > 0 ? 1 : 0)
