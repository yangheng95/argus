import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { createDecisionLog } from "../../src/decision-log"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { ProjectTable } from "../../src/project/project.sql"
import { Instance } from "../../src/project/instance"
import { Question } from "../../src/question"
import { createOrchestratorTools } from "../../src/orchestrator/tools"
import { TaskContext } from "../../src/task-context"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

let analyzeIntentImpl: ((input: unknown) => Promise<unknown>) | undefined

function toolText(result: unknown): string {
  if (typeof result === "string") return result
  if (
    result &&
    typeof result === "object" &&
    (result as { type?: unknown }).type === "final" &&
    typeof (result as { output?: unknown }).output === "string"
  ) {
    return (result as { output: string }).output
  }
  if (
    result &&
    typeof result === "object" &&
    typeof (result as { output?: unknown }).output === "string" &&
    typeof (result as { title?: unknown }).title === "string" &&
    typeof (result as { metadata?: unknown }).metadata === "object"
  ) {
    return (result as { output: string }).output
  }
  throw new Error(`Expected string tool result or known wrapped string output, got ${JSON.stringify(result)}`)
}

mock.module("@/intent-analysis/agent", () => ({
  IntentAnalysisAgent: {
    analyze: (input: unknown) => {
      if (!analyzeIntentImpl) throw new Error("IntentAnalysisAgent.analyze mock not configured")
      return analyzeIntentImpl(input)
    },
  },
}))

describe("orchestrator analyze_intent dynamic follow-up questions", () => {
  let tmp: Awaited<ReturnType<typeof tmpdir>>
  let projectID = ""
  let taskID = ""
  let askSpy: ReturnType<typeof spyOn>

  beforeEach(async () => {
    await resetDatabase()
    tmp = await tmpdir()
    const stamp = Date.now().toString(16)
    projectID = `project_intent_followup_${stamp}`
    taskID = `tsk_${stamp}intentfollowup`
    const now = Date.now()
    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: tmp.path,
          name: "Intent follow-up test",
          sandboxes: "[]",
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          title: "Clone prompt ambiguity",
          request: "Pixel-copy TradingView while strictly using AInvest design system.",
          priority: "normal",
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
    })
    analyzeIntentImpl = async () => ({
      sessionID: "ses_intent_mock",
      result: {
        intent_class: "feature",
        complexity: "medium",
        extracted_slots: [{ key: "action_verb", value: "clone", confidence: 0.9 }],
        missing_info: ["visual_policy"],
        clarifications: [
          {
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
          },
        ],
        confidence: 0.72,
        summary: "Clone the TradingView world-economy page, but visual authority is ambiguous.",
      },
    })
    askSpy = spyOn(Question, "askAndFormat").mockResolvedValue({
      output: "User answered visual policy.",
      answers: [["AInvest system (Recommended)", "Preserve layout parity, not brand colors."]],
    })
  })

  afterEach(async () => {
    askSpy?.mockRestore()
    analyzeIntentImpl = undefined
    await resetDatabase()
    await tmp?.[Symbol.asyncDispose]?.()
  })

  test("asks blocker clarifications and persists a clarified user request", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: "ses_orchestrator_intent_followup",
        })

        const result = await tools.analyze_intent.execute(
          { reason: "prompt has conflicting visual authorities" },
          {} as any,
        )
        const text = toolText(result)

        expect(askSpy).toHaveBeenCalledTimes(1)
        expect(askSpy.mock.calls[0][0]).toMatchObject({
          sessionID: "ses_orchestrator_intent_followup",
          questions: [
            {
              header: "Visual Policy",
              question: "Which visual policy governs this clone?",
              multiple: false,
              custom: true,
            },
          ],
        })
        expect((askSpy.mock.calls[0][0] as any).questions[0].options).toHaveLength(2)
        expect(text).toContain("blocker clarification(s) answered")
        expect(text).toContain("clarified_user_request")

        const decisions = createDecisionLog(taskID).readByPhase("intent_analysis")
        const clarified = decisions.find((entry) => entry.key === "intent_clarified_user_request")
        expect(clarified?.value).toContain("# Original user request")
        expect(clarified?.value).toContain("# Clarifying answers")
        expect(clarified?.value).toContain("AInvest system (Recommended)")

        const snapshot = TaskContext.snapshot(taskID)
        expect(snapshot).toContain("### Clarified Request")
        expect(snapshot).toContain("Preserve layout parity, not brand colors.")
      },
    })
  })
})
