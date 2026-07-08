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
  CronJobTable: "packages/opencorvus/src/scheduler/cron-service.ts",
  EngineArtifactTable: "packages/opencorvus/src/engine/artifact.ts",
  EngineChannelBindingTable: "packages/opencorvus/src/engine/channel-binding.ts",
  EngineGoalTable: "packages/opencorvus/src/engine/persist.ts",
  EngineInteractionRequestTable: "packages/opencorvus/src/engine/interaction-request.ts",
  EngineIterationTable: "packages/opencorvus/src/metrics/store.ts",
  EngineMetricResultTable: "packages/opencorvus/src/metrics/store.ts",
  EngineMetricSpecTable: "packages/opencorvus/src/metrics/store.ts",
  EnginePlanNodeTable: "packages/opencorvus/src/engine/persist.ts",
  EnginePlanVersionTable: "packages/opencorvus/src/engine/persist.ts",
  EngineProgressSnapshotTable: "packages/opencorvus/src/engine/progress.ts",
  EngineRequirementTable: "packages/opencorvus/src/engine/persist.ts",
  EngineSpecSnapshotTable: "packages/opencorvus/src/engine/spec-snapshot.ts",
  EngineTaskTable: "packages/opencorvus/src/engine/task.ts",
  EventJobTable: "packages/opencorvus/src/scheduler/event-service.ts",
  TaskQueueTable: "packages/opencorvus/src/scheduler/task-queue-service.ts",
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

  test("only the engine spec snapshot writer directly writes EngineSpecSnapshotTable", () => {
    expect(directWriteViolations("EngineSpecSnapshotTable")).toEqual([])
  })

  test("only the engine persistence writer directly writes EnginePlanVersionTable", () => {
    expect(directWriteViolations("EnginePlanVersionTable")).toEqual([])
  })

  test("only the engine persistence writer directly writes EnginePlanNodeTable", () => {
    expect(directWriteViolations("EnginePlanNodeTable")).toEqual([])
  })

  test("only the engine persistence writer directly writes EngineGoalTable", () => {
    expect(directWriteViolations("EngineGoalTable")).toEqual([])
  })

  test("only the engine task writer directly writes EngineTaskTable", () => {
    expect(directWriteViolations("EngineTaskTable")).toEqual([])
  })

  test("only the engine persistence writer directly writes EngineRequirementTable", () => {
    expect(directWriteViolations("EngineRequirementTable")).toEqual([])
  })

  test("only the metrics store directly writes EngineMetricSpecTable", () => {
    expect(directWriteViolations("EngineMetricSpecTable")).toEqual([])
  })

  test("only the metrics store directly writes EngineMetricResultTable", () => {
    expect(directWriteViolations("EngineMetricResultTable")).toEqual([])
  })

  test("only the metrics store directly writes EngineIterationTable", () => {
    expect(directWriteViolations("EngineIterationTable")).toEqual([])
  })

  test("only the scheduler cron service directly writes CronJobTable", () => {
    expect(directWriteViolations("CronJobTable")).toEqual([])
  })

  test("only the scheduler event service directly writes EventJobTable", () => {
    expect(directWriteViolations("EventJobTable")).toEqual([])
  })

  test("only the scheduler task queue service directly writes TaskQueueTable", () => {
    expect(directWriteViolations("TaskQueueTable")).toEqual([])
  })
})
