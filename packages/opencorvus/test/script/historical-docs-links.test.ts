import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const docsScanRoots = ["specs/current/architecture", "docs", "packages/web/src/content/docs"]
const markdownExtensions = new Set([".md", ".mdx", ".txt"])
const repositoryExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".css", ".md", ".mdx", ".txt"])
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
const retiredReferenceLedgerFileName = `${["retired", "reference", "ledger"].join("-")}.md`
const retiredSpecPathPatterns: { label: string; pattern: RegExp }[] = [
  { label: "legacy architecture tree", pattern: /specs[/\\]new-arch(?:[/\\]|$)/ },
  { label: "legacy singular architecture tree", pattern: /spec[/\\]new-arch(?:[/\\]|$)/ },
  { label: "package-local spec tree", pattern: /packages[/\\]opencorvus[/\\]specs(?:[/\\]|$)/ },
  { label: "retired reference ledger", pattern: /specs[/\\]retired-reference-ledger\.md/ },
  {
    label: "root-level spec file",
    pattern: /specs[/\\](?!README\.md\b|current[/\\]|records[/\\]|artifacts[/\\])[^/\\\s`"')]+(?:\.md|\.txt|[/\\])/,
  },
  {
    label: "deleted pre-June root spec",
    pattern: /specs[/\\][A-Za-z0-9_@%+.-]*2026-0[1-5]-[0-9]{2}[A-Za-z0-9_@%+.-]*\.md/,
  },
  {
    label: "deleted pre-June superpowers spec",
    pattern: /docs[/\\]superpowers[/\\]specs[/\\]2026-0[1-5]-[0-9]{2}[A-Za-z0-9_@%+.-]*\.md/,
  },
  { label: "deleted overlay flat redesign plan", pattern: /specs[/\\]overlay-flat-redesign(?:[/\\]|$)/ },
  { label: "deleted implementation progress note", pattern: new RegExp("specs[/\\\\]\\u5b9e\\u65bd\\u8fdb\\u5ea6") },
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
    if (markdownExtensions.has(path.extname(entry.name).toLowerCase())) out.push(fullPath)
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
    if (repositoryExtensions.has(path.extname(entry.name).toLowerCase())) out.push(fullPath)
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
    .concat([
      path.join(repoRoot, "specs", "README.md"),
      path.join(repoRoot, "specs", "records", "README.md"),
      path.join(repoRoot, "specs", "records", "2026-06", "README.md"),
    ])
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
    /`([^`]*(?:specs\/(?:README|current|records|artifacts)|docs|packages\/web\/src\/content\/docs)[^`]*\.(?:md|mdx|txt))`/g
  const plainPath =
    /(?:^|[\s"'()`])((?:specs\/(?:README|current|records|artifacts)|docs\/superpowers)\/[A-Za-z0-9_./@%+\-]+\.(?:md|mdx|txt))(?:#[A-Za-z0-9_./%+\-]+)?/g
  for (const pattern of [markdownLink, codeSpanPath, plainPath]) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text))) refs.push(match[1]!)
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

function missingReferences(files: string[]): string[] {
  const missing: string[] = []
  for (const file of files) {
    for (const ref of refsForFile(file)) {
      if (/\s/.test(ref)) continue
      if (ref.includes("{") || ref.includes("*") || ref.includes("...")) continue
      const candidates = candidatesFor(file, ref)
      if (candidates.length > 0 && !candidates.some((candidate) => fs.existsSync(candidate))) {
        missing.push(`${path.relative(repoRoot, file).replace(/\\/g, "/")} -> ${ref}`)
      }
    }
  }
  return missing
}

function specsFiles(): string[] {
  return walkDocs(path.join(repoRoot, "specs"))
}

function currentArchitectureMarkdownFiles(): string[] {
  return walkDocs(path.join(repoRoot, "specs/current/architecture")).filter((file) => file.endsWith(".md"))
}

function currentTaskRecordFiles(): string[] {
  return walkDocs(path.join(repoRoot, "specs/records/2026-06"))
    .filter((file) => path.basename(file).startsWith("2026-06-29-"))
    .filter((file) => path.basename(file) !== "2026-06-29-spec-consolidation.md")
}

function linkedFiles(indexPath: string): Set<string> {
  const text = fs.readFileSync(indexPath, "utf8")
  return new Set(
    Array.from(text.matchAll(/\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)/g)).map((match) => match[1]!).filter(Boolean),
  )
}

describe("historical docs repository links", () => {
  test("local historical doc references resolve", () => {
    expect(missingReferences(docsFiles())).toEqual([])
  }, 30000)

  test("repository historical doc references resolve", () => {
    const activeFiles = repositoryFiles().filter(
      (file) => !path.relative(repoRoot, file).replace(/\\/g, "/").startsWith("specs/records/2026-06/"),
    )

    expect(missingReferences(activeFiles)).toEqual([])
  }, 30000)

  test("spec storage uses the consolidated single tree", () => {
    expect(fs.existsSync(path.join(repoRoot, "specs/README.md"))).toBe(true)
    expect(fs.existsSync(path.join(repoRoot, "specs/current/architecture/README.md"))).toBe(true)
    expect(fs.existsSync(path.join(repoRoot, "specs/records/2026-06/2026-06-29-spec-consolidation.md"))).toBe(true)
    expect(fs.existsSync(path.join(repoRoot, "specs/new-arch"))).toBe(false)
    expect(fs.existsSync(path.join(repoRoot, "packages/opencorvus/specs"))).toBe(false)
    expect(fs.existsSync(path.join(repoRoot, "specs", retiredReferenceLedgerFileName))).toBe(false)

    const rootSpecFiles = fs
      .readdirSync(path.join(repoRoot, "specs"), { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort()
    expect(rootSpecFiles).toEqual(["README.md"])
  })

  test("no pre-June dated spec markdown remains in the spec tree", () => {
    const preJuneSpecs = specsFiles()
      .map((file) => path.relative(repoRoot, file).replace(/\\/g, "/"))
      .filter((file) => path.extname(file).toLowerCase() === ".md")
      .filter((file) => {
        const date = path.basename(file).match(/20\d{2}-\d{2}-\d{2}/)?.[0]
        return Boolean(date && date < "2026-06-01")
      })

    expect(preJuneSpecs).toEqual([])
  })

  test("current architecture chapters are indexed in the architecture README", () => {
    const readmePath = path.join(repoRoot, "specs/current/architecture/README.md")
    const indexed = linkedFiles(readmePath)
    const missing = currentArchitectureMarkdownFiles()
      .map((file) => path.basename(file))
      .filter((file) => file !== "README.md")
      .filter((file) => !indexed.has(file))

    expect(missing).toEqual([])
  })

  test("legacy spec paths are not referenced as live repository paths", () => {
    const thisFile = path.relative(repoRoot, import.meta.path).replace(/\\/g, "/")
    const offenders = repositoryFiles()
      .map((file) => [file, path.relative(repoRoot, file).replace(/\\/g, "/")] as const)
      .filter(([, rel]) => rel !== thisFile)
      .filter(([, rel]) => !rel.startsWith("specs/records/2026-06/"))
      .flatMap(([file, rel]) => {
        const text = fs.readFileSync(file, "utf8")
        return retiredSpecPathPatterns
          .filter(({ pattern }) => pattern.test(text))
          .map(({ label }) => `${rel}: ${label}`)
      })

    expect(offenders).toEqual([])
  })

  test("current task records do not publish deleted spec trees as live command targets", () => {
    const offenders = currentTaskRecordFiles().flatMap((file) => {
      const rel = path.relative(repoRoot, file).replace(/\\/g, "/")
      const text = fs.readFileSync(file, "utf8")
      return retiredSpecPathPatterns
        .filter(({ pattern }) => pattern.test(text))
        .map(({ label }) => `${rel}: ${label}`)
    })

    expect(offenders).toEqual([])
  })
})
