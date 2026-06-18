import { expect, test } from "bun:test"
import en from "../src/i18n/en-US.json"
import { setLocaleData, setLocale } from "../src/utils/i18n"
import { evaluationContextText } from "../src/utils/transcript"

test("evaluation context exposes missing goal data instead of inventing a goal label", async () => {
  setLocaleData("en-US", en)
  await setLocale("en-US")

  const text = evaluationContextText(
    {
      evaluation: { verdict: "rejected" },
      artifacts: [
        {
          label: "evaluator-agent-analysis",
          payload: {
            goal_statuses: [{ goal_index: 1, status: "failed", evidence: "no persisted goal row" }],
          },
        },
      ],
    },
    [{ title: "Existing goal" }],
  )

  expect(text).toContain("Missing goal #2: no persisted goal row")
  expect(text).not.toContain("Goal 2")
})
