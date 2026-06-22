import { afterEach, describe, expect, test } from "bun:test"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import {
  createOrchestratorToolOwnershipPayload,
  insertOrchestratorToolOwnershipArtifact,
  listLiveOrchestratorToolOwnership,
} from "../../src/engine/tool-ownership"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Message } from "../../src/session/message"
import { Database, eq } from "../../src/storage/db"
import { EngineService } from "../../src/task-api"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
  await resetDatabase()
})

describe("cancelTask live orchestrator ownership cleanup", () => {
  test("closes owned tool execution without ambient Instance context", async () => {
    await using tmp = await tmpdir({ git: true })
    const now = Date.now()
    const taskID = Identifier.ascending("task")
    let messageID = ""
    let partID = ""

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ kind: "root", title: "cancel root" })
        const orchestrator = await Session.create({
          kind: "orchestrator",
          parentID: root.id,
          title: "cancel orchestrator",
        })
        const child = await Session.create({
          kind: "frontend-research",
          parentID: orchestrator.id,
          title: "cancel child",
        })
        messageID = Identifier.ascending("message")
        partID = Identifier.ascending("part")

        await Session.updateMessage({
          id: messageID,
          sessionID: orchestrator.id,
          role: "assistant",
          time: { created: now },
          parentID: Identifier.ascending("message"),
          agent: "orchestrator",
          providerID: "test",
          modelID: "model",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            total: 0,
            cache: { read: 0, write: 0 },
          },
        })
        await Session.updatePart({
          id: partID,
          messageID,
          sessionID: orchestrator.id,
          type: "tool",
          callID: "call_cancel_live_ownership",
          tool: "frontend_research",
          state: {
            status: "running",
            input: {},
            time: { start: now },
          },
        })

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "test",
              title: "cancel live ownership",
              request: "cancel live ownership",
              priority: "normal",
              time_started: now,
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
        const ownership = createOrchestratorToolOwnershipPayload({
          taskID,
          orchestratorSessionID: orchestrator.id,
          orchestratorMessageID: messageID,
          toolCallID: "call_cancel_live_ownership",
          toolPartID: partID,
          childSessionID: child.id,
          toolName: "build",
          scope: "task",
          now,
        })
        insertOrchestratorToolOwnershipArtifact({
          taskID,
          label: "tool-ownership-start",
          payload: ownership,
          now,
        })
      },
    })

    expect(Instance.current()).toBeUndefined()
    expect(listLiveOrchestratorToolOwnership(taskID)).toHaveLength(1)

    await EngineService.cancelTask(taskID)

    expect(listLiveOrchestratorToolOwnership(taskID)).toHaveLength(0)
    const part = (await Message.parts(messageID)).find((item) => item.id === partID)
    expect(part?.type).toBe("tool")
    if (part?.type !== "tool") throw new Error("expected tool part")
    expect(part.state.status).toBe("error")
    if (part.state.status !== "error") throw new Error("expected errored tool part")
    expect(part.state.failure.message).toBe("task cancelled")
    expect(part.state.failure.originSite).toBe("task-api.cancel-task")

    const task = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
    expect(task?.time_completed).toBeNumber()
    expect(task?.error).toBe("task cancelled")
  })
})
