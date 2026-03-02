import { describe, expect, test } from "bun:test"
import { messageControlOnly, textAudience, textForACP, textForBoth, textForModel, textForUI } from "../../src/session/part-visibility"

describe("part-visibility", () => {
  test("uses legacy synthetic mapping", () => {
    const part = { synthetic: true }
    expect(textForModel(part)).toBe(true)
    expect(textForUI(part)).toBe(false)
    expect(textForBoth(part)).toBe(false)
    expect(textForACP(part)).toBe(true)
    expect(textAudience(part)).toBe("assistant")
  })

  test("uses legacy ignored mapping", () => {
    const part = { ignored: true }
    expect(textForModel(part)).toBe(false)
    expect(textForUI(part)).toBe(true)
    expect(textForBoth(part)).toBe(false)
    expect(textForACP(part)).toBe(true)
    expect(textAudience(part)).toBe("user")
  })

  test("uses audience overrides", () => {
    const part = {
      audience: {
        model: false,
        ui: true,
        acp: false,
      },
    }
    expect(textForModel(part)).toBe(false)
    expect(textForUI(part)).toBe(true)
    expect(textForBoth(part)).toBe(false)
    expect(textForACP(part)).toBe(false)
    expect(textAudience(part)).toBe("user")
  })

  test("detects control-only message", () => {
    expect(
      messageControlOnly([
        {
          type: "text",
          synthetic: true,
        },
      ]),
    ).toBe(true)
    expect(
      messageControlOnly([
        {
          type: "text",
          ignored: true,
        },
      ]),
    ).toBe(false)
    expect(
      messageControlOnly([
        {
          type: "file",
        },
      ]),
    ).toBe(false)
  })
})
