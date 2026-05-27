import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readFile } from "fs/promises"
import path from "path"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const ROOT = path.resolve(import.meta.dir, "..", "..", "..", "..")

async function repoFile(...parts: string[]) {
  return await readFile(path.join(ROOT, ...parts), "utf8")
}

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
          "intent-analysis": {
            prompt_append: "Custom intent append",
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
          effective_prompt: string
          default_prompt?: string
          configured_prompt: string | null
          inherits_core?: boolean
          prompt_mode?: "override" | "append"
        }>
        // System-scope slots: core_header + agent_generate (legacy spec/goal/
        // delivery _system slots were dropped when per-agent scope
        // became the single source of truth).
        expect(body.some((item) => item.key === "core_header" && item.scope === "system" && item.prompt === "Custom core header")).toBe(true)
        expect(body.some((item) => item.key === "agent_generate" && item.scope === "system")).toBe(true)
        // Agent-scope: user override on an agent surfaces as configured_prompt.
        expect(body.some((item) => item.key === "explore" && item.scope === "agent" && item.prompt_mode === "override" && item.prompt === "Custom explore prompt" && item.configured_prompt === "Custom explore prompt")).toBe(true)
        const intent = body.find((item) => item.key === "intent-analysis" && item.scope === "agent")
        expect(intent?.prompt_mode).toBe("append")
        expect(intent?.prompt).toBe("Custom intent append")
        expect(intent?.configured_prompt).toBe("Custom intent append")
        expect(intent?.default_prompt && intent.default_prompt.length > 0).toBe(true)
        expect(intent?.effective_prompt).toContain(intent!.default_prompt!)
        expect(intent?.effective_prompt).toContain("Custom intent append")
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

  test("Config schema rejects append-mode prompt replacement and agent renames", () => {
    const promptParsed = Config.Info.safeParse({
      agent: {
        build: { prompt: "Invalid replacement" },
      },
    })
    if (promptParsed.success) throw new Error("expected build prompt replacement to be rejected")
    expect(JSON.stringify(promptParsed.error.issues)).toContain("config.agent.build.prompt is invalid")

    const nameParsed = Config.Info.safeParse({
      agent: {
        build: { name: "Builder" },
      },
    })
    if (nameParsed.success) throw new Error("expected agent rename to be rejected")
    expect(JSON.stringify(nameParsed.error.issues)).toContain("config.agent.build.name cannot rename")
  })

  test("PATCH /config validates model refs before writing config", async () => {
    const source = await repoFile("packages", "opencorvus", "src", "server", "routes", "config.ts")
    const start = source.indexOf('operationId: "config.update"')
    expect(start).toBeGreaterThan(0)
    const body = source.slice(start, source.indexOf("const updated = await Config.get()", start))

    expect(body).toContain("validateConfigModelReferences(partial, \"config\")")
    expect(body.indexOf("validateConfigModelReferences")).toBeLessThan(body.indexOf("Config.update"))
  })
})
