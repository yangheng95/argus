import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { createDecisionLog } from "../../src/decision-log"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { findActiveSpecForTask } from "../../src/engine/store"
import { ProjectTable } from "../../src/project/project.sql"
import { Instance } from "../../src/project/instance"
import { Question } from "../../src/question"
import { Session } from "../../src/session"
import { Database } from "../../src/storage/db"
import { createOrchestratorTools } from "../../src/orchestrator/tools"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

let runnerImpl: ((input: any) => Promise<any>) | undefined

mock.module("@/agent/runner", () => ({
  AgentRunError: class AgentRunError extends Error {},
  buildHardErrorFromFinalMessage: () => null,
  toolErrorPartsFromFinalMessage: () => [],
  runAgentSession: (input: any) => {
    if (!runnerImpl) throw new Error("runAgentSession mock not configured")
    return runnerImpl(input)
  },
}))

async function waitForQuestion() {
  let pending = await Question.list()
  for (let i = 0; pending.length === 0 && i < 40; i++) {
    await Bun.sleep(5)
    pending = await Question.list()
  }
  return pending
}

describe("requirements maturity scope clarification", () => {
  let tmp: Awaited<ReturnType<typeof tmpdir>>

  beforeEach(async () => {
    await resetDatabase()
    tmp = await tmpdir()
    runnerImpl = undefined
  })

  afterEach(async () => {
    if (tmp) {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          for (const request of await Question.list()) {
            await Question.reject(request.id)
          }
        },
      })
    }
    runnerImpl = undefined
    mock.restore()
    await resetDatabase()
    await tmp?.[Symbol.asyncDispose]?.()
  })

  test("routes durable maturity_scope_pending to question lane without failing or retrying requirements", async () => {
    const now = Date.now()
    const projectID = `project_maturity_scope_${now}`
    const taskID = `tsk_maturity_scope_${now}`
    let runnerCalls = 0

    runnerImpl = async (input: any) => {
      runnerCalls += 1
      input.onSessionCreated?.({ id: "ses_requirements_maturity_scope" })
      await input.toolKit.tools.register_decision.execute(
        {
          key: "maturity_scope_pending",
          value: "Treat mature as bounded error handling, persistence, and validation expectations.",
          reason: "The user request contains 成熟 without a bounded maturity contract.",
        },
        {} as any,
      )
      return {
        session: { id: "ses_requirements_maturity_scope" },
        streamErrors: [],
        structured: undefined,
        collector: input.toolKit.getCollector(),
        finalMessage: { info: {} },
        model: { providerID: "test", modelID: "mock", id: "test/mock" },
      }
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const rootSession = await Session.create({ kind: "root", title: "Maturity scope root" })
        const agentSession = await Session.create({
          kind: "orchestrator",
          parentID: rootSession.id,
          title: "Maturity scope orchestrator",
        })
        Database.use((db) => {
          db.insert(ProjectTable)
            .values({
              id: projectID,
              worktree: tmp.path,
              name: "Maturity scope project",
              sandboxes: "[]",
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: projectID,
              session_id: rootSession.id,
              source: "test",
              title: "Mature DeepSeek chat",
              request: "写一个成熟的输入 deepseek key 即可聊天的 ai chat 页面",
              kind: "workflow",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()
        })

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: agentSession.id,
          signal: new AbortController().signal,
        })

        const resultPromise = tools.requirements.execute({ reason: "Need requirements" }, {} as any)
        const pending = await waitForQuestion()

        expect(pending).toHaveLength(1)
        expect(pending[0].questions[0].header).toBe("Maturity scope")
        expect(pending[0].questions[0].question).toContain("maturity")
        expect(pending[0].questions[0].question).toContain("Recorded assumption")

        const persisted = createDecisionLog(taskID).readByKey("maturity_scope_pending")
        expect(persisted?.value).toContain("bounded error handling")

        await Question.reply({ requestID: pending[0].id, answers: [["Use assumption"]] })
        const result = await resultPromise

        expect(result).toContain("requirements: maturity scope clarification requested")
        expect(result).toContain("maturity_scope_pending")
        expect(runnerCalls).toBe(1)
        expect(findActiveSpecForTask(taskID)).toBeUndefined()
        expect(createDecisionLog(taskID).readByKey("abort_requirements_failed")).toBeUndefined()
      },
    })
  }, 10_000)
})
