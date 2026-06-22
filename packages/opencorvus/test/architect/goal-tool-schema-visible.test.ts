import { expect, test } from "bun:test"
import { asSchema } from "ai"
import { createArchitectOutputTools } from "@/architect/output-tools"

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

function assertArchitectAcceptanceSpecSchemaVisible(node: JsonObject) {
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
  expect(rendered).toContain("shell")
  expect(rendered).toContain("llm_judge")
  expect(rendered).toContain("contract_audit")
  expect(rendered).toContain("visual-evidence-bundle")
  expect(rendered).toContain("visual_evidence")
  expect(rendered).not.toContain("script_ref")
}

test("architect goal tool schemas expose scriptless acceptance_specs shape to the model", () => {
  const architect = createArchitectOutputTools({ existingGoals: [], workDir: process.cwd() })

  const registerGoalJsonSchema = asObject(asSchema(architect.tools.register_goal.inputSchema as never).jsonSchema)
  const modifyGoalJsonSchema = asObject(asSchema(architect.tools.modify_goal.inputSchema as never).jsonSchema)

  assertArchitectAcceptanceSpecSchemaVisible(acceptanceSpecsNode(registerGoalJsonSchema, ["properties", "acceptance_specs"]))
  assertArchitectAcceptanceSpecSchemaVisible(
    acceptanceSpecsNode(modifyGoalJsonSchema, ["properties", "updates", "properties", "acceptance_specs"]),
  )
})

test("architect exposes canonical final visual evidence acceptance helper", () => {
  const architect = createArchitectOutputTools({ existingGoals: [], workDir: process.cwd() })
  const schema = asObject(asSchema(architect.tools.register_visual_evidence_acceptance.inputSchema as never).jsonSchema)
  const rendered = JSON.stringify(schema)

  expect(Object.keys(asObject(schema.properties))).toEqual(
    expect.arrayContaining(["goal_id", "source_requirement_id", "criteria", "reference_tokens"]),
  )
  expect(rendered).toContain("visual evidence")
  expect(rendered).toContain("reference_tokens")
})
