import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const docsScanRoots = ["specs/current/architecture", "docs", "packages/web/src/content/docs"]
const markdownExtensions = new Set([".md", ".mdx", ".txt"])
const datedSpecFileExtensions = new Set([".md", ".txt"])
const repositoryExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".css",
  ".md",
  ".mdx",
  ".txt",
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".toml",
  ".ps1",
  ".sh",
  ".astro",
  ".html",
  ".htm",
  ".svg",
  ".xml",
  ".rs",
  ".nix",
])
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
const packageLocalSpecTreePattern = /packages[/\\][^/\\]+[/\\]specs(?:[/\\]|$)/
const normalizedPackageLocalSpecTreePattern = /(?:^|[/\\])packages[/\\][^/\\]+[/\\]specs(?:[/\\]|$)/
const scratchEncodedPackageLocalSpecTreePattern = /packages__[^_]+__specs__/
const retiredPathEnd = "(?:[/\\\\]|$|(?=[\\s`\"')\\]}.,:;]))"
const retiredSpecPathPatterns: { label: string; pattern: RegExp }[] = [
  { label: "legacy architecture tree", pattern: new RegExp(`specs[/\\\\]new-arch${retiredPathEnd}`) },
  { label: "legacy singular architecture tree", pattern: new RegExp(`spec[/\\\\]new-arch${retiredPathEnd}`) },
  { label: "package-local spec tree", pattern: packageLocalSpecTreePattern },
  { label: "retired reference ledger", pattern: /specs[/\\]retired-reference-ledger\.md/ },
  {
    label: "root-level spec file",
    pattern: /specs[/\\](?!README\.md\b|current[/\\]|records[/\\]|artifacts[/\\])[^/\\\s`"')]+(?:\.md|\.txt|[/\\])/,
  },
  {
    label: "deleted pre-June root spec",
    pattern: /specs[/\\][A-Za-z0-9_@%+.-]*2026-0[1-5]-[0-9]{2}[A-Za-z0-9_@%+.-]*\.(?:md|txt)/,
  },
  {
    label: "deleted pre-June superpowers spec",
    pattern: /docs[/\\]superpowers[/\\]specs[/\\]2026-0[1-5]-[0-9]{2}[A-Za-z0-9_@%+.-]*\.(?:md|txt)/,
  },
  {
    label: "deleted overlay flat redesign plan",
    pattern: new RegExp(`specs[/\\\\]overlay-flat-redesign${retiredPathEnd}`),
  },
  { label: "deleted implementation progress note", pattern: new RegExp("specs[/\\\\]\\u5b9e\\u65bd\\u8fdb\\u5ea6") },
]
const skippedScratchContentGlobs = [
  "!**/.git/**",
  "!**/.turbo/**",
  "!**/dist/**",
  "!**/dist-vite/**",
  "!**/node_modules/**",
  "!**/opencorvus-dist/**",
  "!**/target/**",
]
const skippedScratchDirectoryNames = new Set([
  ".git",
  ".turbo",
  "dist",
  "dist-vite",
  "node_modules",
  "opencorvus-dist",
  "target",
])

let docsFilesCache: string[] | undefined
let repositoryFilesCache: string[] | undefined
const refsByFileCache = new Map<string, string[]>()

function normalizeRepositoryPath(file: string): string {
  return path.isAbsolute(file) ? path.relative(repoRoot, file).replace(/\\/g, "/") : file.replace(/\\/g, "/")
}

function hasPreJuneDatedSpecFileName(file: string): boolean {
  const normalized = normalizeRepositoryPath(file)
  if (!datedSpecFileExtensions.has(path.extname(normalized).toLowerCase())) return false
  const date = path.basename(normalized).match(/20\d{2}-\d{2}-\d{2}/)?.[0]
  return Boolean(date && date < "2026-06-01")
}

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

function monthlyRecordReadmes(): string[] {
  const recordsRoot = path.join(repoRoot, "specs", "records")
  if (!fs.existsSync(recordsRoot)) return []
  return fs
    .readdirSync(recordsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^20\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => path.join(recordsRoot, entry.name, "README.md"))
    .filter((file) => fs.existsSync(file))
}

function docsFiles(): string[] {
  docsFilesCache ??= Array.from(
    new Set(
      docsScanRoots
        .flatMap((dir) => walkDocs(path.join(repoRoot, dir)))
        .concat([path.join(repoRoot, "specs", "README.md"), ...monthlyRecordReadmes()])
        .concat(rootDocFiles().filter((filePath) => fs.existsSync(filePath))),
    ),
  )
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

function packageLocalSpecDirs(): string[] {
  const packagesRoot = path.join(repoRoot, "packages")
  if (!fs.existsSync(packagesRoot)) return []
  return fs
    .readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packagesRoot, entry.name, "specs"))
    .filter((dir) => fs.existsSync(dir))
    .map((dir) => path.relative(repoRoot, dir).replace(/\\/g, "/"))
    .sort()
}

function deletedPreJuneSpecNameOffenders(): string[] {
  const thisFile = path.relative(repoRoot, import.meta.path).replace(/\\/g, "/")
  const allowedHistoricalMigrationRecord = "specs/records/2026-06/2026-06-29-spec-consolidation.md"
  const allowedHistoricalGuardFile = "packages/opencorvus/test/script/document-health.test.ts"
  const allowedRetiredPathGuardFile = "packages/opencorvus/test/script/enterprise-architecture-explorer.test.ts"
  return repositoryFiles()
    .map((file) => [file, path.relative(repoRoot, file).replace(/\\/g, "/")] as const)
    .filter(
      ([, rel]) =>
        rel !== thisFile &&
        rel !== allowedHistoricalMigrationRecord &&
        rel !== allowedHistoricalGuardFile &&
        rel !== allowedRetiredPathGuardFile,
    )
    .flatMap(([file, rel]) => {
      const text = fs.readFileSync(file, "utf8")
      return Array.from(text.matchAll(deletedPreJuneSpecNamePattern)).map((match) => `${rel}: ${match[0]}`)
    })
    .sort()
}

function scratchSpecSnapshotOffenders(scratchRoot = path.join(repoRoot, ".scratch")): string[] {
  if (!fs.existsSync(scratchRoot)) return []
  const offenders: string[] = []
  const scratchRootSpecFilePattern = /\/specs\/(?!README\.md$)[^/]+\.(?:md|txt)$/

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)
      const rel = path.relative(repoRoot, fullPath).replace(/\\/g, "/")
      if (entry.isDirectory()) {
        if (rel.endsWith("/specs/new-arch") || normalizedPackageLocalSpecTreePattern.test(rel)) {
          offenders.push(rel)
          continue
        }
        if (skippedScratchDirectoryNames.has(entry.name)) continue
        walk(fullPath)
        continue
      }
      const stat = fs.statSync(fullPath)
      if (!stat.isFile()) continue
      if (/specs__new-arch__/.test(entry.name) || scratchEncodedPackageLocalSpecTreePattern.test(entry.name)) {
        offenders.push(rel)
      }
      const extension = path.extname(entry.name).toLowerCase()
      if ((extension === ".md" || extension === ".txt") && scratchRootSpecFilePattern.test(rel)) offenders.push(rel)
      if (hasPreJuneDatedSpecFileName(rel)) offenders.push(rel)
    }
  }

  walk(scratchRoot)
  offenders.push(...scratchContentOffenders(scratchRoot))
  return offenders.sort()
}

function rgPatternSource(pattern: RegExp): string {
  return pattern.source.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  )
}

function scratchContentOffenders(scratchRoot: string): string[] {
  const patterns = retiredSpecPathPatterns.concat([
    { label: "deleted pre-June spec filename", pattern: deletedPreJuneSpecNamePattern },
  ])
  return patterns.flatMap(({ label, pattern }) => {
    const args = [
      "--pcre2",
      "--files-with-matches",
      "--color",
      "never",
      "--no-messages",
      ...skippedScratchContentGlobs.flatMap((glob) => ["--glob", glob]),
      "-e",
      rgPatternSource(pattern),
      scratchRoot,
    ]
    const result = spawnSync("rg", args, {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    })
    if (result.error) throw result.error
    if (result.status !== 0 && result.status !== 1) {
      throw new Error(`rg scratch scan failed for ${label}: ${result.stderr || result.stdout}`)
    }
    return result.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((file) => `${normalizeRepositoryPath(file)}: ${label}`)
  })
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

function preJuneDatedSpecFiles(files = specsFiles()): string[] {
  return files.map(normalizeRepositoryPath).filter(hasPreJuneDatedSpecFileName)
}

function specTreeFiles(): string[] {
  return walkFiles(path.join(repoRoot, "specs"))
}

function isMonthlyRecordPath(rel: string): boolean {
  return /^specs\/records\/20\d{2}-\d{2}\//.test(rel)
}

function allowedSpecStoragePath(rel: string): boolean {
  return (
    rel === "specs/README.md" ||
    rel.startsWith("specs/current/") ||
    isMonthlyRecordPath(rel) ||
    rel.startsWith("specs/artifacts/")
  )
}

function currentArchitectureMarkdownFiles(): string[] {
  return walkDocs(path.join(repoRoot, "specs/current/architecture")).filter((file) => file.endsWith(".md"))
}

function juneTaskRecordFiles(): string[] {
  return walkDocs(path.join(repoRoot, "specs/records/2026-06")).filter((file) => file.endsWith(".md"))
}

function monthlyRecordFiles(): string[] {
  return walkDocs(path.join(repoRoot, "specs/records")).filter((file) => {
    const rel = path.relative(repoRoot, file).replace(/\\/g, "/")
    return file.endsWith(".md") && isMonthlyRecordPath(rel)
  })
}

function recallGovernedRecordFiles(): string[] {
  return monthlyRecordFiles().filter((file) => {
    const date = path.basename(file).match(/^20\d{2}-\d{2}-\d{2}/)?.[0]
    return Boolean(date && date >= "2026-06-29")
  })
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
    } else maybeAddCommand(line)
    for (const match of line.matchAll(/`([^`]+)`/g)) {
      maybeAddCommand(match[1]!)
    }
  }
  return commands
}

function linkedFiles(indexPath: string): Set<string> {
  const text = fs.readFileSync(indexPath, "utf8")
  return new Set(
    Array.from(text.matchAll(/\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)/g))
      .map((match) => match[1]!)
      .filter(Boolean),
  )
}

function markdownSection(text: string, heading: string): string {
  const pattern = new RegExp(`^## ${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m")
  const match = pattern.exec(text)
  if (!match) return ""
  const bodyStart = match.index + match[0].length
  const next = /\n##\s/.exec(text.slice(bodyStart))
  return text.slice(bodyStart, next ? bodyStart + next.index : undefined)
}

describe("historical docs repository links", () => {
  test("local historical doc references resolve", () => {
    expect(missingReferences(docsFiles())).toEqual([])
  }, 30000)

  test("monthly record README files are part of local docs link scans", () => {
    const scanned = docsFiles().map((file) => path.relative(repoRoot, file).replace(/\\/g, "/"))

    expect(scanned).toContain("specs/records/2026-06/README.md")
    expect(scanned).toContain("specs/records/2026-07/README.md")
  })

  test("repository historical doc references resolve", () => {
    const thisFile = path.relative(repoRoot, import.meta.path).replace(/\\/g, "/")
    const activeFiles = repositoryFiles().filter((file) => {
      const rel = path.relative(repoRoot, file).replace(/\\/g, "/")
      return rel !== thisFile && !isMonthlyRecordPath(rel)
    })

    expect(missingReferences(activeFiles)).toEqual([])
  }, 30000)

  test("spec storage uses the consolidated single tree", () => {
    expect(fs.existsSync(path.join(repoRoot, "specs/README.md"))).toBe(true)
    expect(fs.existsSync(path.join(repoRoot, "specs/current/architecture/README.md"))).toBe(true)
    expect(fs.existsSync(path.join(repoRoot, "specs/records/2026-06/2026-06-29-spec-consolidation.md"))).toBe(true)
    expect(fs.existsSync(path.join(repoRoot, "specs/new-arch"))).toBe(false)
    expect(packageLocalSpecDirs()).toEqual([])
    expect(fs.existsSync(path.join(repoRoot, "specs", retiredReferenceLedgerFileName))).toBe(false)
    expect(fs.existsSync(path.join(repoRoot, "specs", "records", "README.md"))).toBe(false)
    const nextMonthRecord = ["specs", "records", "2026-07", "2026-07-01-next-month.md"].join("/")
    const recordsRootIndex = ["specs", "records", "README.md"].join("/")
    const nonMonthRecord = ["specs", "records", "not-a-month", "example.md"].join("/")
    expect(allowedSpecStoragePath(nextMonthRecord)).toBe(true)
    expect(allowedSpecStoragePath(recordsRootIndex)).toBe(false)
    expect(allowedSpecStoragePath(nonMonthRecord)).toBe(false)

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

    const recallGovernanceSources = [
      { rel: "AGENTS.md", required: "必须包含 `Recall` 区块" },
      { rel: "specs/README.md", required: "must include a `Recall` section" },
      { rel: "specs/current/architecture/README.md", required: "must include a `Recall` section" },
      { rel: "specs/records/2026-06/README.md", required: "must include a `Recall` section" },
    ]
    const requiredRecallRecords = [
      "specs/records/2026-06/2026-06-29-spec-consolidation.md",
      "specs/records/2026-06/2026-06-29-database-ioerr-runtime-boundary.md",
      "specs/records/2026-06/2026-06-29-operator-steer-single-source.md",
    ]
    for (const source of recallGovernanceSources) {
      const text = fs.readFileSync(path.join(repoRoot, source.rel), "utf8")
      expect(text).toContain(source.required)
    }
    for (const rel of requiredRecallRecords) {
      expect(fs.readFileSync(path.join(repoRoot, rel), "utf8")).toMatch(/^## Recall$/m)
    }
    const specsReadme = fs.readFileSync(path.join(repoRoot, "specs/README.md"), "utf8")
    expect(specsReadme).toContain("`specs/records/YYYY-MM/**`")
    expect(specsReadme).toContain("matching month directory in `specs/records/YYYY-MM/`")
    const architectureReadme = fs.readFileSync(path.join(repoRoot, "specs/current/architecture/README.md"), "utf8")
    expect(architectureReadme).toContain("`specs/records/YYYY-MM/`")
    expect(architectureReadme).not.toContain("task-specific plans live under `specs/records/2026-06/`")

    const governedRecords = recallGovernedRecordFiles().map((file) => path.relative(repoRoot, file).replace(/\\/g, "/"))
    expect(governedRecords).toContain("specs/records/2026-06/2026-06-29-spec-consolidation.md")
    const missingRecall = governedRecords.filter(
      (rel) => !/^## Recall$/m.test(fs.readFileSync(path.join(repoRoot, rel), "utf8")),
    )
    expect(missingRecall).toEqual([])

    const recordsMissingIndependentAgentFeedback = [
      "specs/records/2026-07/2026-07-06-gui-quality-bug-hunt-iteration.md",
      "specs/records/2026-07/2026-07-07-opentest-lifecycle-virtual-agents.md",
    ].filter(
      (rel) =>
        !/^### Independent Agent Feedback$/m.test(
          markdownSection(fs.readFileSync(path.join(repoRoot, rel), "utf8"), "Recall"),
        ),
    )
    expect(recordsMissingIndependentAgentFeedback).toEqual([])
  })

  test("spec consolidation record keeps addendum numbers contiguous", () => {
    const record = fs.readFileSync(
      path.join(repoRoot, "specs/records/2026-06/2026-06-29-spec-consolidation.md"),
      "utf8",
    )
    const laterAddenda = record.split("## 2026-06-29 Later Independent Review Addenda")[1]
    expect(laterAddenda).toBeDefined()

    const malformedHeadings = Array.from(laterAddenda!.matchAll(/^\$\d+:/gm), (match) => match[0])
    expect(malformedHeadings).toEqual([])
    const addendumNumbers = Array.from(laterAddenda!.matchAll(/^(\d+)\. /gm), (match) => Number(match[1]))
    expect(addendumNumbers.length).toBeGreaterThan(50)
    expect(addendumNumbers).toEqual(addendumNumbers.map((_, index) => index + 1))
    const addendumNumberSet = new Set(addendumNumbers)
    const validationNumbers = Array.from(laterAddenda!.matchAll(/^Validation after addendum (\d+):$/gm), (match) =>
      Number(match[1]),
    )
    expect(validationNumbers).toContain(addendumNumbers.at(-1))
    expect(validationNumbers.filter((number) => !addendumNumberSet.has(number))).toEqual([])
  })

  test("no pre-June dated spec markdown or text file remains in the spec tree", () => {
    expect(preJuneDatedSpecFiles()).toEqual([])
    const staleTextSpec = ["specs", "artifacts", "2026-05-31-stale-input.txt"].join("/")
    const currentTextSpec = ["specs", "artifacts", "2026-06-01-current-input.txt"].join("/")
    const nonSpecJson = ["specs", "current", "architecture", "2026-05-31-non-spec.json"].join("/")
    expect(preJuneDatedSpecFiles([staleTextSpec, currentTextSpec, nonSpecJson])).toEqual([staleTextSpec])
  })

  test("repository retired-path scan covers structured text artifacts", () => {
    for (const extension of [".json", ".jsonc", ".yaml", ".yml", ".mjs", ".cjs"]) {
      expect(repositoryExtensions.has(extension)).toBe(true)
    }
  })

  test("scratch content scan covers unknown text snapshot extensions", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencorvus-scratch-content-"))
    try {
      const textFile = path.join(tempDir, "snapshot.customtext")
      fs.writeFileSync(textFile, "specs/new-arch/probe.md\n")

      const offenders = scratchSpecSnapshotOffenders(tempDir)
      expect(offenders.some((offender) => offender.endsWith("snapshot.customtext: legacy architecture tree"))).toBe(
        true,
      )
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("retired path guards reject bare paths before punctuation", () => {
    const legacyArchitecturePattern = retiredSpecPathPatterns.find(({ label }) => label === "legacy architecture tree")
    expect(legacyArchitecturePattern).toBeDefined()
    const retiredPath = ["specs", "new-arch"].join("/")
    expect(legacyArchitecturePattern!.pattern.test(`path = "${retiredPath}"`)).toBe(true)
  })

  test("scratch snapshot file names reject pre-June dated spec text", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencorvus-scratch-spec-name-"))
    try {
      const staleText = path.join(tempDir, "2026-05-31-stale-spec.txt")
      const currentText = path.join(tempDir, "2026-06-01-current-spec.txt")
      fs.writeFileSync(staleText, "plain stale snapshot\n")
      fs.writeFileSync(currentText, "plain current snapshot\n")

      const offenders = scratchSpecSnapshotOffenders(tempDir)
      expect(offenders.some((offender) => offender.endsWith("2026-05-31-stale-spec.txt"))).toBe(true)
      expect(offenders.some((offender) => offender.endsWith("2026-06-01-current-spec.txt"))).toBe(false)
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

  test("June record README indexes current-day records", () => {
    const readmePath = path.join(repoRoot, "specs/records/2026-06/README.md")
    const text = fs.readFileSync(readmePath, "utf8")
    const indexed = linkedFiles(readmePath)
    const missing = fs
      .readdirSync(path.join(repoRoot, "specs/records/2026-06"))
      .filter((file) => /^2026-06-29-.*\.md$/.test(file))
      .filter((file) => !indexed.has(file))
      .sort()

    expect(text).toContain("current-day governance records only")
    expect(text).toContain("rg --files specs/records/2026-06")
    expect(missing).toEqual([])
  })

  test("specs README links the month index instead of handpicked current-day records", () => {
    const text = fs.readFileSync(path.join(repoRoot, "specs/README.md"), "utf8")
    const handpickedCurrentDayLinks = Array.from(
      text.matchAll(/specs\/records\/2026-06\/2026-06-29-[^`)\s]+\.md/g),
    ).map((match) => match[0])

    expect(text).toContain("specs/records/2026-06/README.md")
    expect(handpickedCurrentDayLinks).toEqual([])
  })

  test("legacy spec paths are not referenced as live repository paths", () => {
    const thisFile = path.relative(repoRoot, import.meta.path).replace(/\\/g, "/")
    const offenders = repositoryFiles()
      .map((file) => [file, path.relative(repoRoot, file).replace(/\\/g, "/")] as const)
      .filter(([, rel]) => rel !== thisFile)
      .filter(([, rel]) => !isMonthlyRecordPath(rel))
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
