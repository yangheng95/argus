import { existsSync, readdirSync } from "fs"
import path from "path"

const mark = "/* Bun compat */"
const needle = "Error.captureStackTrace(this, this.constructor);"
const patch = `try { Error.captureStackTrace(this, this.constructor); } catch (_) { ${mark} }`

function list(): string[] {
  const root = process.cwd()
  const bun = path.join(root, "node_modules", ".bun")
  const nested = existsSync(bun)
    ? readdirSync(bun, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("follow-redirects@"))
      .map((entry) => path.join(bun, entry.name, "node_modules", "follow-redirects", "index.js"))
    : []
  const direct = path.join(root, "node_modules", "follow-redirects", "index.js")
  return [...new Set([...nested, direct].filter((file) => existsSync(file)))]
}

async function run() {
  const files = list()
  if (!files.length) {
    console.log("[patch-follow-redirects] skip: follow-redirects not found")
    return
  }
  const done = await Promise.all(
    files.map(async (file) => {
      const text = await Bun.file(file).text()
      if (text.includes(mark)) return { file, patched: false, reason: "already" as const }
      if (!text.includes(needle)) return { file, patched: false, reason: "missing_target" as const }
      await Bun.write(file, text.replaceAll(needle, patch))
      return { file, patched: true, reason: "patched" as const }
    }),
  )
  const changed = done.filter((x) => x.patched)
  const already = done.filter((x) => x.reason === "already")
  const missing = done.filter((x) => x.reason === "missing_target")
  if (changed.length) {
    changed.forEach((x) => console.log(`[patch-follow-redirects] patched: ${x.file}`))
  }
  if (already.length) {
    already.forEach((x) => console.log(`[patch-follow-redirects] already: ${x.file}`))
  }
  if (missing.length) {
    missing.forEach((x) => console.log(`[patch-follow-redirects] unchanged (target missing): ${x.file}`))
  }
}

run()
