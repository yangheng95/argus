import { afterEach, describe, expect, mock, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { installControlModel } from "../control-plane/mock-control-model"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("panel routes", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("POST /panel/message proxies to panel control service", async () => {
    await using tmp = await tmpdir({ git: true })
    installControlModel()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/panel/message", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            surface: "panel",
            text: "Use executor codex for desktop panel actions and new tasks.",
            executor: "opencode",
            metadata: {
              executor: "codex",
              ui_context: "engine_bar",
            },
          }),
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
          kind: string
          message: string
          local_action?: { type: string; executor?: string }
        }
        expect(body.kind).toBe("panel_response")
        expect(body.local_action?.type).toBe("set_executor")
        expect(body.local_action?.executor).toBe("codex")
      },
    })
  })
})
