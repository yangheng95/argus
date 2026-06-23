import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const deletedProductDocsPath = ["docs", "product"].join("/")
const allowedHistoricalProductDocReferences = new Set([
  "specs/README.md",
  "specs/new-arch/README.md",
  "specs/new-arch/2026-06-04-docs-sdk-single-source.md",
  "specs/new-arch/2026-06-15-historical-docs-consolidation.md",
  "specs/new-arch/2026-06-17-document-health-audit.md",
])
const docsReferenceScanRoots = ["specs", "docs", "packages/opencorvus/specs", "packages/web/src/content/docs"]
const textExtensions = new Set([".md", ".mdx", ".txt"])

function walkTextFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkTextFiles(fullPath, out)
      continue
    }
    if (textExtensions.has(path.extname(entry.name).toLowerCase())) out.push(fullPath)
  }
  return out
}

function rootDocFiles(): string[] {
  return fs
    .readdirSync(repoRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && textExtensions.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(repoRoot, entry.name))
}

function maintainedDocFiles(): string[] {
  return docsReferenceScanRoots.flatMap((root) => walkTextFiles(path.join(repoRoot, root))).concat(rootDocFiles())
}

describe("product documentation single source", () => {
  test("legacy product docs tree is not restored", () => {
    expect(fs.existsSync(path.join(repoRoot, "docs", "product"))).toBe(false)
  })

  test("canonical website docs tree exists", () => {
    expect(fs.existsSync(path.join(repoRoot, "packages/web/src/content/docs/index.mdx"))).toBe(true)
    expect(fs.existsSync(path.join(repoRoot, "packages/web/src/content/docs/zh-cn/index.mdx"))).toBe(true)
  })

  test("deleted product docs are referenced only by historical single-source notes", () => {
    const offenders = maintainedDocFiles()
      .filter((filePath) => fs.readFileSync(filePath, "utf8").includes(deletedProductDocsPath))
      .map((filePath) => path.relative(repoRoot, filePath).replace(/\\/g, "/"))
      .filter((relativePath) => !allowedHistoricalProductDocReferences.has(relativePath))

    expect(offenders).toEqual([])
  })

  test("Mission and Task API guide reflects SDK directory and message contracts", () => {
    const sdkClient = fs.readFileSync(path.join(repoRoot, "packages/sdk/js/src/client.ts"), "utf8")
    const taskModel = fs.readFileSync(path.join(repoRoot, "packages/opencorvus/src/engine/model.ts"), "utf8")
    const enSdk = fs.readFileSync(path.join(repoRoot, "packages/web/src/content/docs/reference/sdk.mdx"), "utf8")
    const zhSdk = fs.readFileSync(path.join(repoRoot, "packages/web/src/content/docs/zh-cn/reference/sdk.mdx"), "utf8")
    const enGuide = fs.readFileSync(
      path.join(repoRoot, "packages/web/src/content/docs/reference/mission-task.mdx"),
      "utf8",
    )
    const zhGuide = fs.readFileSync(
      path.join(repoRoot, "packages/web/src/content/docs/zh-cn/reference/mission-task.mdx"),
      "utf8",
    )

    expect(sdkClient).toContain('url.searchParams.set("directory", directory)')
    expect(enSdk).toContain("Adds the `directory` query parameter")
    expect(zhSdk).toContain("添加 `directory` query 参数")
    expect(enSdk).not.toContain("Adds `x-opencorvus-directory`")
    expect(zhSdk).not.toContain("添加 `x-opencorvus-directory`")

    expect(taskModel).toContain("export const TaskMessageInput = z.object")
    expect(taskModel).toContain("source: z.string().min(1)")
    expect(enGuide).toContain('source: "api"')
    expect(enGuide).toContain("`source` is required")
    expect(zhGuide).toContain('source: "api"')
    expect(zhGuide).toContain("`source` 是必填字段")
  })
})
