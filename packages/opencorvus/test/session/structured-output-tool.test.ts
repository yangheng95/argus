import { describe, expect, test } from "bun:test"
import z from "zod"
// Load SessionPrompt first so the session module graph initialises before
// SessionLoop is directly imported (matches test/session/extra-tools.test.ts;
// a direct SessionLoop import triggers a partial-module circular read).
import "../../src/session/prompt"
import { SessionLoop } from "../../src/session/loop"

/**
 * Unit coverage for SessionLoop.createStructuredOutputTool — the single
 * path stage agents rely on for schema-validated final output after the
 * phase 3 migration. The tests verify the pure, non-LLM parts of the
 * contract: shape, id, validator, onSuccess capture, toModelOutput.
 *
 * Schema-failure self-correction (LLM retries after the AI SDK flags
 * tool-input-validation) is enforced by AI SDK's built-in tool-call
 * validator; these tests exercise the static wiring to confirm a bad
 * payload is rejected before the onSuccess collector ever fires.
 */

type AIToolLike = {
  inputSchema: Record<string, unknown>
  execute: (args: unknown, opts: { toolCallId?: string; messages?: unknown[]; abortSignal?: AbortSignal }) => Promise<{ output: string; title: string; metadata: Record<string, unknown> }>
  toModelOutput?: (result: unknown) => { type: string; value: string }
  description?: string
  strict?: boolean
}

async function expectStructuredOutputPayloadError(
  run: Promise<unknown>,
  expected: string,
) {
  try {
    await run
    throw new Error("expected StructuredOutputPayloadError")
  } catch (err) {
    expect((err as { name?: string }).name).toBe("StructuredOutputPayloadError")
    expect((err as { data?: { message?: string } }).data?.message).toBe(expected)
  }
}

function jsonSchema(shape: z.ZodType): Record<string, any> {
  // Strip $schema so createStructuredOutputTool's destructure sees the
  // same shape the loop's prompt/format path passes.
  const { $schema: _discard, ...rest } = z.toJSONSchema(shape) as Record<string, any>
  return rest
}

describe("SessionLoop.createStructuredOutputTool", () => {
  test("json_schema requires a tool call for every model family", () => {
    expect(SessionLoop.structuredOutputToolChoice({
      type: "json_schema",
      schema: { type: "object", properties: { answer: { type: "string" } } },
      retryCount: 2,
    })).toBe("required")
    expect(SessionLoop.structuredOutputToolChoice({ type: "text" })).toBeUndefined()
  })

  test("produces a tool with id=StructuredOutput and a non-empty description", () => {
    const captured: unknown[] = []
    const schemaShape = jsonSchema(z.object({ answer: z.string() }))
    const t = SessionLoop.createStructuredOutputTool({
      schema: schemaShape,
      onSuccess: (out) => captured.push(out),
    }) as unknown as AIToolLike & { id?: string }

    // ai's tool() stores id separately; we only check the wired description.
    expect(typeof t.description).toBe("string")
    expect((t.description ?? "").length).toBeGreaterThan(0)
    expect(t.strict).toBe(true)
  })

  test("execute delivers the args to onSuccess verbatim and returns success output", async () => {
    const captured: unknown[] = []
    const schemaShape = jsonSchema(z.object({ answer: z.string(), confidence: z.number() }))
    const t = SessionLoop.createStructuredOutputTool({
      schema: schemaShape,
      onSuccess: (out) => captured.push(out),
    }) as unknown as AIToolLike

    const args = { answer: "yes", confidence: 0.9 }
    const result = await t.execute(args, { toolCallId: "call_1" })

    expect(captured.length).toBe(1)
    expect(captured[0]).toEqual(args)
    expect(result.output).toBe("Structured output captured successfully.")
    expect(result.title).toBe("Structured Output")
    expect(result.metadata).toEqual({ valid: true })
  })

  test("execute rejects undefined payload before onSuccess", async () => {
    const captured: unknown[] = []
    const schemaShape = jsonSchema(z.object({ answer: z.string() }))
    const t = SessionLoop.createStructuredOutputTool({
      schema: schemaShape,
      onSuccess: (out) => captured.push(out),
    }) as unknown as AIToolLike

    await expectStructuredOutputPayloadError(
      t.execute(undefined, { toolCallId: "call_empty" }),
      "StructuredOutput payload must be a JSON object; received undefined",
    )
    expect(captured).toEqual([])
  })

  test("execute rejects null payload before onSuccess", async () => {
    const captured: unknown[] = []
    const schemaShape = jsonSchema(z.object({ answer: z.string() }))
    const t = SessionLoop.createStructuredOutputTool({
      schema: schemaShape,
      onSuccess: (out) => captured.push(out),
    }) as unknown as AIToolLike

    await expectStructuredOutputPayloadError(
      t.execute(null, { toolCallId: "call_null" }),
      "StructuredOutput payload must be a JSON object; received null",
    )
    expect(captured).toEqual([])
  })

  test("execute rejects array payload before onSuccess", async () => {
    const captured: unknown[] = []
    const schemaShape = jsonSchema(z.object({ answer: z.string() }))
    const t = SessionLoop.createStructuredOutputTool({
      schema: schemaShape,
      onSuccess: (out) => captured.push(out),
    }) as unknown as AIToolLike

    await expectStructuredOutputPayloadError(
      t.execute([{ answer: "yes" }], { toolCallId: "call_array" }),
      "StructuredOutput payload must be a JSON object; received array",
    )
    expect(captured).toEqual([])
  })

  test("execute rejects schema-invalid object before onSuccess when provider validation is bypassed", async () => {
    const captured: unknown[] = []
    const schemaShape = jsonSchema(z.object({ answer: z.string() }))
    const t = SessionLoop.createStructuredOutputTool({
      schema: schemaShape,
      onSuccess: (out) => captured.push(out),
    }) as unknown as AIToolLike

    await expectStructuredOutputPayloadError(
      t.execute({ answer: 42 }, { toolCallId: "call_schema_invalid" }),
      "StructuredOutput payload did not match the registered JSON schema: /answer must be string",
    )
    expect(captured).toEqual([])
  })

  test("execute rejects semantic guard failures before onSuccess", async () => {
    const captured: unknown[] = []
    const schemaShape = jsonSchema(z.object({ status: z.enum(["passed", "failed"]) }))
    const t = SessionLoop.createStructuredOutputTool({
      schema: schemaShape,
      validate: (out) => {
        const status = (out as { status?: unknown }).status
        return status === "passed" ? "merge_back must complete before status=passed" : undefined
      },
      onSuccess: (out) => captured.push(out),
    }) as unknown as AIToolLike

    await expect(t.execute({ status: "passed" }, { toolCallId: "call_guard" }))
      .rejects
      .toThrow("merge_back must complete")
    expect(captured).toEqual([])

    const ok = await t.execute({ status: "failed" }, { toolCallId: "call_guard_2" })
    expect(ok.metadata).toEqual({ valid: true })
    expect(captured).toEqual([{ status: "failed" }])
  })

  test("toModelOutput returns the tool-call result as a text block", async () => {
    const schemaShape = jsonSchema(z.object({ answer: z.string() }))
    const t = SessionLoop.createStructuredOutputTool({
      schema: schemaShape,
      onSuccess: () => undefined,
    }) as unknown as AIToolLike

    const result = await t.execute({ answer: "a" }, { toolCallId: "call_a" })
    const forModel = t.toModelOutput?.(result)
    expect(forModel).toEqual({ type: "text", value: result.output })
  })

  test("toModelOutput unwraps AI SDK v6 tool output args", async () => {
    const schemaShape = jsonSchema(z.object({ answer: z.string() }))
    const t = SessionLoop.createStructuredOutputTool({
      schema: schemaShape,
      onSuccess: () => undefined,
    }) as unknown as AIToolLike

    const result = await t.execute({ answer: "a" }, { toolCallId: "call_a" })
    const forModel = t.toModelOutput?.({
      toolCallId: "call_a",
      input: { answer: "a" },
      output: result,
    })
    expect(forModel).toEqual({ type: "text", value: result.output })
  })

  test("execute accepts a nested matching payload", async () => {
    const captured: unknown[] = []
    const schemaShape = jsonSchema(
      z.object({
        summary: z.string(),
        items: z.array(z.string()),
      }),
    )
    const t = SessionLoop.createStructuredOutputTool({
      schema: schemaShape,
      onSuccess: (out) => captured.push(out),
    }) as unknown as AIToolLike

    const payload = { summary: "s", items: ["x", "y"] }
    const result = await t.execute(payload, { toolCallId: "call_nested" })
    expect(result.metadata).toEqual({ valid: true })
    expect(captured).toEqual([payload])
  })

  test("execute rejects a mismatching payload with wrong types", async () => {
    const captured: unknown[] = []
    const schemaShape = jsonSchema(
      z.object({
        summary: z.string(),
        items: z.array(z.string()),
      }),
    )
    const t = SessionLoop.createStructuredOutputTool({
      schema: schemaShape,
      onSuccess: (out) => captured.push(out),
    }) as unknown as AIToolLike

    await expectStructuredOutputPayloadError(
      t.execute({ summary: 123, items: "not-an-array" }, { toolCallId: "call_wrong_types" }),
      "StructuredOutput payload did not match the registered JSON schema: /summary must be string; /items must be array",
    )
    expect(captured).toEqual([])
  })

  test("execute enforces draft 2020-12 tuple schemas", async () => {
    const captured: unknown[] = []
    const schemaShape = jsonSchema(z.object({ pair: z.tuple([z.string(), z.number()]) }))
    const t = SessionLoop.createStructuredOutputTool({
      schema: schemaShape,
      onSuccess: (out) => captured.push(out),
    }) as unknown as AIToolLike

    await expectStructuredOutputPayloadError(
      t.execute({ pair: ["name", "not-a-number"] }, { toolCallId: "call_tuple" }),
      "StructuredOutput payload did not match the registered JSON schema: /pair/1 must be number",
    )
    expect(captured).toEqual([])
  })

  test("a validation failure does NOT invoke onSuccess", async () => {
    let captured: unknown[] = []
    const schemaShape = jsonSchema(
      z.object({
        answer: z.string(),
      }),
    )
    const t = SessionLoop.createStructuredOutputTool({
      schema: schemaShape,
      onSuccess: (out) => captured.push(out),
    }) as unknown as AIToolLike

    await expectStructuredOutputPayloadError(
      t.execute({}, { toolCallId: "call_missing_required" }),
      "StructuredOutput payload did not match the registered JSON schema: <root> must have required property 'answer'",
    )
    expect(captured).toEqual([])
  })

  test("ignores a $schema field on the input shape", async () => {
    // The StructuredOutput wrapper strips `$schema` before wiring the tool
    // (some providers reject it). This test verifies that stripping is
    // transparent and the wrapped tool still produces a valid validator.
    const shapeWithMeta = { $schema: "http://json-schema.org/draft-07/schema#", ...jsonSchema(z.object({ ok: z.boolean() })) }
    const t = SessionLoop.createStructuredOutputTool({
      schema: shapeWithMeta,
      onSuccess: () => undefined,
    }) as unknown as AIToolLike

    const result = await t.execute({ ok: true }, { toolCallId: "call_schema_meta" })
    expect(result.metadata).toEqual({ valid: true })
  })

  test("multiple tools from repeated factory calls have isolated onSuccess channels", async () => {
    const a: unknown[] = []
    const b: unknown[] = []
    const shape = jsonSchema(z.object({ v: z.string() }))

    const toolA = SessionLoop.createStructuredOutputTool({ schema: shape, onSuccess: (out) => a.push(out) }) as unknown as AIToolLike
    const toolB = SessionLoop.createStructuredOutputTool({ schema: shape, onSuccess: (out) => b.push(out) }) as unknown as AIToolLike

    await toolA.execute({ v: "alpha" }, { toolCallId: "a" })
    await toolB.execute({ v: "beta" }, { toolCallId: "b" })

    expect(a).toEqual([{ v: "alpha" }])
    expect(b).toEqual([{ v: "beta" }])
  })
})
