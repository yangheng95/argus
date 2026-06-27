import { expect, test } from "bun:test"
import {
  interleavedReasoningProfileContractGaps,
  interleavedReasoningProfileContractIDs,
  profileFor,
} from "../../src/provider/hexin-profiles"
import { GLM_EVALUATION_TEMPERATURE, THINKING_MODEL_TOP_P } from "../../src/provider/sampling"
import { ProviderTransform } from "../../src/provider/transform"

test("hexin gpt-5.4 and gpt-5.5 profiles use Hexin model-info limits", () => {
  const profile = profileFor("gpt-5.4")
  expect(profile.context).toBe(1_050_000)
  expect(profile.input).toBe(1_050_000)
  expect(profile.output).toBe(128_000)
  expect(profile.reasoning).toBe(true)
  expect(profile.image_in).toBe(true)

  const latest = profileFor("gpt-5.5")
  expect(latest.context).toBe(1_050_000)
  expect(latest.input).toBe(1_050_000)
  expect(latest.output).toBe(128_000)
  expect(latest.reasoning).toBe(true)
  expect(latest.image_in).toBe(true)
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

test("hexin kimi-k2.5 profile follows Hexin model-info limits", () => {
  const profile = profileFor("kimi-k2.5")

  expect(profile.family).toBe("kimi")
  expect(profile.reasoning).toBe(true)
  expect(profile.attachment).toBe(true)
  expect(profile.image_in).toBe(true)
  expect(profile.pdf_in).toBe(false)
  expect(profile.toolcall).toBe(true)
  expect(profile.interleaved).toEqual({ field: "reasoning_content" })
  expect(profile.context).toBe(262_144)
  expect(profile.input).toBe(262_144)
  expect(profile.output).toBe(262_144)
})

test("hexin kimi-k2.6 profile follows Moonshot thinking-model contract", () => {
  const profile = profileFor("kimi-k2.6")

  expect(profile.family).toBe("kimi")
  expect(profile.reasoning).toBe(true)
  expect(profile.temperature).toBe(false)
  expect(profile.attachment).toBe(true)
  expect(profile.image_in).toBe(true)
  expect(profile.pdf_in).toBe(false)
  expect(profile.toolcall).toBe(true)
  expect(profile.interleaved).toEqual({ field: "reasoning_content" })
  expect(profile.context).toBe(262_144)
  expect(profile.input).toBe(262_144)
  expect(profile.output).toBe(262_144)
})

test("hexin kimi-k2.7-code profile follows verified Moonshot vision and context contract", () => {
  const profile = profileFor("kimi-k2.7-code")

  expect(profile.family).toBe("kimi")
  expect(profile.reasoning).toBe(true)
  expect(profile.temperature).toBe(false)
  expect(profile.attachment).toBe(true)
  expect(profile.image_in).toBe(true)
  expect(profile.pdf_in).toBe(false)
  expect(profile.toolcall).toBe(true)
  expect(profile.interleaved).toEqual({ field: "reasoning_content" })
  expect(profile.context).toBe(262_144)
  expect(profile.input).toBe(262_144)
  expect(profile.output).toBe(262_144)
  expect(
    ProviderTransform.requestBody("hexin", {
      model: "kimi-k2.7-code",
      temperature: 0,
    }),
  ).toMatchObject({ temperature: 1 })
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
  expect(profile.attachment).toBe(true)
  expect(profile.image_in).toBe(true)
  expect(profile.toolcall).toBe(true)
  expect(profile.interleaved).toEqual({ field: "reasoning_content" })
  expect(profile.context).toBe(1_000_000)
  expect(profile.input).toBe(1_000_000)
  expect(profile.output).toBe(65_536)
})

test("hexin claude-sonnet-4-6 profiles use Hexin model-info limits", () => {
  for (const id of [
    "claude-sonnet-4-6",
    "claude-sonnet-4-6-bak",
    "cy-claude-sonnet-4-6",
    "cy-claude-sonnet-4-6-v2",
  ]) {
    const profile = profileFor(id)
    expect(profile.family).toBe("claude")
    expect(profile.reasoning).toBe(true)
    expect(profile.attachment).toBe(true)
    expect(profile.image_in).toBe(true)
    expect(profile.toolcall).toBe(true)
    expect(profile.context).toBe(1_000_000)
    expect(profile.input).toBe(1_000_000)
    expect(profile.output).toBe(64_000)
  }
})

test("hexin interleaved reasoning profiles have explicit transform contracts", () => {
  expect(interleavedReasoningProfileContractGaps()).toEqual([])
  expect(interleavedReasoningProfileContractIDs().sort()).toEqual([
    "glm-5",
    "glm-5.1",
    "kimi-k2.5",
    "kimi-k2.6",
    "kimi-k2.7-code",
    "qwen3.7-max",
  ])

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

    if (profile.family === "kimi" && id !== "kimi-k2.5") {
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
