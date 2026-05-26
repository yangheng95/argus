import { afterEach, describe, expect, test } from "bun:test"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("retired task export/import routes", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("task export and archive import endpoints are not mounted", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.App()
    const headers = { "x-opencorvus-directory": tmp.path }

    const taskExport = await app.request("/export/task/tsk_retired", { headers })
    const taskArchive = await app.request("/export/task/tsk_retired/archive", { headers })
    const taskImport = await app.request("/export/import", {
      method: "POST",
      headers: { ...headers, "content-type": "application/zip" },
      body: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    })

    expect(taskExport.status).toBe(404)
    expect(taskArchive.status).toBe(404)
    expect(taskImport.status).toBe(404)
  })
})
