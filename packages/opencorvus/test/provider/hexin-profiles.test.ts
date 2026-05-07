import { expect, test } from "bun:test"
import { profileFor } from "../../src/provider/hexin-profiles"

test("hexin gpt-5.4 profile uses the large GPT-5.4 context window", () => {
  const profile = profileFor("gpt-5.4")
  expect(profile.context).toBe(1_050_000)
  expect(profile.input).toBe(922_000)
  expect(profile.output).toBe(128_000)
  expect(profile.image_in).toBe(true)
})

test("hexin gpt-5.4 mini and nano profiles keep GPT-5 generation limits", () => {
  const mini = profileFor("gpt-5.4-mini")
  const nano = profileFor("gpt-5.4-nano")

  expect(mini.context).toBe(400_000)
  expect(mini.input).toBe(272_000)
  expect(mini.output).toBe(128_000)
  expect(nano.context).toBe(400_000)
  expect(nano.input).toBe(272_000)
  expect(nano.output).toBe(128_000)
})
