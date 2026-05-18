import { afterEach, expect, mock, spyOn, test } from "bun:test"
import path from "node:path"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { SessionPrompt } from "../../src/session/prompt"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const routePath = path.join(import.meta.dir, "..", "..", "src", "server", "routes", "coding.ts")
const source = await Bun.file(routePath).text()

afterEach(async () => {
  mock.restore()
  Config.global.reset()
  await Instance.disposeAll()
  await resetDatabase()
})

test("coding stream route uses the coding agent explicitly", () => {
  expect(source).toContain('agent: "coding"')
  expect(source).toContain("coding agent for direct coding assistance")
  expect(source).not.toContain("Agent.defaultAgent()")
  expect(source).not.toContain("build agent for direct coding assistance")
})

test("coding stream route ignores configured default_agent and prompts coding", async () => {
  await using tmp = await tmpdir({
    git: true,
    config: {
      model: "openai/gpt-5.2",
      default_agent: "custom-primary",
      agent: {
        "custom-primary": {
          mode: "primary",
          prompt: "Custom primary prompt",
        },
      },
    },
  })

  const calls: Array<Parameters<typeof SessionPrompt.prompt>[0]> = []
  spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
    calls.push(input)
    return {
      info: {
        id: "msg_coding_route",
        sessionID: input.sessionID,
        role: "user",
        time: { created: Date.now() },
        agent: input.agent ?? "coding",
        model: { providerID: "openai", modelID: "gpt-5.2" },
      },
      parts: [],
    } as Awaited<ReturnType<typeof SessionPrompt.prompt>>
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const app = Server.App()
      const response = await app.request("/coding/message/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-opencorvus-directory": tmp.path,
        },
        body: JSON.stringify({ text: "touch the file" }),
      })

      expect(response.status).toBe(200)
      expect(await response.text()).toContain('"type":"done"')
    },
  })

  expect(calls).toHaveLength(1)
  expect(calls[0].agent).toBe("coding")
  expect(calls[0].parts).toEqual([{ type: "text", text: "touch the file" }])
})
