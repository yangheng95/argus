import { expect, test } from "bun:test"
import { normalizeVisionJudgeVerdictForTest } from "../../src/frontend-design/tools/webpage-vision-judge"

test("webpage_vision_judge accepts provider field aliases without dropping visual findings", () => {
  const verdict = normalizeVisionJudgeVerdictForTest({
    accepted: false,
    differences: [
      {
        severity: "high",
        region: "Economic indicators heatmap table body",
        what_you_see: "Every cell is filled with strong colour and numeric values.",
        what_you_should_see: "Cells should stay blank and muted like the reference.",
        fix: "Remove the bold fills and text values from the placeholder table cells.",
      },
      {
        severity: "low",
        region: "Footer language selector",
        whatYouSee: "English text is shown alone.",
        whatYouShouldSee: "A globe icon should appear next to English.",
        fixHint: "Add the globe icon before the language label.",
      },
      {
        severity: "High",
        region: "Economic Calendar section",
        see: "A tall vertical feed grouped by calendar date.",
        should_see: "A compact horizontal row of exactly four event preview cards.",
        fix: "Render the next four events in one horizontal card row.",
      },
      {
        severity: "medium",
        region: "Tab navigation",
        see: "Plain blue links are shown.",
        shouldSee: "Rounded TradingView-style tab pills are shown.",
        fixHint: "Apply the extracted tab pill styles to the semantic tab classes.",
      },
    ],
  })

  expect(verdict.accepted).toBe(false)
  expect(verdict.overall_impression).toContain("4 visible difference")
  expect(verdict.differences[0]).toMatchObject({
    severity: "major",
    observed: "Every cell is filled with strong colour and numeric values.",
    expected: "Cells should stay blank and muted like the reference.",
    fix_hint: "Remove the bold fills and text values from the placeholder table cells.",
  })
  expect(verdict.differences[1]).toMatchObject({
    severity: "minor",
    observed: "English text is shown alone.",
    expected: "A globe icon should appear next to English.",
    fix_hint: "Add the globe icon before the language label.",
  })
  expect(verdict.differences[2]).toMatchObject({
    severity: "major",
    observed: "A tall vertical feed grouped by calendar date.",
    expected: "A compact horizontal row of exactly four event preview cards.",
    fix_hint: "Render the next four events in one horizontal card row.",
  })
  expect(verdict.differences[3]).toMatchObject({
    severity: "major",
    observed: "Plain blue links are shown.",
    expected: "Rounded TradingView-style tab pills are shown.",
    fix_hint: "Apply the extracted tab pill styles to the semantic tab classes.",
  })
})
