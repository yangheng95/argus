import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Orchestrator } from "../../src/orchestrator/agent"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { installControlModel } from "../workspace/mock-control-model"

function promptResult(sessionID: string) {
  const now = Date.now()
  return {
    info: {
      id: `msg_orch_${now}`,
      role: "assistant",
      sessionID,
      time: { created: now, completed: now },
      finish: "stop",
      agent: "orchestrator",
      providerID: "mock-control",
      modelID: "control",
      parentID: `msg_user_${now}`,
      path: { cwd: process.cwd(), root: process.cwd() },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    },
    parts: [],
  } as Awaited<ReturnType<typeof SessionPrompt.prompt>>
}

describe("orchestrator session reuse", () => {
  let tmp: Awaited<ReturnType<typeof tmpdir>>

  beforeEach(async () => {
    await resetDatabase()
    tmp = await tmpdir({ git: true, config: { model: "mock-control/control" } })
    installControlModel()
  })

  afterEach(async () => {
    mock.restore()
    await resetDatabase()
    await tmp?.[Symbol.asyncDispose]?.()
  })

  test("reuses one orchestrator child session for repeated task wakes", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = `tsk_orch_reuse_${now.toString(16)}`
        const root = await Session.create({ kind: "root", title: "Session reuse task" })
        await Session.mergeConfigOverlay({
          sessionID: root.id,
          patch: { model: "mock-control/control" },
        })
        const promptInputs: Array<Parameters<typeof SessionPrompt.prompt>[0]> = []
        const loopInputs: Array<Parameters<typeof SessionPrompt.loop>[0]> = []
        spyOn(SessionPrompt, "prompt").mockImplementation((async (input) => {
          promptInputs.push(input)
          return promptResult(input.sessionID)
        }) as never)
        spyOn(SessionPrompt, "loop").mockImplementation((async (input) => {
          loopInputs.push(input)
          return promptResult(input.sessionID)
        }) as never)

        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "test",
              title: "Session reuse task",
              request: "reuse the orchestrator session",
              kind: "workflow",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()
        })

        await Orchestrator.processTask(taskID, { note: "first wake" })

        const children = await Session.children(root.id)
        const orchestrators = children.filter((session) => session.kind === "orchestrator")
        const orchestratorID = orchestrators[0]!.id

        await Session.updateMessage({
          id: `msg_orch_user_${now}`,
          role: "user",
          sessionID: orchestratorID,
          time: { created: now + 1 },
          agent: "orchestrator",
          model: { providerID: "mock-control", modelID: "control" },
          system: "previous dynamic context",
          systemMode: "complete",
        } as never)

        await Orchestrator.processTask(taskID)

        expect(orchestrators).toHaveLength(1)
        expect(promptInputs).toHaveLength(1)
        expect(promptInputs[0]!.sessionID).toBe(orchestratorID)
        expect(loopInputs).toHaveLength(1)
        expect(loopInputs[0]!.sessionID).toBe(orchestratorID)
      },
    })
  })
})
