import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { ExecutorBootstrap } from "../../src/executor/bootstrap"
import { ExecutorRegistry } from "../../src/executor/registry"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const CODEX_MODEL_KEY = "OPENCORVUS_EXECUTOR_CODEX_MODEL"
const CLAUDE_MODEL_KEY = "OPENCORVUS_EXECUTOR_CLAUDE_MODEL"

describe("executor routes", () => {
  afterEach(async () => {
    mock.restore()
    ExecutorRegistry.reset()
    delete process.env.OPENCORVUS_EXECUTOR_CODEX_PROTOCOL
    delete process.env[CODEX_MODEL_KEY]
    delete process.env[CLAUDE_MODEL_KEY]
    await resetDatabase()
  })

  test("GET /executor reports default modern protocol surfaces", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/executor", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(response.status).toBe(200)
        const body = (await response.json()) as Array<{
          id: string
          protocol: string
          protocolVersion: string
          transport: string
          features: { structured_output?: boolean }
          tools: Array<{ name: string }>
        }>
        expect(body.find((item) => item.id === "codex")?.protocol).toBe("codex-app-server")
        expect(body.find((item) => item.id === "codex")?.protocolVersion).toBe("v2")
        expect(body.find((item) => item.id === "claude-code")?.protocol).toBe("claude-agent-sdk")
        expect(body.find((item) => item.id === "claude-code")?.transport).toBe("inproc")
        expect(body.find((item) => item.id === "codex")?.tools.some((item) => item.name === "shell_command")).toBe(true)
        expect(body.find((item) => item.id === "claude-code")?.features.structured_output).toBe(true)
        expect(
          body.find((item) => item.id === "claude-code")?.tools.some((item) => item.name === "structured_output"),
        ).toBe(false)
      },
    })
  })

  test("GET /executor propagates executor bootstrap registration failures", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        spyOn(ExecutorBootstrap, "autoRegister").mockRejectedValue(new Error("executor bootstrap unavailable"))
        const response = await Server.App().request("/executor", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(500)
        await expect(response.json()).resolves.toMatchObject({
          name: "UnknownError",
          data: { message: "executor bootstrap unavailable" },
        })
      },
    })
  })

  test("PATCH /executor/:executorID/model rejects malformed bodies without clearing the current override", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        process.env[CODEX_MODEL_KEY] = "gpt-5.5"

        const nonString = await app.request("/executor/codex/model", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({ model: 42 }),
        })
        expect(nonString.status).toBe(400)
        expect(process.env[CODEX_MODEL_KEY]).toBe("gpt-5.5")

        const missing = await app.request("/executor/codex/model", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({}),
        })
        expect(missing.status).toBe(400)
        expect(process.env[CODEX_MODEL_KEY]).toBe("gpt-5.5")
      },
    })
  })

  test("PATCH /executor/:executorID/model accepts a string body and keeps empty string as explicit clear", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        process.env[CODEX_MODEL_KEY] = "gpt-5.5"

        const set = await app.request("/executor/codex/model", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({ model: " gpt-5.4 " }),
        })
        expect(set.status).toBe(200)
        await expect(set.json()).resolves.toEqual({ ok: true })
        expect(process.env[CODEX_MODEL_KEY]).toBe("gpt-5.4")

        const clear = await app.request("/executor/codex/model", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({ model: "" }),
        })
        expect(clear.status).toBe(200)
        await expect(clear.json()).resolves.toEqual({ ok: true })
        expect(process.env[CODEX_MODEL_KEY]).toBeUndefined()

        const unsupported = await app.request("/executor/opencorvus/model", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({ model: "gpt-5.4" }),
        })
        expect(unsupported.status).toBe(404)
        await expect(unsupported.json()).resolves.toMatchObject({ name: "NotFoundError" })
      },
    })
  })

  test("Server.openapi documents executor model PATCH body and named 404 response", async () => {
    const spec = await Server.openapi()
    const patch = spec.paths?.["/executor/{executorID}/model"]?.patch
    const requestBody = patch?.requestBody
    const schema = requestBody?.content?.["application/json"]?.schema
    const notFoundSchema = patch?.responses?.["404"]?.content?.["application/json"]?.schema

    expect(requestBody?.required).toBe(true)
    expect(schema?.properties?.model?.type).toBe("string")
    expect(schema?.required).toContain("model")
    expect(JSON.stringify(notFoundSchema)).toContain("NotFoundError")
  })
})
