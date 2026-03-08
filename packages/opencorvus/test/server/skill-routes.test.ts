import { afterEach, describe, expect, mock, test } from "bun:test"
import { rm } from "fs/promises"
import path from "path"
import type { PermissionNext } from "../../src/permission/next"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { SkillTool } from "../../src/tool/skill"
import type { Tool } from "../../src/tool/tool"
import { Log } from "../../src/util/log"
import { Filesystem } from "../../src/util/filesystem"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const cleanupTargets = [
  path.resolve(process.cwd(), "opencorvus.jsonc"),
  path.resolve(process.cwd(), "opencorvus.json"),
  path.resolve(process.cwd(), "config.json"),
  path.resolve(process.cwd(), "skills-market"),
].map((target) => ({
  target,
  existed: Promise.resolve(Bun.file(target).exists()),
}))

const baseCtx: Omit<Tool.Context, "ask"> = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
}

describe("skill routes", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
    await Promise.all(
      cleanupTargets.map(async (item) => {
        if (await item.existed) return
        await rm(item.target, { recursive: true, force: true }).catch(() => undefined)
      }),
    )
  })

  test("GET /skill/market returns curated market entries", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/skill/market", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        const body = await response.json() as Array<{ id: string; trust: string; recommended_policy: string }>
        expect(body.some((item) => item.id === "openai-skills")).toBe(true)
        expect(body.some((item) => item.id === "anthropic-skills")).toBe(true)
        expect(body.every((item) => item.recommended_policy === "ask")).toBe(true)
      },
    })
  })

  test("POST /skill/install imports a local skill source and reports risk metadata", async () => {
    await using tmp = await tmpdir({ git: true })
    const skillDir = path.join(tmp.path, "local-skill")
    await Filesystem.write(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: local-review",
        "description: Local review skill",
        "---",
        "",
        "Use this skill for review tasks.",
      ].join("\n"),
    )
    await Filesystem.write(path.join(skillDir, "scripts", "review.sh"), "echo review")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const installed = await app.request("/skill/install", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            kind: "path",
            value: skillDir,
            policy: "ask",
          }),
        })

        expect(installed.status).toBe(200)

        const listed = await app.request("/skill/installed", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(listed.status).toBe(200)
        const body = await listed.json() as Array<{
          name: string
          source_type: string
          source?: string
          trust: string
          policy: string
          recommended_policy: string
          risk: {
            level: string
            has_scripts: boolean
          }
        }>
        const item = body.find((entry) => entry.name === "local-review")
        expect(item).toBeDefined()
        expect(item?.source_type).toBe("config_path")
        expect(item?.source).toBe(skillDir)
        expect(item?.trust).toBe("local")
        expect(item?.policy).toBe("ask")
        expect(item?.recommended_policy).toBe("ask")
        expect(item?.risk.level).toBe("high")
        expect(item?.risk.has_scripts).toBe(true)
      },
    })
  }, 40000)

  test("POST /skill/policy updates effective policy and /skill/remove removes the source", async () => {
    await using tmp = await tmpdir({ git: true })
    const skillDir = path.join(tmp.path, "skill-two")
    await Filesystem.write(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: local-note",
        "description: Local note skill",
        "---",
        "",
        "Use this skill for note taking.",
      ].join("\n"),
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        await app.request("/skill/install", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            kind: "path",
            value: skillDir,
          }),
        })

        const updated = await app.request("/skill/policy", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            name: "local-note",
            action: "deny",
          }),
        })
        expect(updated.status).toBe(200)

        const listed = await app.request("/skill/installed", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        const body = await listed.json() as Array<{ name: string; policy: string }>
        expect(body.find((item) => item.name === "local-note")?.policy).toBe("deny")

        const removed = await app.request("/skill/remove", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            source: skillDir,
            kind: "path",
          }),
        })
        expect(removed.status).toBe(200)

        const after = await app.request("/skill/installed", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        const afterBody = await after.json() as Array<{ name: string }>
        expect(afterBody.some((item) => item.name === "local-note")).toBe(false)
      },
    })
  }, 20000)

  test("installed skill can be loaded through SkillTool after route install", async () => {
    await using tmp = await tmpdir({ git: true })
    const skillDir = path.join(tmp.path, "skill-e2e")
    await Filesystem.write(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: route-installed-skill",
        "description: Route installed skill for e2e coverage",
        "---",
        "",
        "Use this skill after installation.",
      ].join("\n"),
    )
    await Filesystem.write(path.join(skillDir, "scripts", "demo.txt"), "demo")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const installed = await app.request("/skill/install", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            kind: "path",
            value: skillDir,
            policy: "ask",
          }),
        })

        expect(installed.status).toBe(200)

        const listed = await app.request("/skill/installed", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(listed.status).toBe(200)
        const body = await listed.json() as Array<{ name: string; policy: string }>
        expect(body.find((item) => item.name === "route-installed-skill")?.policy).toBe("ask")

        const tool = await SkillTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const ctx: Tool.Context = {
          ...baseCtx,
          ask: async (req) => {
            requests.push(req)
          },
        }

        const result = await tool.execute({ name: "route-installed-skill" }, ctx)
        expect(requests.length).toBe(1)
        expect(requests[0].permission).toBe("skill")
        expect(requests[0].patterns).toContain("route-installed-skill")
        expect(result.title).toBe("Loaded skill: route-installed-skill")
        expect(result.metadata.dir).toBe(skillDir)
        expect(result.output).toContain('<skill_content name="route-installed-skill">')
        expect(result.output).toContain("Use this skill after installation.")
        expect(result.output).toContain(path.resolve(skillDir, "scripts", "demo.txt"))
      },
    })
  }, 20000)

  test("real market entry can be installed and loaded through SkillTool", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.App()
    const market = await app.request("/skill/market", {
      headers: {
        "x-opencorvus-directory": tmp.path,
      },
    })
    expect(market.status).toBe(200)
    const entries = await market.json() as Array<{
      id: string
      name: string
      source?: string
      install_kind: "git" | "url" | "manual"
      recommended_policy: "ask" | "allow" | "deny"
    }>
    const entry =
      entries.find((item) => item.id === "openai-skills" && item.install_kind === "git" && item.source) ??
      entries.find((item) => item.install_kind === "git" && item.source)
    expect(entry).toBeDefined()

    const before = await app.request("/skill/installed", {
      headers: {
        "x-opencorvus-directory": tmp.path,
      },
    })
    expect(before.status).toBe(200)
    const beforeBody = await before.json() as Array<{ name: string }>
    const beforeNames = new Set(beforeBody.map((item) => item.name))

    const installed = await app.request("/skill/install", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-opencorvus-directory": tmp.path,
      },
      body: JSON.stringify({
        kind: entry!.install_kind,
        value: entry!.source,
        policy: entry!.recommended_policy,
      }),
    })
    expect(installed.status).toBe(200)

    const listed = await app.request("/skill/installed", {
      headers: {
        "x-opencorvus-directory": tmp.path,
      },
    })
    expect(listed.status).toBe(200)
    const body = await listed.json() as Array<{
      name: string
      policy: string
      source_type: string
      source?: string
    }>
    const installedSkills = body.filter(
      (item) => item.source_type === "managed_git" && !beforeNames.has(item.name),
    )
    expect(installedSkills.length > 0).toBe(true)
    expect(installedSkills.every((item) => item.policy === entry!.recommended_policy)).toBe(true)

    const selected = installedSkills[0]
    expect(selected).toBeDefined()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await SkillTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const ctx: Tool.Context = {
          ...baseCtx,
          ask: async (req) => {
            requests.push(req)
          },
        }

        const result = await tool.execute({ name: selected!.name }, ctx)
        expect(requests.length).toBe(1)
        expect(requests[0].permission).toBe("skill")
        expect(requests[0].patterns).toContain(selected!.name)
        expect(result.title).toBe(`Loaded skill: ${selected!.name}`)
        expect(result.output).toContain(`<skill_content name="${selected!.name}">`)
      },
    })
  }, 120000)
})
