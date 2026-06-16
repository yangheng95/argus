import { expect, test } from "bun:test"
import { asSchema } from "ai"
import { createArchitectOutputTools } from "@/architect/output-tools"
import { createOrchestratorTools } from "@/orchestrator/tools"

type JsonObject = Record<string, any>

function asObject(value: unknown): JsonObject {
  expect(typeof value).toBe("object")
  expect(value).not.toBeNull()
  expect(Array.isArray(value)).toBe(false)
  return value as JsonObject
}

function acceptanceSpecsNode(schema: JsonObject, path: string[]): JsonObject {
  let node: JsonObject = schema
  for (const segment of path) {
    node = asObject(node[segment])
  }
  return node
}

function assertAcceptanceSpecSchemaVisible(node: JsonObject) {
  expect(node.type).toBe("array")
  const items = asObject(node.items)
  expect(items.type).toBe("object")

  const properties = asObject(items.properties)
  expect(Object.keys(properties)).toEqual(expect.arrayContaining(["id", "severity", "scorers"]))
  expect(items.required).toEqual(expect.arrayContaining(["id", "severity", "scorers"]))

  const scorers = asObject(properties.scorers)
  expect(scorers.type).toBe("array")
  const scorerItems = asObject(scorers.items)
  const scorerVariants = scorerItems.oneOf ?? scorerItems.anyOf
  expect(Array.isArray(scorerVariants)).toBe(true)
  expect(scorerVariants.length).toBeGreaterThanOrEqual(4)

  const rendered = JSON.stringify(node)
  expect(rendered).toContain("Not for contract_audit; contract_audit is its own scorer type")
  expect(rendered).toContain("This is a scorer type, not a script_ref path")
}

test("goal tool schemas expose acceptance_specs shape to the model", () => {
  const architect = createArchitectOutputTools({ existingGoals: [], workDir: process.cwd() })
  const orchestrator = createOrchestratorTools({ taskID: "tsk_schema_visible", agentSessionID: "ses_schema_visible" })

  const registerGoalJsonSchema = asObject(asSchema(architect.tools.register_goal.inputSchema as never).jsonSchema)
  const modifyGoalJsonSchema = asObject(asSchema(orchestrator.tools.modify_goal.inputSchema as never).jsonSchema)

  assertAcceptanceSpecSchemaVisible(acceptanceSpecsNode(registerGoalJsonSchema, ["properties", "acceptance_specs"]))
  assertAcceptanceSpecSchemaVisible(
    acceptanceSpecsNode(modifyGoalJsonSchema, ["properties", "updates", "properties", "acceptance_specs"]),
  )
})
