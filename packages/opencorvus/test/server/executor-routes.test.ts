import { afterEach, describe, expect, mock, test } from "bun:test"
import { ExecutorRegistry } from "../../src/executor/registry"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("executor routes", () => {
  afterEach(async () => {
    mock.restore()
    ExecutorRegistry.reset()
    delete process.env.OPENCORVUS_EXECUTOR_CODEX_PROTOCOL
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
})
