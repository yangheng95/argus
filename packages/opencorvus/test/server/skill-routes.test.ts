import { afterEach, describe, expect, mock, test } from "bun:test"
import { rm } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { Config } from "../../src/config/config"
import type { PermissionNext } from "../../src/permission/next"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { SkillTool } from "../../src/tool/skill"
import { Agent } from "../../src/agent/agent"
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
        expect(item?.source_type).toBe("external")
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

  test("POST /skill/import-and-mount imports every dropped archive skill and mounts each to the agent", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const archiveBase64 = await zipBase64({
          "bundle-alpha/SKILL.md": [
            "---",
            "name: bundle-alpha",
            "description: First dropped bundle skill",
            "---",
            "",
            "Use this first bundle skill.",
          ].join("\n"),
          "bundle-beta/SKILL.md": [
            "---",
            "name: bundle-beta",
            "description: Second dropped bundle skill",
            "---",
            "",
            "Use this second bundle skill.",
          ].join("\n"),
        })
        const mounted = await app.request("/skill/import-and-mount", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            agent: "requirements",
            import: {
              filename: "skill-bundle.zip",
              archiveBase64,
            },
          }),
        })

        expect(mounted.status).toBe(200)
        const body = (await mounted.json()) as {
          skills: Array<{ name: string; mounted_agents: string[]; unmounted: boolean }>
          matrix: Array<{ agent: string; mounted: Array<{ name: string; enabled: boolean }> }>
        }
        const mountedNames = body.matrix.find((row) => row.agent === "requirements")?.mounted.map((item) => item.name)
        expect(mountedNames).toContain("bundle-alpha")
        expect(mountedNames).toContain("bundle-beta")
        for (const name of ["bundle-alpha", "bundle-beta"]) {
          const poolSkill = body.skills.find((entry) => entry.name === name)
          expect(poolSkill?.mounted_agents).toEqual(["requirements"])
          expect(poolSkill?.unmounted).toBe(false)
          const yaml = await Filesystem.readText(path.join(tmp.path, ".opencorvus", "skill", name, "SKILL.md"))
          expect(yaml).toContain("mounted_agents:")
          expect(yaml).toContain("- requirements")
        }
      },
    })
  }, 20000)

  test("POST /skill/import-and-mount validates agent before writing dropped skills", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/skill/import-and-mount", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            agent: "requriements",
            import: {
              filename: "atomic-skill/SKILL.md",
              content: [
                "---",
                "name: atomic-skill",
                "description: Skill that must not be written on failed mount.",
                "---",
                "",
                "Do not write this skill when the agent is invalid.",
              ].join("\n"),
            },
          }),
        })

        expect(response.status).toBe(500)
        const body = (await response.json()) as { data?: { message?: string } }
        expect(body.data?.message).toContain("Unknown agent: requriements")
        expect(await Filesystem.exists(path.join(tmp.path, ".opencorvus", "skill", "atomic-skill", "SKILL.md"))).toBe(
          false,
        )
      },
    })
  })

  test("POST /skill/mount persists builtin skill mounts in the project SKILL.md", async () => {
    await using tmp = await tmpdir({ git: true })
    const home = process.env.OPENCORVUS_TEST_HOME
    const opencorvusHome = process.env.OPENCORVUS_HOME
    process.env.OPENCORVUS_TEST_HOME = tmp.path
    process.env.OPENCORVUS_HOME = path.join(tmp.path, "portable")

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const app = Server.App()
          const mounted = await app.request("/skill/mount", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-opencorvus-directory": tmp.path,
            },
            body: JSON.stringify({
              agent: "build",
              skill: "research-report",
            }),
          })

          expect(mounted.status).toBe(200)
          const body = (await mounted.json()) as {
            skills: Array<{ name: string; location: string; mounted_agents: string[]; unmounted: boolean }>
            matrix: Array<{ agent: string; mounted: Array<{ name: string; enabled: boolean }> }>
          }
          const skill = body.skills.find((entry) => entry.name === "research-report")
          expect(skill).toBeDefined()
          expect(skill!.location).toBe(path.join(tmp.path, ".opencorvus", "skills", "research-report", "SKILL.md"))
          expect(skill!.mounted_agents).toContain("build")
          expect(skill!.unmounted).toBe(false)
          expect(body.matrix.find((row) => row.agent === "build")?.mounted).toContainEqual(
            expect.objectContaining({ name: "research-report", enabled: true }),
          )
          const yaml = await Filesystem.readText(skill!.location)
          expect(yaml).toContain("mounted_agents:")
          expect(yaml).toContain("- build")
          expect(
            await Filesystem.exists(path.join(tmp.path, ".opencorvus", "skills", "research-report", "SKILL.md")),
          ).toBe(true)

          const listed = await app.request("/skill/mounts", {
            headers: {
              "x-opencorvus-directory": tmp.path,
            },
          })
          expect(listed.status).toBe(200)
          const listedBody = (await listed.json()) as {
            skills: Array<{ name: string; mounted_agents: string[] }>
          }
          expect(listedBody.skills.find((entry) => entry.name === "research-report")?.mounted_agents).toContain("build")
        },
      })
    } finally {
      if (home === undefined) delete process.env.OPENCORVUS_TEST_HOME
      else process.env.OPENCORVUS_TEST_HOME = home
      if (opencorvusHome === undefined) delete process.env.OPENCORVUS_HOME
      else process.env.OPENCORVUS_HOME = opencorvusHome
    }
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

  test("GET /skill/mounts pools external skills as unmounted and keeps mounted pool rows reusable", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        for (const [root, name] of [
          [path.join(".claude", "skills"), "claude-review"],
          [path.join(".agents", "skills"), "agents-review"],
          [path.join(".codex", "skills"), "codex-review"],
          [path.join(".opencorvus", "skill"), "opencorvus-singular-review"],
          [path.join(".opencorvus", "skills"), "opencorvus-plural-review"],
        ] as const) {
          await Filesystem.write(
            path.join(dir, root, name, "SKILL.md"),
            [
              "---",
              `name: ${name}`,
              `description: ${root} external review skill`,
              "---",
              "",
              `Use this skill from ${root}.`,
            ].join("\n"),
          )
        }
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const initial = await app.request("/skill/mounts", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(initial.status).toBe(200)
        const initialBody = (await initial.json()) as {
          unmounted_count: number
          skills: Array<{ name: string; mounted_agents: string[]; unmounted: boolean; warning?: string }>
        }
        for (const name of [
          "claude-review",
          "agents-review",
          "codex-review",
          "opencorvus-singular-review",
          "opencorvus-plural-review",
        ]) {
          const skill = initialBody.skills.find((entry) => entry.name === name)
          expect(skill).toBeDefined()
          expect(skill?.mounted_agents).toEqual([])
          expect(skill?.unmounted).toBe(true)
          expect(skill?.warning).toBe("unmounted")
        }

        const mountedRequirements = await app.request("/skill/mount", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            agent: "requirements",
            skill: "claude-review",
          }),
        })
        expect(mountedRequirements.status).toBe(200)

        const mountedArchitect = await app.request("/skill/mount", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            agent: "architect",
            skill: "claude-review",
          }),
        })
        expect(mountedArchitect.status).toBe(200)
        const body = (await mountedArchitect.json()) as {
          skills: Array<{ name: string; mounted_agents: string[]; unmounted: boolean }>
          matrix: Array<{ agent: string; mounted: Array<{ name: string; enabled: boolean }> }>
        }
        const poolSkill = body.skills.find((entry) => entry.name === "claude-review")
        expect(poolSkill?.mounted_agents).toEqual(["requirements", "architect"])
        expect(poolSkill?.unmounted).toBe(false)
        expect(body.matrix.find((row) => row.agent === "requirements")?.mounted).toContainEqual(
          expect.objectContaining({ name: "claude-review", enabled: true }),
        )
        expect(body.matrix.find((row) => row.agent === "architect")?.mounted).toContainEqual(
          expect.objectContaining({ name: "claude-review", enabled: true }),
        )
        const mountedYaml = await Filesystem.readText(
          path.join(tmp.path, ".claude", "skills", "claude-review", "SKILL.md"),
        )
        expect(mountedYaml).toContain("mounted_agents:")
        expect(mountedYaml).toContain("- requirements")
        expect(mountedYaml).toContain("- architect")

        const unmountedRequirements = await app.request("/skill/unmount", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            agent: "requirements",
            skill: "claude-review",
          }),
        })
        expect(unmountedRequirements.status).toBe(200)
        const unmountedYaml = await Filesystem.readText(
          path.join(tmp.path, ".claude", "skills", "claude-review", "SKILL.md"),
        )
        expect(unmountedYaml).toContain("mounted_agents:")
        expect(unmountedYaml).not.toContain("- requirements")
        expect(unmountedYaml).toContain("- architect")
      },
    })
  }, 20000)

  test("GET /skill/mounts exposes integrity as mountable and allows integrity preview skill mounts", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Filesystem.write(
          path.join(dir, ".opencorvus", "skill", "integrity-preview-review", "SKILL.md"),
          [
            "---",
            "name: integrity-preview-review",
            "description: Integrity preview review workflow.",
            "required_tools:",
            "  - browser_preview_bind_local_module",
            "agents:",
            "  - integrity",
            "---",
            "",
            "Use browser preview evidence for integrity review.",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const initial = await app.request("/skill/mounts", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(initial.status).toBe(200)
        const initialBody = (await initial.json()) as {
          agents: Array<{ name: string; skill_mountable: boolean; skill_tool_available: boolean }>
          skills: Array<{ name: string; mounted_agents: string[]; unmounted: boolean }>
          matrix: Array<{ agent: string; mounted: Array<{ name: string; enabled: boolean }> }>
        }
        expect(initialBody.agents).toContainEqual(
          expect.objectContaining({ name: "integrity", skill_mountable: true, skill_tool_available: true }),
        )
        expect(initialBody.agents.map((agent) => agent.name)).not.toContain("orchestrator")
        expect(initialBody.matrix.map((row) => row.agent)).not.toContain("orchestrator")
        expect(initialBody.skills.find((entry) => entry.name === "integrity-preview-review")?.mounted_agents).toEqual(
          [],
        )

        const mounted = await app.request("/skill/mount", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            agent: "integrity",
            skill: "integrity-preview-review",
          }),
        })
        expect(mounted.status).toBe(200)
        const body = (await mounted.json()) as {
          skills: Array<{ name: string; mounted_agents: string[]; unmounted: boolean }>
          matrix: Array<{ agent: string; mounted: Array<{ name: string; enabled: boolean }> }>
        }
        expect(body.skills.find((entry) => entry.name === "integrity-preview-review")?.mounted_agents).toEqual([
          "integrity",
        ])
        expect(body.skills.find((entry) => entry.name === "integrity-preview-review")?.unmounted).toBe(false)
        expect(body.matrix.find((row) => row.agent === "integrity")?.mounted).toContainEqual(
          expect.objectContaining({ name: "integrity-preview-review", enabled: true }),
        )

        const yaml = await Filesystem.readText(
          path.join(tmp.path, ".opencorvus", "skill", "integrity-preview-review", "SKILL.md"),
        )
        expect(yaml).toContain("mounted_agents:")
        expect(yaml).toContain("- integrity")
      },
    })
  })

  test("POST /skill/mount rejects operator-managed mounts for non-mountable agents", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Filesystem.write(
          path.join(dir, ".opencorvus", "skill", "orchestrator-manual", "SKILL.md"),
          [
            "---",
            "name: orchestrator-manual",
            "description: Manual orchestrator mount should stay rejected.",
            "---",
            "",
            "This skill must not be operator-mounted to orchestrator.",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/skill/mount", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            agent: "orchestrator",
            skill: "orchestrator-manual",
          }),
        })

        expect(response.status).toBe(500)
        const body = (await response.json()) as { data?: { message?: string } }
        expect(body.data?.message).toContain("does not allow operator-managed skill mounts")
        const yaml = await Filesystem.readText(
          path.join(tmp.path, ".opencorvus", "skill", "orchestrator-manual", "SKILL.md"),
        )
        expect(yaml).not.toContain("mounted_agents:")
      },
    })
  })

  test("GET /skill/mounts rejects SKILL.md mounted_agents with unknown agent names", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".opencorvus", "skill", "typo-mounted", "SKILL.md"),
          [
            "---",
            "name: typo-mounted",
            "description: Skill with misspelled mounted agent.",
            "mounted_agents:",
            "  - requriements",
            "---",
            "",
            "This skill should make the matrix fail loudly.",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/skill/mounts", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(500)
        const body = (await response.json()) as { data?: { message?: string } }
        expect(body.data?.message).toContain(
          "Skill typo-mounted mounted_agents contains unknown agent(s): requriements",
        )
      },
    })
  })

  test("GET /skill/installed classifies .opencorvus skill roots as external without duplicating config scan", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        for (const [root, name] of [
          [path.join(".opencorvus", "skill"), "opencorvus-singular-review"],
          [path.join(".opencorvus", "skills"), "opencorvus-plural-review"],
        ] as const) {
          await Filesystem.write(
            path.join(dir, root, name, "SKILL.md"),
            [
              "---",
              `name: ${name}`,
              `description: ${root} OpenCorvus skill root`,
              "---",
              "",
              `Use this skill from ${root}.`,
            ].join("\n"),
          )
        }
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
        for (const name of ["opencorvus-singular-review", "opencorvus-plural-review"]) {
          const matches = body.filter((entry) => entry.name === name)
          expect(matches.length).toBe(1)
          expect(matches[0]?.source_type).toBe("external")
          expect(matches[0]?.trust).toBe("external")
          expect(matches[0]?.recommended_policy).toBe("ask")
          expect(matches[0]?.duplicate_locations).toEqual([])
        }
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

  test("POST /skill/policy updates effective policy and /skill/remove removes the source", async () => {
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

        const mounted = await app.request("/skill/mount", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            agent: "build",
            skill: "route-installed-skill",
          }),
        })
        expect(mounted.status).toBe(200)
        const mountBody = (await mounted.json()) as {
          unmounted_count: number
          skills: Array<{ name: string; mounted_agents: string[]; unmounted: boolean }>
        }
        const mountedSkill = mountBody.skills.find((item) => item.name === "route-installed-skill")
        expect(mountedSkill?.mounted_agents).toContain("build")
        expect(mountedSkill?.unmounted).toBe(false)

        const build = await Agent.get("build")
        expect(build).toBeDefined()
        const tool = await SkillTool.init({ agent: build })
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
