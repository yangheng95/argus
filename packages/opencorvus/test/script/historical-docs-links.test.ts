import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const docsScanRoots = ["specs/current/architecture", "docs", "packages/web/src/content/docs"]
const markdownExtensions = new Set([".md", ".mdx", ".txt"])
const repositoryExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".css", ".md", ".mdx", ".txt"])
const scratchTextExtensions = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".patch",
  ".current",
  ".json",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".css",
  ".html",
  ".htm",
  ".tmp",
  ".tsv",
  ".diff",
  ".log",
  ".lock",
  ".ps1",
  ".snap",
  ".astro",
  ".sh",
  ".toml",
  ".ndjson",
  ".jsonl",
  ".rs",
  ".sample",
  ".nix",
  ".headers",
  ".csv",
  ".editorconfig",
  ".gitattributes",
  ".dockerignore",
  ".vscodeignore",
  ".webmanifest",
  ".geojson",
  ".xml",
  ".svg",
  ".yaml",
  ".yml",
])
const scratchBinaryExtensions = new Set([
  ".bin",
  ".br",
  ".dll",
  ".dylib",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".icns",
  ".jpg",
  ".jpeg",
  ".node",
  ".pdf",
  ".png",
  ".so",
  ".tar",
  ".tgz",
  ".wasm",
  ".webp",
  ".xz",
  ".zip",
  ".zst",
])
const scratchTextSampleBytes = 64 * 1024
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
const deletedPreJuneSpecNamePattern =
  /\b[A-Za-z0-9_@%+.-]*2026-0[1-5]-[0-9]{2}[A-Za-z0-9_@%+.-]*\.(?:md|txt)\b|\bretired-reference-ledger\.md\b/g
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
      path.join(repoRoot, "specs", "records", "2026-06", "README.md"),
    ])
    .concat(rootDocFiles().filter((filePath) => fs.existsSync(filePath)))
  return docsFilesCache
}

function walkFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(fullPath, out)
    else out.push(fullPath)
  }
  return out
}

function repositoryFiles(): string[] {
  repositoryFilesCache ??= walkRepository(repoRoot)
  return repositoryFilesCache
}

function deletedPreJuneSpecNameOffenders(): string[] {
  const thisFile = path.relative(repoRoot, import.meta.path).replace(/\\/g, "/")
  const allowedHistoricalMigrationRecord = "specs/records/2026-06/2026-06-29-spec-consolidation.md"
  const allowedHistoricalGuardFile = "packages/opencorvus/test/script/document-health.test.ts"
  return repositoryFiles()
    .map((file) => [file, path.relative(repoRoot, file).replace(/\\/g, "/")] as const)
    .filter(([, rel]) => rel !== thisFile && rel !== allowedHistoricalMigrationRecord && rel !== allowedHistoricalGuardFile)
    .flatMap(([file, rel]) => {
      const text = fs.readFileSync(file, "utf8")
      return Array.from(text.matchAll(deletedPreJuneSpecNamePattern)).map((match) => `${rel}: ${match[0]}`)
    })
    .sort()
}

function isUtf8TextSample(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer)
  } catch {
    return false
  }
  let controlCount = 0
  for (const byte of buffer) {
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) controlCount += 1
  }
  return controlCount <= Math.max(4, Math.floor(buffer.length / 100))
}

function shouldScanScratchTextFile(fullPath: string, extension: string, stat = fs.statSync(fullPath)): boolean {
  if (!stat.isFile()) return false
  if (scratchTextExtensions.has(extension)) return true
  if (scratchBinaryExtensions.has(extension)) return false

  if (stat.size === 0) return true

  const sample = Buffer.alloc(Math.min(stat.size, scratchTextSampleBytes))
  const fd = fs.openSync(fullPath, "r")
  try {
    const bytesRead = fs.readSync(fd, sample, 0, sample.length, 0)
    return isUtf8TextSample(sample.subarray(0, bytesRead))
  } finally {
    fs.closeSync(fd)
  }
}

function scratchSpecSnapshotOffenders(): string[] {
  const scratchRoot = path.join(repoRoot, ".scratch")
  if (!fs.existsSync(scratchRoot)) return []
  const offenders: string[] = []
  const scratchRootSpecFilePattern = /\/specs\/(?!README\.md$)[^/]+\.(?:md|txt)$/

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)
      const rel = path.relative(repoRoot, fullPath).replace(/\\/g, "/")
      if (entry.isDirectory()) {
        if (rel.endsWith("/specs/new-arch") || rel.endsWith("/packages/opencorvus/specs")) {
          offenders.push(rel)
          continue
        }
        walk(fullPath)
        continue
      }
      const stat = fs.statSync(fullPath)
      if (!stat.isFile()) continue
      if (/specs__new-arch__|packages__opencorvus__specs__/.test(entry.name)) offenders.push(rel)
      const extension = path.extname(entry.name).toLowerCase()
      if ((extension === ".md" || extension === ".txt") && scratchRootSpecFilePattern.test(rel)) offenders.push(rel)
      if (!shouldScanScratchTextFile(fullPath, extension, stat)) continue
      const date = entry.name.match(/20\d{2}-\d{2}-\d{2}/)?.[0]
      if (extension === ".md" && date && date < "2026-06-01") offenders.push(rel)
      const text = fs.readFileSync(fullPath, "utf8")
      if (/specs\/new-arch|packages\/opencorvus\/specs/.test(text)) offenders.push(rel)
      for (const { label, pattern } of retiredSpecPathPatterns) {
        pattern.lastIndex = 0
        if (pattern.test(text)) offenders.push(`${rel}: ${label}`)
      }
      for (const match of text.matchAll(deletedPreJuneSpecNamePattern)) {
        offenders.push(`${rel}: ${match[0]}`)
      }
    }
  }

  walk(scratchRoot)
  return offenders.sort()
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

function specTreeFiles(): string[] {
  return walkFiles(path.join(repoRoot, "specs"))
}

function allowedSpecStoragePath(rel: string): boolean {
  return (
    rel === "specs/README.md" ||
    rel.startsWith("specs/current/") ||
    rel.startsWith("specs/records/2026-06/") ||
    rel.startsWith("specs/artifacts/")
  )
}

function currentArchitectureMarkdownFiles(): string[] {
  return walkDocs(path.join(repoRoot, "specs/current/architecture")).filter((file) => file.endsWith(".md"))
}

function juneTaskRecordFiles(): string[] {
  return walkDocs(path.join(repoRoot, "specs/records/2026-06")).filter((file) => file.endsWith(".md"))
}

function commandLinesInMarkdown(text: string): string[] {
  const commands: string[] = []
  let inFence = false
  const commandPattern = /^\s*(bun|git|node|npm|pnpm|powershell|rg|yarn|ls|dir|find)(?:\s|$)/
  const maybeAddCommand = (candidate: string) => {
    if (commandPattern.test(candidate)) commands.push(candidate.trim())
  }

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("```")) {
      inFence = !inFence
      continue
    }
    if (inFence) {
      maybeAddCommand(line)
      if (retiredSpecPathPatterns.some(({ pattern }) => pattern.test(line))) commands.push(line.trim())
    }
    else maybeAddCommand(line)
    for (const match of line.matchAll(/`([^`]+)`/g)) {
      maybeAddCommand(match[1]!)
    }
  }
  return commands
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
    expect(fs.existsSync(path.join(repoRoot, "specs", "records", "README.md"))).toBe(false)

    const rootSpecFiles = fs
      .readdirSync(path.join(repoRoot, "specs"), { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort()
    expect(rootSpecFiles).toEqual(["README.md"])

    const misplacedSpecFiles = specTreeFiles()
      .map((file) => path.relative(repoRoot, file).replace(/\\/g, "/"))
      .filter((rel) => !allowedSpecStoragePath(rel))
      .sort()
    expect(misplacedSpecFiles).toEqual([])
  })

  test("AGENTS preserves spec storage and Recall governance", () => {
    const agents = fs.readFileSync(path.join(repoRoot, "AGENTS.md"), "utf8")
    for (const required of [
      "**32.1（spec / 方案集中落盘单一来源 — 2026-06-29）**",
      "**32.2（pre-June spec 删除规则 — 2026-06-29）**",
      "**32.3（Recall 区块 — 2026-06-29）**",
      "**32.4（压缩/续跑保真 — 2026-06-29）**",
      "**32.5（spec 索引与验证 — 2026-06-29）**",
      "specs/current/architecture/**",
      "specs/records/YYYY-MM/**",
      "specs/artifacts/**",
    ]) {
      expect(agents).toContain(required)
    }

    const requiredRecallRecords = [
      "specs/records/2026-06/2026-06-29-spec-consolidation.md",
      "specs/records/2026-06/2026-06-29-database-ioerr-runtime-boundary.md",
    ]
    const missingRecall = requiredRecallRecords
      .filter((rel) => fs.existsSync(path.join(repoRoot, rel)))
      .filter((rel) => !/^## Recall$/m.test(fs.readFileSync(path.join(repoRoot, rel), "utf8")))
    expect(missingRecall).toEqual([])
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

  test("scratch text detection scans unknown UTF-8 snapshot extensions", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencorvus-scratch-text-"))
    try {
      const textFile = path.join(tempDir, "snapshot.customtext")
      const binaryFile = path.join(tempDir, "snapshot.custombin")
      fs.writeFileSync(textFile, "specs/new-arch/probe.md\n")
      fs.writeFileSync(binaryFile, Buffer.from([0, 159, 146, 150]))

      expect(shouldScanScratchTextFile(textFile, path.extname(textFile).toLowerCase())).toBe(true)
      expect(shouldScanScratchTextFile(binaryFile, path.extname(binaryFile).toLowerCase())).toBe(false)
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("scratch snapshots do not retain deleted spec trees", () => {
    expect(scratchSpecSnapshotOffenders()).toEqual([])
  }, 30000)

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

  test("deleted pre-June spec filenames are not referenced outside migration evidence", () => {
    expect(deletedPreJuneSpecNameOffenders()).toEqual([])
  }, 30000)

  test("June task records do not publish deleted spec trees as live command targets", () => {
    const offenders = juneTaskRecordFiles().flatMap((file) => {
      const rel = path.relative(repoRoot, file).replace(/\\/g, "/")
      const text = fs.readFileSync(file, "utf8")
      return commandLinesInMarkdown(text).flatMap((line) =>
        retiredSpecPathPatterns
          .filter(({ pattern }) => pattern.test(line))
          .map(({ label }) => `${rel}: ${label}: ${line}`),
      )
    })

    expect(offenders).toEqual([])
  })

  test("June records do not publish retired root spec paths outside migration evidence", () => {
    const allowedHistoricalMigrationRecord = "specs/records/2026-06/2026-06-29-spec-consolidation.md"
    const rootSpecPathPattern =
      /specs[/\\](?!README\.md\b|current[/\\]|records[/\\]|artifacts[/\\])[^/\\\s`"')]+\.(?:md|txt)\b/g
    const offenders = juneTaskRecordFiles()
      .map((file) => [file, path.relative(repoRoot, file).replace(/\\/g, "/")] as const)
      .filter(([, rel]) => rel !== allowedHistoricalMigrationRecord)
      .flatMap(([file, rel]) => {
        const text = fs.readFileSync(file, "utf8")
        return Array.from(text.matchAll(rootSpecPathPattern)).map((match) => `${rel}: ${match[0]}`)
      })

    expect(offenders).toEqual([])
  })

  test("June records do not present retired spec trees as current evidence or remaining work", () => {
    const allowedHistoricalMigrationRecord = "specs/records/2026-06/2026-06-29-spec-consolidation.md"
    const currentClaimPatterns = [
      /existing specs under `specs\/new-arch`/,
      /Reindex all existing `specs\/new-arch/,
      /The repository carries three documentation layers/,
    ]
    const offenders = juneTaskRecordFiles()
      .map((file) => [file, path.relative(repoRoot, file).replace(/\\/g, "/")] as const)
      .filter(([, rel]) => rel !== allowedHistoricalMigrationRecord)
      .flatMap(([file, rel]) => {
        const text = fs.readFileSync(file, "utf8")
        return currentClaimPatterns
          .filter((pattern) => pattern.test(text))
          .map((pattern) => `${rel}: ${pattern.source}`)
      })

    expect(offenders).toEqual([])
  })
})
