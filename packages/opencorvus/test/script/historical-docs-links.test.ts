import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const docsScanRoots = ["specs", "docs", "packages/opencorvus/specs", "packages/web/src/content/docs"]
const markdownExtensions = new Set([".md", ".mdx", ".txt"])
const repositoryExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".md", ".mdx", ".txt"])
const skippedRepositoryDirs = new Set([
  ".git",
  ".opencorvus",
  ".scratch",
  ".tmp",
  ".turbo",
  "dist",
  "dist-vite",
  "node_modules",
  "opencorvus-dist",
  "target",
  "tmp",
])
const skippedRepositoryPrefixes = [
  path.join("packages", "opencorvus", "script", "cache-probe", "out"),
  path.join("packages", "opencorvus", "test", "fixture", "skills"),
  path.join("packages", "sdk", "js", "src", "gen"),
  path.join("packages", "vscode-extension", ".vscode-test"),
  path.join("packages", "vscode-extension", "media", "ui", "assets"),
]

let docsFilesCache: string[] | undefined
let repositoryFilesCache: string[] | undefined
const refsByFileCache = new Map<string, string[]>()

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

function walkRepository(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    const relativePath = path.relative(repoRoot, fullPath)
    if (skippedRepositoryPrefixes.some((prefix) => relativePath.startsWith(prefix))) continue
    if (entry.isDirectory()) {
      if (!skippedRepositoryDirs.has(entry.name)) walkRepository(fullPath, out)
      continue
    }
    if (repositoryExtensions.has(path.extname(entry.name).toLowerCase())) {
      out.push(fullPath)
    }
  }
  return out
}

function rootDocFiles(): string[] {
  return fs
    .readdirSync(repoRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && markdownExtensions.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(repoRoot, entry.name))
}

function docsFiles(): string[] {
  docsFilesCache ??= docsScanRoots
    .flatMap((dir) => walkDocs(path.join(repoRoot, dir)))
    .concat(rootDocFiles().filter((filePath) => fs.existsSync(filePath)))
  return docsFilesCache
}

function repositoryFiles(): string[] {
  repositoryFilesCache ??= walkRepository(repoRoot)
  return repositoryFilesCache
}

function candidatesFor(fromFile: string, rawRef: string): string[] {
  const withoutAnchor = rawRef.split("#")[0]?.trim() ?? ""
  if (!withoutAnchor || /^[a-z]+:/i.test(withoutAnchor) || withoutAnchor.startsWith("mailto:")) return []
  const normalized = decodeURIComponent(withoutAnchor).replace(/\//g, path.sep)
  const repoRootRelative = /^(specs|docs|packages|script|github|examples|assets|nix)(?:[\\/]|$)/.test(normalized)
  const base = repoRootRelative ? repoRoot : path.dirname(fromFile)
  const resolved = path.resolve(base, normalized.replace(/^[\\/]/, ""))
  return [
    resolved,
    `${resolved}.md`,
    `${resolved}.mdx`,
    path.join(resolved, "index.md"),
    path.join(resolved, "index.mdx"),
  ]
}

function refsIn(text: string): string[] {
  const refs: string[] = []
  const markdownLink = /(?<!!?)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  const codeSpanPath =
    /`([^`]*(?:specs|docs|packages\/web\/src\/content\/docs|packages\/opencorvus\/specs)[^`]*\.(?:md|mdx|txt))`/g
  const plainPath =
    /(?:^|[\s"'()`])((?:specs|docs\/superpowers|packages\/opencorvus\/specs)\/[A-Za-z0-9_./@%+\-]+\.(?:md|mdx|txt))(?:#[A-Za-z0-9_./%+\-]+)?/g
  for (const pattern of [markdownLink, codeSpanPath, plainPath]) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text))) {
      refs.push(match[1]!)
    }
  }
  return refs
}

function refsForFile(file: string): string[] {
  const cached = refsByFileCache.get(file)
  if (cached) return cached
  const refs = refsIn(fs.readFileSync(file, "utf8"))
  refsByFileCache.set(file, refs)
  return refs
}

function markdownTableRows(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("|"))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
    .filter((cells) => cells.length > 0 && !cells.every((cell) => /^:?-{3,}:?$/.test(cell)))
}

function retiredRefs(): Set<string> {
  const ledger = fs.readFileSync(path.join(repoRoot, "specs/retired-reference-ledger.md"), "utf8")
  return new Set(
    markdownTableRows(ledger)
      .map((cells) => cells[0]?.match(/^`([^`]+)`$/)?.[1])
      .filter((ref): ref is string => Boolean(ref?.endsWith(".md"))),
  )
}

function rootSpecFiles(): string[] {
  return fs
    .readdirSync(path.join(repoRoot, "specs"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && markdownExtensions.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .filter((name) => !["README.md", "retired-reference-ledger.md"].includes(name))
    .sort()
}

function indexedRootSpecs(): Map<string, string> {
  const readme = fs.readFileSync(path.join(repoRoot, "specs/README.md"), "utf8")
  const rows = new Map<string, string>()
  for (const cells of markdownTableRows(readme)) {
    const status = cells[1]?.trim()
    if (!status) continue
    for (const match of cells[0]?.matchAll(/`([^`]+)`/g) ?? []) {
      rows.set(match[1]!, status)
    }
  }
  return rows
}

function indexedSpecTable(indexPath: string): Map<string, string> {
  const readme = fs.readFileSync(indexPath, "utf8")
  const rows = new Map<string, string>()
  for (const cells of markdownTableRows(readme)) {
    const status = cells[1]?.trim()
    if (!status) continue
    for (const match of cells[0]?.matchAll(/`([^`]+)`/g) ?? []) {
      rows.set(match[1]!, status)
    }
  }
  return rows
}

function packageSpecFiles(): string[] {
  return fs
    .readdirSync(path.join(repoRoot, "packages/opencorvus/specs"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && markdownExtensions.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .filter((name) => name !== "README.md")
    .sort()
}

function newArchHistoricalFiles(): string[] {
  return fs
    .readdirSync(path.join(repoRoot, "specs/new-arch"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .filter((name) => !["README.md", "HISTORY.md"].includes(name))
    .filter((name) => !/^(0[1-9]|1[0-6]|99)-/.test(name))
    .sort()
}

function indexedNewArchHistory(): Set<string> {
  const history = fs.readFileSync(path.join(repoRoot, "specs/new-arch/HISTORY.md"), "utf8")
  return new Set(
    markdownTableRows(history)
      .map((cells) => cells[0]?.match(/^\[([^\]]+\.md)\]\([^)]+\)$/)?.[1])
      .filter((file): file is string => Boolean(file)),
  )
}

function missingReferences(files: string[], retired: Set<string>): string[] {
  const missing: string[] = []
  for (const file of files) {
    for (const ref of refsForFile(file)) {
      if (/\s/.test(ref)) continue
      if (ref.includes("{") || ref.includes("*") || ref.includes("...")) continue
      if (retired.has(ref)) continue
      const candidates = candidatesFor(file, ref)
      if (candidates.length > 0 && !candidates.some((candidate) => fs.existsSync(candidate))) {
        missing.push(`${path.relative(repoRoot, file)} -> ${ref}`)
      }
    }
  }
  return missing
}

function referencedRetiredPaths(files: string[], retired: Set<string>): Set<string> {
  const referenced = new Set<string>()
  for (const file of files) {
    for (const ref of refsForFile(file)) {
      if (retired.has(ref)) referenced.add(ref)
    }
  }
  return referenced
}

describe("historical docs repository links", () => {
  test("local historical doc references resolve or are marked retired", () => {
    const missing = missingReferences(docsFiles(), retiredRefs())

    expect(missing).toEqual([])
  })

  test("repository historical doc references resolve or are listed in retired ledger", () => {
    const missing = missingReferences(repositoryFiles(), retiredRefs())

    expect(missing).toEqual([])
  })

  test("retired reference ledger entries are still referenced", () => {
    const retired = retiredRefs()
    const ledgerPath = path.join(repoRoot, "specs/retired-reference-ledger.md")
    const referenced = referencedRetiredPaths(
      repositoryFiles().filter((file) => file !== ledgerPath),
      retired,
    )

    expect(Array.from(retired).filter((ref) => !referenced.has(ref))).toEqual([])
  })

  test("root historical specs are indexed", () => {
    const indexed = indexedRootSpecs()

    expect(rootSpecFiles().filter((file) => !indexed.has(file))).toEqual([])
  })

  test("package-local OpenCorvus specs are indexed", () => {
    const indexed = indexedSpecTable(path.join(repoRoot, "packages/opencorvus/specs/README.md"))

    expect(packageSpecFiles().filter((file) => !indexed.has(file))).toEqual([])
  })

  test("new-arch historical notes are indexed", () => {
    const indexed = indexedNewArchHistory()

    expect(newArchHistoricalFiles().filter((file) => !indexed.has(file))).toEqual([])
  })

  test("root specs marked superseded have a top-of-file banner", () => {
    const indexed = indexedRootSpecs()
    const missingBanner = Array.from(indexed.entries())
      .filter(([, status]) => status === "Superseded")
      .map(([file]) => file)
      .filter((file) => {
        const firstLines = fs
          .readFileSync(path.join(repoRoot, "specs", file), "utf8")
          .split(/\r?\n/)
          .slice(0, 6)
          .join("\n")
        return !/superseded/i.test(firstLines)
      })

    expect(missingBanner).toEqual([])
  })
})
