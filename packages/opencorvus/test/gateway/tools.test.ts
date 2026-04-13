import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { OrchestratorService } from "../../src/orchestrator/service"
import { listProjectTasks } from "../../src/orchestrator/store"
import { Question } from "../../src/question"
import { ensureGatewaySession } from "../../src/gateway/session"
import { createGatewayTools } from "../../src/gateway/tools"
import { readCwd } from "../../src/gateway/cwd-state"
import { channelKey } from "../../src/session/channel-key"
import { tmpdir } from "../fixture/fixture"
import { Log } from "../../src/util/log"

Log.init({ print: false })

// Phase 2 tool invariants:
//  - enqueue_workflow_task creates a task with kind="workflow"
//  - dispatch_build_task creates a task with kind="build"
//  - both go through OrchestratorService.createTask + appear in listProjectTasks
//  - forward_clarification unblocks an awaiting Question.ask
//  - switch_cwd persists to gateway session metadata
//  - cancel_task on unknown ID surfaces an error (no silent fallback)

async function withGatewayContext<T>(
  fn: (ctx: { dir: string; sessionID: string; tools: ReturnType<typeof createGatewayTools> }) => Promise<T>,
): Promise<T> {
  await using tmp = await tmpdir({ git: true })
  return Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const ck = channelKey({ local: true, userID: `U-${Math.random().toString(36).slice(2, 8)}` })
      const session = await ensureGatewaySession({ channelKey: ck, defaultCwd: tmp.path })
      const tools = createGatewayTools({ sessionID: session.id, defaultCwd: tmp.path })
      try {
        return await fn({ dir: tmp.path, sessionID: session.id, tools })
      } finally {
        await Session.remove(session.id).catch(() => undefined)
      }
    },
  })
}

describe("Gateway tools (Phase 2)", () => {
  test("enqueue_workflow_task creates a kind='workflow' task", async () => {
    await withGatewayContext(async ({ tools }) => {
      const taskID = await tools.enqueue_workflow_task.execute(
        { request: "Build a counter", title: "counter", priority: "low" } as any,
        {} as any,
      )
      expect(typeof taskID).toBe("string")
      const tasks = listProjectTasks(Instance.project.id, 50)
      const row = tasks.find((t) => t.id === taskID)
      expect(row).toBeDefined()
      expect(row!.kind).toBe("workflow")
      await OrchestratorService.cancelTask(taskID).catch(() => undefined)
      await OrchestratorService.deleteTask(taskID).catch(() => undefined)
    })
  })

  test("dispatch_build_task creates a kind='build' task", async () => {
    await withGatewayContext(async ({ tools }) => {
      const taskID = await tools.dispatch_build_task.execute(
        { prompt: "Print hello", title: "hello-cli" } as any,
        {} as any,
      )
      expect(typeof taskID).toBe("string")
      const tasks = listProjectTasks(Instance.project.id, 50)
      const row = tasks.find((t) => t.id === taskID)
      expect(row).toBeDefined()
      expect(row!.kind).toBe("build")
      await OrchestratorService.cancelTask(taskID).catch(() => undefined)
      await OrchestratorService.deleteTask(taskID).catch(() => undefined)
    })
  })

  test("forward_clarification resolves an awaiting Question.ask", async () => {
    await withGatewayContext(async ({ sessionID, tools }) => {
      const askPromise = Question.ask({
        sessionID,
        questions: [
          { question: "Pick one", header: "P", options: [{ label: "yes", description: "" }, { label: "no", description: "" }] },
        ],
        timeoutMs: 5000,
      })
      let questionID: string | undefined
      for (let i = 0; i < 50 && !questionID; i++) {
        await new Promise((r) => setTimeout(r, 10))
        const pending = await Question.list()
        const match = pending.find((p) => p.sessionID === sessionID)
        if (match) questionID = match.id
      }
      expect(questionID).toBeDefined()
      await tools.forward_clarification.execute(
        { questionID: questionID!, answers: [["yes"]] } as any,
        {} as any,
      )
      const answers = await askPromise
      expect(answers).toEqual([["yes"]])
    })
  })

  test("switch_cwd updates session metadata", async () => {
    await withGatewayContext(async ({ dir, sessionID, tools }) => {
      await tools.switch_cwd.execute({ cwd: dir } as any, {} as any)
      const reread = await Session.get(sessionID)
      expect(readCwd(reread)).toBe(dir)
    })
  })

  test("cancel_task on unknown ID surfaces an error (no silent fallback)", async () => {
    await withGatewayContext(async ({ tools }) => {
      let threw = false
      try {
        await tools.cancel_task.execute({ taskID: "tsk_does_not_exist" } as any, {} as any)
      } catch {
        threw = true
      }
      expect(threw).toBe(true)
    })
  })
})
