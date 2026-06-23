import { describe, expect, test } from "bun:test"
import {
  buildClarifiedUserRequest,
  clarificationAnswers,
  clarificationToQuestionInfo,
  renderClarificationAnswers,
} from "../../src/intent-analysis/clarified-request"
import type { IntentClarification } from "../../src/intent-analysis/types"

const blocker: IntentClarification = {
  header: "Visual Policy",
  question: "Which visual policy governs this clone?",
  options: [
    {
      label: "AInvest system (Recommended)",
      description: "Keep the reference structure while using AInvest visual primitives.",
    },
    {
      label: "TradingView pixels",
      description: "Copy the source brand visuals and relax the AInvest design-system constraint.",
    },
  ],
  multiple: false,
  custom: true,
  why_needed: "The original request asks for two incompatible visual authorities.",
  priority: "blocker",
}

describe("intent-analysis clarified request helpers", () => {
  test("maps rich blocker clarifications to the existing question schema", () => {
    expect(clarificationToQuestionInfo(blocker)).toEqual({
      header: "Visual Policy",
      question: "Which visual policy governs this clone?",
      options: blocker.options,
      multiple: false,
      custom: true,
    })
  })

  test("builds a clarified user request from original request plus answered follow-up questions", () => {
    const rows = clarificationAnswers({
      clarifications: [blocker],
      answers: [["AInvest system (Recommended)", "Preserve layout parity, not brand colors."]],
    })

    const answerText = renderClarificationAnswers(rows)
    expect(answerText).toContain("Which visual policy governs this clone?")
    expect(answerText).toContain("AInvest system (Recommended), Preserve layout parity, not brand colors.")

    const clarified = buildClarifiedUserRequest({
      originalRequest: "Pixel-copy TradingView while strictly using AInvest design system.",
      answers: rows,
    })
    expect(clarified).toContain("# Original user request")
    expect(clarified).toContain("Pixel-copy TradingView")
    expect(clarified).toContain("# Clarifying answers")
    expect(clarified).toContain("The original request asks for two incompatible visual authorities.")
  })

  test("fails loud when answer count does not match blocker questions", () => {
    expect(() => clarificationAnswers({ clarifications: [blocker], answers: [] })).toThrow(
      /clarification answer count mismatch/,
    )
  })

  test("fails loud instead of fabricating a clarified request without answers", () => {
    expect(() => buildClarifiedUserRequest({ originalRequest: "Do the thing.", answers: [] })).toThrow(
      /requires at least one answered clarification/,
    )
  })
})
