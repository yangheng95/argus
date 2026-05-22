import { describe, expect, test } from "bun:test"
import { isModelReference } from "../../src/provider/model-ref"

describe("model reference validation", () => {
  test("requires provider/model shape without blank segments", () => {
    expect(isModelReference("openai/gpt-5")).toBe(true)
    expect(isModelReference("gpt-5")).toBe(false)
    expect(isModelReference("openai/")).toBe(false)
    expect(isModelReference("/gpt-5")).toBe(false)
    expect(isModelReference("openai/gpt 5")).toBe(false)
  })
})
