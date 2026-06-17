import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { findTask } from "../../src/engine/store"
import * as TaskLoop from "../../src/orchestrator/loop"
import { configureCorsOrigins } from "../../src/server/cors"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

function taskCreateRequest(requestID: string) {
  return {
    request: `create from origin test ${requestID}`,
    executor: "opencorvus",
    requestID,
    source: "panel",
  }
}

async function waitForTaskLoop(spy: ReturnType<typeof spyOn<typeof TaskLoop, "runTaskLoop">>) {
  for (let i = 0; i < 50 && spy.mock.calls.length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe("request Origin enforcement", () => {
  afterEach(async () => {
    configureCorsOrigins([])
    mock.restore()
    await resetDatabase()
  })

  test("hostile Origin is rejected before POST /task mutates state", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })

    const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
    const response = await Server.App().request("/task", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "127.0.0.1:7878",
        origin: "https://evil.example",
        "x-opencorvus-directory": tmp.path,
      },
      body: JSON.stringify(taskCreateRequest("hostile-origin")),
    })

    expect(response.status).toBe(403)
    const body = (await response.json()) as { name: string; data: { origin: string } }
    expect(body.name).toBe("RequestOriginForbiddenError")
    expect(body.data.origin).toBe("https://evil.example")
    expect(findTask("hostile-origin")).toBeUndefined()
    expect(runTaskLoop).not.toHaveBeenCalled()
  }, 15_000)

  test("same-host Origin reaches POST /task", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })

    const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
    const response = await Server.App().request("/task", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "127.0.0.1:7878",
        origin: "http://127.0.0.1:7878",
        "x-opencorvus-directory": tmp.path,
      },
      body: JSON.stringify(taskCreateRequest("same-host-origin")),
    })

    expect(response.status).toBe(202)
    const body = (await response.json()) as { task_id: string }
    expect(findTask(body.task_id)).toBeDefined()
    await waitForTaskLoop(runTaskLoop)
    expect(runTaskLoop).toHaveBeenCalledTimes(1)
  }, 15_000)

  test("configured Origin reaches POST /task", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })
    configureCorsOrigins(["https://trusted.example"])

    const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
    const response = await Server.App().request("/task", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "127.0.0.1:7878",
        origin: "https://trusted.example",
        "x-opencorvus-directory": tmp.path,
      },
      body: JSON.stringify(taskCreateRequest("configured-origin")),
    })

    expect(response.status).toBe(202)
    const body = (await response.json()) as { task_id: string }
    expect(findTask(body.task_id)).toBeDefined()
    await waitForTaskLoop(runTaskLoop)
    expect(runTaskLoop).toHaveBeenCalledTimes(1)
  }, 15_000)
})
