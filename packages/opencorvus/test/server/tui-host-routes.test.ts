import { afterEach, describe, expect, test } from "bun:test"
import { TuiRoutes } from "../../src/server/routes/tui"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("server.tui-host-routes", () => {
  afterEach(async () => {
    await Instance.disposeAll()
  })

  test("returns project-scoped host status and snapshot", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = TuiRoutes()
        const statusRes = await app.request("/host/status")
        expect(statusRes.status).toBe(200)
        const status = (await statusRes.json()) as { status: string; running: boolean; directory: string | null }
        expect(status.status).toBe("idle")
        expect(status.running).toBe(false)
        expect(status.directory).toBe(tmp.path)

        const snapshotRes = await app.request("/host/snapshot")
        expect(snapshotRes.status).toBe(200)
        const snapshot = (await snapshotRes.json()) as { buffer: string; status: string }
        expect(snapshot.status).toBe("idle")
        expect(snapshot.buffer).toBe("")
      },
    })
  })

  test("rejects invalid host resize payload", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = TuiRoutes()
        const res = await app.request("/host/resize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cols: 0, rows: 40 }),
        })
        expect(res.status).toBe(400)
      },
    })
  })
})
