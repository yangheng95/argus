import { afterEach, describe, expect, test } from "bun:test"
import path from "node:path"
import { Tui } from "../../src/tui"
import { TuiHost } from "../../src/tui/host"
import { PtyRoutes } from "../../src/server/routes/pty"
import { Server } from "../../src/server/server"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

function inputEchoCommand(cwd: string): Tui.EmbeddedCommand {
  if (process.platform === "win32") {
    return {
      command: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "$line=[Console]::In.ReadLine(); Write-Output $line; Start-Sleep -Seconds 30",
      ],
      cwd,
      url: "",
      port: 0,
      hostname: "",
    }
  }
  return {
    command: "sh",
    args: ["-c", 'read line; printf "%s" "$line"; sleep 30'],
    cwd,
    url: "",
    port: 0,
    hostname: "",
  }
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

function waitForSocketMessage(ws: WebSocket, check: (message: string) => boolean) {
  const decoder = new TextDecoder()
  let listener: ((event: MessageEvent) => void) | undefined
  return withTimeout(
    new Promise<string>((resolve) => {
      listener = (event: MessageEvent) => {
        if (event.data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(event.data)
          if (bytes[0] === 0) return
          const message = decoder.decode(event.data)
          if (check(message)) resolve(message)
          return
        }
        const message = String(event.data)
        if (check(message)) resolve(message)
      }
      ws.addEventListener("message", listener)
    }),
    "timed out waiting for websocket message",
  ).finally(() => {
    if (listener) ws.removeEventListener("message", listener)
  })
}

describe("server.pty-routes", () => {
  afterEach(async () => {
    await Instance.disposeAll()
  })

  test("lists, reads, resizes, renames, and removes the project-bound PTY", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = PtyRoutes()
        expect(await (await app.request("/")).json()).toEqual([])

        const wrongCwd = await app.request("/", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd: path.join(tmp.path, "not-current-project") }),
        })
        expect(wrongCwd.status).toBe(400)
        expect(TuiHost.status().id).toBeNull()

        await TuiHost.startPrepared({ command: inputEchoCommand(tmp.path), cols: 80, rows: 24, title: "Initial TUI" })
        const active = TuiHost.status()
        expect(active.id).toBeString()

        const list = (await (await app.request("/")).json()) as Array<{ id: string; title: string }>
        expect(list).toEqual([{ id: active.id, title: "Initial TUI", command: active.command, args: active.args, cwd: tmp.path, status: "running", pid: active.pid }])

        const get = await app.request(`/${active.id}`)
        expect(get.status).toBe(200)
        expect((await get.json()) as { id: string }).toMatchObject({ id: active.id })

        const update = await app.request(`/${active.id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "Renamed TUI", size: { cols: 120, rows: 40 } }),
        })
        expect(update.status).toBe(200)
        expect(await update.json()).toMatchObject({ id: active.id, title: "Renamed TUI" })
        expect(TuiHost.status()).toMatchObject({ cols: 120, rows: 40, title: "Renamed TUI" })

        const remove = await app.request(`/${active.id}`, { method: "DELETE" })
        expect(remove.status).toBe(200)
        expect(await remove.json()).toBe(true)
        expect(await (await app.request("/")).json()).toEqual([])
      },
    })
  })

  test("streams PTY input and output through the OpenCode connect route", async () => {
    await using tmp = await tmpdir()
    let id = ""
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await TuiHost.startPrepared({ command: inputEchoCommand(tmp.path), cols: 80, rows: 24 })
        id = TuiHost.status().id!
      },
    })
    const listener = Server.listen({ hostname: "127.0.0.1", port: 0, randomPort: true })
    try {
      const url = new URL(`/pty/${id}/connect?directory=${encodeURIComponent(tmp.path)}&cursor=-1`, listener.url)
      url.protocol = "ws:"
      const ws = await openSocket(url)
      const message = waitForSocketMessage(ws, (value) => value.includes("route-pty-websocket"))
      ws.send("route-pty-websocket\r\n")
      expect(await message).toContain("route-pty-websocket")
      ws.close(1000)
    } finally {
      await listener.stop(true)
      await Instance.disposeAll()
    }
  })
})
