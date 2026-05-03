import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")

function walkCss(root: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(root)) {
    const full = join(root, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      out.push(...walkCss(full))
    } else if (entry.endsWith(".css")) {
      out.push(full)
    }
  }
  return out
}

// Strips block comments and string literals so brace counts only see
// structural braces, not braces embedded in comments or in `content: "{"`.
function stripCommentsAndStrings(css: string): string {
  let out = ""
  let i = 0
  while (i < css.length) {
    const ch = css[i]
    const next = css[i + 1]
    if (ch === "/" && next === "*") {
      const end = css.indexOf("*/", i + 2)
      if (end < 0) {
        return out + " ".repeat(css.length - i)
      }
      out += " ".repeat(end + 2 - i)
      i = end + 2
      continue
    }
    if (ch === '"' || ch === "'") {
      const quote = ch
      let j = i + 1
      while (j < css.length) {
        if (css[j] === "\\") {
          j += 2
          continue
        }
        if (css[j] === quote) break
        if (css[j] === "\n") break
        j++
      }
      out += " ".repeat(j + 1 - i)
      i = j + 1
      continue
    }
    out += ch
    i++
  }
  return out
}

describe("CSS structural validity", () => {
  // The architecture-guards suite scans CSS with regex, which catches
  // token discipline (no raw px, no rgba, no body[data-theme] chrome
  // bleed) but does not parse the file. A surface extraction that ate
  // the closing `}` of a multi-selector rule (commit 188a3ea30 deleted
  // the `.msg-pdf-wrap` closer because the strip range happened to
  // include the line where the `.md-pdf` rule below it began) shipped a
  // structural error that only `vite build` surfaced because vite runs
  // the same PostCSS parser the browser depends on. This guard fails
  // fast, in-process, before pre-push, so the next strip cannot regress
  // the same way.
  const cssRoot = join(OVERLAY_ROOT, "src")
  const files = walkCss(cssRoot)

  test("walk found at least the legacy God CSS and one surface", () => {
    expect(files.some((path) => path.endsWith("styles.css"))).toBe(true)
    expect(files.some((path) => path.includes("surfaces"))).toBe(true)
  })

  for (const file of files) {
    const relative = file.slice(OVERLAY_ROOT.length + 1).replace(/\\/g, "/")
    test(`brace-balance ok in ${relative}`, () => {
      const text = readFileSync(file, "utf8")
      const stripped = stripCommentsAndStrings(text)

      let opens = 0
      let closes = 0
      let depth = 0
      let firstUnderflowLine: number | null = null

      let line = 1
      for (let i = 0; i < stripped.length; i++) {
        const ch = stripped[i]
        if (ch === "\n") {
          line++
          continue
        }
        if (ch === "{") {
          opens++
          depth++
        } else if (ch === "}") {
          closes++
          depth--
          if (depth < 0 && firstUnderflowLine === null) {
            firstUnderflowLine = line
          }
        }
      }

      expect(opens).toBe(closes)
      expect(firstUnderflowLine).toBe(null)
      expect(depth).toBe(0)
    })
  }
})
