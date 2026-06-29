import { $ } from "bun"
import { afterEach, describe, expect, mock, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { BlobReader, TextWriter, ZipReader } from "@zip.js/zip.js"
import { EngineArtifactTable, EngineInteractionRequestTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { ProtocolEventTable } from "../../src/protocol/protocol.sql"
import { Server } from "../../src/server/server"
import { Database, eq } from "../../src/storage/db"
import { timelineOrderKey } from "../../src/timeline/order"
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

describe("task project archive route", () => {
  afterEach(async () => {
    mock.restore()
    await Instance.disposeAll()
    await resetDatabase()
  })

  test("GET /task/:taskID/project-archive zips git-included project files and execution flow", async () => {
    await using tmp = await tmpdir({ git: true })

    await fs.mkdir(path.join(tmp.path, "src"), { recursive: true })
    await fs.mkdir(path.join(tmp.path, "dist"), { recursive: true })
    await fs.writeFile(path.join(tmp.path, ".gitignore"), "dist/\n", "utf8")
    await fs.writeFile(path.join(tmp.path, "tracked.txt"), "tracked file\n", "utf8")
    await fs.writeFile(path.join(tmp.path, " spaced name .txt"), "spaced file\n", "utf8")
    await fs.writeFile(path.join(tmp.path, "src", "untracked.txt"), "untracked file\n", "utf8")
    await fs.writeFile(path.join(tmp.path, "dist", "ignored.txt"), "ignored file\n", "utf8")
    await $`git add .gitignore tracked.txt " spaced name .txt"`.cwd(tmp.path).quiet()
    await $`git commit -m "seed archive fixture"`.cwd(tmp.path).quiet()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await fs.mkdir(path.join(tmp.path, ".opencorvus", "r", "t", "ab", "cdef12"), { recursive: true })
        await fs.mkdir(path.join(tmp.path, ".opencorvus", "runtime"), { recursive: true })
        await fs.mkdir(path.join(tmp.path, ".opencorvus", "worktrees"), { recursive: true })
        await fs.mkdir(path.join(tmp.path, ".opencorvus-worktrees"), { recursive: true })
        await fs.writeFile(
          path.join(tmp.path, ".opencorvus", "r", "t", "ab", "cdef12", "forced.txt"),
          "short runtime must not archive\n",
        )
        await fs.writeFile(path.join(tmp.path, ".opencorvus", "runtime", "forced.txt"), "runtime must not archive\n")
        await fs.writeFile(path.join(tmp.path, ".opencorvus", "worktrees", "forced.txt"), "worktree must not archive\n")
        await fs.writeFile(
          path.join(tmp.path, ".opencorvus-worktrees", "forced.txt"),
          "legacy worktree must not archive\n",
        )
        await fs.writeFile(path.join(tmp.path, ".opencorvus-meta.json"), "{}\n")
        await $`git add -f .opencorvus/r/t/ab/cdef12/forced.txt .opencorvus/runtime/forced.txt .opencorvus/worktrees/forced.txt .opencorvus-worktrees/forced.txt .opencorvus-meta.json`
          .cwd(tmp.path)
          .quiet()

        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const interactionID = Identifier.ascending("interaction")
        const longProtocolBody = "protocol-big-marker-" + "x".repeat(20_000)
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "panel",
              title: "Archive task",
              request: "Export task project archive",
              priority: "normal",
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
        Database.use((db) => {
          db.insert(EngineArtifactTable)
            .values({
              id: runID,
              task_id: taskID,
              run_id: runID,
              kind: "run",
              label: "archive-run",
              payload: {
                status: "completed",
                phase: "execute",
                retry_count: 2,
                metadata: { archiveMarker: "run-db-row" },
                time_started: now + 1,
                time_completed: now + 2,
              },
              time_created: now + 1,
              time_updated: now + 2,
            })
            .run()
          db.insert(EngineArtifactTable)
            .values({
              id: Identifier.ascending("artifact"),
              task_id: taskID,
              run_id: runID,
              kind: "report",
              label: "archive-report",
              payload: { archiveMarker: "artifact-db-row" },
              time_created: now + 3,
              time_updated: now + 3,
            })
            .run()
          db.insert(EngineInteractionRequestTable)
            .values({
              id: interactionID,
              task_id: taskID,
              run_id: runID,
              external_id: "archive-question",
              request_type: "question",
              status: "answered",
              title: "Archive interaction",
              body: "Should this database interaction be exported?",
              payload: { archiveMarker: "interaction-payload" },
              response: { answer: "yes", archiveMarker: "interaction-response" },
              time_resolved: now + 4,
              time_created: now + 4,
              time_updated: now + 4,
            })
            .run()
          const protocolEventID = Identifier.ascending("protocol_event")
          db.insert(ProtocolEventTable)
            .values({
              id: protocolEventID,
              kind: "event",
              type: "workflow.step.updated",
              aggregate_type: "task",
              aggregate_id: taskID,
              task_id: taskID,
              run_id: runID,
              interaction_id: interactionID,
              source: "archive-test",
              seq: 1,
              order_key: timelineOrderKey({ domain: "protocol", time: now + 5, sequence: 1, id: protocolEventID }),
              emitted_at: now + 5,
              payload: {
                stepID: "archive-step",
                status: "completed",
                summary: "archive protocol db row",
                archiveMarker: "protocol-db-row",
                longProtocolBody,
              },
              time_created: now + 5,
              time_updated: now + 5,
            })
            .run()
        })

        const response = await Server.App().request(`/task/${taskID}/project-archive`, {
          headers: { "x-opencorvus-directory": tmp.path },
        })

        expect(response.status).toBe(200)
        expect(response.headers.get("content-type")).toContain("application/zip")
        expect(response.headers.get("content-disposition")).toContain(`${taskID}-project.zip`)

        const bytes = new Uint8Array(await response.arrayBuffer())
        const entries = await zipEntries(bytes)
        expect(entries.get("project/.gitignore")).toContain("dist/")
        expect(entries.get("project/tracked.txt")).toBe("tracked file\n")
        expect(entries.get("project/ spaced name .txt")).toBe("spaced file\n")
        expect(entries.has("project/spaced name .txt")).toBe(false)
        expect(entries.get("project/src/untracked.txt")).toBe("untracked file\n")
        expect(entries.has("project/dist/ignored.txt")).toBe(false)
        expect(entries.has("project/.opencorvus/r/t/ab/cdef12/forced.txt")).toBe(false)
        expect(entries.has("project/.opencorvus/runtime/forced.txt")).toBe(false)
        expect(entries.has("project/.opencorvus/worktrees/forced.txt")).toBe(false)
        expect(entries.has("project/.opencorvus-worktrees/forced.txt")).toBe(false)
        expect(entries.has("project/.opencorvus-meta.json")).toBe(false)

        const manifest = JSON.parse(entries.get("opencorvus-task-execution-flow/manifest.json") || "{}")
        expect(manifest.taskID).toBe(taskID)
        expect(manifest.project.id).toBe(Instance.project.id)
        expect(manifest.projectFileSelection).toContain("git ls-files")
        expect(manifest.projectFileSelection).toContain("OpenCorvus runtime filter")
        expect(manifest.executionFlowBounds).toMatchObject({
          maxStringChars: 16_384,
          maxArrayItems: 500,
          maxDepth: 12,
        })
        expect(entries.get("opencorvus-task-execution-flow/task.json")).toContain(taskID)
        expect(entries.get("opencorvus-task-execution-flow/board.json")).toContain(taskID)
        const runs = JSON.parse(entries.get("opencorvus-task-execution-flow/runs.json") || "[]")
        expect(runs).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: runID,
              status: "completed",
              phase: "execute",
              retryCount: 2,
              metadata: { archiveMarker: "run-db-row" },
            }),
          ]),
        )
        const artifacts = JSON.parse(entries.get("opencorvus-task-execution-flow/artifacts.json") || "[]")
        const runArtifacts = artifacts.find((item: any) => item.runID === runID)
        expect(runArtifacts?.artifacts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              runID,
              kind: "report",
              label: "archive-report",
              payload: { archiveMarker: "artifact-db-row" },
            }),
          ]),
        )
        const interactions = JSON.parse(entries.get("opencorvus-task-execution-flow/interactions.json") || "[]")
        expect(interactions).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: interactionID,
              runID,
              status: "answered",
              response: { answer: "yes", archiveMarker: "interaction-response" },
            }),
          ]),
        )
        const protocolEvents = JSON.parse(entries.get("opencorvus-task-execution-flow/protocol-events.json") || "[]")
        expect(protocolEvents).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "workflow.step.updated",
              runID,
              interactionID,
              summary: "archive protocol db row",
              payload: expect.objectContaining({
                stepID: "archive-step",
                status: "completed",
                summary: "archive protocol db row",
                archiveMarker: "protocol-db-row",
                longProtocolBody: expect.objectContaining({
                  truncated: true,
                  reason: "string_limit",
                  chars: longProtocolBody.length,
                }),
              }),
            }),
          ]),
        )
        expect(JSON.stringify(protocolEvents)).not.toContain(longProtocolBody)
        expect(entries.get("opencorvus-task-execution-flow/transcript.json")).toContain("[")
      },
    })
  }, 30000)

  test("GET /task/:taskID/project-archive returns 422 JSON for non-Git projects", async () => {
    await using nonGitTmp = await tmpdir()

    await Instance.provide({
      directory: nonGitTmp.path,
      fn: async () => {
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "panel",
              title: "Archive non-git task",
              request: "Export task project archive",
              priority: "normal",
              time_created: now,
              time_updated: now,
            })
            .run(),
        )

        const response = await Server.App().request(`/task/${taskID}/project-archive`, {
          headers: { "x-opencorvus-directory": nonGitTmp.path },
        })

        expect(response.status).toBe(422)
        const body = (await response.json()) as { message: string }
        expect(body.message).toContain("not a Git worktree")
      },
    })
  })

  test("GET /task/:taskID/project-archive rejects a foreign active project", async () => {
    await using projectA = await tmpdir({ git: true })
    await using projectB = await tmpdir({ git: true })

    let taskID = ""
    await Instance.provide({
      directory: projectA.path,
      fn: async () => {
        taskID = Identifier.ascending("task")
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "panel",
              title: "Archive foreign task",
              request: "must not export from another active project",
              priority: "normal",
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
      },
    })

    const response = await Server.App().request(`/task/${taskID}/project-archive`, {
      headers: { "x-opencorvus-directory": projectB.path },
    })

    expect(response.status).toBe(404)
  })

  test("rewind routes reject a foreign active project before mutating the task cursor", async () => {
    await using projectA = await tmpdir({ git: true })
    await using projectB = await tmpdir({ git: true })

    let taskID = ""
    await Instance.provide({
      directory: projectA.path,
      fn: async () => {
        taskID = Identifier.ascending("task")
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "panel",
              title: "Rewind foreign task",
              request: "must not rewind from another active project",
              priority: "normal",
              rewind_cursor_time: now - 1,
              rewind_cursor_event_id: "evt_existing",
              rewind_count: 1,
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
      },
    })

    const rewindResponse = await Server.App().request(`/task/${taskID}/rewind`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-opencorvus-directory": projectB.path,
      },
      body: JSON.stringify({
        anchor: { kind: "cursorTime", cursorTime: 1 },
        resetWorktree: false,
      }),
    })
    const clearResponse = await Server.App().request(`/task/${taskID}/rewind/clear`, {
      method: "POST",
      headers: { "x-opencorvus-directory": projectB.path },
    })

    expect(rewindResponse.status).toBe(404)
    expect(clearResponse.status).toBe(404)
    const task = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
    expect(task?.rewind_cursor_event_id).toBe("evt_existing")
    expect(task?.rewind_count).toBe(1)
  })
})
