import { describe, expect, test } from "bun:test"
import z from "zod"
import { tool, jsonSchema as aiJsonSchema } from "ai"
// Load SessionPrompt first so the session module graph initialises before
// SessionLoop is directly imported (matches structured-output-tool.test.ts).
import "../../src/session/prompt"
import { SessionLoop } from "../../src/session/loop"

/**
 * Phase A of deleted pre-June record 2026-04-28-structured-output-systemic-fix:
 * the predictive-compaction trigger must size tools by the JSON Schema that
 * actually goes on the wire, not by `JSON.stringify(zodWrapper)` which walks
 * the Zod object's `_def` graph and produces wildly inflated counts.
 *
 * Concretely, on integrity reviewer's 4 dimension tools the old estimator
 * reported toolSchemaChars=992342 (≈ 258K tokens) and pre-empted step 1 with
 * `predictive-compaction-triggered`. The provider-normalised schema for the
 * same tools is well under that.
 */
describe("SessionLoop.estimateToolPayloadChars", () => {
  test("counts the provider-bound JSON Schema, not the Zod wrapper internals", () => {
    const deeplyNested = z.object({
      summary: z.string().min(1),
      items: z.array(
        z.object({
          kind: z.enum(["a", "b", "c"]),
          payload: z.object({
            ref: z.string(),
            tags: z.array(z.string()),
          }),
        }),
      ),
    })

    const inputJsonSchema = z.toJSONSchema(deeplyNested) as Record<string, unknown>
    const aiTool = tool({
      description: "deep-nested",
      inputSchema: aiJsonSchema(inputJsonSchema as never),
      async execute() {
        return { output: "", title: "", metadata: {} }
      },
    })

    const estimated = SessionLoop.estimateToolPayloadChars({ deepTool: aiTool })

    // The wire payload contains the JSON Schema string + name + description.
    const wireLength = JSON.stringify(inputJsonSchema).length + "deepTool".length + "deep-nested".length

    // Allow a small ±5% drift for ai-sdk's internal normalisation, but the
    // estimator must NOT balloon to many times the true wire size (the old
    // code did exactly that by stringifying the Zod wrapper's `_def` graph).
    expect(estimated).toBeGreaterThanOrEqual(Math.floor(wireLength * 0.95))
    expect(estimated).toBeLessThanOrEqual(Math.ceil(wireLength * 1.05))
  })

  test("returns 0 for an empty tool set", () => {
    expect(SessionLoop.estimateToolPayloadChars({})).toBe(0)
  })

  test("scales linearly with the number of tools (no double counting)", () => {
    const make = () =>
      tool({
        description: "x",
        inputSchema: aiJsonSchema(z.toJSONSchema(z.object({ field: z.string() })) as never),
        async execute() {
          return { output: "", title: "", metadata: {} }
        },
      })

    const single = SessionLoop.estimateToolPayloadChars({ a: make() })
    const triple = SessionLoop.estimateToolPayloadChars({ a: make(), b: make(), c: make() })

    // 3× the same tool → ~3× the byte count (plus a few bytes for unique names).
    expect(triple).toBeGreaterThanOrEqual(single * 3 - 4)
    expect(triple).toBeLessThanOrEqual(single * 3 + 4)
  })

  test("does not throw when a tool exposes a malformed inputSchema", () => {
    const broken = {
      description: "broken",
      // intentionally pass a value asSchema() cannot interpret as a wrapper
      inputSchema: undefined,
    }
    expect(() => SessionLoop.estimateToolPayloadChars({ broken: broken as never })).not.toThrow()
  })
})

describe("SessionLoop.normalizeToolSchemaForProvider", () => {
  // Stub Provider.Model — only `providerID` and `api.id` are read by
  // ProviderTransform.schema; the rest can be {} to keep the test pure.
  const fakeModel = {
    providerID: "test-provider",
    api: { id: "test-model" },
  } as unknown as Parameters<typeof SessionLoop.normalizeToolSchemaForProvider>[0]

  test("returns a JSON Schema that round-trips through stringify (no Zod internals)", () => {
    const schema = z.toJSONSchema(z.object({ a: z.string(), b: z.number().optional() })) as Record<string, unknown>
    const out = SessionLoop.normalizeToolSchemaForProvider(fakeModel, schema)
    const json = JSON.stringify(out)
    expect(json.length).toBeGreaterThan(0)
    expect(json).toContain('"type":"object"')
    // ProviderTransform.schema is identity for non-google providers, so the
    // shape must still describe the same fields.
    expect(json).toContain("a")
  })

  test("is the same call ProviderTransform.schema would make — single source", () => {
    const schema = z.toJSONSchema(z.object({ x: z.string() })) as Record<string, unknown>
    const helperOut = SessionLoop.normalizeToolSchemaForProvider(fakeModel, schema)
    // Re-running the helper on its own output must be idempotent for the
    // happy path (non-google provider, no integer-enum coercion). Drift here
    // would mean the estimator and the runtime tool wrapper see different
    // schemas, defeating the §A invariant.
    const second = SessionLoop.normalizeToolSchemaForProvider(fakeModel, helperOut)
    expect(JSON.stringify(second)).toEqual(JSON.stringify(helperOut))
  })
})
