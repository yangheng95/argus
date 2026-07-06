import { BlobReader, TextReader, TextWriter, Uint8ArrayWriter, ZipReader, ZipWriter } from "@zip.js/zip.js"
import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { payloadPackageSources } from "../../src/expert-squad/payload"
import { ExpertSquadRegistry } from "../../src/expert-squad/registry"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import {
  copyRepositoryExpertSquadPackage,
  PROJECT_EXPERT_SQUAD_ID,
  projectExpertSquadFiles,
  writeSourceExpertSquadPackage,
} from "../fixture/expert-squad"
import { tmpdir } from "../fixture/fixture"

async function writeSourcePackage(root: string, folder = "uploaded-folder") {
  return writeSourceExpertSquadPackage(root, folder)
}

async function zipBase64(entries: Record<string, string>) {
  const writer = new ZipWriter(new Uint8ArrayWriter())
  for (const [name, content] of Object.entries(entries)) await writer.add(name, new TextReader(content))
  return Buffer.from(await writer.close()).toString("base64")
}

async function zipEntries(archiveBase64: string): Promise<Map<string, string>> {
  const reader = new ZipReader(new BlobReader(new Blob([Buffer.from(archiveBase64, "base64")])))
  try {
    const entries = await reader.getEntries()
    const result = new Map<string, string>()
    for (const entry of entries) {
      if (entry.directory || !entry.getData) continue
      result.set(entry.filename, await entry.getData(new TextWriter()))
    }
    return result
  } finally {
    await reader.close()
  }
}

describe("expert-squad routes", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("GET /expert-squad/catalog releases payload packages for an empty project", async () => {
    await using project = await tmpdir({ git: true })

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const response = await Server.App().request("/expert-squad/catalog", {
          headers: {
            "x-opencorvus-directory": project.path,
          },
        })

        expect(response.status, await response.clone().text()).toBe(200)
        const body = (await response.json()) as {
          active: { effective: string; project: string; session_override: string | null }
          squads: Array<{
            id: string
            label: string
            built_in: boolean
            source: { kind: "built_in" } | { kind: "project_package"; root: string }
            virtual_agents: Array<{ base_role: string; virtual_agent_id: string }>
          }>
          active_agent_projection: {
            source_expert_squad_id: string
            prompt_profile_active: string
            projection_hash: string
            agents: unknown[]
          }
          active_skill_projection: { selector_skill_names: string[] }
        }
        expect(body.active).toEqual({ effective: "general", project: "general", session_override: null })
        expect(body.active_agent_projection).toEqual({
          source_expert_squad_id: "general",
          prompt_profile_active: "general",
          projection_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
          agents: [],
        })
        expect(body.squads.map((squad) => squad.id)).toEqual([
          "general",
          ...payloadPackageSources.map((source) => source.id),
        ])

        const squads = new Map(body.squads.map((squad) => [squad.id, squad]))
        expect(squads.get("general")).toMatchObject({
          built_in: true,
          source: { kind: "built_in" },
        })
        for (const source of payloadPackageSources) {
          const targetRoot = path.join(project.path, ".opencorvus", "expert-squads", source.id)
          const squad = squads.get(source.id)
          expect(squads.get(source.id)).toMatchObject({
            built_in: false,
            source: { kind: "project_package", root: targetRoot },
          })
          await expect(ExpertSquadRegistry.loadPackage(targetRoot)).resolves.toMatchObject({ id: source.id })
        }
        expect(squads.get("software-testing")?.virtual_agents.map((agent) => agent.virtual_agent_id).sort()).toEqual([
          "opentest-implementer",
          "opentest-reviewer",
        ])
        expect(body.active_skill_projection.selector_skill_names).toEqual(
          expect.arrayContaining([
            "frontend-automation-debug-expert-squad",
            "frontend-innovate-expert-squad",
            "frontend-replica-expert-squad",
          ]),
        )
      },
    })
  }, 20000)

  test("GET /expert-squad/catalog returns active software-testing virtual agent projection only from resolver output", async () => {
    await using project = await tmpdir({ git: true })
    await copyRepositoryExpertSquadPackage(project.path, "software-testing")

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const app = Server.App()
        const patchResponse = await app.request("/config", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": project.path,
          },
          body: JSON.stringify({
            prompt_profile: {
              active: "software-testing",
            },
          }),
        })
        expect(patchResponse.status, await patchResponse.clone().text()).toBe(200)

        const response = await app.request("/expert-squad/catalog", {
          headers: {
            "x-opencorvus-directory": project.path,
          },
        })

        expect(response.status, await response.clone().text()).toBe(200)
        const body = (await response.json()) as {
          active: { effective: string; project: string; session_override: string | null }
          squads: Array<{ id: string; projected_agents: string[]; virtual_agents: Array<{ base_role: string; virtual_agent_id: string }> }>
          active_agent_projection: {
            source_expert_squad_id: string
            prompt_profile_active: string
            agents: Array<{
              base_role: string
              virtual_agent_id: string
              package_skill_refs: string[]
              package_tool_refs: string[]
              package_mcp_server_refs: string[]
            }>
          }
          active_skill_projection: { projected_agent_ids: string[]; projected_tool_ids: string[] }
        }
        expect(body.active).toEqual({
          effective: "software-testing",
          project: "software-testing",
          session_override: null,
        })
        expect(body.active_agent_projection.source_expert_squad_id).toBe("software-testing")
        expect(body.active_agent_projection.prompt_profile_active).toBe("software-testing")
        expect(body.active_agent_projection.agents.map((agent) => agent.base_role).sort()).toEqual(["build", "integrity"])
        expect(body.active_agent_projection.agents.map((agent) => agent.virtual_agent_id).sort()).toEqual([
          "opentest-implementer",
          "opentest-reviewer",
        ])
        expect(body.active_agent_projection.agents).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              base_role: "build",
              virtual_agent_id: "opentest-implementer",
              package_skill_refs: ["software-testing/build/test-implementation"],
              package_tool_refs: [
                "software-testing/shared/test-artifact-inventory",
                "software-testing/shared/opentest-protocol-engine",
              ],
              package_mcp_server_refs: [],
            }),
            expect.objectContaining({
              base_role: "integrity",
              virtual_agent_id: "opentest-reviewer",
              package_skill_refs: ["software-testing/integrity/test-review"],
              package_tool_refs: [
                "software-testing/shared/test-artifact-inventory",
                "software-testing/shared/opentest-protocol-engine",
              ],
              package_mcp_server_refs: [],
            }),
          ]),
        )
        expect(body.active_agent_projection.agents.some((agent) => agent.base_role === "requirements")).toBe(false)
        expect(body.active_agent_projection.agents.some((agent) => agent.base_role === "architect")).toBe(false)
        expect(body.active_agent_projection.agents.some((agent) => agent.base_role === "visual-qa")).toBe(false)
        expect(body.active_skill_projection.projected_agent_ids.sort()).toEqual(["build", "integrity", "orchestrator"])
        expect(body.active_skill_projection.projected_tool_ids).not.toContain("requirements")
        expect(body.active_skill_projection.projected_tool_ids).not.toContain("architect")
        expect(body.active_skill_projection.projected_tool_ids).not.toContain("visual_qa")

        const softwareTesting = body.squads.find((squad) => squad.id === "software-testing")
        expect(softwareTesting?.label).toBe("WuJiang/OpenTest")
        expect(softwareTesting?.display_label).toBe("Builtin/WuJiang/OpenTest")
        expect(softwareTesting?.projected_agents.sort()).toEqual(["build", "integrity"])
        expect(softwareTesting?.virtual_agents.map((agent) => agent.virtual_agent_id).sort()).toEqual([
          "opentest-implementer",
          "opentest-reviewer",
        ])
      },
    })
  }, 20000)

  test("POST /expert-squad/import-folder installs a source folder under the current project", async () => {
    await using project = await tmpdir({ git: true })
    await using source = await tmpdir()
    const sourceDirectory = await writeSourcePackage(source.path, "arbitrary-upload-name")

    const response = await Server.App().request(`/expert-squad/import-folder?directory=${encodeURIComponent(project.path)}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ sourceDirectory, replace: false }),
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { id: string; targetRoot: string; replaced: boolean }
    expect(body).toEqual({
      id: PROJECT_EXPERT_SQUAD_ID,
      targetRoot: path.join(project.path, ".opencorvus", "expert-squads", PROJECT_EXPERT_SQUAD_ID),
      replaced: false,
    })
    await expect(ExpertSquadRegistry.loadPackage(body.targetRoot)).resolves.toMatchObject({ id: PROJECT_EXPERT_SQUAD_ID })
  })

  test("POST /expert-squad/import-file and /export round-trip a wrapped ZIP package", async () => {
    await using project = await tmpdir({ git: true })
    const archiveBase64 = await zipBase64(projectExpertSquadFiles(PROJECT_EXPERT_SQUAD_ID, "downloaded-name"))

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const imported = await Server.App().request("/expert-squad/import-file", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": project.path,
          },
          body: JSON.stringify({ archiveBase64, filename: "similar-display-name.zip", replace: false }),
        })
        expect(imported.status).toBe(200)
        expect(await imported.json()).toMatchObject({ id: PROJECT_EXPERT_SQUAD_ID, replaced: false })

        const exported = await Server.App().request("/expert-squad/export", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": project.path,
          },
          body: JSON.stringify({ id: PROJECT_EXPERT_SQUAD_ID }),
        })
        expect(exported.status).toBe(200)
        const body = (await exported.json()) as {
          id: string
          filename: string
          archiveBase64: string
          fileCount: number
        }
        expect(body.id).toBe(PROJECT_EXPERT_SQUAD_ID)
        expect(body.filename).toBe(`${PROJECT_EXPERT_SQUAD_ID}-expert-squad.zip`)
        const entries = await zipEntries(body.archiveBase64)
        expect(body.fileCount).toBe(entries.size)
        expect(entries.has(ExpertSquadRegistry.MANIFEST)).toBe(false)
        expect(entries.get(`${PROJECT_EXPERT_SQUAD_ID}/${ExpertSquadRegistry.MANIFEST}`)).toContain(
          `"id": "${PROJECT_EXPERT_SQUAD_ID}"`,
        )
      },
    })
  })

  test("POST /expert-squad/import-file maps invalid package archives to ExpertSquadPackageError", async () => {
    await using project = await tmpdir({ git: true })
    const archiveBase64 = await zipBase64({
      ...projectExpertSquadFiles(PROJECT_EXPERT_SQUAD_ID, "pkg"),
      "pkg/README.md:ads": "# alternate data stream\n",
    })

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const response = await Server.App().request("/expert-squad/import-file", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": project.path,
          },
          body: JSON.stringify({ archiveBase64, replace: false }),
        })

        expect(response.status).toBe(400)
        const body = (await response.json()) as { name: string; data: { message: string } }
        expect(body.name).toBe("ExpertSquadPackageError")
        expect(body.data.message).toContain("unsafe expert squad archive path")
      },
    })
  })

  test("POST /expert-squad routes reject body projectDirectory overrides", async () => {
    await using project = await tmpdir({ git: true })
    await using source = await tmpdir()
    const sourceDirectory = await writeSourcePackage(source.path)
    const archiveBase64 = await zipBase64(projectExpertSquadFiles(PROJECT_EXPERT_SQUAD_ID, "pkg"))
    const requests = [
      {
        path: "/expert-squad/import-folder",
        body: { projectDirectory: source.path, sourceDirectory, replace: false },
      },
      {
        path: "/expert-squad/import-file",
        body: { projectDirectory: source.path, archiveBase64, replace: false },
      },
      {
        path: "/expert-squad/export",
        body: { projectDirectory: source.path, id: PROJECT_EXPERT_SQUAD_ID },
      },
    ]

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        for (const request of requests) {
          const response = await Server.App().request(request.path, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-opencorvus-directory": project.path,
            },
            body: JSON.stringify(request.body),
          })

          expect(response.status).toBe(400)
          expect((await response.json()) as { success: boolean }).toMatchObject({ success: false })
        }
      },
    })
  })
})
