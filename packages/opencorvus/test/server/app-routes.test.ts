import { afterEach, describe, expect, mock, test } from "bun:test"
import { Server } from "../../src/server/server"
import { clearServerShutdownHandler, registerServerShutdownHandler } from "../../src/server/shutdown"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"

Log.init({ print: false })

describe("app routes", () => {
  afterEach(async () => {
    mock.restore()
    clearServerShutdownHandler()
    await resetDatabase()
  })

  test("GET /ui/ serves the overlay shell", async () => {
    const app = Server.App()
    const response = await app.request("/ui/")

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/html")
    expect(await response.text()).toContain('data-page="overlay"')
  })

  test("POST /shutdown returns 503 without a registered handler", async () => {
    const app = Server.App()
    const response = await app.request("/shutdown", { method: "POST" })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ ok: false })
  })

  test("POST /shutdown dispatches the registered shutdown handler", async () => {
    const app = Server.App()
    const calls: string[] = []
    const invoked = Promise.withResolvers<void>()

    registerServerShutdownHandler((reason) => {
      calls.push(reason)
      invoked.resolve()
    })

    const response = await app.request("/shutdown", { method: "POST" })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })

    await invoked.promise
    expect(calls).toEqual(["http.shutdown"])
  })
})
