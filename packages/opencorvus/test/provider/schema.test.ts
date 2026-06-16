import { describe, expect, test } from "bun:test"
import { asSchema } from "ai"
import z from "zod"
import { ProviderSchema } from "@/provider/schema"

const hexinGptModel = {
  id: "hexin/gpt-5.5",
  providerID: "hexin",
  api: {
    id: "gpt-5.5",
    url: "https://aimemodeldev.myhexin.com/litellm/v1",
    npm: "@ai-sdk/openai-compatible",
  },
} as any

describe("ProviderSchema.output", () => {
  test("normalizes object schemas through ProviderTransform.schema", () => {
    const schema = ProviderSchema.output(
      hexinGptModel,
      z.object({
        suggestion: z.string(),
        rationale: z.string().optional(),
      }),
    )
    const json = asSchema(schema).jsonSchema as any

    expect(json.required).toEqual(["suggestion", "rationale"])
    expect(json.properties.rationale.anyOf).toContainEqual({ type: "null" })
    expect(json.additionalProperties).toBe(false)
  })

  test("keeps Zod validation attached to structured outputs", async () => {
    const schema = asSchema(ProviderSchema.output(hexinGptModel, z.object({ suggestion: z.string() })))

    expect(await schema.validate?.({ suggestion: "continue" })).toEqual({
      success: true,
      value: { suggestion: "continue" },
    })
    const rejected = await schema.validate?.({ suggestion: 1 })
    expect(rejected?.success).toBe(false)
  })
})

describe("ProviderSchema.input", () => {
  test("normalizes tool schemas through ProviderTransform.schema", () => {
    const schema = ProviderSchema.input(
      hexinGptModel,
      z.object({
        steps: z.array(
          z.object({
            action: z.literal("assertSelector"),
            selector: z.string(),
            present: z.boolean().optional(),
          }),
        ),
      }),
    )
    const json = asSchema(schema).jsonSchema as any
    const step = json.properties.steps.items

    expect(step.required).toEqual(["action", "selector", "present"])
    expect(step.properties.present.anyOf).toContainEqual({ type: "null" })
    expect(step.additionalProperties).toBe(false)
  })
})
