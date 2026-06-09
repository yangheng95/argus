import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("channel routes", () => {
  afterEach(async () => {
    await Instance.disposeAll()
    await resetDatabase()
  })

  test("GET /channel/runtime reports managed runtime state", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await Server.App().request("/channel/runtime", {
          headers: { "x-opencorvus-directory": tmp.path },
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
          status: string
          detail: string
          channels: string[]
          logs: string[]
          running: boolean
        }
        expect(body.status).toBe("disabled")
        expect(body.running).toBe(false)
        expect(body.channels).toEqual([])
        expect(typeof body.detail).toBe("string")
        expect(Array.isArray(body.logs)).toBe(true)
      },
    })
  })

  test("POST /channel/message can reject unbound threads without creating tasks", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await Server.App().request("/channel/message", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            platform: "slack",
            channel: "C-smoke",
            thread: "T-smoke",
            text: "hello from automated smoke",
            allow_create: false,
          }),
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as { kind: string; message: string }
        expect(body.kind).toBe("panel_response")
        expect(body.message).toContain("No task is bound")
      },
    })
  })
})
