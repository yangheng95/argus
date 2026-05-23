import { describe, expect, test } from "bun:test"
import { BUILTIN_TEST_PROVIDERS } from "../../src/provider/builtin-test-providers"

describe("built-in test providers", () => {
  test("kimik26 declares image attachment support", () => {
    const model = BUILTIN_TEST_PROVIDERS.kimik26.models?.kimik26

    expect(model?.attachment).toBe(true)
    expect(model?.modalities?.input).toContain("image")
  })
})
