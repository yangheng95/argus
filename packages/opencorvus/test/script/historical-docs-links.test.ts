import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const scanRoots = ["specs", "packages/opencorvus/specs", "packages/web/src/content/docs"]
const rootDocs = ["README.md", "CONTRIBUTING.md", "RELEASE.md", "AGENTS.md", "CLAUDE.md"]
const markdownExtensions = new Set([".md", ".mdx", ".txt"])

function walkDocs(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkDocs(fullPath, out)
      continue
    }
    if (markdownExtensions.has(path.extname(entry.name).toLowerCase())) {
      out.push(fullPath)
    }
  }
  return out
}

function candidatesFor(fromFile: string, rawRef: string): string[] {
  const withoutAnchor = rawRef.split("#")[0]?.trim() ?? ""
  if (!withoutAnchor || /^[a-z]+:/i.test(withoutAnchor) || withoutAnchor.startsWith("mailto:")) return []
  const normalized = decodeURIComponent(withoutAnchor).replace(/\//g, path.sep)
  const repoRootRelative = /^(specs|docs|packages|script|github|examples|assets|nix)(?:[\\/]|$)/.test(normalized)
  const base = repoRootRelative ? repoRoot : path.dirname(fromFile)
  const resolved = path.resolve(base, normalized.replace(/^[\\/]/, ""))
  return [resolved, `${resolved}.md`, `${resolved}.mdx`, path.join(resolved, "index.md"), path.join(resolved, "index.mdx")]
}

function refsIn(text: string): string[] {
  const refs: string[] = []
  const markdownLink = /(?<!!?)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  const codeSpanPath = /`([^`]*(?:specs|docs|packages\/web\/src\/content\/docs|packages\/opencorvus\/specs)[^`]*\.(?:md|mdx|txt))`/g
  for (const pattern of [markdownLink, codeSpanPath]) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text))) {
      refs.push(match[1]!)
    }
  }
  return refs
}

describe("historical docs repository links", () => {
  test("local historical doc references resolve or are marked retired", () => {
    const files = scanRoots
      .flatMap((dir) => walkDocs(path.join(repoRoot, dir)))
      .concat(rootDocs.map((rel) => path.join(repoRoot, rel)).filter((filePath) => fs.existsSync(filePath)))
    const missing: string[] = []

    for (const file of files) {
      const text = fs.readFileSync(file, "utf8")
      const retiredLines = text
        .split(/\r?\n/)
        .filter((line) => line.includes("Retired external note"))
        .join("\n")
      for (const ref of refsIn(text)) {
        if (/\s/.test(ref)) continue
        if (ref.includes("{") || ref.includes("*") || ref.includes("...")) continue
        if (retiredLines.includes(ref)) continue
        const candidates = candidatesFor(file, ref)
        if (candidates.length > 0 && !candidates.some((candidate) => fs.existsSync(candidate))) {
          missing.push(`${path.relative(repoRoot, file)} -> ${ref}`)
        }
      }
    }

    expect(missing).toEqual([])
  })
})
