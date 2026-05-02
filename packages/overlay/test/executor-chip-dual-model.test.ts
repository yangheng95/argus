// Regression for iter35.
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
// iter35 contract:
//   1. The orchestrator model (appStore.config.model — what
//      MirrorCode plans + evaluates with) is ALWAYS shown on the
//      chip, regardless of which executor is active.
//   2. When an external executor (codex / claude-code) is
//      selected, the chip ADDITIONALLY shows that executor's
//      own model after a `→` arrow. The arrow communicates the
//      planning → execution handoff.
//   3. Hover surfaces a multi-line title explaining the role of
//      each model (orchestrator = planning + evaluation;
//      external executor = code execution).
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

describe("ExecutorSelector chip surfaces orchestrator + external executor models", () => {
  test("imports / declares the orchestrator model accessor (appStore.config.model)", () => {
    expect(SRC).toMatch(/appStore\.config\b/)
    expect(SRC).toMatch(/projectModelFromConfig/)
  })

  test("derives `isExternalExecutor` from active id !== mirrorcode", () => {
    expect(SRC).toMatch(/INTERNAL_EXECUTOR_ID\s*=\s*"mirrorcode"/)
    expect(SRC).toMatch(/activeID\(\)\s*!==\s*INTERNAL_EXECUTOR_ID/)
  })

  test("renders the orchestrator model span ALWAYS (iter41: empty state shows `— not set —` placeholder)", () => {
    // iter35 wrapped this span in `<Show when={orchestratorModel()}>`,
    // which hid the whole thing when the project default model was
    // empty — the user couldn't tell iter35 ever shipped because
    // `MirrorCode · ` collapsed to just `MirrorCode`. iter41 unwraps
    // the Show and falls back to t("agent_models.option_not_set") when
    // the model is empty, plus a [data-empty="true"] hook for CSS.
    expect(SRC).toMatch(
      /data-empty=\{orchestratorModel\(\) \? "false" : "true"\}/,
    )
    expect(SRC).toMatch(
      /\{orchestratorModel\(\) \|\| t\("agent_models\.option_not_set"\)\}/,
    )
    // No Show wrap on the orchestrator model span:
    expect(SRC).not.toMatch(
      /<Show when=\{orchestratorModel\(\)\}>[\s\S]*?data-source="orchestrator"/,
    )
  })

  test("renders the arrow + external model only when the executor is external", () => {
    expect(SRC).toMatch(
      /<Show when=\{isExternalExecutor\(\) && externalExecutorModel\(\)\}>/,
    )
    expect(SRC).toMatch(/class="executor-chip-arrow"/)
    expect(SRC).toMatch(/data-source="external"/)
  })

  test("the chip carries a tooltip explaining both models", () => {
    expect(SRC).toMatch(/title=\{chipTitle\(\)\}/)
    expect(SRC).toMatch(/executor\.model_explainer_pair/)
    expect(SRC).toMatch(/executor\.model_explainer_internal/)
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
    "executor.model_explainer_internal",
    "executor.model_explainer_external",
    "executor.model_explainer_pair",
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
