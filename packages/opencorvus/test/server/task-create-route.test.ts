import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as fs from "node:fs/promises"
import path from "node:path"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { findTask } from "../../src/engine/store"
import { deriveTaskStatus } from "../../src/engine/task-status"
import * as TaskLoop from "../../src/orchestrator/loop"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionTable } from "../../src/session/session.sql"
import { AttachmentStore } from "../../src/storage/attachment-store"
import { Database } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { PROJECT_EXPERT_SQUAD_ID, writeProjectExpertSquadPackage } from "../fixture/expert-squad"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("task creation route", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("POST /task accepts omitted queue and starts immediately", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })

    const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
    const app = Server.App()
    const response = await app.request("/task", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-opencorvus-directory": tmp.path,
      },
      body: JSON.stringify({
        request: "create from overlay without queue",
        executor: "opencorvus",
        requestID: "route-create-no-queue",
        source: "panel",
      }),
    })

    expect(response.status).toBe(202)
    const body = (await response.json()) as { task_id: string }
    const task = findTask(body.task_id)
    expect(task).toBeDefined()
    expect(deriveTaskStatus(task!)).toBe("active")
    expect(typeof task!.time_started).toBe("number")

    for (let i = 0; i < 50 && runTaskLoop.mock.calls.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(runTaskLoop).toHaveBeenCalledTimes(1)
  }, 15_000)

  test("POST /task rejects caller-supplied child task lineage", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })

    const app = Server.App()
    const response = await app.request("/task", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-opencorvus-directory": tmp.path,
      },
      body: JSON.stringify({
        request: "create a forged child task",
        executor: "opencorvus",
        requestID: "route-create-forged-child",
        source: "panel",
        metadata: { parent_task_id: "tsk_parent" },
      }),
    })

    expect(response.status).toBe(400)
    const body = (await response.json()) as { name: string; data: { message: string } }
    expect(body.name).toBe("ExternalChildTaskLineageError")
    expect(body.data.message).toContain("metadata.parent_task_id is owned by the orchestrator scheduler")
    expect(Database.use((db) => db.select().from(EngineTaskTable).all())).toHaveLength(0)
  }, 15_000)

  test("POST /task defaults init-git to true for missing directories", async () => {
    await using root = await tmpdir()
    const directory = path.join(root.path, "created-from-task-route")

    const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
    const app = Server.App()
    const response = await app.request(`/task?directory=${encodeURIComponent(directory)}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        request: "create task in missing directory",
        executor: "opencorvus",
        model: "test/model",
        requestID: "route-create-missing-init-git-default",
        source: "api",
      }),
    })

    expect(response.status).toBe(202)
    await expect(fs.stat(path.join(directory, ".git"))).resolves.toBeDefined()
    const body = (await response.json()) as { task_id: string }
    const task = findTask(body.task_id)
    expect(task).toBeDefined()
    expect(deriveTaskStatus(task!)).toBe("active")

    for (let i = 0; i < 50 && runTaskLoop.mock.calls.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(runTaskLoop).toHaveBeenCalledTimes(1)
  }, 15_000)

  test("POST /task defaults init-git to true for existing non-git directories", async () => {
    await using tmp = await tmpdir()

    spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
    const app = Server.App()
    const response = await app.request("/task", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-opencorvus-directory": tmp.path,
      },
      body: JSON.stringify({
        request: "create task in existing non-git directory",
        executor: "opencorvus",
        model: "test/model",
        requestID: "route-create-existing-init-git-default",
        source: "api",
      }),
    })

    expect(response.status).toBe(202)
    await expect(fs.stat(path.join(tmp.path, ".git"))).resolves.toBeDefined()
    const body = (await response.json()) as { task_id: string }
    expect(findTask(body.task_id)).toBeDefined()
  }, 15_000)

  test("POST /task with init-git=false rejects missing directories without creating .git", async () => {
    await using root = await tmpdir()
    const directory = path.join(root.path, "missing-with-init-git-false")

    spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
    const app = Server.App()
    const response = await app.request(`/task?directory=${encodeURIComponent(directory)}&init-git=false`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        request: "do not initialize git",
        executor: "opencorvus",
        model: "test/model",
        requestID: "route-create-missing-init-git-false",
        source: "api",
      }),
    })

    expect(response.status).toBe(412)
    const body = (await response.json()) as { name: string }
    expect(body.name).toBe("WorktreeNotGitError")
    await expect(fs.stat(path.join(directory, ".git"))).rejects.toThrow()
  }, 15_000)

  test("POST /task with init-git=false rejects existing non-git directories without creating .git", async () => {
    await using tmp = await tmpdir()

    spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
    const app = Server.App()
    const response = await app.request("/task?init-git=false", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-opencorvus-directory": tmp.path,
      },
      body: JSON.stringify({
        request: "reject existing non-git directory",
        executor: "opencorvus",
        model: "test/model",
        requestID: "route-create-existing-init-git-false",
        source: "api",
      }),
    })

    expect(response.status).toBe(412)
    const body = (await response.json()) as { name: string }
    expect(body.name).toBe("WorktreeNotGitError")
    await expect(fs.stat(path.join(tmp.path, ".git"))).rejects.toThrow()
  }, 15_000)

  test("POST /task rejects invalid init-git values", async () => {
    await using tmp = await tmpdir({ git: true })

    spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
    const app = Server.App()
    const response = await app.request(`/task?directory=${encodeURIComponent(tmp.path)}&init-git=yes`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        request: "invalid init-git parameter",
        executor: "opencorvus",
        model: "test/model",
        requestID: "route-create-invalid-init-git",
        source: "api",
      }),
    })

    expect(response.status).toBe(400)
    const body = (await response.json()) as { name: string }
    expect(body.name).toBe("InvalidInitGitParameterError")
  }, 15_000)

  test("POST /task writes selected prompt profile to the root session overlay", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })
    await writeProjectExpertSquadPackage(tmp.path)

    spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
    const app = Server.App()
    const response = await app.request("/task", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-opencorvus-directory": tmp.path,
      },
      body: JSON.stringify({
        request: "create with project package profile",
        executor: "opencorvus",
        requestID: "route-create-profile",
        source: "panel",
        promptProfile: PROJECT_EXPERT_SQUAD_ID,
      }),
    })

    expect(response.status).toBe(202)
    const body = (await response.json()) as { task_id: string }
    const task = findTask(body.task_id)
    expect(task?.session_id).toBeTruthy()
    const session = await Session.get(task!.session_id!)
    expect(session.metadata?.configOverlay).toMatchObject({
      prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID },
    })
  }, 15_000)

  test("POST /task rejects malformed attachment base64 before writing task attachments", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })

    const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
    const writeAttachment = spyOn(AttachmentStore, "write")
    const app = Server.App()
    const response = await app.request("/task", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-opencorvus-directory": tmp.path,
      },
      body: JSON.stringify({
        title: "malformed attachment orphan root",
        request: "create with malformed upload",
        executor: "opencorvus",
        requestID: "route-create-malformed-attachment",
        source: "panel",
        promptProfile: "general",
        attachments: [{ mime: "image/png", filename: "bad.png", data: "not base64!*" }],
      }),
    })

    const responseText = await response.text()
    expect(response.status).not.toBe(202)
    expect(responseText).toContain("invalid base64 payload")
    expect(writeAttachment).not.toHaveBeenCalled()
    expect(runTaskLoop).not.toHaveBeenCalled()
    const malformedTasks = Database.use((db) =>
      db
        .select()
        .from(EngineTaskTable)
        .all()
        .filter((task) => task.request_id === "route-create-malformed-attachment"),
    )
    expect(malformedTasks).toHaveLength(0)
    const orphanSessions = Database.use((db) =>
      db
        .select()
        .from(SessionTable)
        .all()
        .filter((session) => session.title === "malformed attachment orphan root"),
    )
    expect(orphanSessions).toHaveLength(0)
  }, 15_000)

  test("POST /task rejects malformed attachments before initializing a missing project directory", async () => {
    await using tmp = await tmpdir()
    const missingProject = path.join(tmp.path, "missing-project")

    const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
    const writeAttachment = spyOn(AttachmentStore, "write")
    const app = Server.App()
    const response = await app.request("/task", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-opencorvus-directory": missingProject,
      },
      body: JSON.stringify({
        title: "malformed attachment missing project",
        request: "create missing project with malformed upload",
        executor: "opencorvus",
        requestID: "route-create-malformed-attachment-missing-project",
        source: "panel",
        attachments: [{ mime: "image/png", filename: "bad.png", data: "not base64!*" }],
      }),
    })

    expect(response.status).toBe(400)
    expect(writeAttachment).not.toHaveBeenCalled()
    expect(runTaskLoop).not.toHaveBeenCalled()
    expect(await fs.stat(missingProject).then(() => true, () => false)).toBe(false)
  }, 15_000)
})
