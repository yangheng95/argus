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

const approvedWriters: Record<string, string> = {
  EngineArtifactTable: "packages/opencorvus/src/engine/artifact.ts",
  EngineChannelBindingTable: "packages/opencorvus/src/engine/channel-binding.ts",
  EngineInteractionRequestTable: "packages/opencorvus/src/engine/interaction-request.ts",
  EngineProgressSnapshotTable: "packages/opencorvus/src/engine/progress.ts",
}

function directWriteViolations(tableName: string): string[] {
  const violations: string[] = []
  const writePattern = new RegExp(`\\.(insert|update|delete)\\s*\\(\\s*${tableName}\\b`, "g")
  const approvedWriter = approvedWriters[tableName]

  for (const file of productionSourceFiles(sourceRoot)) {
    const path = projectPath(file)
    if (path === approvedWriter) continue
    const source = readFileSync(file, "utf8")
    for (const match of source.matchAll(writePattern)) {
      const line = source.slice(0, match.index).split("\n").length
      violations.push(`${path}:${line}`)
    }
  }

  return violations
}

describe("database write boundary", () => {
  test("only the engine artifact writer directly writes EngineArtifactTable", () => {
    expect(directWriteViolations("EngineArtifactTable")).toEqual([])
  })

  test("only the engine progress writer directly writes EngineProgressSnapshotTable", () => {
    expect(directWriteViolations("EngineProgressSnapshotTable")).toEqual([])
  })

  test("only the engine interaction request writer directly writes EngineInteractionRequestTable", () => {
    expect(directWriteViolations("EngineInteractionRequestTable")).toEqual([])
  })

  test("only the engine channel binding writer directly writes EngineChannelBindingTable", () => {
    expect(directWriteViolations("EngineChannelBindingTable")).toEqual([])
  })
})
