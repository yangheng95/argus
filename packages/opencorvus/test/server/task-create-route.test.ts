import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
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
        request: "create with testing profile",
        executor: "opencorvus",
        requestID: "route-create-profile",
        source: "panel",
        promptProfile: "testing",
      }),
    })

    expect(response.status).toBe(202)
    const body = (await response.json()) as { task_id: string }
    const task = findTask(body.task_id)
    expect(task?.session_id).toBeTruthy()
    const session = await Session.get(task!.session_id!)
    expect(session.metadata?.configOverlay).toMatchObject({
      prompt_profile: { active: "testing" },
    })
  }, 15_000)
})
