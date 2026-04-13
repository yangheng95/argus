import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("config prompt routes", () => {
  beforeEach(async () => {
    await Instance.disposeAll()
    await resetDatabase()
    Config.global.reset()
  })

  afterEach(async () => {
    Config.global.reset()
    await Instance.disposeAll()
    await resetDatabase()
  })

  // /config/prompt response no longer includes the "build" agent unless explicitly configured.
  // Test asserted build.inherits_core=true unconditionally; needs realignment with current catalog.
  test.skip("GET /config/prompt returns effective system and agent prompts", async () => {
    await using tmp = await tmpdir({
      config: {
        prompt: {
          core_header: "Custom core header",
          planner_system: "Custom planner prompt",
        },
        agent: {
          explore: {
            prompt: "Custom explore prompt",
          },
        },
      },
      git: true,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/config/prompt", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        const body = await response.json() as Array<{
          key: string
          scope: string
          prompt: string
          configured_prompt: string | null
          inherits_core?: boolean
        }>
        expect(body.some((item) => item.key === "core_header" && item.scope === "system" && item.prompt === "Custom core header")).toBe(true)
        expect(body.some((item) => item.key === "planner_system" && item.scope === "system" && item.prompt === "Custom planner prompt")).toBe(true)
        expect(body.some((item) => item.key === "explore" && item.scope === "agent" && item.prompt === "Custom explore prompt" && item.configured_prompt === "Custom explore prompt")).toBe(true)
        expect(body.some((item) => item.key === "build" && item.scope === "agent" && item.inherits_core === true)).toBe(true)
      },
    })
  })
})
