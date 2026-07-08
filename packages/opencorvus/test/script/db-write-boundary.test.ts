import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { resolve, relative } from "node:path"

const repositoryRoot = resolve(import.meta.dir, "../../../..")
const sourceRoot = resolve(repositoryRoot, "packages/opencorvus/src")

function productionSourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const absolute = resolve(dir, entry)
    const stats = statSync(absolute)
    if (stats.isDirectory()) {
      files.push(...productionSourceFiles(absolute))
      continue
    }
    if (entry.endsWith(".ts")) files.push(absolute)
  }
  return files
}

function projectPath(file: string): string {
  return relative(repositoryRoot, file).replaceAll("\\", "/")
}

function isApprovedEngineArtifactWriter(path: string): boolean {
  return path === "packages/opencorvus/src/engine/artifact.ts"
}

describe("database write boundary", () => {
  test("only the engine artifact writer directly writes EngineArtifactTable", () => {
    const violations: string[] = []
    const writePattern = /\.(insert|update|delete)\s*\(\s*EngineArtifactTable\b/g

    for (const file of productionSourceFiles(sourceRoot)) {
      const path = projectPath(file)
      if (isApprovedEngineArtifactWriter(path)) continue
      const source = readFileSync(file, "utf8")
      for (const match of source.matchAll(writePattern)) {
        const line = source.slice(0, match.index).split("\n").length
        violations.push(`${path}:${line}`)
      }
    }

    expect(violations).toEqual([])
  })
})
