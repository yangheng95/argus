import { describe, expect, test } from "bun:test"
import { renderDimensionCatalogue } from "../../src/integrity/dimensions"

describe("integrity dimensions — owned_paths collaboration semantics", () => {
  test("owned_paths overlap is not described as a hard edit conflict", () => {
    const prompt = renderDimensionCatalogue()

    expect(prompt).toContain("`owned_paths` are responsibility hints, not a file sandbox")
    expect(prompt).toContain("overlap is allowed when goals need to coordinate")
    expect(prompt).not.toContain("Two goals owning the same path")
    expect(prompt).not.toContain("hard build-time conflict")
    expect(prompt).not.toContain("turns merge into roulette")
  })
})
