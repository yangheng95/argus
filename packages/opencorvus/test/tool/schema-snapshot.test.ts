import { describe, expect, test } from "bun:test"
import z from "zod"
import { AnalyticsTool } from "../../src/tool/analytics"
import { ApplyPatchTool } from "../../src/tool/apply_patch"
import { BashTool } from "../../src/tool/bash"
import { EditTool } from "../../src/tool/edit"
import { GlobTool } from "../../src/tool/glob"
import { GoalReportTool } from "../../src/tool/goal-report"
import { SearchCodeTool } from "../../src/tool/grep"
import { MemoryTool } from "../../src/tool/memory"
import { PanelTool } from "../../src/tool/panel"
import { PlannerTool } from "../../src/tool/planner"
import { ReadTool } from "../../src/tool/read"
import { ScheduleTool } from "../../src/tool/schedule"
import { SkillTool } from "../../src/tool/skill"
import { TaskReportTool } from "../../src/tool/task-report"
import { TaskTool } from "../../src/tool/task"
import { TodoReadTool, TodoWriteTool } from "../../src/tool/todo"
import type { Tool } from "../../src/tool/tool"
import { WebFetchTool } from "../../src/tool/webfetch"
import { WebSearchTool } from "../../src/tool/websearch"
import { WriteTool } from "../../src/tool/write"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const BUILT_IN_TOOLS: Tool.Info[] = [
  AnalyticsTool,
  ApplyPatchTool,
  BashTool,
  EditTool,
  GlobTool,
  GoalReportTool,
  SearchCodeTool,
  MemoryTool,
  PanelTool,
  PlannerTool,
  ReadTool,
  ScheduleTool,
  SkillTool,
  TaskReportTool,
  TaskTool,
  TodoReadTool,
  TodoWriteTool,
  WebFetchTool,
  WebSearchTool,
  WriteTool,
]

function normalizeDynamicDescriptions(value: unknown, directory: string): unknown {
  if (typeof value === "string") return value.replaceAll(directory, "<instance-directory>")
  if (Array.isArray(value)) return value.map((item) => normalizeDynamicDescriptions(item, directory))
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeDynamicDescriptions(item, directory)]),
    )
  }
  return value
}

describe("tool parameter schemas", () => {
  test("keeps built-in tool schemas stable", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const schemas: Record<string, unknown> = {}
        for (const info of BUILT_IN_TOOLS.sort((left, right) => left.id.localeCompare(right.id))) {
          const tool = await info.init()
          schemas[info.id] = normalizeDynamicDescriptions(z.toJSONSchema(tool.parameters), tmp.path)
        }

        expect(schemas).toMatchSnapshot()
      },
    })
  }, 20000)
})
