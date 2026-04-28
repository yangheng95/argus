import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineInteractionRequestTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"

let runnerImpl: ((input: any) => Promise<any>) | undefined

mock.module("@/agent/runner", () => ({
  runAgentSession: (input: any) => {
    if (!runnerImpl) throw new Error("runAgentSession mock not configured")
    return runnerImpl(input)
  },
  runAgentSessionWithRetry: () => {
    throw new Error("runAgentSessionWithRetry should not be called by RequirementsAgent")
  },
}))

describe("RequirementsAgent prompt precedence", () => {
  let tmp: Awaited<ReturnType<typeof tmpdir>>

  beforeEach(async () => {
    await resetDatabase()
    tmp = await tmpdir()
  })

  afterEach(async () => {
    runnerImpl = undefined
    mock.restore()
    await resetDatabase()
    await tmp?.[Symbol.asyncDispose]?.()
  })

  test("answered clarifications outrank scaffold evidence and appear before visual contract", async () => {
    const now = Date.now()
    const projectID = `project_requirements_${now}`
    const taskID = `tsk_requirements_${now}`
    const interactionID = `int_requirements_${now}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Database.use((db) => {
          db.insert(ProjectTable).values({
            id: projectID,
            worktree: tmp.path,
            name: "Requirements prompt test",
            sandboxes: "[]",
            time_created: now,
            time_updated: now,
          }).run()

          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: projectID,
            source: "test",
            title: "复刻百度主页",
            request: "复刻百度主页",
            priority: "normal",
            time_created: now,
            time_updated: now,
            time_started: now,
          }).run()

          db.insert(EngineInteractionRequestTable).values({
            id: interactionID,
            task_id: taskID,
            external_id: `ext_${now}`,
            request_type: "question",
            status: "answered",
            title: "技术澄清",
            body: "确认技术栈与范围",
            payload: {
              questions: [
                { question: "希望我用什么技术来做？", header: "技术栈" },
                { question: "你要的结果更接近哪一种？", header: "目标形态" },
              ],
            },
            response: {
              answers: [["原生三件套"], ["交互原型"]],
            },
            time_resolved: now,
            time_created: now,
            time_updated: now,
          }).run()
        })

        let runnerCalls = 0
        runnerImpl = async (input: any) => {
          runnerCalls += 1
          expect(input.format).toBeUndefined()
          expect(input.toolKit.tools.submit_requirements).toBeDefined()
          const parts = await input.buildUserParts()
          const text = parts
            .map((part: any) => (part?.type === "text" ? (part.text ?? "") : ""))
            .join("\n")

          const clarificationIndex = text.indexOf("## Clarifications Already Answered")
          const visualContractIndex = text.indexOf("# Visual Contract (")

          expect(clarificationIndex).toBeGreaterThan(-1)
          expect(visualContractIndex).toBeGreaterThan(-1)
          expect(clarificationIndex).toBeLessThan(visualContractIndex)
          expect(text).toContain("Concrete stack or deliverable answers from clarifications/operator notes outrank existing package.json dependencies")
          expect(text).toContain("If the user explicitly chose a framework-free implementation")

          await input.toolKit.tools.register_requirement.execute({
            id: "REQ-1",
            type: "explicit",
            description: "使用原生 HTML、CSS 和 JavaScript 复刻百度首页。",
          }, {} as any)
          await input.toolKit.tools.register_decision.execute({
            key: "frontend_framework",
            value: "none (vanilla HTML/CSS/JavaScript)",
            reason: "已回答澄清明确选择原生三件套，这高于现有 scaffold。",
          }, {} as any)
          await input.toolKit.tools.register_decision.execute({
            key: "test_framework",
            value: "vitest",
            reason: "现有项目脚手架使用 Vitest。",
          }, {} as any)
          await input.toolKit.tools.submit_requirements.execute({}, {} as any)

          return {
            session: { id: "ses_requirements" },
            streamErrors: [],
            structured: undefined,
            collector: input.toolKit.getCollector(),
            finalMessage: { info: {} },
            model: { providerID: "test", modelID: "mock", id: "test/mock" },
            requiredTools: [],
          }
        }

        const { RequirementsAgent } = await import("../../src/requirements")

        const result = await RequirementsAgent.run({
          title: "复刻百度主页",
          request: "复刻百度主页",
          taskID,
          designSpecs: [{
            id: "vis-layout-page",
            category: "layout",
            title: "页面整体布局",
            requirement: "桌面首页首屏布局",
            applies_to: "body",
            severity: "must",
          }],
        })

        expect(runnerCalls).toBe(1)
        expect(result.decisions.find((decision) => decision.key === "frontend_framework")?.value)
          .toBe("none (vanilla HTML/CSS/JavaScript)")
      },
    })
  })
})
