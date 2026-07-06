import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test"
import { Orchestrator } from "../../src/orchestrator/agent"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Database, desc, eq } from "../../src/storage/db"
import { EngineGoalTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { ProtocolEventTable } from "../../src/protocol/protocol.sql"
import { compileBoard } from "../../src/workbench/board"
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
      finish: "tool-calls",
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

test("direct-start first wake emits workflow.selected and restores board goal progress", async () => {
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const now = Date.now()
      const taskID = `tsk_orch_workflow_selected_${now.toString(16)}`
      const goalID = `gol_orch_workflow_selected_${now.toString(16)}`
      const root = await Session.create({ kind: "root", title: "Workflow selection regression" })
      await Session.mergeConfigOverlay({
        sessionID: root.id,
        patch: { model: "mock-control/control" },
      })
      spyOn(SessionPrompt, "prompt").mockImplementation((async (input) => promptResult(input.sessionID)) as never)
      spyOn(SessionPrompt, "loop").mockImplementation((async (input) => promptResult(input.sessionID)) as never)

      Database.use((db) => {
        db.insert(EngineTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            session_id: root.id,
            source: "test",
            title: "Workflow selection regression",
            request: "show overlay goal progress",
            kind: "workflow",
            priority: "normal",
            time_created: now,
            time_updated: now,
            time_started: now,
          })
          .run()
        db.insert(EngineGoalTable)
          .values({
            id: goalID,
            task_id: taskID,
            title: "Render goal progress",
            slug: "render-goal-progress",
            objective: "Restore overlay goal progress rendering.",
            order_index: 0,
            time_created: now + 1,
            time_updated: now + 1,
          } as any)
          .run()
      })

      await Orchestrator.processTask(taskID, { note: "first direct wake" })

      const selection = Database.use((db) =>
        db
          .select({
            type: ProtocolEventTable.type,
            payload: ProtocolEventTable.payload,
          })
          .from(ProtocolEventTable)
          .where(eq(ProtocolEventTable.task_id, taskID))
          .orderBy(desc(ProtocolEventTable.seq))
          .all()
          .find((row) => row.type === "workflow.selected"),
      ) as { payload?: { workflowID?: string; workflow?: { id?: string } } } | undefined

      expect(selection?.payload?.workflowID).toBe("pipeline")
      expect(selection?.payload?.workflow?.id).toBe("pipeline")

      const board = compileBoard({ taskID }) as any
      expect(board.workflow?.id).toBe("pipeline")
      expect(board.goalWorkflows?.map((goal: any) => goal.goalID)).toEqual([goalID])
      expect(board.goalWorkflows?.[0]?.goalStatus).toBe("pending")
    },
  })
})
