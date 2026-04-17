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

  test("GET /config/prompt returns effective system and agent prompts", async () => {
    await using tmp = await tmpdir({
      config: {
        prompt: {
          core_header: "Custom core header",
        },
        agent: {
          explore: {
            prompt: "Custom explore prompt",
          },
          planner: {
            prompt: "Custom planner prompt",
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
          default_prompt?: string
          configured_prompt: string | null
          inherits_core?: boolean
        }>
        // System-scope slots: core_header + agent_generate (legacy spec/goal/
        // planner/delivery _system slots were dropped when per-agent scope
        // became the single source of truth).
        expect(body.some((item) => item.key === "core_header" && item.scope === "system" && item.prompt === "Custom core header")).toBe(true)
        expect(body.some((item) => item.key === "agent_generate" && item.scope === "system")).toBe(true)
        // Agent-scope: user override on an agent surfaces as configured_prompt.
        expect(body.some((item) => item.key === "explore" && item.scope === "agent" && item.prompt === "Custom explore prompt" && item.configured_prompt === "Custom explore prompt")).toBe(true)
        expect(body.some((item) => item.key === "planner" && item.scope === "agent" && item.prompt === "Custom planner prompt" && item.configured_prompt === "Custom planner prompt")).toBe(true)
        // Previously-masked native agents (architect / requirements / design-analyst)
        // now each have a distinct default prompt — none collapse to empty.
        const architect = body.find((item) => item.key === "architect" && item.scope === "agent")
        const requirements = body.find((item) => item.key === "requirements" && item.scope === "agent")
        const designAnalyst = body.find((item) => item.key === "design-analyst" && item.scope === "agent")
        expect(architect && architect.default_prompt && architect.default_prompt.length > 0).toBe(true)
        expect(requirements && requirements.default_prompt && requirements.default_prompt.length > 0).toBe(true)
        expect(designAnalyst && designAnalyst.default_prompt && designAnalyst.default_prompt.length > 0).toBe(true)
        // Distinct defaults — the pre-fix bug made several agents collapse to
        // the same empty/inherits_core placeholder.
        expect(architect!.default_prompt).not.toBe(requirements!.default_prompt)
        expect(architect!.default_prompt).not.toBe(designAnalyst!.default_prompt)
        expect(requirements!.default_prompt).not.toBe(designAnalyst!.default_prompt)
      },
    })
  })
})
