import { afterEach, describe, expect, test } from "bun:test"
import path from "node:path"
import { Tui } from "../../src/tui"
import { TuiHost } from "../../src/tui/host"
import { Bus } from "../../src/bus"
import { Pty } from "../../src/pty"
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
      directory: cwd,
      url: "",
      port: 0,
      hostname: "",
    }
  }
  return {
    command: "sh",
    args: ["-c", 'read line; printf "%s" "$line"; sleep 30'],
    cwd,
    directory: cwd,
    url: "",
    port: 0,
    hostname: "",
  }
}

function exitCommand(cwd: string): Tui.EmbeddedCommand {
  if (process.platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "echo pty-exit"],
      cwd,
      directory: cwd,
      url: "",
      port: 0,
      hostname: "",
    }
  }
  return {
    command: "sh",
    args: ["-lc", "printf pty-exit"],
    cwd,
    directory: cwd,
    url: "",
    port: 0,
    hostname: "",
  }
}

function ptyCreateBody(command: Tui.EmbeddedCommand, title: string) {
  return JSON.stringify({
    command: command.command,
    args: command.args,
    cwd: command.cwd,
    title,
  })
}

async function waitForCheck(check: () => Promise<boolean>, message: string) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (await check()) return
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

  test("accepts an explicit embedded TUI agent in the PTY create contract", () => {
    expect(Pty.CreateInput.parse({ title: "OpenCorvus TUI", agent: "tui-coding" })).toMatchObject({
      title: "OpenCorvus TUI",
      agent: "tui-coding",
    })
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

        const first = await app.request("/", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: ptyCreateBody(inputEchoCommand(tmp.path), "Initial TUI"),
        })
        expect(first.status).toBe(200)
        const active = (await first.json()) as { id: string; title: string; command: string; args: string[]; cwd: string; status: string; pid: number }
        expect(active.id).toBeString()

        const second = await app.request("/", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: ptyCreateBody(inputEchoCommand(tmp.path), "Second TUI"),
        })
        expect(second.status).toBe(200)
        const secondActive = (await second.json()) as { id: string; title: string }
        expect(secondActive.id).not.toBe(active.id)

        const list = (await (await app.request("/")).json()) as Array<{ id: string; title: string }>
        expect(list.map((item) => item.title)).toEqual(["Initial TUI", "Second TUI"])

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
        expect(TuiHost.get(active.id)).toMatchObject({ cols: 120, rows: 40, title: "Renamed TUI" })
        expect(TuiHost.get(secondActive.id)).toMatchObject({ title: "Second TUI" })

        const remove = await app.request(`/${active.id}`, { method: "DELETE" })
        expect(remove.status).toBe(200)
        expect(await remove.json()).toBe(true)
        expect(((await (await app.request("/")).json()) as Array<{ id: string }>).map((item) => item.id)).toEqual([secondActive.id])

        const removeSecond = await app.request(`/${secondActive.id}`, { method: "DELETE" })
        expect(removeSecond.status).toBe(200)
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

  test("removes exited PTY sessions from the public list", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = PtyRoutes()
        const create = await app.request("/", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: ptyCreateBody(exitCommand(tmp.path), "Short TUI"),
        })
        expect(create.status).toBe(200)
        await waitForCheck(
          async () => ((await (await app.request("/")).json()) as unknown[]).length === 0,
          "exited PTY session remained in /pty list",
        )
      },
    })
  })

  test("closes stale PTY connects with a not found reason", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const closed: Array<{ code?: number; reason?: string }> = []
        const handler = Pty.connect("pty_missing_stale", {
          send: () => {
            throw new Error("stale PTY connection should not send output")
          },
          close: (code, reason) => {
            closed.push({ code, reason })
          },
        })
        expect(closed).toEqual([{ code: 4404, reason: "PTY session not found" }])
        handler.onMessage("ignored")
        handler.onClose()
      },
    })
  })

  test("publishes OpenCode-style PTY lifecycle events", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = PtyRoutes()
        const events: string[] = []
        const unsubs = [
          Bus.subscribe(Pty.Event.Created, (event) => events.push(`${event.type}:${event.properties.info.title}`)),
          Bus.subscribe(Pty.Event.Updated, (event) => events.push(`${event.type}:${event.properties.info.title}`)),
          Bus.subscribe(Pty.Event.Deleted, (event) => events.push(`${event.type}:${event.properties.id}`)),
          Bus.subscribe(Pty.Event.Exited, (event) => events.push(`${event.type}:${event.properties.id}:${event.properties.exitCode}`)),
        ]
        try {
          const create = await app.request("/", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: ptyCreateBody(inputEchoCommand(tmp.path), "Event TUI"),
          })
          expect(create.status).toBe(200)
          const active = (await create.json()) as { id: string }
          expect(events).toContain("pty.created:Event TUI")

          const update = await app.request(`/${active.id}`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: "Event TUI Renamed" }),
          })
          expect(update.status).toBe(200)
          expect(events).toContain("pty.updated:Event TUI Renamed")

          const remove = await app.request(`/${active.id}`, { method: "DELETE" })
          expect(remove.status).toBe(200)
          expect(events).toContain(`pty.deleted:${active.id}`)

          const exiting = await app.request("/", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: ptyCreateBody(exitCommand(tmp.path), "Event Exit TUI"),
          })
          expect(exiting.status).toBe(200)
          const exitingInfo = (await exiting.json()) as { id: string }
          await waitForCheck(
            async () => events.some((event) => event === `pty.exited:${exitingInfo.id}:0`),
            "natural PTY exit event was not published",
          )
        } finally {
          for (const unsub of unsubs) unsub()
        }
      },
    })
  }, 15_000)
})
