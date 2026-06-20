import { $ } from "bun"
import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { BlobReader, TextWriter, ZipReader } from "@zip.js/zip.js"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Identifier } from "../../src/id/id"
import { ensureMissionSession } from "../../src/mission/session"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { Message } from "../../src/session/message"
import { Database } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

async function zipEntries(bytes: Uint8Array): Promise<Map<string, string | null>> {
  const reader = new ZipReader(new BlobReader(new Blob([bytes])))
  const entries = await reader.getEntries()
  const result = new Map<string, string | null>()
  for (const entry of entries) {
    if (entry.directory || !entry.getData) {
      result.set(entry.filename, null)
      continue
    }
    result.set(entry.filename, await entry.getData(new TextWriter()))
  }
  await reader.close()
  return result
}

function userMessage(input: { sessionID: string; messageID: string; created: number }): Message.User {
  return {
    id: input.messageID,
    sessionID: input.sessionID,
    role: "user",
    time: { created: input.created },
    agent: "user",
    model: { providerID: "test", modelID: "test" },
    tools: {},
    mode: "",
  } as Message.User
}

describe("mission project archive route", () => {
  afterEach(async () => {
    await Instance.disposeAll()
    await resetDatabase()
  })

  test("GET /mission/:missionID/project-archive zips git-included project files and Mission execution flow", async () => {
    await using tmp = await tmpdir({ git: true })

    await fs.mkdir(path.join(tmp.path, "src"), { recursive: true })
    await fs.mkdir(path.join(tmp.path, "dist"), { recursive: true })
    await fs.writeFile(path.join(tmp.path, ".gitignore"), "dist/\n", "utf8")
    await fs.writeFile(path.join(tmp.path, "tracked.txt"), "tracked mission file\n", "utf8")
    await fs.writeFile(path.join(tmp.path, "src", "mission-untracked.txt"), "mission untracked\n", "utf8")
    await fs.writeFile(path.join(tmp.path, "dist", "ignored.txt"), "ignored mission file\n", "utf8")
    await $`git add .gitignore tracked.txt`.cwd(tmp.path).quiet()
    await $`git commit -m "seed mission archive fixture"`.cwd(tmp.path).quiet()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await fs.mkdir(path.join(tmp.path, ".opencorvus", "runtime"), { recursive: true })
        await fs.writeFile(path.join(tmp.path, ".opencorvus", "runtime", "forced.txt"), "runtime must not archive\n")
        await fs.writeFile(path.join(tmp.path, ".opencorvus-meta.json"), "{}\n")
        await $`git add -f .opencorvus/runtime/forced.txt .opencorvus-meta.json`.cwd(tmp.path).quiet()

        const session = await ensureMissionSession({ missionID: "mission-archive", defaultCwd: tmp.path })
        const now = Date.now()
        const messageID = Identifier.ascending("message")
        await Session.persistMessage({
          info: userMessage({ sessionID: session.id, messageID, created: now }),
          parts: [
            {
              id: Identifier.ascending("part"),
              sessionID: session.id,
              messageID,
              type: "text",
              text: "mission transcript archive marker",
            } as Message.Part,
          ],
          touchSessionID: session.id,
        })

        const taskID = Identifier.ascending("task")
        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "mission",
              title: "Mission archive task",
              request: "Archive Mission project",
              priority: "normal",
              metadata: { actor: "mission", mission: { id: session.missionID, session_id: session.id } },
              time_started: now + 1,
              time_completed: now + 2,
              time_created: now,
              time_updated: now + 2,
            })
            .run(),
        )

        const response = await Server.App().request(`/mission/${session.missionID}/project-archive`, {
          headers: { "x-opencorvus-directory": tmp.path },
        })

        expect(response.status).toBe(200)
        expect(response.headers.get("content-type")).toContain("application/zip")
        expect(response.headers.get("content-disposition")).toContain("mission-archive-project.zip")

        const entries = await zipEntries(new Uint8Array(await response.arrayBuffer()))
        expect(entries.get("project/.gitignore")).toContain("dist/")
        expect(entries.get("project/tracked.txt")).toBe("tracked mission file\n")
        expect(entries.get("project/src/mission-untracked.txt")).toBe("mission untracked\n")
        expect(entries.has("project/dist/ignored.txt")).toBe(false)
        expect(entries.has("project/.opencorvus/runtime/forced.txt")).toBe(false)
        expect(entries.has("project/.opencorvus-meta.json")).toBe(false)

        const manifest = JSON.parse(entries.get("opencorvus-mission-execution-flow/manifest.json") || "{}")
        expect(manifest).toMatchObject({
          schema: "opencorvus.mission-project-archive.v1",
          missionID: session.missionID,
          sessionID: session.id,
          project: { id: Instance.project.id },
          projectFileRoot: "project/",
          executionFlowRoot: "opencorvus-mission-execution-flow/",
        })
        expect(manifest.projectFileSelection).toContain("git ls-files")
        expect(manifest.executionFlowBounds).toMatchObject({
          maxStringChars: 16_384,
          maxArrayItems: 500,
          maxDepth: 12,
        })
        expect(entries.get("opencorvus-mission-execution-flow/mission.json")).toContain(session.missionID)
        expect(entries.get("opencorvus-mission-execution-flow/status.json")).toContain(taskID)
        expect(entries.get("opencorvus-mission-execution-flow/tasks.json")).toContain(taskID)
        expect(entries.get("opencorvus-mission-execution-flow/transcript.json")).toContain(
          "mission transcript archive marker",
        )
      },
    })
  }, 30000)

  test("GET /mission/:missionID/project-archive returns 422 JSON for non-Git projects", async () => {
    await using nonGitTmp = await tmpdir()

    await Instance.provide({
      directory: nonGitTmp.path,
      fn: async () => {
        const session = await ensureMissionSession({ missionID: "mission-nongit", defaultCwd: nonGitTmp.path })

        const response = await Server.App().request(`/mission/${session.missionID}/project-archive`, {
          headers: { "x-opencorvus-directory": nonGitTmp.path },
        })

        expect(response.status).toBe(422)
        const body = (await response.json()) as { message: string }
        expect(body.message).toContain("not a Git worktree")
      },
    })
  })
})
