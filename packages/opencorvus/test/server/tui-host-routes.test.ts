import { afterEach, describe, expect, test } from "bun:test"
import { Tui } from "../../src/tui"
import { TuiHost } from "../../src/tui/host"
import { TuiRoutes } from "../../src/server/routes/tui"
import { Server } from "../../src/server/server"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

function inputEchoCommand(cwd: string): Tui.EmbeddedCommand {
  if (process.platform === "win32") {
    return {
      command: "powershell.exe",
      args: ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "$line=[Console]::In.ReadLine(); Write-Output $line; Start-Sleep -Seconds 30"],
      cwd,
      url: "http://127.0.0.1:3",
      port: 3,
      hostname: "127.0.0.1",
    }
  }
  return {
    command: "sh",
    args: ["-c", 'read line; printf "%s" "$line"; sleep 30'],
    cwd,
    url: "http://127.0.0.1:3",
    port: 3,
    hostname: "127.0.0.1",
  }
}

async function waitFor(check: () => boolean, message: string) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(message)
}

async function withTimeout<T>(promise: Promise<T>, message: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), 5_000)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function openSocket(url: URL) {
  const ws = new WebSocket(url)
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true })
      ws.addEventListener("error", () => reject(new Error("websocket failed before open")), { once: true })
    }),
    "timed out waiting for websocket open",
  )
  return ws
}

async function expectSocketRejected(url: URL) {
  const ws = new WebSocket(url)
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      ws.addEventListener(
        "open",
        () => {
          ws.close(1000)
          reject(new Error("websocket opened"))
        },
        { once: true },
      )
      ws.addEventListener("error", () => resolve(), { once: true })
      ws.addEventListener("close", () => resolve(), { once: true })
    }),
    "timed out waiting for websocket rejection",
  )
}

function waitForSocketMessage(ws: WebSocket, check: (message: string) => boolean) {
  const decoder = new TextDecoder()
  let listener: ((event: MessageEvent) => void) | undefined
  return withTimeout(
    new Promise<string>((resolve) => {
      listener = (event: MessageEvent) => {
        const message = typeof event.data === "string" ? event.data : decoder.decode(event.data as ArrayBuffer)
        if (check(message)) resolve(message)
      }
      ws.addEventListener("message", listener)
    }),
    "timed out waiting for websocket message",
  ).finally(() => {
    if (listener) ws.removeEventListener("message", listener)
  })
}

function hostConnectURL(base: URL, directory: string, ticket: string) {
  const url = new URL("/tui/host/connect", base)
  url.protocol = "ws:"
  url.searchParams.set("directory", directory)
  url.searchParams.set(TuiHost.CONNECT_TICKET_QUERY, ticket)
  url.searchParams.set("cursor", "-1")
  return url
}

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

  test("rejects empty input and stopped host operations", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = TuiRoutes()
        const emptyInput = await app.request("/host/input", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ data: "" }),
        })
        expect(emptyInput.status).toBe(400)

        const stoppedInput = await app.request("/host/input", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ data: "x" }),
        })
        expect(stoppedInput.status).toBe(400)

        const stoppedResize = await app.request("/host/resize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cols: 100, rows: 30 }),
        })
        expect(stoppedResize.status).toBe(400)
      },
    })
  })

  test("issues connect tokens through the OpenCode ticket header contract", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = TuiRoutes()

        const missingHeader = await app.request("/host/connect-token", { method: "POST" })
        expect(missingHeader.status).toBe(403)

        const stopped = await app.request("/host/connect-token", {
          method: "POST",
          headers: { [TuiHost.CONNECT_TOKEN_HEADER]: TuiHost.CONNECT_TOKEN_HEADER_VALUE },
        })
        expect(stopped.status).toBe(404)

        await TuiHost.startPrepared({ command: inputEchoCommand(tmp.path), cols: 80, rows: 24 })
        const status = TuiHost.status()
        expect(status.id).toBeString()
        const issued = await app.request("/host/connect-token", {
          method: "POST",
          headers: { [TuiHost.CONNECT_TOKEN_HEADER]: TuiHost.CONNECT_TOKEN_HEADER_VALUE },
        })
        expect(issued.status).toBe(200)
        const body = (await issued.json()) as { ticket: string; expires_in: number }
        expect(body.ticket).toBeString()
        expect(body.expires_in).toBe(60)
        expect(TuiHost.consumeConnectToken({ ticket: body.ticket, hostID: status.id!, directory: tmp.path })).toBe(true)
        expect(TuiHost.consumeConnectToken({ ticket: body.ticket, hostID: status.id!, directory: tmp.path })).toBe(false)
      },
    })
  })

  test("writes input, resizes, snapshots, and stops through host routes", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await TuiHost.startPrepared({ command: inputEchoCommand(tmp.path), cols: 80, rows: 24 })
        const app = TuiRoutes()

        const input = await app.request("/host/input", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ data: "route-host-input\r\n" }),
        })
        expect(input.status).toBe(200)
        expect(await input.json()).toBe(true)
        await waitFor(
          () => TuiHost.snapshot().buffer.includes("route-host-input"),
          "host route input did not reach the Pseudo Terminal",
        )

        const resize = await app.request("/host/resize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cols: 120, rows: 40 }),
        })
        expect(resize.status).toBe(200)
        const resized = (await resize.json()) as { cols: number; rows: number; directory: string | null }
        expect(resized.cols).toBe(120)
        expect(resized.rows).toBe(40)
        expect(resized.directory).toBe(tmp.path)

        const snapshot = await app.request("/host/snapshot")
        expect(snapshot.status).toBe(200)
        const body = (await snapshot.json()) as { buffer: string; cols: number; rows: number }
        expect(body.buffer).toContain("route-host-input")
        expect(body.cols).toBe(120)
        expect(body.rows).toBe(40)

        const output = await app.request("/host/output?cursor=0")
        expect(output.status).toBe(200)
        const firstOutput = (await output.json()) as { data: string; cursor: number; from: number; truncated: boolean }
        expect(firstOutput.data).toContain("route-host-input")
        expect(firstOutput.from).toBe(0)
        expect(firstOutput.cursor).toBeGreaterThan(0)
        expect(firstOutput.truncated).toBe(false)

        const emptyOutput = await app.request(`/host/output?cursor=${encodeURIComponent(String(firstOutput.cursor))}`)
        expect(emptyOutput.status).toBe(200)
        expect(await emptyOutput.json()).toMatchObject({
          data: "",
          cursor: firstOutput.cursor,
          from: firstOutput.cursor,
          truncated: false,
        })

        const stop = await app.request("/host/stop", { method: "POST" })
        expect(stop.status).toBe(200)
        expect(await stop.json()).toBe(true)
        expect(TuiHost.status().running).toBe(false)
      },
    })
  })

  test("streams host input and output through a ticketed WebSocket connect route", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await TuiHost.startPrepared({ command: inputEchoCommand(tmp.path), cols: 80, rows: 24 })
      },
    })
    const listener = Server.listen({ hostname: "127.0.0.1", port: 0, randomPort: true })
    try {
      const tokenResponse = await fetch(new URL(`/tui/host/connect-token?directory=${encodeURIComponent(tmp.path)}`, listener.url), {
        method: "POST",
        headers: { [TuiHost.CONNECT_TOKEN_HEADER]: TuiHost.CONNECT_TOKEN_HEADER_VALUE },
      })
      expect(tokenResponse.status).toBe(200)
      const token = (await tokenResponse.json()) as { ticket: string }
      const url = hostConnectURL(listener.url, tmp.path, token.ticket)
      const ws = await openSocket(url)
      const message = waitForSocketMessage(ws, (value) => value.includes("route-host-websocket"))
      ws.send("route-host-websocket\r\n")
      expect(await message).toContain("route-host-websocket")
      await expectSocketRejected(url)
      ws.close(1000)
    } finally {
      await listener.stop(true)
      await Instance.disposeAll()
    }
  })

  test("rejects invalid output cursor payload", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = TuiRoutes()
        const res = await app.request("/host/output?cursor=-2")
        expect(res.status).toBe(400)
      },
    })
  })
})
