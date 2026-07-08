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
  ControlAccountTable: "packages/opencorvus/src/control/index.ts",
  ControlMessageTable: "packages/opencorvus/src/control/timeline.ts",
  DecisionLogTable: "packages/opencorvus/src/decision-log/index.ts",
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
  EngineRunTable: "packages/opencorvus/src/engine/writer.ts",
  EngineSpecSnapshotTable: "packages/opencorvus/src/engine/spec-snapshot.ts",
  EngineTaskTable: "packages/opencorvus/src/engine/task.ts",
  EventJobTable: "packages/opencorvus/src/scheduler/event-service.ts",
  MemoryChunkTable: "packages/opencorvus/src/memory/index.ts",
  MemoryFileTable: "packages/opencorvus/src/memory/index.ts",
  MessageTable: "packages/opencorvus/src/session/index.ts",
  PartTable: "packages/opencorvus/src/session/index.ts",
  PermissionTable: "packages/opencorvus/src/permission/next.ts",
  ProjectTable: "packages/opencorvus/src/project/project.ts",
  ProtocolEventTable: "packages/opencorvus/src/protocol/store.ts",
  QuickNoteTable: "packages/opencorvus/src/quicknote/service.ts",
  ScratchpadTable: "packages/opencorvus/src/memory/scratchpad.ts",
  SessionControlRecordTable: "packages/opencorvus/src/session/control.ts",
  SessionTable: "packages/opencorvus/src/session/index.ts",
  TaskPlanTable: "packages/opencorvus/src/memory/task-plan.ts",
  TaskQueueTable: "packages/opencorvus/src/scheduler/task-queue-service.ts",
  TodoTable: "packages/opencorvus/src/session/todo.ts",
  WorkbenchBriefSnapshotTable: "packages/opencorvus/src/workbench/brief.ts",
  WorkbenchTaskNoteTable: "packages/opencorvus/src/workbench/note-store.ts",
  WorkerTurnDescriptorTable: "packages/opencorvus/src/agent/worker-turn-descriptor.ts",
  WorkspaceTable: "packages/opencorvus/src/workspace/workspace.ts",
}

function directWriteLocationsByTable(): Record<string, string[]> {
  const locations: Record<string, Set<string>> = {}
  const writePattern = /\.(insert|update|delete)\s*\(\s*([A-Za-z0-9_]+Table)\b/g

  for (const file of productionSourceFiles(sourceRoot)) {
    const path = projectPath(file)
    const source = readFileSync(file, "utf8")
    for (const match of source.matchAll(writePattern)) {
      const tableName = match[2]
      if (!tableName) continue
      locations[tableName] ??= new Set<string>()
      locations[tableName].add(path)
    }
  }

  return Object.fromEntries(
    Object.entries(locations)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([tableName, files]) => [tableName, [...files].sort()]),
  )
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
  test("every production direct table write has an approved single writer", () => {
    const locationsByTable = directWriteLocationsByTable()
    expect(Object.keys(locationsByTable)).toEqual(Object.keys(approvedWriters).sort())
    for (const [tableName, approvedWriter] of Object.entries(approvedWriters)) {
      expect(locationsByTable[tableName]).toEqual([approvedWriter])
    }
  })

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

  test("only the session writer directly writes PartTable", () => {
    expect(directWriteViolations("PartTable")).toEqual([])
  })

  test("only the control timeline writer directly writes ControlMessageTable", () => {
    expect(directWriteViolations("ControlMessageTable")).toEqual([])
  })

  test("only the decision log writer directly writes DecisionLogTable", () => {
    expect(directWriteViolations("DecisionLogTable")).toEqual([])
  })

  test("only the quicknote service directly writes QuickNoteTable", () => {
    expect(directWriteViolations("QuickNoteTable")).toEqual([])
  })

  test("only the project service directly writes ProjectTable", () => {
    expect(directWriteViolations("ProjectTable")).toEqual([])
  })
})
