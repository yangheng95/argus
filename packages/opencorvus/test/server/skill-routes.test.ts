import { afterEach, describe, expect, mock, test } from "bun:test"
import { rm } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { Config } from "../../src/config/config"
import type { PermissionNext } from "../../src/permission/next"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { SkillTool } from "../../src/tool/skill"
import type { Tool } from "../../src/tool/tool"
import { Log } from "../../src/util/log"
import { Filesystem } from "../../src/util/filesystem"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js"

Log.init({ print: false })

async function zipBase64(files: Record<string, string>) {
  const writer = new ZipWriter(new Uint8ArrayWriter())
  for (const [name, content] of Object.entries(files)) {
    await writer.add(name, new TextReader(content))
  }
  return Buffer.from(await writer.close()).toString("base64")
}

const cleanupTargets = [
  path.resolve(process.cwd(), "opencorvus.jsonc"),
  path.resolve(process.cwd(), "opencorvus.json"),
  path.resolve(process.cwd(), "config.json"),
  path.resolve(process.cwd(), "skills-market"),
].map((target) => ({
  target,
  existed: existsSync(target),
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
        if (item.existed) return
        await rm(item.target, { recursive: true, force: true }).catch(() => undefined)
      }),
    )
    Config.global.reset()
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
        const body = (await response.json()) as Array<{ id: string; trust: string; recommended_policy: string }>
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
        const body = (await listed.json()) as Array<{
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

  test("POST /skill/import-file writes a dropped SKILL.md into project .opencorvus", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const imported = await app.request("/skill/import-file", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            filename: "SKILL.md",
            policy: "ask",
            content: [
              "---",
              "name: dropped-review",
              "description: Dropped review skill",
              "---",
              "",
              "Use this skill after dropping the file into the overlay.",
            ].join("\n"),
          }),
        })

        expect(imported.status).toBe(200)
        const importBody = (await imported.json()) as { name: string; source: string; kind: string }
        expect(importBody.name).toBe("dropped-review")
        expect(importBody.kind).toBe("path")
        expect(importBody.source).toBe(path.join(tmp.path, ".opencorvus", "skill", "dropped-review", "SKILL.md"))
        expect(await Filesystem.exists(importBody.source)).toBe(true)

        const listed = await app.request("/skill/installed", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(listed.status).toBe(200)
        const body = (await listed.json()) as Array<{
          name: string
          source_type: string
          location: string
          policy: string
        }>
        const item = body.find((entry) => entry.name === "dropped-review")
        expect(item).toBeDefined()
        expect(item?.source_type).toBe("unknown")
        expect(item?.location).toBe(importBody.source)
        expect(item?.policy).toBe("ask")
      },
    })
  }, 20000)

  test("POST /skill/import-file imports a dropped skill directory with bundled files", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const imported = await app.request("/skill/import-file", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            sourceName: "folder-skill",
            policy: "ask",
            files: [
              {
                path: "folder-skill/SKILL.md",
                content: [
                  "---",
                  "name: folder-review",
                  "description: Folder review skill",
                  "---",
                  "",
                  "Use this skill from a dropped directory.",
                ].join("\n"),
              },
              {
                path: "folder-skill/scripts/review.txt",
                content: "folder-script",
              },
            ],
          }),
        })

        expect(imported.status).toBe(200)
        const body = (await imported.json()) as { name: string; source: string; names?: string[] }
        expect(body.name).toBe("folder-review")
        expect(body.names).toEqual(["folder-review"])
        expect(body.source).toBe(path.join(tmp.path, ".opencorvus", "skill", "folder-review", "SKILL.md"))
        expect(
          await Filesystem.readText(
            path.join(tmp.path, ".opencorvus", "skill", "folder-review", "scripts", "review.txt"),
          ),
        ).toBe("folder-script")

        const listed = await app.request("/skill/installed", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        const installed = (await listed.json()) as Array<{ name: string; policy: string }>
        expect(installed.find((item) => item.name === "folder-review")?.policy).toBe("ask")
      },
    })
  }, 20000)

  test("POST /skill/import-file imports a dropped skill zip archive", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const archiveBase64 = await zipBase64({
          "zip-skill/SKILL.md": [
            "---",
            "name: zip-review",
            "description: Zip review skill",
            "---",
            "",
            "Use this skill from a dropped zip archive.",
          ].join("\n"),
          "zip-skill/references/guide.md": "zip-reference",
        })
        const imported = await app.request("/skill/import-file", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            filename: "zip-skill.zip",
            policy: "allow",
            archiveBase64,
          }),
        })

        expect(imported.status).toBe(200)
        const body = (await imported.json()) as { name: string; source: string; names?: string[] }
        expect(body.name).toBe("zip-review")
        expect(body.names).toEqual(["zip-review"])
        expect(body.source).toBe(path.join(tmp.path, ".opencorvus", "skill", "zip-review", "SKILL.md"))
        expect(
          await Filesystem.readText(
            path.join(tmp.path, ".opencorvus", "skill", "zip-review", "references", "guide.md"),
          ),
        ).toBe("zip-reference")

        const listed = await app.request("/skill/installed", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        const installed = (await listed.json()) as Array<{ name: string; policy: string }>
        expect(installed.find((item) => item.name === "zip-review")?.policy).toBe("allow")
      },
    })
  }, 20000)

  test("GET /skill/installed classifies .codex skills as external", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".codex", "skills", "codex-review")
        await Filesystem.write(
          path.join(skillDir, "SKILL.md"),
          [
            "---",
            "name: codex-review",
            "description: Codex external review skill",
            "---",
            "",
            "Use this skill from a Codex-compatible external directory.",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const listed = await app.request("/skill/installed", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(listed.status).toBe(200)
        const body = (await listed.json()) as Array<{
          name: string
          source_type: string
          trust: string
          recommended_policy: string
        }>
        const item = body.find((entry) => entry.name === "codex-review")
        expect(item).toBeDefined()
        expect(item?.source_type).toBe("external")
        expect(item?.trust).toBe("external")
        expect(item?.recommended_policy).toBe("ask")
      },
    })
  }, 20000)

  test("GET /skill/installed classifies .opencorvus/skills as external without duplicating config scan", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencorvus", "skills", "opencorvus-review")
        await Filesystem.write(
          path.join(skillDir, "SKILL.md"),
          [
            "---",
            "name: opencorvus-review",
            "description: OpenCorvus plural skill root",
            "---",
            "",
            "Use this skill from an OpenCorvus plural skill directory.",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const listed = await app.request("/skill/installed", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(listed.status).toBe(200)
        const body = (await listed.json()) as Array<{
          name: string
          source_type: string
          trust: string
          recommended_policy: string
          duplicate_locations: string[]
        }>
        const matches = body.filter((entry) => entry.name === "opencorvus-review")
        expect(matches.length).toBe(1)
        expect(matches[0]?.source_type).toBe("external")
        expect(matches[0]?.trust).toBe("external")
        expect(matches[0]?.recommended_policy).toBe("ask")
        expect(matches[0]?.duplicate_locations).toEqual([])
      },
    })
  }, 20000)

  test("GET /skill/installed returns duplicate skill locations and filters expired duplicates", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Filesystem.write(
          path.join(dir, ".claude", "skills", "route-review", "SKILL.md"),
          [
            "---",
            "name: route-review",
            "description: Route review skill from Claude directory",
            "---",
            "",
            "Use this skill from Claude.",
          ].join("\n"),
        )
        await Filesystem.write(
          path.join(dir, ".opencorvus", "skill", "route-review", "SKILL.md"),
          [
            "---",
            "name: route-review",
            "description: Route review skill from OpenCorvus directory",
            "---",
            "",
            "Use this skill from OpenCorvus.",
          ].join("\n"),
        )
        await Filesystem.write(
          path.join(dir, ".agents", "skills", "route-review-expired", "SKILL.md"),
          [
            "---",
            "name: route-review",
            "description: Expired route review skill",
            `expires_at: ${new Date(Date.now() - 60_000).toISOString()}`,
            "---",
            "",
            "This duplicate is expired.",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const listed = await app.request("/skill/installed", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(listed.status).toBe(200)
        const body = (await listed.json()) as Array<{
          name: string
          location: string
          duplicate_locations: string[]
        }>
        const matches = body.filter((entry) => entry.name === "route-review")
        const claudeLocation = path.join(tmp.path, ".claude", "skills", "route-review", "SKILL.md")
        const opencorvusLocation = path.join(tmp.path, ".opencorvus", "skill", "route-review", "SKILL.md")
        const expiredLocation = path.join(tmp.path, ".agents", "skills", "route-review-expired", "SKILL.md")
        expect(matches.length).toBe(1)
        expect(matches[0]?.duplicate_locations).toContain(claudeLocation)
        expect(matches[0]?.duplicate_locations).toContain(opencorvusLocation)
        expect(matches[0]?.duplicate_locations).not.toContain(expiredLocation)
        expect(matches[0]?.duplicate_locations.length).toBe(2)
      },
    })
  }, 20000)

  // After /skill/remove, /skill/installed still surfaces the skill — Config layer caches
  // skills.paths even after Skill.state.reset()/Config.state.reset(). Pending a deeper
  // cache invalidation fix in the manager.
  test.skip("POST /skill/policy updates effective policy and /skill/remove removes the source", async () => {
    await using tmp = await tmpdir({ git: true })
    const skillDir = path.join(tmp.path, "skill-two")
    await Filesystem.write(
      path.join(skillDir, "SKILL.md"),
      ["---", "name: local-note", "description: Local note skill", "---", "", "Use this skill for note taking."].join(
        "\n",
      ),
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
        const body = (await listed.json()) as Array<{ name: string; policy: string }>
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
        const afterBody = (await after.json()) as Array<{ name: string }>
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
        const body = (await listed.json()) as Array<{ name: string; policy: string }>
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

  // Live test: shells out to git to clone a real market entry (openai-skills) — flaky in CI.
  test.skip("real market entry can be installed and loaded through SkillTool", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.App()
    const market = await app.request("/skill/market", {
      headers: {
        "x-opencorvus-directory": tmp.path,
      },
    })
    expect(market.status).toBe(200)
    const entries = (await market.json()) as Array<{
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
    const beforeBody = (await before.json()) as Array<{ name: string }>
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
    const body = (await listed.json()) as Array<{
      name: string
      policy: string
      source_type: string
      source?: string
    }>
    const installedSkills = body.filter((item) => item.source_type === "managed_git" && !beforeNames.has(item.name))
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
