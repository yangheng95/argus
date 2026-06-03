import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { EngineRoutes } from "../../src/server/routes/orchestrator"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("orchestrator message bridge init", () => {
  afterEach(async () => {
    await Instance.disposeAll()
    await resetDatabase()
  })

  test("route middleware does not require an instance context before parameter validation", async () => {
    expect(Instance.current()).toBeUndefined()

    const response = await EngineRoutes().request("/task/not-a-task/progress")

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      data: { taskID: "not-a-task" },
      success: false,
    })
  })

  test("route middleware still runs inside a project instance context", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await EngineRoutes().request("/task/not-a-task/progress")

        expect(response.status).toBe(400)
        expect(await response.json()).toMatchObject({
          data: { taskID: "not-a-task" },
          success: false,
        })
      },
    })
  })
})
