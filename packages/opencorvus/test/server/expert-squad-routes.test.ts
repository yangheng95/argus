import { BlobReader, TextReader, TextWriter, Uint8ArrayWriter, ZipReader, ZipWriter } from "@zip.js/zip.js"
import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { ExpertSquadRegistry } from "../../src/expert-squad/registry"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

async function writeFile(root: string, relativePath: string, content: string) {
  const target = path.join(root, relativePath)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content)
}

function manifest() {
  return {
    schema_version: 1,
    id: "frontend-replica",
    label: "Frontend Replica",
    description: "Replica squad",
    version: "2026.07.03",
    readme: "README.md",
    selector: {
      summary: "Use for replica tasks.",
      selection_guidance: "Call select_expert_squad with profile_id frontend-replica.",
    },
    capability_projection: {
      scheduler: {
        role_base: true,
        built_in_tool_ids: ["select_expert_squad", "skill", "build"],
        package_tool_refs: ["frontend-replica/orchestrator/source-evidence"],
        package_skill_refs: ["frontend-replica/orchestrator/scheduler"],
      },
      agents: {
        build: {
          role_base: true,
          package_skill_refs: ["frontend-replica/build/implementation"],
          package_tool_refs: ["frontend-replica/build/build-evidence"],
        },
      },
    },
    agents: {
      orchestrator: {
        prompt: "agents/orchestrator/system.md",
        skill_refs: ["frontend-replica/orchestrator/scheduler"],
        tool_refs: ["frontend-replica/orchestrator/source-evidence"],
      },
      build: {
        prompt: "agents/build/system.md",
        skill_refs: ["frontend-replica/build/implementation"],
        tool_refs: ["frontend-replica/build/build-evidence"],
      },
    },
  }
}

function packageFileMap(prefix = "") {
  const root = prefix ? `${prefix.replace(/\/+$/, "")}/` : ""
  return {
    [`${root}README.md`]: "# Frontend Replica\n",
    [`${root}agents/orchestrator/system.md`]: "orchestrator overlay",
    [`${root}agents/build/system.md`]: "build overlay",
    [`${root}agents/orchestrator/skills/scheduler/SKILL.md`]: "---\nname: scheduler\n---\n",
    [`${root}agents/build/skills/implementation/SKILL.md`]: "---\nname: implementation\n---\n",
    [`${root}agents/orchestrator/tools/source-evidence.ts`]: "export default {}",
    [`${root}agents/build/tools/build-evidence.ts`]: "export default {}",
    [`${root}${ExpertSquadRegistry.MANIFEST}`]: JSON.stringify(manifest(), null, 2),
  }
}

async function writeSourcePackage(root: string, folder = "uploaded-folder") {
  const packageRoot = path.join(root, folder)
  for (const [relativePath, content] of Object.entries(packageFileMap())) {
    await writeFile(packageRoot, relativePath, content)
  }
  return packageRoot
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
      id: "frontend-replica",
      targetRoot: path.join(project.path, ".opencorvus", "expert-squads", "frontend-replica"),
      replaced: false,
    })
    await expect(ExpertSquadRegistry.loadPackage(body.targetRoot)).resolves.toMatchObject({ id: "frontend-replica" })
  })

  test("POST /expert-squad/import-file and /export round-trip a wrapped ZIP package", async () => {
    await using project = await tmpdir({ git: true })
    const archiveBase64 = await zipBase64(packageFileMap("downloaded-name"))

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
        expect(await imported.json()).toMatchObject({ id: "frontend-replica", replaced: false })

        const exported = await Server.App().request("/expert-squad/export", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": project.path,
          },
          body: JSON.stringify({ id: "frontend-replica" }),
        })
        expect(exported.status).toBe(200)
        const body = (await exported.json()) as {
          id: string
          filename: string
          archiveBase64: string
          fileCount: number
        }
        expect(body.id).toBe("frontend-replica")
        expect(body.filename).toBe("frontend-replica-expert-squad.zip")
        const entries = await zipEntries(body.archiveBase64)
        expect(body.fileCount).toBe(entries.size)
        expect(entries.has(ExpertSquadRegistry.MANIFEST)).toBe(false)
        expect(entries.get(`frontend-replica/${ExpertSquadRegistry.MANIFEST}`)).toContain('"id": "frontend-replica"')
      },
    })
  })

  test("POST /expert-squad/import-file maps invalid package archives to ExpertSquadPackageError", async () => {
    await using project = await tmpdir({ git: true })
    const archiveBase64 = await zipBase64({
      ...packageFileMap("pkg"),
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
    const archiveBase64 = await zipBase64(packageFileMap("pkg"))
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
        body: { projectDirectory: source.path, id: "frontend-replica" },
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
