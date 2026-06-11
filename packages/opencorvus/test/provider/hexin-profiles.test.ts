import { expect, test } from "bun:test"
import {
  interleavedReasoningProfileContractGaps,
  interleavedReasoningProfileContractIDs,
  profileFor,
} from "../../src/provider/hexin-profiles"
import { GLM_EVALUATION_TEMPERATURE, THINKING_MODEL_TOP_P } from "../../src/provider/sampling"
import { ProviderTransform } from "../../src/provider/transform"

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

test("hexin kimi-k2.6 profile follows Moonshot thinking-model contract", () => {
  const profile = profileFor("kimi-k2.6")

  expect(profile.family).toBe("kimi")
  expect(profile.reasoning).toBe(true)
  expect(profile.temperature).toBe(false)
  expect(profile.toolcall).toBe(true)
  expect(profile.interleaved).toEqual({ field: "reasoning_content" })
  expect(profile.context).toBe(256_000)
})

test("hexin glm-5.1 profile follows Z.AI thinking-model contract", () => {
  const profile = profileFor("openai/glm-5.1")

  expect(profile.family).toBe("glm")
  expect(profile.reasoning).toBe(true)
  expect(profile.toolcall).toBe(true)
  expect(profile.interleaved).toEqual({ field: "reasoning_content" })
  expect(profile.context).toBe(200_000)
  expect(profile.output).toBe(128_000)
  expect(profile.transform?.sampling).toEqual({
    temperature: GLM_EVALUATION_TEMPERATURE,
    topP: THINKING_MODEL_TOP_P,
  })
  expect(profile.transform?.options).toEqual({
    thinking: {
      type: "enabled",
      clear_thinking: false,
    },
  })
})

test("hexin glm-5 profile family uses the same single transform contract", () => {
  const profile = profileFor("glm-5")

  expect(profile.family).toBe("glm")
  expect(profile.reasoning).toBe(true)
  expect(profile.interleaved).toEqual({ field: "reasoning_content" })
  expect(profile.transform?.sampling?.temperature).toBe(GLM_EVALUATION_TEMPERATURE)
  expect(profile.transform?.sampling?.topP).toBe(THINKING_MODEL_TOP_P)
  expect(profile.transform?.options?.thinking).toEqual({
    type: "enabled",
    clear_thinking: false,
  })
})

test("hexin qwen3.7-max profile marks Hexin thinking mode as reasoning", () => {
  const profile = profileFor("qwen3.7-max")

  expect(profile.family).toBe("qwen")
  expect(profile.reasoning).toBe(true)
  expect(profile.toolcall).toBe(true)
  expect(profile.interleaved).toEqual({ field: "reasoning_content" })
})

test("hexin interleaved reasoning profiles have explicit transform contracts", () => {
  expect(interleavedReasoningProfileContractGaps()).toEqual([])
  expect(interleavedReasoningProfileContractIDs().sort()).toEqual(["glm-5", "glm-5.1", "kimi-k2.6", "qwen3.7-max"])

  for (const id of interleavedReasoningProfileContractIDs()) {
    const profile = profileFor(id)
    expect(profile.interleaved).toEqual({ field: "reasoning_content" })

    if (profile.family === "glm") {
      expect(profile.transform?.sampling).toEqual({
        temperature: GLM_EVALUATION_TEMPERATURE,
        topP: THINKING_MODEL_TOP_P,
      })
      expect(profile.transform?.options?.thinking).toEqual({
        type: "enabled",
        clear_thinking: false,
      })
    }

    if (profile.family === "kimi") {
      expect(profile.temperature).toBe(false)
      expect(
        ProviderTransform.requestBody("hexin", {
          model: id,
          temperature: 0,
        }),
      ).toMatchObject({ temperature: 1 })
    }
  }
})
