import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { rm } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { Config } from "../../src/config/config"
import { Identifier } from "../../src/id/id"
import type { PermissionNext } from "../../src/permission/next"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SkillTool } from "../../src/tool/skill"
import { Agent } from "../../src/agent/agent"
import { SkillMount } from "../../src/skill/mounts"
import type { Tool } from "../../src/tool/tool"
import { Log } from "../../src/util/log"
import { Filesystem } from "../../src/util/filesystem"
import { ProjectTable } from "../../src/project/project.sql"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { copyRepositoryExpertSquadPackage, PROJECT_EXPERT_SQUAD_ID, writeProjectExpertSquadPackage } from "../fixture/expert-squad"
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
          expect(body.skills.find((entry) => entry.name === name)).toMatchObject({
            mounted_agents: ["requirements"],
            unmounted: false,
          })
          const yaml = await Filesystem.readText(path.join(tmp.path, ".opencorvus", "skill", name, "SKILL.md"))
          expect(yaml).toContain("mounted_agents:")
          expect(yaml).toContain("- requirements")
        }
        const installed = await app.request("/skill/installed", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(installed.status).toBe(200)
        const installedBody = (await installed.json()) as Array<{ name: string }>
        expect(installedBody.some((entry) => entry.name === "bundle-alpha")).toBe(true)
        expect(installedBody.some((entry) => entry.name === "bundle-beta")).toBe(true)
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

  test("POST /skill/mount materializes builtin skill into the default skill projection", async () => {
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
          const materialized = path.join(tmp.path, ".opencorvus", "skills", "research-report", "SKILL.md")
          expect(body.skills.find((entry) => entry.name === "research-report")).toMatchObject({
            mounted_agents: ["build"],
            unmounted: false,
          })
          expect(body.matrix.find((row) => row.agent === "build")?.mounted).toContainEqual(
            expect.objectContaining({ name: "research-report", enabled: true }),
          )
          const yaml = await Filesystem.readText(materialized)
          expect(yaml).toContain("mounted_agents:")
          expect(yaml).toContain("- build")
          expect(await Filesystem.exists(materialized)).toBe(true)

          const listed = await app.request("/skill/mounts", {
            headers: {
              "x-opencorvus-directory": tmp.path,
            },
          })
          expect(listed.status).toBe(200)
          const listedBody = (await listed.json()) as {
            skills: Array<{ name: string; mounted_agents: string[] }>
          }
          expect(listedBody.skills.find((entry) => entry.name === "research-report")).toMatchObject({
            mounted_agents: ["build"],
          })

          const installed = await app.request("/skill/installed", {
            headers: {
              "x-opencorvus-directory": tmp.path,
            },
          })
          expect(installed.status).toBe(200)
          const installedBody = (await installed.json()) as Array<{ name: string }>
          expect(installedBody.some((entry) => entry.name === "research-report")).toBe(true)
        },
      })
    } finally {
      if (home === undefined) delete process.env.OPENCORVUS_TEST_HOME
      else process.env.OPENCORVUS_TEST_HOME = home
      if (opencorvusHome === undefined) delete process.env.OPENCORVUS_HOME
      else process.env.OPENCORVUS_HOME = opencorvusHome
    }
  }, 20000)

  test("GET /skill/mounts refresh=true rescans installed skills into the unmounted pool", async () => {
    await using tmp = await tmpdir({ git: true })

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
        const initialBody = (await initial.json()) as { skills: Array<{ name: string }> }
        expect(initialBody.skills.some((entry) => entry.name === "manual-refresh-skill")).toBe(false)

        await Filesystem.write(
          path.join(tmp.path, ".opencorvus", "skill", "manual-refresh-skill", "SKILL.md"),
          [
            "---",
            "name: manual-refresh-skill",
            "description: Skill added directly on disk after the matrix cache was initialized.",
            "---",
            "",
            "Use this skill only after explicit skill refresh.",
          ].join("\n"),
        )

        const refreshed = await app.request("/skill/mounts?refresh=true", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(refreshed.status).toBe(200)
        const refreshedBody = (await refreshed.json()) as {
          skills: Array<{ name: string; mounted_agents: string[]; unmounted: boolean }>
        }
        expect(refreshedBody.skills.find((entry) => entry.name === "manual-refresh-skill")).toMatchObject({
          mounted_agents: [],
          unmounted: true,
        })

        const installed = await app.request("/skill/installed", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(installed.status).toBe(200)
        const installedBody = (await installed.json()) as Array<{ name: string }>
        expect(installedBody.some((entry) => entry.name === "manual-refresh-skill")).toBe(true)
      },
    })
  }, 20000)

  test("GET /skill/mounts with sessionID returns the active expert-squad skill projection", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Filesystem.write(
          path.join(dir, ".opencorvus", "skill", "unreferenced-default", "SKILL.md"),
          [
            "---",
            "name: unreferenced-default",
            "description: Installed ordinary skill in the default system collection.",
            "mounted_agents:",
            "  - build",
            "---",
            "",
            "This skill remains visible because expert-squad projection unions the default system skill collection.",
          ].join("\n"),
        )
      },
    })
    await writeProjectExpertSquadPackage(tmp.path)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.update({ prompt_profile: { active: "general" } })
        const root = await Session.create({ kind: "root", title: "skill projection root" })
        await Session.mergeConfigOverlay({
          sessionID: root.id,
          patch: { prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } },
        })

        const app = Server.App()
        const response = await app.request(`/skill/mounts?sessionID=${encodeURIComponent(root.id)}`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
          scope: string
          active_profile: string
          capability_profile_id: string
          projection_hash: string
          projected_tool_ids: string[]
          projected_agents: string[]
          selector_skill_names: string[]
          production_skill_names: string[]
          projected_skill_names: string[]
          skills: Array<{ name: string; mounted_agents: string[]; unmounted: boolean }>
          project_mounts: { agents?: Record<string, string[]> }
          matrix: Array<{ agent: string; mounted: Array<{ name: string; enabled: boolean }> }>
        }

        expect(body.scope).toBe("session")
        expect(body.active_profile).toBe(PROJECT_EXPERT_SQUAD_ID)
        expect(body.capability_profile_id).toBe(PROJECT_EXPERT_SQUAD_ID)
        expect(body.projection_hash).toMatch(/^[a-f0-9]{64}$/)
        expect(body.projected_tool_ids).not.toContain("build")
        expect(body.projected_tool_ids).not.toContain("source-evidence")
        expect(body.projected_agents).toEqual(["orchestrator", "general", "build"])
        expect(body.selector_skill_names).toEqual([`${PROJECT_EXPERT_SQUAD_ID}-expert-squad`])
        expect(body.production_skill_names).toEqual(
          expect.arrayContaining(["implementation", "scheduler", "unreferenced-default"]),
        )
        expect(body.projected_skill_names).toEqual(body.skills.map((entry) => entry.name))
        expect(body.projected_skill_names).toEqual(
          expect.arrayContaining([
            "implementation",
            `${PROJECT_EXPERT_SQUAD_ID}-expert-squad`,
            "scheduler",
            "unreferenced-default",
          ]),
        )
        expect(body.projected_skill_names).not.toContain("source-evidence")
        expect(body.projected_skill_names).not.toContain("package-browser")
        expect(body.skills.find((entry) => entry.name === "scheduler")?.mounted_agents).toEqual(["orchestrator"])
        expect(body.skills.find((entry) => entry.name === "implementation")?.mounted_agents).toEqual(["build"])
        expect(body.skills.find((entry) => entry.name === "unreferenced-default")?.mounted_agents).toEqual(["build"])
        expect(body.skills.map((entry) => entry.name)).not.toContain("source-evidence")
        expect(body.project_mounts.agents?.orchestrator).toContain("scheduler")
        expect(body.project_mounts.agents?.build).toContain("implementation")
        expect(body.project_mounts.agents?.build).toContain("unreferenced-default")
        expect(body.project_mounts.agents?.build ?? []).not.toContain("source-evidence")
        expect(body.matrix.find((row) => row.agent === "build")?.mounted).toContainEqual(
          expect.objectContaining({ name: "implementation", enabled: true }),
        )
        expect(body.matrix.find((row) => row.agent === "build")?.mounted).toContainEqual(
          expect.objectContaining({ name: "unreferenced-default", enabled: true }),
        )
      },
    })
  }, 20000)

  test("GET /skill/mounts exposes opentest virtual agents as base-role metadata", async () => {
    await using tmp = await tmpdir({ git: true })
    await copyRepositoryExpertSquadPackage(tmp.path, "opentest")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.update({ prompt_profile: { active: "opentest" } })
        const app = Server.App()
        const response = await app.request("/skill/mounts", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status, await response.clone().text()).toBe(200)
        const body = (await response.json()) as {
          active_profile: string
          projected_agents: string[]
          agents: Array<{ name: string; virtual_agent?: { id: string; label: string; projection_hash: string } }>
          project_mounts: { agents?: Record<string, string[]> }
        }
        expect(body.active_profile).toBe("opentest")
        expect(body.projected_agents).toEqual(expect.arrayContaining(["orchestrator", "build", "integrity"]))
        expect(body.projected_agents).not.toContain("opentest-implementer")
        expect(body.projected_agents).not.toContain("opentest-reviewer")
        expect(body.agents.find((agent) => agent.name === "build")?.virtual_agent).toMatchObject({
          id: "opentest-implementer",
          label: "OpenTest Implementer",
        })
        expect(body.agents.find((agent) => agent.name === "integrity")?.virtual_agent).toMatchObject({
          id: "opentest-reviewer",
          label: "OpenTest Reviewer",
        })
        expect(body.project_mounts.agents?.build).toContain("software-test-implementation")
        expect(body.project_mounts.agents?.integrity).toContain("software-test-review")
        expect(body.project_mounts.agents?.["opentest-implementer"]).toBeUndefined()
        expect(body.project_mounts.agents?.["opentest-reviewer"]).toBeUndefined()
      },
    })
  }, 20000)

  test("GET /skill/mounts includes active package agent-local skills discovered from directory", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        prompt_profile: {
          active: PROJECT_EXPERT_SQUAD_ID,
        },
      },
    })
    const packageRoot = await writeProjectExpertSquadPackage(tmp.path)
    await Filesystem.write(
      path.join(packageRoot, "agents", "build", "skills", "package-review", "SKILL.md"),
      [
        "---",
        "name: package-review",
        "description: Directory-discovered package review skill.",
        "---",
        "",
        "# Package Review",
        "",
        "PACKAGE_REVIEW_CONTENT",
      ].join("\n"),
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.update({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } })
        const app = Server.App()
        const headers = {
          "x-opencorvus-directory": tmp.path,
        }
        const response = await app.request("/skill/mounts", { headers })

        expect(response.status, await response.clone().text()).toBe(200)
        const body = (await response.json()) as {
          active_profile: string
          production_skill_names: string[]
          projected_skill_names: string[]
          skills: Array<{ name: string; mounted_agents: string[]; unmounted: boolean }>
          project_mounts: { agents?: Record<string, string[]> }
          matrix: Array<{ agent: string; mounted: Array<{ name: string; enabled: boolean }> }>
        }
        expect(body.active_profile).toBe(PROJECT_EXPERT_SQUAD_ID)
        expect(body.production_skill_names).toContain("package-review")
        expect(body.projected_skill_names).toContain("package-review")
        expect(body.skills.find((entry) => entry.name === "package-review")).toMatchObject({
          mounted_agents: ["build"],
          unmounted: false,
        })
        expect(body.project_mounts.agents?.build).toContain("package-review")
        expect(body.matrix.find((row) => row.agent === "build")?.mounted).toContainEqual(
          expect.objectContaining({ name: "package-review", enabled: true }),
        )

        const installed = await app.request("/skill/installed", { headers })
        expect(installed.status).toBe(200)
        const installedBody = (await installed.json()) as Array<{ name: string }>
        expect(installedBody.map((entry) => entry.name)).not.toContain("package-review")
      },
    })
  }, 20000)

  test("GET /skill/mounts fails visibly when package skills declare mounted agents", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        prompt_profile: {
          active: PROJECT_EXPERT_SQUAD_ID,
        },
      },
    })
    const packageRoot = await writeProjectExpertSquadPackage(tmp.path)
    await Filesystem.write(
      path.join(packageRoot, "agents", "build", "skills", "package-review", "SKILL.md"),
      [
        "---",
        "name: package-review",
        "description: Package skill with conflicting visibility metadata.",
        "mounted_agents:",
        "  - build",
        "---",
        "",
        "# Package Review",
      ].join("\n"),
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.update({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } })
        const response = await Server.App().request("/skill/mounts", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status, await response.clone().text()).toBe(500)
        const body = (await response.json()) as { data?: { message?: string } }
        expect(body.data?.message).toContain(
          `Package skill ${PROJECT_EXPERT_SQUAD_ID}/build/package-review must not declare agents or mounted_agents`,
        )
      },
    })
  }, 20000)

  test("skill mount routes reject sessions outside the active project before mount matrix side effects", async () => {
    await using project = await tmpdir({ git: true })
    const app = Server.App()
    let oneChildWithForeignParentID = ""
    let foreignSessionID = ""

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        foreignSessionID = Identifier.descending("session")
        const foreignProjectID = "foreign-project"
        const foreignProjectDirectory = path.join(project.path, "..", foreignProjectID)
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(ProjectTable)
            .values({
              id: foreignProjectID,
              worktree: foreignProjectDirectory,
              name: "Foreign Project",
              time_created: now,
              time_updated: now,
              sandboxes: [],
            })
            .run(),
        )
        await Session.importSnapshot({
          info: {
            id: foreignSessionID,
            slug: "foreign-skill-root",
            projectID: foreignProjectID,
            directory: foreignProjectDirectory,
            title: "foreign project skill owner",
            version: "test",
            kind: "root",
            time: {
              created: Date.now(),
              updated: Date.now(),
            },
          },
          messages: [],
        })
        const child: Session.Info = {
          id: Identifier.descending("session"),
          slug: "cross-parent-skill-child",
          projectID: Instance.project.id,
          directory: project.path,
          parentID: foreignSessionID,
          title: "project a skill child with project b parent",
          version: "test",
          kind: "build",
          time: {
            created: Date.now(),
            updated: Date.now(),
          },
        }
        await Session.importSnapshot({ info: child, messages: [] })
        oneChildWithForeignParentID = child.id
      },
    })

    const matrix = spyOn(SkillMount, "matrix")
    const mount = spyOn(SkillMount, "mount")
    const unmount = spyOn(SkillMount, "unmount")
    const importAndMount = spyOn(SkillMount, "importAndMount")
    const headers = {
      "x-opencorvus-directory": project.path,
    }
    const jsonHeaders = {
      ...headers,
      "content-type": "application/json",
    }

    const foreignMounts = await app.request(
      `/skill/mounts?refresh=true&sessionID=${encodeURIComponent(foreignSessionID)}`,
      { headers },
    )
    const foreignMount = await app.request("/skill/mount", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ sessionID: foreignSessionID, agent: "build", skill: "foreign-skill" }),
    })
    const foreignUnmount = await app.request("/skill/unmount", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ sessionID: foreignSessionID, agent: "build", skill: "foreign-skill" }),
    })
    const foreignImportAndMount = await app.request("/skill/import-and-mount", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        sessionID: foreignSessionID,
        agent: "build",
        import: {
          filename: "SKILL.md",
          content: "---\nname: foreign-import\n---\nforeign project import must not run\n",
        },
      }),
    })
    const foreignParentMounts = await app.request(
      `/skill/mounts?refresh=true&sessionID=${encodeURIComponent(oneChildWithForeignParentID)}`,
      { headers },
    )
    const foreignParentMount = await app.request("/skill/mount", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ sessionID: oneChildWithForeignParentID, agent: "build", skill: "foreign-parent-skill" }),
    })

    for (const response of [
      foreignMounts,
      foreignMount,
      foreignUnmount,
      foreignImportAndMount,
      foreignParentMounts,
      foreignParentMount,
    ]) {
      expect(response.status).toBe(404)
    }
    expect(matrix).not.toHaveBeenCalled()
    expect(mount).not.toHaveBeenCalled()
    expect(unmount).not.toHaveBeenCalled()
    expect(importAndMount).not.toHaveBeenCalled()
  })

  test("POST /skill/install invalidates discovery cache before the next mount matrix read", async () => {
    await using tmp = await tmpdir({ git: true })
    const skillDir = path.join(tmp.path, "installed-after-cache")
    await Filesystem.write(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: installed-after-cache",
        "description: Skill installed after the matrix cache was initialized.",
        "---",
        "",
        "Use this skill after installation.",
      ].join("\n"),
    )

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
        const body = (await listed.json()) as Array<{ name: string; source_type: string; source?: string; policy: string }>
        const skill = body.find((entry) => entry.name === "installed-after-cache")
        expect(skill).toBeDefined()
        expect(skill?.source_type).toBe("config_path")
        expect(skill?.source).toBe(skillDir)
        expect(skill?.policy).toBe("ask")
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

  test("GET /skill/mounts includes external installed skills in the unmounted pool", async () => {
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
          expect(initialBody.skills.find((entry) => entry.name === name)).toMatchObject({
            mounted_agents: [],
            unmounted: true,
            warning: "unmounted",
          })
        }

        const installed = await app.request("/skill/installed", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(installed.status).toBe(200)
        const installedBody = (await installed.json()) as Array<{ name: string }>
        for (const name of [
          "claude-review",
          "agents-review",
          "codex-review",
          "opencorvus-singular-review",
          "opencorvus-plural-review",
        ]) {
          expect(installedBody.some((entry) => entry.name === name)).toBe(true)
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
        expect(body.skills.find((entry) => entry.name === "claude-review")).toMatchObject({
          mounted_agents: ["requirements", "architect"],
          unmounted: false,
        })
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

  test("GET /skill/mounts exposes integrity and installed skills before operator mount", async () => {
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
            "  - browser_preview",
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
        expect(initialBody.skills.find((entry) => entry.name === "integrity-preview-review")).toMatchObject({
          mounted_agents: [],
          unmounted: true,
        })

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
        expect(mounted.status, await mounted.clone().text()).toBe(200)
        const body = (await mounted.json()) as {
          skills: Array<{ name: string; mounted_agents: string[]; unmounted: boolean }>
          matrix: Array<{ agent: string; mounted: Array<{ name: string; enabled: boolean }> }>
        }
        expect(body.skills.find((entry) => entry.name === "integrity-preview-review")).toMatchObject({
          mounted_agents: ["integrity"],
          unmounted: false,
        })
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

  test("GET /skill/mounts fails visibly for unknown default skill mounted_agents", async () => {
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
    await writeProjectExpertSquadPackage(tmp.path, PROJECT_EXPERT_SQUAD_ID, {
      buildDefaultSkillRefs: ["default/skill/typo-mounted"],
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.update({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } })
        const app = Server.App()
        const response = await app.request("/skill/mounts", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status, await response.clone().text()).toBe(500)
        const body = (await response.json()) as { data?: { message?: string } }
        expect(body.data?.message).toContain(
          "Skill typo-mounted mounted_agents contains unknown agent(s): requriements",
        )
        const yaml = await Filesystem.readText(
          path.join(tmp.path, ".opencorvus", "skill", "typo-mounted", "SKILL.md"),
        )
        expect(yaml).toContain("- requriements")
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

  test("installed and mounted skill is available through SkillTool", async () => {
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
        expect(mountBody.skills.find((item) => item.name === "route-installed-skill")).toMatchObject({
          mounted_agents: ["build"],
          unmounted: false,
        })

        const build = await Agent.get("build")
        expect(build).toBeDefined()
        const tool = await SkillTool.init({ agent: build })
        const ctx: Tool.Context = {
          ...baseCtx,
          ask: async () => {},
        }

        const loaded = await tool.execute({ name: "route-installed-skill" }, ctx)
        expect(loaded.output).toContain('<skill_content name="route-installed-skill">')
      },
    })
  }, 20000)

  test("GET /skill/mounts unions default skill mounted_agents with manifest refs", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } },
      init: async (dir) => {
        await Filesystem.write(
          path.join(dir, ".opencorvus", "skill", "shared-note", "SKILL.md"),
          [
            "---",
            "name: shared-note",
            "description: Default skill with its own mounted agents.",
            "mounted_agents:",
            "  - requirements",
            "---",
            "",
            "This default skill is projected to Requirements and additionally to Build.",
          ].join("\n"),
        )
      },
    })
    await writeProjectExpertSquadPackage(tmp.path, PROJECT_EXPERT_SQUAD_ID, {
      buildDefaultSkillRefs: ["default/skill/shared-note"],
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.update({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } })
        const app = Server.App()
        const matrix = await app.request("/skill/mounts", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(matrix.status).toBe(200)
        const body = (await matrix.json()) as {
          projected_skill_names: string[]
          skills: Array<{ name: string; mounted_agents: string[] }>
          project_mounts: { agents?: Record<string, string[]> }
          matrix: Array<{ agent: string; mounted: Array<{ name: string; enabled: boolean }> }>
        }
        expect(body.projected_skill_names).toContain("shared-note")
        expect(body.skills.find((entry) => entry.name === "shared-note")?.mounted_agents).toEqual([
          "requirements",
          "build",
        ])
        expect(body.project_mounts.agents?.build).toContain("shared-note")
        expect(body.project_mounts.agents?.requirements).toContain("shared-note")
        expect(body.matrix.find((row) => row.agent === "build")?.mounted).toContainEqual(
          expect.objectContaining({ name: "shared-note", enabled: true }),
        )
        expect(body.matrix.find((row) => row.agent === "requirements")?.mounted).toContainEqual(
          expect.objectContaining({ name: "shared-note", enabled: true }),
        )

        const installed = await app.request("/skill/installed", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(installed.status).toBe(200)
        const installedBody = (await installed.json()) as Array<{ name: string }>
        expect(installedBody.some((entry) => entry.name === "shared-note")).toBe(true)
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
