import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Config } from "../../src/config/config"
import { ControlTimeline } from "../../src/control/timeline"
import { PlannerService } from "../../src/planner/service"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { SpecService } from "../../src/spec/service"
import { Log } from "../../src/util/log"
import { installControlModel } from "../control-plane/mock-control-model"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

let configDir = ""
let originalConfigDir: string | undefined

function clarify() {
  spyOn(SpecService, "initial").mockResolvedValue({
    summary: "Clarify feature",
    content: "# Scope\n\nImplement feature",
    goals: [
      {
        description: "Clarify the requested change",
        criteria: "The requested change is clearly scoped.",
        priority: "blocking",
      },
    ],
    assumptions: [],
    risks: [],
    clarifications: [],
    spec_items: [{
      title: "Clarify the requested change",
      description: "The requested change is clearly scoped.",
      priority: "blocking",
      check_selector: ["spec_check"],
    }],
    evidence_sources: [],
    unresolved_questions: [],
  })
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
  beforeEach(async () => {
    await Instance.disposeAll()
    await resetDatabase()
    Config.global.reset()
    originalConfigDir = process.env.OPENCORVUS_CONFIG_DIR
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-control-config-"))
    process.env.OPENCORVUS_CONFIG_DIR = configDir
  })

  afterEach(async () => {
    mock.restore()
    Config.global.reset()
    if (originalConfigDir === undefined) delete process.env.OPENCORVUS_CONFIG_DIR
    else process.env.OPENCORVUS_CONFIG_DIR = originalConfigDir
    if (configDir) await fs.rm(configDir, { recursive: true, force: true }).catch(() => undefined)
    configDir = ""
    await Instance.disposeAll()
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
        const user = body.find((item) => item.info.role === "user" && item.parts[0]?.text === "Use executor codex for desktop panel actions and new tasks.")
        const assistant = body.find((item) => item.info.role === "assistant" && item.parts[0]?.text.includes("Executor set to codex"))
        expect(user).toBeDefined()
        expect(assistant).toBeDefined()
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

  test("GET /control/timeline includes screenshot attachments as file parts", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ControlTimeline.append({
          surface: "panel",
          source: "panel",
          entries: [
            {
              role: "assistant",
              text: "Captured OpenCorvus GUI.",
              metadata: {
                attachments: [
                  {
                    mime: "image/png",
                    filename: "opencorvus-gui.png",
                    url: "data:image/png;base64,aGVsbG8=",
                  },
                ],
              },
            },
          ],
        })

        const app = Server.App()
        const res = await app.request("/control/timeline?surface=panel", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(res.status).toBe(200)
        const body = await res.json() as Array<{
          info: { role: string }
          parts: Array<{ type: string; text?: string; mime?: string; filename?: string }>
        }>
        const message = body.find((item) => item.parts[0]?.text === "Captured OpenCorvus GUI.")
        expect(message).toBeDefined()
        expect(message?.parts[1]).toMatchObject({
          type: "file",
          mime: "image/png",
          filename: "opencorvus-gui.png",
        })
      },
    })
  })
})
