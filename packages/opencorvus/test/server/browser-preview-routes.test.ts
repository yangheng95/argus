import { afterEach, describe, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("browser preview routes", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("GET /browser-preview/target is project scoped and reads the active directory manifest", async () => {
    await using tmp = await tmpdir()
    await fs.writeFile(
      path.join(tmp.path, "package.json"),
      JSON.stringify({
        packageManager: "npm@10.9.0",
        opencorvus: { browserPreview: { url: "http://127.0.0.1:5173/" } },
      }),
    )
    const app = Server.App()

    const response = await app.request("/browser-preview/target", {
      headers: {
        "x-opencorvus-directory": tmp.path,
      },
    })

    expect(response.status).toBe(200)
    const body = await response.json() as { status: string; url?: string; source: string; viewports?: { id: string }[] }
    expect(body.status).toBe("ready")
    expect(body.url).toBe("http://127.0.0.1:5173/")
    expect(body.source).toBe("package-json")
    expect(body.viewports?.map((viewport) => viewport.id)).toEqual(["desktop", "tablet", "mobile"])
  })

  test("GET /browser-preview/target requires directory context", async () => {
    const app = Server.App()
    const response = await app.request("/browser-preview/target")

    expect(response.status).toBe(400)
    const body = await response.json() as { name?: string }
    expect(body.name).toBe("DirectoryRequiredError")
  })

  test("POST /browser-preview/verify surfaces missing target without launching capture", async () => {
    await using tmp = await tmpdir()
    const app = Server.App()

    const response = await app.request("/browser-preview/verify", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-opencorvus-directory": tmp.path,
      },
      body: JSON.stringify({ viewportID: "mobile" }),
    })

    expect(response.status).toBe(200)
    const body = await response.json() as {
      status: string
      viewport?: { id: string }
      capture?: unknown
      target?: { status: string }
      diagnostics?: string[]
    }
    expect(body.status).toBe("failed")
    expect(body.viewport?.id).toBe("mobile")
    expect(body.capture).toBeUndefined()
    expect(body.target?.status).toBe("missing")
    expect(body.diagnostics?.join("\n")).toContain("requires a resolved http(s) URL")
  })
})
