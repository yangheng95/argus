// Regression for the model selector contract.
//
// User feedback (2026-05-03): "把模型放到输入框的mirrorcode内部显示。
// 如果选择了外部执行器，则额外显示外部执行器的模型。hover 解释
// 两个 model 的区别".
//
// Pre-iter35 the executor chip in the bottom-left composer slot
// rendered `[ExecutorLabel] · [executorCurrentModel]`. For
// MirrorCode (the internal/orchestrator executor) `executor
// CurrentModel("mirrorcode")` returned `""` because mirrorcode
// has no `info.model` field — its model follows project config
// (appStore.config.model). So the chip showed just `MirrorCode ▾`
// without any model context.
//
// Current contract:
//   1. The OpenCorvus model (appStore.config.model) is always shown.
//   2. External executor model is shown only when the active external
//      executor reports a non-empty model.
//   3. If Agent Models contains per-agent model overrides, the OpenCorvus
//      model is marked with a localized "(Custom)" suffix.
//   4. Hover surfaces a multi-line title explaining the two model surfaces.
//
// Source-level grep — Bun JSX runtime can't render Solid; verify
// the contract on the .tsx source itself.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const SRC = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "components", "ExecutorSelector.tsx"),
  "utf8",
)

describe("ExecutorSelector chip surfaces OpenCorvus + external executor models", () => {
  test("imports / declares the OpenCorvus model accessor (appStore.config.model)", () => {
    expect(SRC).toMatch(/appStore\.config\b/)
    expect(SRC).toMatch(/projectModelFromConfig/)
  })

  test("derives `isExternalExecutor` from active id !== mirrorcode", () => {
    expect(SRC).toMatch(/INTERNAL_EXECUTOR_ID\s*=\s*"mirrorcode"/)
    expect(SRC).toMatch(/activeID\(\)\s*!==\s*INTERNAL_EXECUTOR_ID/)
  })

  test("renders the OpenCorvus model span always, with an empty-state placeholder", () => {
    expect(SRC).toMatch(
      /data-empty=\{openCorvusModel\(\) \? "false" : "true"\}/,
    )
    expect(SRC).toMatch(
      /\{openCorvusParts\(\)\.name \|\| t\("agent_models\.option_not_set"\)\}/,
    )
    // No Show wrap on the OpenCorvus model span:
    expect(SRC).not.toMatch(
      /<Show when=\{openCorvusModel\(\)\}>[\s\S]*?data-source="opencorvus"/,
    )
  })

  test("renders the external executor model slot only when a non-empty external model exists", () => {
    expect(SRC).toMatch(/data-source="executor"/)
    expect(SRC).toMatch(/hasExternalExecutorModel/)
    expect(SRC).toMatch(/<Show when=\{hasExternalExecutorModel\(\)\}>/)
    expect(SRC).not.toMatch(/executor\.same_as_plan/)
    expect(SRC).not.toMatch(/data-source="external"/)
  })

  test("marks OpenCorvus model as custom when per-agent model overrides diverge", () => {
    expect(SRC).toMatch(/agentModelOverridesFromConfig/)
    expect(SRC).toMatch(/hasCustomAgentModels/)
    expect(SRC).toMatch(/executor\.custom_agent_models/)
    expect(SRC).toMatch(/executor-chip-custom/)
  })

  test("splits provider and model into scan-friendly fields", () => {
    expect(SRC).toMatch(/splitModelID/)
    expect(SRC).toMatch(/executor-chip-provider/)
    expect(SRC).toMatch(/executor-chip-name/)
    expect(SRC).toMatch(/executor-menu-summary/)
    expect(SRC).toMatch(/executor-menu-model-provider/)
    expect(SRC).toMatch(/executor-menu-model-name/)
  })

  test("the chip carries a tooltip explaining both models", () => {
    expect(SRC).toMatch(/title=\{chipTitle\(\)\}/)
    expect(SRC).toMatch(/executor\.model_explainer_pair/)
    expect(SRC).toMatch(/executor\.model_explainer_opencorvus/)
    expect(SRC).toMatch(/executor\.model_explainer_external/)
  })
})

describe("i18n keys for the dual-model explainer exist in both locales", () => {
  const EN = JSON.parse(
    readFileSync(path.resolve(import.meta.dir, "..", "src", "i18n", "en-US.json"), "utf8"),
  )
  const ZH = JSON.parse(
    readFileSync(path.resolve(import.meta.dir, "..", "src", "i18n", "zh-CN.json"), "utf8"),
  )
  for (const key of [
    "executor.custom_agent_models",
    "executor.model_explainer_opencorvus",
    "executor.model_explainer_external",
    "executor.model_explainer_pair",
    "executor.change_model",
    "executor.role_external",
    "executor.role_opencorvus",
  ]) {
    test(`${key} present in en-US.json`, () => {
      expect(typeof EN[key]).toBe("string")
      expect((EN[key] as string).length).toBeGreaterThan(0)
    })
    test(`${key} present in zh-CN.json`, () => {
      expect(typeof ZH[key]).toBe("string")
      expect((ZH[key] as string).length).toBeGreaterThan(0)
    })
  }
})
