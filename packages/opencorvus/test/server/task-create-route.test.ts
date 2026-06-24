import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as fs from "node:fs/promises"
import path from "node:path"
import { findTask } from "../../src/engine/store"
import { deriveTaskStatus } from "../../src/engine/task-status"
import * as TaskLoop from "../../src/orchestrator/loop"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
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

    spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
    const app = Server.App()
    const response = await app.request("/task", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-opencorvus-directory": tmp.path,
      },
      body: JSON.stringify({
        request: "create with frontend automation debug profile",
        executor: "opencorvus",
        requestID: "route-create-profile",
        source: "panel",
        promptProfile: "frontend-automation-debug",
      }),
    })

    expect(response.status).toBe(202)
    const body = (await response.json()) as { task_id: string }
    const task = findTask(body.task_id)
    expect(task?.session_id).toBeTruthy()
    const session = await Session.get(task!.session_id!)
    expect(session.metadata?.configOverlay).toMatchObject({
      prompt_profile: { active: "frontend-automation-debug" },
    })
  }, 15_000)
})
