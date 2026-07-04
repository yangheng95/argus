import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readFile } from "fs/promises"
import path from "path"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { resetDatabase } from "../fixture/db"
import {
  copyRepositoryExpertSquadPackage,
  PROJECT_EXPERT_SQUAD_ID,
  writeProjectExpertSquadPackage,
} from "../fixture/expert-squad"
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
        const body = (await response.json()) as Array<{
          key: string
          scope: string
          prompt: string
          editable_prompt: string
          effective_prompt: string
          active_profile: string
          profile_prompt: string | null
          default_prompt?: string
          configured_prompt: string | null
          inherits_core?: boolean
          prompt_mode?: "override" | "append"
        }>
        // System-scope slots: core_header + agent_generate (legacy spec/goal/
        // acceptance _system slots were dropped when per-agent scope
        // became the single source of truth).
        expect(
          body.some(
            (item) => item.key === "core_header" && item.scope === "system" && item.prompt === "Custom core header",
          ),
        ).toBe(true)
        expect(body.some((item) => item.key === "agent_generate" && item.scope === "system")).toBe(true)
        // Agent-scope: user override on an agent surfaces as configured_prompt.
        expect(
          body.some(
            (item) =>
              item.key === "explore" &&
              item.scope === "agent" &&
              item.prompt_mode === "override" &&
              item.prompt === "Custom explore prompt" &&
              item.configured_prompt === "Custom explore prompt",
          ),
        ).toBe(true)
        const intent = body.find((item) => item.key === "intent-analysis" && item.scope === "agent")
        expect(intent?.prompt_mode).toBe("append")
        expect(intent?.prompt).toBe(intent?.editable_prompt)
        expect(intent?.configured_prompt).toBe("Custom intent append")
        expect(intent?.default_prompt && intent.default_prompt.length > 0).toBe(true)
        expect(intent?.effective_prompt).toContain(intent!.default_prompt!)
        expect(intent?.effective_prompt).toContain("Custom intent append")
        expect(intent?.editable_prompt).toBe("Custom intent append")
        // Previously-masked native agents (architect / requirements / frontend-design)
        // now each have a distinct default prompt — none collapse to empty.
        const architect = body.find((item) => item.key === "architect" && item.scope === "agent")
        const requirements = body.find((item) => item.key === "requirements" && item.scope === "agent")
        const frontendDesign = body.find((item) => item.key === "frontend-design" && item.scope === "agent")
        expect(architect && architect.default_prompt && architect.default_prompt.length > 0).toBe(true)
        expect(requirements && requirements.default_prompt && requirements.default_prompt.length > 0).toBe(true)
        expect(frontendDesign && frontendDesign.default_prompt && frontendDesign.default_prompt.length > 0).toBe(true)
        expect(architect?.prompt).toBe(architect?.editable_prompt)
        expect(requirements?.prompt).toBe(requirements?.editable_prompt)
        expect(frontendDesign?.prompt).toBe(frontendDesign?.editable_prompt)
        expect(architect?.effective_prompt).toContain("Register at least two goals")
        expect(requirements?.effective_prompt).toContain("You do NOT produce goals, acceptance_specs")
        expect(frontendDesign?.effective_prompt).toContain("source-derived visual HTML skeleton")
        // Distinct defaults — the pre-fix bug made several agents collapse to
        // the same empty/inherits_core placeholder.
        expect(architect!.default_prompt).not.toBe(requirements!.default_prompt)
        expect(architect!.default_prompt).not.toBe(frontendDesign!.default_prompt)
        expect(requirements!.default_prompt).not.toBe(frontendDesign!.default_prompt)
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

  test("PATCH /config rejects built-in skill_mountable drift from the canonical role contract", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/config", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            agent: {
              integrity: {
                skill_mountable: false,
              },
            },
          }),
        })

        expect(response.status).toBe(400)
        expect(await response.text()).toContain("config.agent.integrity.skill_mountable must stay true")
      },
    })
  })

  test("GET /config/prompt-profile returns full active profile catalog", async () => {
    await using tmp = await tmpdir({ git: true })
    for (const id of [
      "algorithm",
      "backend",
      "frontend-automation-debug",
      "frontend-innovate",
      "frontend-replica",
    ] as const) {
      await copyRepositoryExpertSquadPackage(tmp.path, id)
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const rejectedPatchResponse = await app.request("/config", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            prompt_profile: {
              active: "custom-squad",
              profiles: {
                "custom-squad": {
                  label: "Custom Squad",
                  description: "Project profile",
                  agents: {
                    build: "Custom build guidance.",
                  },
                },
              },
            },
          }),
        })
        expect(rejectedPatchResponse.status).toBe(400)
        expect(await rejectedPatchResponse.text()).toContain("profiles")

        const patchResponse = await app.request("/config", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            prompt_profile: {
              active: "backend",
            },
          }),
        })
        expect(patchResponse.status).toBe(200)

        const response = await app.request("/config/prompt-profile", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
          active: string
          project_active: string
          session_active: string | null
          default: string
          targets: Array<{ id: string; editable: boolean; built_in_only: boolean }>
          profiles: Array<{
            id: string
            label: string
            built_in: boolean
            editable: boolean
            agents: Record<string, string>
            capability_profile_id: string
            projection_hash: string
            projected_agents: string[]
            capability_projection: {
              scheduler: { built_in_tool_ids: string[]; package_tool_refs: string[] }
              agents: Record<string, { built_in_tool_ids: string[]; package_tool_refs: string[] }>
            }
          }>
        }
        expect(body.active).toBe("backend")
        expect(body.project_active).toBe("backend")
        expect(body.session_active).toBe(null)
        expect(body.default).toBe("general")
        expect(body.targets.find((target) => target.id === "build")).toMatchObject({
          id: "build",
          editable: true,
          built_in_only: false,
        })
        expect(body.targets.find((target) => target.id === "orchestrator")).toMatchObject({
          id: "orchestrator",
          editable: false,
          built_in_only: true,
        })
        expect(body.profiles.map((profile) => profile.id)).toEqual([
          "general",
          "algorithm",
          "backend",
          "frontend-automation-debug",
          "frontend-innovate",
          "frontend-replica",
        ])
        const frontendReplicaProfile = body.profiles.find((profile) => profile.id === "frontend-replica")
        expect(frontendReplicaProfile).toMatchObject({
          label: "Frontend Replica",
          built_in: false,
          editable: false,
          capability_profile_id: "frontend-replica",
        })
        expect(frontendReplicaProfile?.projection_hash).toMatch(/^[a-f0-9]{64}$/)
        expect(frontendReplicaProfile?.projected_agents).toContain("build")
        expect(frontendReplicaProfile?.capability_projection.scheduler.built_in_tool_ids).toContain("build")
        expect(body.profiles.find((profile) => profile.id === "frontend-innovate")).toMatchObject({
          label: "Frontend Innovate",
          built_in: false,
          editable: false,
        })
        expect(body.profiles.find((profile) => profile.id === "frontend-automation-debug")).toMatchObject({
          label: "Frontend Automation Debug",
          built_in: false,
          editable: false,
        })
        expect(body.profiles.find((profile) => profile.id === "general")).toMatchObject({
          built_in: true,
          editable: false,
          capability_profile_id: "general",
        })
        expect(body.profiles.every((profile) => !profile.editable)).toBe(true)
      },
    })
  })

  test("GET /config/prompt-profile does not parse inactive package MCP definitions", async () => {
    await using tmp = await tmpdir({ git: true })
    const inactiveRoot = await writeProjectExpertSquadPackage(tmp.path)
    await Bun.write(path.join(inactiveRoot, "mcp", "broken.jsonc"), "{")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/config/prompt-profile", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
          active: string
          profiles: Array<{
            id: string
            built_in: boolean
            capability_profile_id: string
            agents: Record<string, string>
          }>
        }
        expect(body.active).toBe("general")
        expect(body.profiles.find((profile) => profile.id === PROJECT_EXPERT_SQUAD_ID)).toMatchObject({
          built_in: false,
          capability_profile_id: PROJECT_EXPERT_SQUAD_ID,
          agents: { build: "project build overlay" },
        })

        const patchResponse = await app.request("/config", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            prompt_profile: {
              active: PROJECT_EXPERT_SQUAD_ID,
            },
          }),
        })
        expect(patchResponse.status).toBe(400)
        expect(await patchResponse.text()).toContain("invalid JSONC")
      },
    })
  })

  test("GET /config/prompt-profile returns session-effective project package profile when sessionID is supplied", async () => {
    await using tmp = await tmpdir({ git: true })
    await writeProjectExpertSquadPackage(tmp.path)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.update({
          prompt_profile: {
            active: "general",
          },
        })
        const root = await Session.create({ kind: "root", title: "profile scope root" })
        await Session.mergeConfigOverlay({
          sessionID: root.id,
          patch: {
            prompt_profile: {
              active: PROJECT_EXPERT_SQUAD_ID,
            },
          },
        })

        const app = Server.App()
        const response = await app.request(`/config/prompt-profile?sessionID=${encodeURIComponent(root.id)}`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
          active: string
          project_active: string
          session_active: string | null
          profiles: Array<{
            id: string
            built_in: boolean
            editable: boolean
            agents: Record<string, string>
            capability_profile_id: string
            projection_hash: string
            projected_agents: string[]
            capability_projection: {
              scheduler: { built_in_tool_ids: string[]; package_tool_refs: string[] }
              agents: Record<string, { package_tool_refs: string[] }>
            }
          }>
        }
        expect(body.active).toBe(PROJECT_EXPERT_SQUAD_ID)
        expect(body.project_active).toBe("general")
        expect(body.session_active).toBe(PROJECT_EXPERT_SQUAD_ID)
        expect(body.profiles.find((profile) => profile.id === PROJECT_EXPERT_SQUAD_ID)).toMatchObject({
          built_in: false,
          editable: false,
          capability_profile_id: PROJECT_EXPERT_SQUAD_ID,
          projected_agents: ["build"],
          agents: { build: "project build overlay" },
        })
        const projectProfile = body.profiles.find((profile) => profile.id === PROJECT_EXPERT_SQUAD_ID)
        expect(projectProfile?.projection_hash).toMatch(/^[a-f0-9]{64}$/)
        expect(projectProfile?.capability_projection.scheduler.package_tool_refs).toEqual([
          `${PROJECT_EXPERT_SQUAD_ID}/orchestrator/source-evidence`,
        ])
        expect(projectProfile?.capability_projection.agents.build.package_tool_refs).toEqual([
          `${PROJECT_EXPERT_SQUAD_ID}/build/build-evidence`,
        ])
      },
    })
  })

  test("GET /config/prompt returns session-effective project package prompt when sessionID is supplied", async () => {
    await using tmp = await tmpdir({ git: true })
    await writeProjectExpertSquadPackage(tmp.path)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.update({
          prompt_profile: {
            active: "general",
          },
        })
        const root = await Session.create({ kind: "root", title: "prompt catalog scope root" })
        await Session.mergeConfigOverlay({
          sessionID: root.id,
          patch: {
            prompt_profile: {
              active: PROJECT_EXPERT_SQUAD_ID,
            },
          },
        })

        const app = Server.App()
        const response = await app.request(`/config/prompt?sessionID=${encodeURIComponent(root.id)}`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as Array<{
          key: string
          active_profile: string
          profile_prompt: string | null
          effective_prompt: string
        }>
        const build = body.find((item) => item.key === "build")
        expect(build?.active_profile).toBe(PROJECT_EXPERT_SQUAD_ID)
        expect(build?.profile_prompt).toBe("project build overlay")
        expect(build?.effective_prompt).toContain("project build overlay")
      },
    })
  })

  test("PATCH /config accepts a repository project frontend automation debug profile and prompt preview uses it", async () => {
    await using tmp = await tmpdir({ git: true })
    await copyRepositoryExpertSquadPackage(tmp.path, "frontend-automation-debug")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const patchResponse = await app.request("/config", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({ prompt_profile: { active: "frontend-automation-debug" } }),
        })

        expect(patchResponse.status).toBe(200)

        const response = await app.request("/config/prompt", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(response.status).toBe(200)
        const body = (await response.json()) as Array<{
          key: string
          active_profile: string
          profile_prompt: string | null
          effective_prompt: string
        }>
        const build = body.find((item) => item.key === "build")
        expect(build?.active_profile).toBe("frontend-automation-debug")
        expect(build?.profile_prompt).toContain("focused automation")
        expect(build?.effective_prompt).toContain("focused automation")
      },
    })
  })

  test("PATCH /config accepts a project package prompt profile and prompt preview uses it", async () => {
    await using tmp = await tmpdir({ git: true })
    await writeProjectExpertSquadPackage(tmp.path)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const patchResponse = await app.request("/config", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } }),
        })

        expect(patchResponse.status).toBe(200)

        const catalogResponse = await app.request("/config/prompt-profile", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(catalogResponse.status).toBe(200)
        const catalog = (await catalogResponse.json()) as {
          active: string
          profiles: Array<{ id: string; built_in: boolean; editable: boolean; agents: Record<string, string> }>
        }
        expect(catalog.active).toBe(PROJECT_EXPERT_SQUAD_ID)
        expect(catalog.profiles.find((profile) => profile.id === PROJECT_EXPERT_SQUAD_ID)).toMatchObject({
          built_in: false,
          editable: false,
          agents: { build: "project build overlay" },
        })

        const previewResponse = await app.request("/config/prompt", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(previewResponse.status).toBe(200)
        const preview = (await previewResponse.json()) as Array<{
          key: string
          active_profile: string
          profile_prompt: string | null
          effective_prompt: string
        }>
        const build = preview.find((item) => item.key === "build")
        expect(build?.active_profile).toBe(PROJECT_EXPERT_SQUAD_ID)
        expect(build?.profile_prompt).toBe("project build overlay")
        expect(build?.effective_prompt).toContain("project build overlay")
      },
    })
  })

  test("PATCH /config rejects unknown prompt profile before writing", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/config", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({ prompt_profile: { active: "missing-profile" } }),
        })

        expect(response.status).toBe(400)
        const body = (await response.json()) as {
          success: false
          data: { message: string }
          error: Array<{ message: string }>
        }
        expect(body.success).toBe(false)
        expect(body.data.message).toContain("Unknown prompt profile")
        expect(body.error[0]?.message).toBe(body.data.message)
        expect((await Config.get()).prompt_profile.active).toBe("general")
      },
    })
  })

  test("PATCH /config validates model refs before writing config", async () => {
    const source = await repoFile("packages", "opencorvus", "src", "server", "routes", "config.ts")
    const start = source.indexOf('operationId: "config.update"')
    expect(start).toBeGreaterThan(0)
    const body = source.slice(start, source.indexOf("const updated = await Config.get()", start))

    expect(body).toContain('validateConfigModelReferences(partial, "config")')
    expect(body.indexOf("validateConfigModelReferences")).toBeLessThan(body.indexOf("Config.update"))
  })
})
