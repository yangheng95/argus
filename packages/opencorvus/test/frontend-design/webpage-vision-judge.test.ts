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
    ],
  })

  expect(verdict.accepted).toBe(false)
  expect(verdict.overall_impression).toContain("2 visible difference")
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
})
