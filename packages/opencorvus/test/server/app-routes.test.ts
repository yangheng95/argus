import { afterEach, describe, expect, mock, test } from "bun:test"
import { Server } from "../../src/server/server"
import { openPathCommand } from "../../src/server/routes/app"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("app routes", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("openPathCommand keeps the target as the final argument", () => {
    const cmd = openPathCommand("C:\\repo")
    expect(cmd.at(-1)).toBe("C:\\repo")
  })

  test("GET /ui/ serves the overlay shell", async () => {
    const app = Server.App()
    const response = await app.request("/ui/")

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/html")
    expect(await response.text()).toContain('data-page="overlay"')
  })

  test("POST /path/open validates non-empty input", async () => {
    await using tmp = await tmpdir()
    const app = Server.App()

    const response = await app.request("/path/open", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-opencorvus-directory": tmp.path,
      },
      body: JSON.stringify({
        path: "",
      }),
    })

    expect(response.status).toBe(400)
  })
})
