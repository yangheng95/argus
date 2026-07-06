import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineInteractionRequestTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { createRequirementsOutputTools, RequirementsSubmitSchema } from "../../src/requirements/output-tools"
import { createDecisionLog } from "../../src/decision-log"
import { textContextPacket } from "../../src/agent/context-packet"

let runnerImpl: ((input: any) => Promise<any>) | undefined

mock.module("@/agent/runner", () => ({
  AgentRunError: class AgentRunError extends Error {},
  buildHardErrorFromFinalMessage: () => null,
  toolErrorPartsFromFinalMessage: () => [],
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
        const rootSession = await Session.create({ kind: "root", title: "Requirements prompt test root" })
        Database.use((db) => {
          db.insert(ProjectTable)
            .values({
              id: projectID,
              worktree: tmp.path,
              name: "Requirements prompt test",
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
              session_id: rootSession.id,
              title: "复刻百度主页",
              request: "复刻百度主页",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()

          db.insert(EngineInteractionRequestTable)
            .values({
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
            })
            .run()
        })

        let runnerCalls = 0
        const decisionLog = createDecisionLog(taskID)
        const continuation = {
          sessionID: "ses_requirements_existing",
          artifactID: "artifact_requirements_continuation",
          reason: "continue requirements finalizer miss",
          kind: "protocol-finalizer-miss" as const,
          finalizerName: "submit_requirements",
        }
        runnerImpl = async (input: any) => {
          runnerCalls += 1
          expect(input.continuation).toEqual(continuation)
          expect(input.format).toBeUndefined()
          expect(input.terminalTool?.toolName).toBe("submit_requirements")
          expect(input.terminalTool?.shouldExposeOnlyTerminalTool(input.toolKit.getCollector())).toBe(false)
          expect(input.toolKit.tools.request_orchestrator_decision).toBeDefined()
          expect(input.toolKit.tools.submit_requirements).toBeDefined()
          const parts = await input.buildUserParts()
          const text = parts.map((part: any) => (part?.type === "text" ? (part.text ?? "") : "")).join("\n")

          const clarificationIndex = text.indexOf("## Clarifications Already Answered")
          const contextPacketIndex = text.indexOf("# Agent Context Packets")

          expect(clarificationIndex).toBeGreaterThan(-1)
          expect(contextPacketIndex).toBeGreaterThan(-1)
          expect(clarificationIndex).toBeLessThan(contextPacketIndex)
          expect(text).toContain("# Frontend Design Requirements Context")
          expect(text).toContain("source: frontend_design")
          expect(text).toContain(
            "Concrete stack or deliverable answers from clarifications/operator notes outrank existing package.json dependencies",
          )
          expect(text).toContain("If the user explicitly chose a framework-free implementation")

          await input.toolKit.tools.register_requirement.execute(
            {
              id: "REQ-1",
              type: "explicit",
              description: "使用原生 HTML、CSS 和 JavaScript 复刻百度首页。",
              acceptance: "浏览器打开页面后展示与百度首页一致的搜索入口和基础交互。",
              non_goals: "不包含真实百度后端搜索服务或账号体系。",
            },
            {} as any,
          )
          await input.toolKit.tools.register_decision.execute(
            {
              key: "runtime",
              value: "browser",
              reason: "The requested deliverable is a browser page.",
            },
            {} as any,
          )
          await input.toolKit.tools.register_decision.execute(
            {
              key: "frontend_framework",
              value: "none (vanilla HTML/CSS/JavaScript)",
              reason: "已回答澄清明确选择原生三件套，这高于现有 scaffold。",
            },
            {} as any,
          )
          await input.toolKit.tools.register_decision.execute(
            {
              key: "test_framework",
              value: "vitest",
              reason: "现有项目脚手架使用 Vitest。",
            },
            {} as any,
          )
          await input.toolKit.tools.register_decision.execute(
            {
              key: "affected_modules",
              value: "frontend page scaffold and static assets",
              reason: "The task changes the user-facing page implementation.",
            },
            {} as any,
          )
          await input.toolKit.tools.register_decision.execute(
            {
              key: "affected_concepts",
              value: "layout, visual fidelity, search form interaction",
              reason: "These concepts define the acceptance surface.",
            },
            {} as any,
          )
          await input.toolKit.tools.register_decision.execute(
            {
              key: "impact_size",
              value: "medium",
              reason: "A page replica touches multiple frontend surfaces.",
            },
            {} as any,
          )
          expect(input.terminalTool.shouldExposeOnlyTerminalTool(input.toolKit.getCollector())).toBe(false)
          await input.toolKit.tools.submit_requirements.execute({ final: true, fact_check_items: [] }, {} as any)

          return {
            session: { id: "ses_requirements" },
            streamErrors: [],
            structured: undefined,
            collector: input.toolKit.getCollector(),
            finalMessage: { info: {} },
            model: { providerID: "test", modelID: "mock", id: "test/mock" },
          }
        }

        const { RequirementsAgent } = await import("../../src/requirements")

        const result = await RequirementsAgent.run({
          title: "复刻百度主页",
          request: "复刻百度主页",
          taskID,
          decisionLog,
          contextPackets: [
            textContextPacket({
              id: "frontend-design-requirements-test",
              title: "Frontend Design Requirements Context",
              source: "frontend_design",
              body:
                "Visual contract vis-layout-page: category=layout; title=页面整体布局; requirement=桌面首页首屏布局; applies_to=body; severity=must.",
            })!,
          ],
          continuation,
        })

        expect(runnerCalls).toBe(1)
        expect(result.decisions.find((decision) => decision.key === "frontend_framework")?.value).toBe(
          "none (vanilla HTML/CSS/JavaScript)",
        )
        expect(decisionLog.readByPhase("requirements").map((decision) => decision.key)).toEqual([
          "runtime",
          "frontend_framework",
          "test_framework",
          "affected_modules",
          "affected_concepts",
          "impact_size",
        ])
      },
    })
  }, 10_000)

  test("persists maturity_scope_pending when register_decision runs before finalized requirements", async () => {
    const now = Date.now()
    const projectID = `project_maturity_pending_${now}`
    const taskID = `tsk_maturity_pending_${now}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const rootSession = await Session.create({ kind: "root", title: "Maturity pending root" })
        Database.use((db) => {
          db.insert(ProjectTable)
            .values({
              id: projectID,
              worktree: tmp.path,
              name: "Maturity pending project",
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
              session_id: rootSession.id,
              title: "Mature DeepSeek chat",
              request: "写一个成熟的输入 deepseek key 即可聊天的 ai chat 页面",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()
        })

        const decisionLog = createDecisionLog(taskID)

        runnerImpl = async (input: any) => {
          const parts = await input.buildUserParts()
          const promptText = parts.map((part: any) => (part?.type === "text" ? (part.text ?? "") : "")).join("\n")
          expect(promptText).toContain("成熟")

          await input.toolKit.tools.register_decision.execute(
            {
              key: "maturity_scope_pending",
              value: "Treat mature as bounded error handling and persistence expectations.",
              reason: "The word 成熟 is ambiguous unless the user bounds it.",
            },
            {} as any,
          )

          expect(decisionLog.readByKey("maturity_scope_pending")?.value).toBe(
            "Treat mature as bounded error handling and persistence expectations.",
          )

          return {
            session: { id: "ses_requirements_maturity" },
            streamErrors: [],
            structured: undefined,
            collector: input.toolKit.getCollector(),
            finalMessage: { info: {} },
            model: { providerID: "test", modelID: "mock", id: "test/mock" },
          }
        }

        const { RequirementsAgent } = await import("../../src/requirements")

        await expect(
          RequirementsAgent.run({
            title: "Mature DeepSeek chat",
            request: "写一个成熟的输入 deepseek key 即可聊天的 ai chat 页面",
            taskID,
            decisionLog,
          }),
        ).rejects.toThrow("requirements agent produced no requirements")

        const persisted = decisionLog.readByKey("maturity_scope_pending")
        expect(persisted?.phase).toBe("requirements")
        expect(persisted?.reason).toContain("ambiguous")
      },
    })
  }, 10_000)
})

test("submit_requirements schema requires explicit final confirmation", () => {
  expect(RequirementsSubmitSchema.safeParse({}).success).toBe(false)
  const parsed = RequirementsSubmitSchema.safeParse({ final: true })
  expect(parsed.success).toBe(true)
  if (parsed.success) expect(parsed.data.fact_check_items).toEqual([])
  expect(RequirementsSubmitSchema.safeParse({ final: true, fact_check_items: [] }).success).toBe(true)
})

test("submit_requirements requires the minimum downstream decision contract", async () => {
  const kit = createRequirementsOutputTools()
  await kit.tools.register_requirement.execute(
    {
      id: "REQ-1",
      type: "explicit",
      description: "Implement the requested user-visible behavior.",
      acceptance: "The requested user-visible behavior is observable in the running app.",
      non_goals: "This requirement does not cover unrelated polish or infrastructure work.",
    },
    {} as any,
  )

  const missing = await kit.tools.submit_requirements.execute({ final: true, fact_check_items: [] }, {} as any)
  expect(missing).toContain("missing required foundational decision")
  expect(missing).toContain("runtime")
  expect(missing).toContain("one_framework")
  expect(missing).toContain("affected_modules")
  expect(kit.getCollector().finalized).toBe(false)

  for (const decision of [
    ["runtime", "browser"],
    ["frontend_framework", "vanilla"],
    ["test_framework", "bun:test"],
    ["affected_modules", "src/app"],
    ["affected_concepts", "rendering, interaction"],
    ["impact_size", "small"],
  ] as const) {
    await kit.tools.register_decision.execute(
      {
        key: decision[0],
        value: decision[1],
        reason: "test fixture",
      },
      {} as any,
    )
  }

  const passed = await kit.tools.submit_requirements.execute({ final: true }, {} as any)
  expect(passed).toContain("PASS: Requirements finalized")
  expect(passed).toContain("0 fact-check item(s) registered")
  expect(kit.getCollector().finalized).toBe(true)
  expect(kit.getCollector().fact_check_items).toEqual([])

  const duplicate = await kit.tools.submit_requirements.execute({ final: true }, {} as any)
  expect(duplicate).toContain("already finalized")
  const lateDecision = await kit.tools.register_decision.execute(
    {
      key: "late",
      value: "mutation",
      reason: "test fixture",
    },
    {} as any,
  )
  expect(lateDecision).toContain("already finalized")
  expect(kit.getCollector().decisions.some((decision) => decision.key === "late")).toBe(false)
})
