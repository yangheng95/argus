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

  test("Server.openapi includes project routes mounted through routeInventoryApp", async () => {
    const spec = await Server.openapi()
    const paths = spec.paths ?? {}

    expect(paths["/global/health"]?.get).toBeDefined()
    expect(paths["/project/current"]?.get).toBeDefined()
    expect(paths["/goal-run/{goalRunID}/acceptance"]?.get).toBeDefined()
    expect(paths["/task/{taskID}/project-archive"]?.get?.responses?.[200]?.content?.["application/zip"]).toBeDefined()
  })

  test("Server.openapi documents directory query for project-scoped routes only once", async () => {
    const spec = await Server.openapi()
    const paths = spec.paths ?? {}
    const parameterNames = (operation: { parameters?: Array<{ name?: string; in?: string }> } | undefined) =>
      (operation?.parameters ?? [])
        .filter((parameter) => parameter.in === "query" && parameter.name === "directory")
        .map((parameter) => parameter.name)

    expect(parameterNames(paths["/project/current"]?.get)).toEqual(["directory"])
    expect(parameterNames(paths["/task/{taskID}/browser-preview"]?.get)).toEqual(["directory"])
    expect(parameterNames(paths["/session"]?.get)).toEqual(["directory"])
    expect(parameterNames(paths["/global/health"]?.get)).toEqual([])
    expect(parameterNames(paths["/log"]?.get)).toEqual([])
    expect(parameterNames(paths["/log/files"]?.get)).toEqual([])
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
