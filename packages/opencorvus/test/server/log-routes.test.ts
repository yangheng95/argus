import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"

Log.init({ print: false, dev: true, level: "DEBUG" })

describe("log routes", () => {
  test("GET /log reads current and named files from the unified log directory", async () => {
    await Log.init({ print: false, dev: true, level: "DEBUG" })
    const marker = `log-route-${Date.now()}`
    Log.create({ service: "log-route-test" }).info("log route probe", { marker })
    await Bun.sleep(50)

    const app = Server.App()
    const current = await app.request("/log?n=500")
    expect(current.status).toBe(200)
    const currentBody = (await current.json()) as {
      directory: string
      path: string
      file: string
      lines: string[]
    }

    expect(currentBody.directory).toBe(Log.directory())
    expect(currentBody.path).toBe(Log.file())
    expect(currentBody.file).toBe(path.basename(Log.file()))
    expect(currentBody.lines.some((line) => JSON.parse(line).marker === marker)).toBe(true)

    const files = await app.request("/log/files")
    expect(files.status).toBe(200)
    const filesBody = (await files.json()) as {
      directory: string
      current: string
      files: Array<{ name: string; path: string; current: boolean }>
    }
    expect(filesBody.directory).toBe(Log.directory())
    expect(filesBody.current).toBe(Log.file())
    expect(filesBody.files).toContainEqual(
      expect.objectContaining({
        name: currentBody.file,
        path: currentBody.path,
        current: true,
      }),
    )

    const named = await app.request(`/log?file=${encodeURIComponent(currentBody.file)}&n=500`)
    expect(named.status).toBe(200)
    const namedBody = (await named.json()) as { path: string; lines: string[] }
    expect(namedBody.path).toBe(Log.file())
    expect(namedBody.lines.some((line) => JSON.parse(line).marker === marker)).toBe(true)
  })

  test("GET /log rejects path traversal file names", async () => {
    const app = Server.App()
    const response = await app.request(`/log?file=${encodeURIComponent("../dev.log")}`)
    expect(response.status).toBe(400)
  })

  test("GET /log rejects Windows name-stream and drive separators", async () => {
    const app = Server.App()
    const response = await app.request(`/log?file=${encodeURIComponent("dev.log:stream.log")}`)
    expect(response.status).toBe(400)
  })

  test("GET /log returns a typed 404 for valid but missing named log files", async () => {
    const app = Server.App()
    const response = await app.request(`/log?file=${encodeURIComponent("missing.log")}`)
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      name: "LogFileNotFoundError",
      data: {
        file: "missing.log",
        directory: Log.directory(),
      },
    })
  })

  test("GET /log/tail delegates to the unified log reader", async () => {
    await Log.init({ print: false, dev: true, level: "DEBUG" })
    Log.create({ service: "log-route-test" }).info("tail route probe")
    await Bun.sleep(50)

    const app = Server.App()
    const response = await app.request("/log/tail?n=100")
    expect(response.status).toBe(200)
    const body = (await response.json()) as { directory: string; path: string; file: string; lines: string[] }

    expect(body.directory).toBe(Log.directory())
    expect(body.path).toBe(Log.file())
    expect(body.file).toBe(path.basename(Log.file()))
    expect(body.lines.some((line) => JSON.parse(line).message === "tail route probe")).toBe(true)
  })

  test("GET /log/tail returns the last non-empty log line when the file ends with a newline", async () => {
    await Log.init({ print: false, dev: true, level: "DEBUG" })
    Log.create({ service: "log-route-test" }).info("first tail line")
    Log.create({ service: "log-route-test" }).info("last tail line")
    await Bun.sleep(50)

    const response = await Server.App().request("/log/tail?n=1")
    expect(response.status).toBe(200)
    const body = (await response.json()) as { lines: string[] }

    expect(body.lines).toHaveLength(1)
    expect(JSON.parse(body.lines[0]!).message).toBe("last tail line")
  })

  test("POST /log remains readable through GET /log when print mode is enabled", async () => {
    await Log.init({ print: true, dev: true, level: "DEBUG" })
    const marker = `print-log-route-${Date.now()}`
    const app = Server.App()

    const written = await app.request("/log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        service: "overlay:test",
        level: "error",
        message: "print mode route probe",
        extra: { marker },
      }),
    })
    expect(written.status).toBe(200)

    await Bun.sleep(50)
    const response = await app.request("/log?n=500")
    expect(response.status).toBe(200)
    const body = (await response.json()) as { path: string; lines: string[] }

    expect(body.path).toBe(Log.file())
    expect(body.lines.some((line) => JSON.parse(line).marker === marker)).toBe(true)
  })
})
