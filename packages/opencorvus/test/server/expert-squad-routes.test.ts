import { BlobReader, TextReader, TextWriter, Uint8ArrayWriter, ZipReader, ZipWriter } from "@zip.js/zip.js"
import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { ExpertSquadRegistry } from "../../src/expert-squad/registry"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import {
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
