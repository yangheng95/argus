import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")

type Operation = {
  operationId?: string
  parameters?: Array<{ name?: string; in?: string }>
  requestBody?: {
    content?: {
      "application/json"?: {
        schema?: {
          properties?: Record<string, unknown>
          required?: string[]
        }
      }
    }
  }
}

type OpenApi = {
  paths?: Record<string, Record<string, Operation>>
}

const scheduleOperations = [
  ["get", "/experimental/schedule", "experimental.schedule.list"],
  ["post", "/experimental/schedule", "experimental.schedule.create"],
  ["delete", "/experimental/schedule/{id}", "experimental.schedule.delete"],
  ["get", "/experimental/event-schedule", "experimental.eventschedule.list"],
  ["post", "/experimental/event-schedule", "experimental.eventschedule.create"],
  ["delete", "/experimental/event-schedule/{id}", "experimental.eventschedule.delete"],
] as const

const scheduleDataTypes = [
  "ExperimentalScheduleListData",
  "ExperimentalScheduleCreateData",
  "ExperimentalScheduleDeleteData",
  "ExperimentalEventscheduleListData",
  "ExperimentalEventscheduleCreateData",
  "ExperimentalEventscheduleDeleteData",
] as const

function openApi() {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, "packages", "sdk", "openapi.json"), "utf8")) as OpenApi
}

function typeBlock(source: string, typeName: string) {
  const start = source.indexOf(`export type ${typeName} =`)
  expect(start).toBeGreaterThanOrEqual(0)
  const rest = source.slice(start + 1)
  const next = rest.search(/\nexport type /)
  return next === -1 ? source.slice(start) : source.slice(start, start + 1 + next)
}

describe("experimental schedule generated contract", () => {
  test("OpenAPI schedule operations expose directory but not projectId", () => {
    const spec = openApi()

    for (const [method, routePath, operationID] of scheduleOperations) {
      const operation = spec.paths?.[routePath]?.[method]
      expect(operation?.operationId).toBe(operationID)
      const queryNames = (operation?.parameters ?? [])
        .filter((parameter) => parameter.in === "query")
        .map((parameter) => parameter.name)
      expect(queryNames).toContain("directory")
      expect(queryNames).not.toContain("projectId")

      const schema = operation?.requestBody?.content?.["application/json"]?.schema
      expect(schema?.properties ?? {}).not.toHaveProperty("projectId")
      expect(schema?.required ?? []).not.toContain("projectId")
    }
  })

  test("generated SDK schedule methods do not accept or send projectId", () => {
    const sdkSource = fs.readFileSync(
      path.join(repoRoot, "packages", "sdk", "js", "src", "gen", "sdk.gen.ts"),
      "utf8",
    )
    const typeSource = fs.readFileSync(
      path.join(repoRoot, "packages", "sdk", "js", "src", "gen", "types.gen.ts"),
      "utf8",
    )

    for (const [_method, routePath] of scheduleOperations) {
      const sdkBlocks = sdkSource
        .split("\n  public ")
        .filter((block) => block.includes(`url: "${routePath}"`))
      expect(sdkBlocks.length).toBeGreaterThan(0)
      for (const block of sdkBlocks) {
        expect(block).not.toContain("projectId")
        expect(block).not.toContain('{ in: "query", key: "projectId" }')
        expect(block).not.toContain('{ in: "body", key: "projectId" }')
      }
    }

    for (const typeName of scheduleDataTypes) {
      expect(typeBlock(typeSource, typeName)).not.toContain("projectId")
    }
  })
})
