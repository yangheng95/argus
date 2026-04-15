import { afterEach, describe, expect, mock, test } from "bun:test"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"

Log.init({ print: false })

describe("app routes", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  // Cross-file pollution: a prior test leaves an unresolved Question.ask, which gets rejected
  // here as "user dismissed". Skip until Question.pending is reset between test files.
  test.skip("GET /ui/ serves the overlay shell", async () => {
    const app = Server.App()
    const response = await app.request("/ui/")

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/html")
    expect(await response.text()).toContain('data-page="overlay"')
  })
})
