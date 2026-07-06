import { BlobReader, TextReader, TextWriter, Uint8ArrayWriter, ZipReader, ZipWriter } from "@zip.js/zip.js"
import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { ExpertSquadRegistry } from "../../src/expert-squad/registry"
import { payloadPackageSources } from "../../src/expert-squad/payload"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import {
  copyRepositoryExpertSquadPackage,
  PROJECT_EXPERT_SQUAD_ID,
  PROJECT_EXPERT_SQUAD_NAMESPACE,
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

async function withRouteInactivityTimeout<T>(
  label: string,
  inactivityTimeoutMilliseconds: number,
  run: (activity: (step: string) => void) => Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastActivity = "start"
  return await new Promise<T>((resolve, reject) => {
    const reset = (step: string) => {
      lastActivity = step
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        reject(new Error(`${label}: inactive for ${inactivityTimeoutMilliseconds}ms after ${lastActivity}`))
      }, inactivityTimeoutMilliseconds)
    }
    reset(lastActivity)
    run(reset).then(resolve, reject).finally(() => {
      if (timer) clearTimeout(timer)
    })
  })
}

function routeTest(name: string, run: (activity: (step: string) => void) => Promise<void>) {
  test(name, { timeout: 0 }, async () => {
    await withRouteInactivityTimeout(name, 15_000, run)
  })
}

describe("expert-squad routes", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  routeTest("GET /expert-squad/catalog does not release payload packages for an empty project", async (activity) => {
    await using project = await tmpdir({ git: true })
    activity("created temporary project")

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        activity("instance provided")
        const response = await Server.App().request("/expert-squad/catalog", {
          headers: {
            "x-opencorvus-directory": project.path,
          },
        })
        activity("catalog response returned")

        expect(response.status, await response.clone().text()).toBe(200)
        const body = (await response.json()) as {
          active: { effective: string; project: string; session_override: string | null }
          squads: Array<{
            id: string
            label: string
            built_in: boolean
            source: { kind: "built_in" } | { kind: "project_package"; namespace: string; root: string }
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
        expect(body.squads.map((squad) => squad.id)).toEqual(["general"])

        const squads = new Map(body.squads.map((squad) => [squad.id, squad]))
        expect(squads.get("general")).toMatchObject({
          built_in: true,
          source: { kind: "built_in" },
        })
        expect(await ExpertSquadRegistry.discover(project.path)).toEqual([])
        expect(body.active_skill_projection.selector_skill_names).not.toEqual(
          expect.arrayContaining([
            "frontend-automation-debug-expert-squad",
            "frontend-innovate-expert-squad",
            "frontend-replica-expert-squad",
          ]),
        )
      },
    })
  })

  routeTest("POST /expert-squad/release-payload explicitly provisions bundled packages", async (activity) => {
    await using project = await tmpdir({ git: true })
    activity("created temporary project")

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        activity("instance provided")
        const response = await Server.App().request("/expert-squad/release-payload", {
          method: "POST",
          headers: {
            "x-opencorvus-directory": project.path,
          },
        })
        activity("release-payload response returned")

        expect(response.status, await response.clone().text()).toBe(200)
        const body = (await response.json()) as {
          installed: Array<{ namespace: string; id: string; targetRoot: string; replaced: boolean }>
          skipped: Array<{ namespace: string; id: string; targetRoot: string; replaced: boolean }>
        }
        expect(body.skipped).toEqual([])
        expect(body.installed.map((item) => `${item.namespace}/${item.id}`)).toEqual(
          payloadPackageSources.map((source) => `${source.namespace}/${source.id}`),
        )
        for (const item of body.installed) {
          expect(item.replaced).toBe(false)
          expect(item.targetRoot).toBe(path.join(project.path, ".opencorvus", "expert-squads", item.namespace, item.id))
          await expect(ExpertSquadRegistry.loadPackage(item.targetRoot)).resolves.toMatchObject({
            namespace: item.namespace,
            id: item.id,
          })
        }
      },
    })
  })

  routeTest("POST /expert-squad/release-payload maps malformed JSON to ExpertSquadPackageError", async (activity) => {
    await using project = await tmpdir({ git: true })
    activity("created temporary project")

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        activity("instance provided")
        const response = await Server.App().request("/expert-squad/release-payload", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": project.path,
          },
          body: "{",
        })
        activity("release-payload malformed JSON response returned")

        expect(response.status).toBe(400)
        const body = (await response.json()) as { name: string; data: { message: string } }
        expect(body).toEqual({
          name: "ExpertSquadPackageError",
          data: {
            message: "Expert squad payload release requires valid JSON when the content type is application/json",
          },
        })
      },
    })
  })

  routeTest("GET /expert-squad/catalog returns active opentest virtual agent projection only from resolver output", async (activity) => {
    await using project = await tmpdir({ git: true })
    activity("created temporary project")
    await copyRepositoryExpertSquadPackage(project.path, "opentest")
    activity("copied opentest expert squad")

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        activity("instance provided")
        const app = Server.App()
        const patchResponse = await app.request("/config", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": project.path,
          },
          body: JSON.stringify({
            prompt_profile: {
              active: "opentest",
            },
          }),
        })
        activity("project prompt profile patched")
        expect(patchResponse.status, await patchResponse.clone().text()).toBe(200)

        const response = await app.request("/expert-squad/catalog", {
          headers: {
            "x-opencorvus-directory": project.path,
          },
        })
        activity("catalog response returned")

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
          effective: "opentest",
          project: "opentest",
          session_override: null,
        })
        expect(body.active_agent_projection.source_expert_squad_id).toBe("opentest")
        expect(body.active_agent_projection.prompt_profile_active).toBe("opentest")
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
              package_skill_refs: ["opentest/build/test-implementation"],
              package_tool_refs: ["opentest/shared/opentest-protocol-engine"],
              package_mcp_server_refs: [],
            }),
            expect.objectContaining({
              base_role: "integrity",
              virtual_agent_id: "opentest-reviewer",
              package_skill_refs: ["opentest/integrity/test-review"],
              package_tool_refs: ["opentest/shared/opentest-protocol-engine"],
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

        const opentest = body.squads.find((squad) => squad.id === "opentest")
        expect(opentest?.label).toBe("OpenTest")
        expect(opentest?.display_label).toBe("WuJiang/OpenTest")
        expect(opentest?.projected_agents.sort()).toEqual(["build", "integrity"])
        expect(opentest?.virtual_agents.map((agent) => agent.virtual_agent_id).sort()).toEqual([
          "opentest-implementer",
          "opentest-reviewer",
        ])
      },
    })
  })

  routeTest("POST /expert-squad/import-folder installs a source folder under the current project", async (activity) => {
    await using project = await tmpdir({ git: true })
    activity("created temporary project")
    await using source = await tmpdir()
    const sourceDirectory = await writeSourcePackage(source.path, "arbitrary-upload-name")
    activity("created source package")

    const response = await Server.App().request(`/expert-squad/import-folder?directory=${encodeURIComponent(project.path)}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ sourceDirectory, replace: false }),
    })
    activity("import-folder response returned")

    expect(response.status).toBe(200)
    const body = (await response.json()) as { namespace: string; id: string; targetRoot: string; replaced: boolean }
    expect(body).toEqual({
      namespace: PROJECT_EXPERT_SQUAD_NAMESPACE,
      id: PROJECT_EXPERT_SQUAD_ID,
      targetRoot: path.join(
        project.path,
        ".opencorvus",
        "expert-squads",
        PROJECT_EXPERT_SQUAD_NAMESPACE,
        PROJECT_EXPERT_SQUAD_ID,
      ),
      replaced: false,
    })
    await expect(ExpertSquadRegistry.loadPackage(body.targetRoot)).resolves.toMatchObject({ id: PROJECT_EXPERT_SQUAD_ID })
  })

  routeTest("POST /expert-squad/import-file and /export round-trip a canonical wrapped ZIP package", async (activity) => {
    await using project = await tmpdir({ git: true })
    const archiveBase64 = await zipBase64(
      projectExpertSquadFiles(PROJECT_EXPERT_SQUAD_ID, `${PROJECT_EXPERT_SQUAD_NAMESPACE}/${PROJECT_EXPERT_SQUAD_ID}`),
    )
    activity("created archive")

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        activity("instance provided")
        const imported = await Server.App().request("/expert-squad/import-file", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": project.path,
          },
          body: JSON.stringify({ archiveBase64, filename: "similar-display-name.zip", replace: false }),
        })
        activity("import-file response returned")
        expect(imported.status).toBe(200)
        const importedBody = (await imported.json()) as {
          namespace: string
          id: string
          targetRoot: string
          replaced: boolean
        }
        expect(importedBody).toEqual({
          namespace: PROJECT_EXPERT_SQUAD_NAMESPACE,
          id: PROJECT_EXPERT_SQUAD_ID,
          targetRoot: path.join(
            project.path,
            ".opencorvus",
            "expert-squads",
            PROJECT_EXPERT_SQUAD_NAMESPACE,
            PROJECT_EXPERT_SQUAD_ID,
          ),
          replaced: false,
        })
        await expect(ExpertSquadRegistry.loadPackage(importedBody.targetRoot)).resolves.toMatchObject({
          id: PROJECT_EXPERT_SQUAD_ID,
        })

        const exported = await Server.App().request("/expert-squad/export", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": project.path,
          },
          body: JSON.stringify({ id: PROJECT_EXPERT_SQUAD_ID }),
        })
        activity("export response returned")
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
        activity("export archive parsed")
        expect(body.fileCount).toBe(entries.size)
        expect(entries.has(ExpertSquadRegistry.MANIFEST)).toBe(false)
        expect(
          entries.get(`${PROJECT_EXPERT_SQUAD_NAMESPACE}/${PROJECT_EXPERT_SQUAD_ID}/${ExpertSquadRegistry.MANIFEST}`),
        ).toContain(
          `"id": "${PROJECT_EXPERT_SQUAD_ID}"`,
        )
      },
    })
  })

  routeTest("POST /expert-squad/import-file maps invalid package archives to ExpertSquadPackageError", async (activity) => {
    await using project = await tmpdir({ git: true })
    activity("created temporary project")
    const archiveBase64 = await zipBase64({
      ...projectExpertSquadFiles(PROJECT_EXPERT_SQUAD_ID, "pkg"),
      "pkg/README.md:ads": "# alternate data stream\n",
    })
    activity("created invalid archive")

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        activity("instance provided")
        const response = await Server.App().request("/expert-squad/import-file", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": project.path,
          },
          body: JSON.stringify({ archiveBase64, replace: false }),
        })
        activity("import-file response returned")

        expect(response.status).toBe(400)
        const body = (await response.json()) as { name: string; data: { message: string } }
        expect(body.name).toBe("ExpertSquadPackageError")
        expect(body.data.message).toContain("unsafe expert squad archive path")
      },
    })
  })

  routeTest("POST /expert-squad routes reject body projectDirectory overrides", async (activity) => {
    await using project = await tmpdir({ git: true })
    activity("created temporary project")
    await using source = await tmpdir()
    const sourceDirectory = await writeSourcePackage(source.path)
    const archiveBase64 = await zipBase64(projectExpertSquadFiles(PROJECT_EXPERT_SQUAD_ID, "pkg"))
    activity("created source package and archive")
    const requests = [
      {
        path: "/expert-squad/import-folder",
        body: { projectDirectory: source.path, sourceDirectory, replace: false },
        expectedBody: { success: false },
      },
      {
        path: "/expert-squad/import-file",
        body: { projectDirectory: source.path, archiveBase64, replace: false },
        expectedBody: { success: false },
      },
      {
        path: "/expert-squad/release-payload",
        body: { projectDirectory: source.path },
        expectedBody: {
          name: "ExpertSquadPackageError",
          data: { message: "Expert squad payload release does not accept request body fields" },
        },
      },
      {
        path: "/expert-squad/export",
        body: { projectDirectory: source.path, id: PROJECT_EXPERT_SQUAD_ID },
        expectedBody: { success: false },
      },
    ]

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        activity("instance provided")
        for (const request of requests) {
          const response = await Server.App().request(request.path, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-opencorvus-directory": project.path,
            },
            body: JSON.stringify(request.body),
          })
          activity(`${request.path} response returned`)

          expect(response.status).toBe(400)
          expect(await response.json()).toMatchObject(request.expectedBody)
        }
      },
    })
  })
})
