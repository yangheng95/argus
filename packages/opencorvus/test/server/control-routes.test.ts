import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { PlannerService } from "../../src/planner/service"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { installControlModel } from "../control-plane/mock-control-model"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

function clarify() {
  spyOn(PlannerService, "initial").mockResolvedValue({
    summary: "Clarify feature",
    prompt: "Ask before executing",
    goals: [
      {
        description: "Clarify the requested change",
        criteria: "The requested change is clearly scoped.",
        priority: "blocking",
      },
    ],
    metadata: {
      strategy: "initial",
      steps: ["Clarify the requested change"],
      clarification: {
        reason: "Need clarification before planning.",
        questions: [
          {
            header: "Clarification",
            question: "Which module should this change target?",
          },
        ],
      },
      spec_analysis: undefined,
    },
  })
}

describe("control routes", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("GET /control/timeline returns persisted global panel conversation", async () => {
    await using tmp = await tmpdir({ git: true })
    installControlModel()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const sent = await app.request("/panel/message", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            surface: "panel",
            text: "Use executor codex for desktop panel actions and new tasks.",
            metadata: {
              executor: "codex",
              ui_context: "engine_bar",
            },
          }),
        })
        expect(sent.status).toBe(200)

        const res = await app.request("/control/timeline?surface=panel", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(res.status).toBe(200)
        const body = await res.json() as Array<{
          info: { role: string }
          parts: Array<{ type: string; text: string }>
        }>
        expect(body).toHaveLength(2)
        expect(body[0]?.info.role).toBe("user")
        expect(body[0]?.parts[0]?.text).toBe("Use executor codex for desktop panel actions and new tasks.")
        expect(body[1]?.info.role).toBe("assistant")
        expect(body[1]?.parts[0]?.text).toContain("Executor set to codex")
      },
    })
  })

  test("GET /control/timeline returns persisted task conversation after panel task creation", async () => {
    await using tmp = await tmpdir({ git: true })
    clarify()
    installControlModel()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const sent = await app.request("/panel/message", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            surface: "panel",
            text: "Create a task to implement feature x.",
          }),
        })
        expect(sent.status).toBe(200)
        const created = await sent.json() as { task_id: string }

        const res = await app.request(`/control/timeline?taskID=${created.task_id}`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(res.status).toBe(200)
        const body = await res.json() as Array<{
          info: { role: string; taskID?: string }
          parts: Array<{ type: string; text: string }>
        }>
        expect(body).toHaveLength(2)
        expect(body[0]?.info.role).toBe("user")
        expect(body[0]?.info.taskID).toBe(created.task_id)
        expect(body[0]?.parts[0]?.text).toBe("Create a task to implement feature x.")
        expect(body[1]?.info.role).toBe("assistant")
        expect(body[1]?.parts[0]?.text).toContain("Task accepted:")
      },
    })
  })
})
