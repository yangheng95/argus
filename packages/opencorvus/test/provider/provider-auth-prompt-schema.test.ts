import { describe, expect, test } from "bun:test"
import { ProviderAuth } from "../../src/provider/auth"

describe("provider auth prompt schema", () => {
  test("select prompts require an explicit selectValue", () => {
    const withoutValue = ProviderAuth.Prompt.safeParse({
      type: "select",
      key: "region",
      message: "Region",
      options: [
        { label: "Europe", value: "eu" },
        { label: "United States", value: "us" },
      ],
    })

    const withValue = ProviderAuth.Prompt.safeParse({
      type: "select",
      key: "region",
      message: "Region",
      selectValue: "us",
      options: [
        { label: "Europe", value: "eu" },
        { label: "United States", value: "us" },
      ],
    })

    expect(withoutValue.success).toBe(false)
    expect(withValue.success).toBe(true)
  })

  test("auth method schema preserves the explicit preferred source", () => {
    const method = ProviderAuth.Method.parse({
      type: "oauth",
      label: "Browser OAuth",
      preferred: true,
    })

    expect(method).toEqual({
      type: "oauth",
      label: "Browser OAuth",
      preferred: true,
    })
  })
})
