import { describe, expect, test } from "bun:test"
import { asSchema, tool } from "ai"
import z from "zod"
import { ProviderSchema } from "../../src/provider/schema"
// Import SessionPrompt before SessionLoop to avoid the session/prompt module-init cycle.
import { SessionPrompt } from "../../src/session/prompt"
import { SessionLoop } from "../../src/session/loop"
import { createOrchestratorTools } from "../../src/orchestrator/tools"
import { ToolRegistry } from "../../src/tool/registry"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { BuildResultSchema } from "../../src/build/types"
import { GoalContractFieldsSchema, GoalContractUpdateSchema } from "../../src/pipeline/goal-contract.schema"
import { ToolAdapterRegistry } from "../../src/executor/protocol"
import {
  WebpageAnalyzeTool,
  WebpageCompileTool,
  WebpageExtractTool,
  WebpageRuntimeStateTool,
} from "../../src/frontend-design/tools"
import type { Tool } from "../../src/tool/tool"

void SessionPrompt

type JsonNode = Record<string, any>

const hexinGptModel = {
  id: "hexin/gpt-5.5",
  providerID: "hexin",
  api: {
    id: "gpt-5.5",
    url: "https://aimemodeldev.myhexin.com/litellm/v1",
    npm: "@ai-sdk/openai-compatible",
  },
} as any

const geminiModel = {
  id: "google/gemini-3-pro",
  providerID: "google",
  api: {
    id: "gemini-3-pro",
    url: "https://generativelanguage.googleapis.com",
    npm: "@ai-sdk/google",
  },
} as any

const BUILT_IN_TOOL_IDS = new Set([
  "analytics",
  "apply_patch",
  "bash",
  "browser_preview",
  "external_code_search",
  "glob",
  "goal_report",
  "memory",
  "mission_state",
  "panel",
  "planner",
  "read",
  "schedule",
  "search_code",
  "skill",
  "task",
  "task_report",
  "todoread",
  "todowrite",
  "wait",
  "webfetch",
  "websearch",
])

const FRONTEND_DESIGN_TOOL_INFOS: Tool.Info[] = [
  WebpageAnalyzeTool,
  WebpageCompileTool,
  WebpageExtractTool,
  WebpageRuntimeStateTool,
]

function providerInputJson(inputSchema: unknown, model = hexinGptModel): JsonNode {
  return asSchema(ProviderSchema.input(model, inputSchema as never)).jsonSchema as JsonNode
}

function preparedToolJson(name: string, inputSchema: unknown, model = hexinGptModel): JsonNode {
  const prepared = SessionLoop.prepareProviderTool({
    name,
    source: "extra",
    model,
    tool: tool({
      description: `${name} schema stress tool`,
      inputSchema: inputSchema as any,
      async execute() {
        return { output: "ok", title: "", metadata: {} }
      },
    }),
  }) as any
  return asSchema(prepared.inputSchema).jsonSchema as JsonNode
}

function schemaPath(path: Array<string | number>): string {
  return path.length === 0
    ? "$"
    : `$${path.map((item) => (typeof item === "number" ? `[${item}]` : `.${item}`)).join("")}`
}

function isJsonObject(value: unknown): value is JsonNode {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function collectOpenAIStrictIssues(schema: unknown, path: Array<string | number> = []): string[] {
  if (Array.isArray(schema)) {
    return schema.flatMap((item, index) => collectOpenAIStrictIssues(item, [...path, index]))
  }
  if (!isJsonObject(schema)) return []

  const issues: string[] = []
  const properties = isJsonObject(schema.properties) ? schema.properties : undefined
  if (properties) {
    const keys = Object.keys(properties)
    const required = Array.isArray(schema.required) ? schema.required : []
    const missing = keys.filter((key) => !required.includes(key))
    const extra = required.filter((key: unknown) => typeof key === "string" && !keys.includes(key))
    if (missing.length > 0 || extra.length > 0) {
      issues.push(
        `${schemaPath(path)} required must exactly match properties; missing=[${missing.join(",")}], extra=[${extra.join(",")}]`,
      )
    }
    if (schema.additionalProperties !== false) {
      issues.push(`${schemaPath(path)} object properties must be closed with additionalProperties=false`)
    }
  }

  if (path.length === 0) {
    if (schema.type !== "object") issues.push("$ root provider tool schema must be type=object")
    if (schema.anyOf) issues.push("$ root provider tool schema must not expose anyOf")
    if (schema.oneOf) issues.push("$ root provider tool schema must not expose oneOf")
  }

  for (const [key, value] of Object.entries(schema)) {
    issues.push(...collectOpenAIStrictIssues(value, [...path, key]))
  }
  return issues
}

function collectGeminiIssues(schema: unknown, path: Array<string | number> = []): string[] {
  if (Array.isArray(schema)) {
    return schema.flatMap((item, index) => collectGeminiIssues(item, [...path, index]))
  }
  if (!isJsonObject(schema)) return []

  const issues: string[] = []
  if (path.length === 0) {
    if (schema.type !== "object") issues.push("$ root provider tool schema must be type=object")
    if (schema.anyOf) issues.push("$ root provider tool schema must not expose anyOf")
    if (schema.oneOf) issues.push("$ root provider tool schema must not expose oneOf")
  }
  if (schema.type && schema.type !== "object") {
    if (schema.properties) issues.push(`${schemaPath(path)} non-object schema must not carry properties`)
    if (schema.required) issues.push(`${schemaPath(path)} non-object schema must not carry required`)
  }
  if (schema.type === "array" && schema.items == null) {
    issues.push(`${schemaPath(path)} array schema must declare items`)
  }
  for (const [key, value] of Object.entries(schema)) {
    issues.push(...collectGeminiIssues(value, [...path, key]))
  }
  return issues
}

function collectHiddenAnyIssues(schema: unknown, path: Array<string | number> = []): string[] {
  if (Array.isArray(schema)) {
    return schema.flatMap((item, index) => collectHiddenAnyIssues(item, [...path, index]))
  }
  if (!isJsonObject(schema)) return []

  const keys = Object.keys(schema)
  const issues: string[] = []
  const last = path[path.length - 1]
  if (path.length > 0 && last !== "properties" && keys.length === 0) {
    issues.push(`${schemaPath(path)} hides payload shape behind an empty schema`)
  }
  if (schema.additionalProperties === true) {
    issues.push(`${schemaPath([...path, "additionalProperties"])} leaves object payload shape unconstrained`)
  }
  if (isJsonObject(schema.additionalProperties) && Object.keys(schema.additionalProperties).length === 0) {
    issues.push(`${schemaPath([...path, "additionalProperties"])} hides map value shape behind an empty schema`)
  }
  for (const [key, value] of Object.entries(schema)) {
    if (key === "default" || key === "examples") continue
    issues.push(...collectHiddenAnyIssues(value, [...path, key]))
  }
  return issues
}

function collectTopLevelDescriptionIssues(name: string, schema: JsonNode): string[] {
  const properties = isJsonObject(schema.properties) ? schema.properties : undefined
  if (!properties) return []
  return Object.entries(properties).flatMap(([key, value]) => {
    if (!isJsonObject(value)) return []
    if (value.const !== undefined || (key === "action" && Array.isArray(value.enum))) return []
    const description = schemaDescription(value)
    if (description.length >= 12) return []
    return [`${name}.${key} needs a concrete top-level field description`]
  })
}

function schemaDescription(value: JsonNode): string {
  if (typeof value.description === "string") return value.description.trim()
  for (const key of ["anyOf", "oneOf"] as const) {
    const variants = value[key]
    if (!Array.isArray(variants)) continue
    for (const variant of variants) {
      if (!isJsonObject(variant)) continue
      const description = schemaDescription(variant)
      if (description.length > 0) return description
    }
  }
  return ""
}

function assertEnterpriseProviderSchema(name: string, inputSchema: unknown): void {
  const gpt = providerInputJson(inputSchema, hexinGptModel)
  const gemini = providerInputJson(inputSchema, geminiModel)

  expect(collectOpenAIStrictIssues(gpt), name).toEqual([])
  expect(collectGeminiIssues(gemini), name).toEqual([])
  expect(collectHiddenAnyIssues(gpt), name).toEqual([])
  expect(collectTopLevelDescriptionIssues(name, gpt), name).toEqual([])
}

function assertEnterpriseJsonSchema(name: string, schema: unknown): void {
  expect(collectGeminiIssues(schema), name).toEqual([])
  expect(collectHiddenAnyIssues(schema), name).toEqual([])
  expect(collectTopLevelDescriptionIssues(name, schema as JsonNode), name).toEqual([])
}

describe("schema stress benchmark - provider dialects", () => {
  test("recursive GPT strict schemas stay provider-compatible without weakening local semantics", async () => {
    const inputSchema = z.object({
      chronology: z
        .array(
          z.object({
            event: z.string().describe("Observable event that happened."),
            evidence: z.string().optional().describe("Evidence reference when available."),
          }),
        )
        .describe("Ordered event list."),
    })
    const json = preparedToolJson("submit_timeline", inputSchema)
    expect(collectOpenAIStrictIssues(json)).toEqual([])
    expect(json.properties.chronology.items.properties.evidence.anyOf).toContainEqual({ type: "null" })

    let seenArgs: unknown
    const prepared = SessionLoop.prepareProviderTool({
      name: "submit_timeline",
      source: "extra",
      model: hexinGptModel,
      tool: tool({
        description: "submit timeline",
        inputSchema,
        async execute(args) {
          seenArgs = args
          return { output: "ok", title: "", metadata: {} }
        },
      }),
    }) as any
    await prepared.execute({ chronology: [{ event: "captured", evidence: null }] }, { toolCallId: "call_schema" })
    expect(seenArgs).toEqual({ chronology: [{ event: "captured" }] })
    await expect(
      prepared.execute({ chronology: [{ event: "captured", evidence: 42 }] }, { toolCallId: "call_schema_bad" }),
    ).rejects.toThrow("Invalid input for tool submit_timeline")
  })

  test("terminal discriminated unions expose root objects and preserve canonical validation", async () => {
    const json = preparedToolJson("report_build_result", BuildResultSchema)
    expect(collectOpenAIStrictIssues(json)).toEqual([])
    expect(collectHiddenAnyIssues(json)).toEqual([])
    expect(json.anyOf).toBeUndefined()
    expect(json.properties.status.enum).toEqual(["passed", "failed"])

    const prepared = SessionLoop.prepareProviderTool({
      name: "report_build_result",
      source: "extra",
      model: hexinGptModel,
      tool: tool({
        description: "report build result",
        inputSchema: BuildResultSchema,
        async execute(args) {
          return { output: JSON.stringify(args), title: "", metadata: {} }
        },
      }),
    }) as any

    await expect(
      prepared.execute(
        {
          status: "passed",
          summary: "The verification passed.",
          files_changed: [],
          tests: [],
          fact_check_items: [],
          error: "should not be accepted",
        },
        { toolCallId: "call_build_invalid" },
      ),
    ).rejects.toThrow("Invalid input for tool report_build_result")
  })

  test("goal contract schemas stay visible to models instead of collapsing to unknown objects", () => {
    for (const [name, schema] of [
      ["register_goal", GoalContractFieldsSchema],
      ["modify_goal.updates", GoalContractUpdateSchema],
    ] as const) {
      const json = providerInputJson(schema)
      expect(collectOpenAIStrictIssues(json), name).toEqual([])
      expect(collectHiddenAnyIssues(json), name).toEqual([])
      expect(JSON.stringify(json), name).toContain("acceptance_specs")
      expect(JSON.stringify(json), name).toContain("scorers")
    }
  })
})

describe("schema stress benchmark - live tool surfaces", () => {
  test("executor structured output adapter fails loud without a requested schema", async () => {
    const capabilities = {
      stream: true,
      resume: true,
      interrupt: true,
      builtin_tools: true,
      custom_tools: true,
      structured_output: true,
      approvals: ["command", "user_input"],
      reasoning: true,
      plan_updates: true,
      diff_updates: true,
      mcp: true,
      usage: true,
      realtime: true,
      tool_kinds: ["dynamic", "approval", "input", "shell", "structured_output"],
    }

    const withoutSchema = await ToolAdapterRegistry.declare(
      ToolAdapterRegistry.context({
        provider: "codex",
        capabilities,
      }),
    )
    expect(withoutSchema.some((item) => item.name === "approval")).toBe(false)
    expect(withoutSchema.some((item) => item.name === "structured_output")).toBe(false)
    for (const item of withoutSchema) {
      expect(item.inputSchema, `executor.${item.name} must declare inputSchema`).toBeDefined()
      assertEnterpriseJsonSchema(`executor.${item.name}`, item.inputSchema)
    }

    const schema = providerInputJson(
      z.object({
        summary: z.string().describe("Final concise result summary."),
      }),
    )
    const withSchema = await ToolAdapterRegistry.declare(
      ToolAdapterRegistry.context({
        provider: "codex",
        capabilities,
        settings: {
          structured_output_schema: schema,
        },
      }),
    )
    const structuredOutput = withSchema.find((item) => item.name === "structured_output")
    expect(structuredOutput?.inputSchema).toEqual(schema)
    expect(collectOpenAIStrictIssues(structuredOutput!.inputSchema as JsonNode)).toEqual([])
    expect(collectHiddenAnyIssues(structuredOutput!.inputSchema as JsonNode)).toEqual([])
  })

  test("built-in registry tools expose enterprise-grade provider schemas", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tools = await ToolRegistry.tools(
          { providerID: hexinGptModel.providerID, modelID: hexinGptModel.api.id },
          undefined,
          { experimental: { batch_tool: false } } as any,
        )
        const builtIns = tools
          .filter((item) => BUILT_IN_TOOL_IDS.has(item.id))
          .sort((left, right) => left.id.localeCompare(right.id))

        expect(builtIns.map((item) => item.id)).toEqual([...BUILT_IN_TOOL_IDS].sort())
        for (const item of builtIns) {
          assertEnterpriseProviderSchema(`registry.${item.id}`, item.parameters)
        }
      },
    })
  }, 30000)

  test("batch tool reuses visible target tool schemas instead of hiding parameters", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tools = await ToolRegistry.tools(
          { providerID: hexinGptModel.providerID, modelID: hexinGptModel.api.id },
          undefined,
          { experimental: { batch_tool: true } } as any,
        )
        const batch = tools.find((item) => item.id === "batch")
        expect(batch).toBeDefined()

        assertEnterpriseProviderSchema("registry.batch", batch!.parameters)
        const json = providerInputJson(batch!.parameters)
        expect(JSON.stringify(json)).toContain('"maxItems":25')
        expect(JSON.stringify(json)).toContain('"const":"read"')
        expect(JSON.stringify(json)).toContain('"filePath"')
        expect(JSON.stringify(json)).not.toContain('"additionalProperties":{}')
      },
    })
  }, 30000)

  test("frontend-design webpage evidence tools expose enterprise-grade provider schemas", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        for (const info of FRONTEND_DESIGN_TOOL_INFOS.sort((left, right) => left.id.localeCompare(right.id))) {
          const item = await info.init()
          assertEnterpriseProviderSchema(`frontend-design.${info.id}`, item.parameters)
        }
      },
    })
  }, 30000)

  test("orchestrator tools expose enterprise-grade provider schemas", () => {
    const { tools } = createOrchestratorTools({
      taskID: "tsk_schema_stress",
      agentSessionID: "ses_schema_stress",
      signal: new AbortController().signal,
    })

    for (const [name, item] of Object.entries(tools).sort(([left], [right]) => left.localeCompare(right))) {
      assertEnterpriseProviderSchema(`orchestrator.${name}`, (item as any).inputSchema)
    }
  })
})
