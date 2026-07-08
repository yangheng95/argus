import { afterEach, describe, expect, test, beforeEach } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { LSP } from "../../src/lsp"
import { LSPClient } from "../../src/lsp/client"
import { LSPServer } from "../../src/lsp/server"
import { Instance } from "../../src/project/instance"
import { ProcessSupervisor } from "../../src/shell/process-supervisor"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { expectNoProcessErrors } from "../fixture/process-errors"

// Minimal fake LSP server that speaks JSON-RPC over stdio
function spawnFakeServer() {
  const { spawn } = require("child_process")
  const serverPath = path.join(__dirname, "../fixture/lsp/fake-lsp-server.js")
  return {
    process: spawn(process.execPath, [serverPath], {
      stdio: "pipe",
    }),
  }
}

function spawnHangingShutdownServer() {
  const { spawn } = require("child_process")
  const serverPath = path.join(__dirname, "../fixture/lsp/hanging-shutdown-lsp-server.js")
  return {
    process: spawn(process.execPath, [serverPath], {
      stdio: "pipe",
    }),
  }
}

function spawnSupervisorStyleFakeServer(): ProcessSupervisor.Handle & { disposeCalls: () => number } {
  const { spawn } = require("child_process")
  const serverPath = path.join(__dirname, "../fixture/lsp/fake-lsp-server.js")
  const child = spawn(process.execPath, [serverPath], {
    stdio: "pipe",
  })
  if (!child.pid || !child.stdin || !child.stdout || !child.stderr) {
    throw new Error("fake LSP child did not expose stdio")
  }
  const exited = new Promise<number>((resolve, reject) => {
    child.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      resolve(code ?? (signal ? 1 : 0))
    })
    child.once("error", reject)
  })
  const terminate = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill()
    await Promise.race([exited.catch(() => undefined), Bun.sleep(1_000)])
  }
  let disposeCalls = 0
  let disposed = false
  return {
    pid: child.pid,
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    exited,
    terminate,
    async dispose() {
      if (disposed) return
      disposed = true
      disposeCalls++
      await terminate()
    },
    unref() {
      child.unref?.()
    },
    disposeCalls: () => disposeCalls,
  }
}

async function waitForFile(filepath: string, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const exists = await fs
      .stat(filepath)
      .then(() => true)
      .catch(() => false)
    if (exists) return true
    await Bun.sleep(20)
  }
  return false
}

describe("LSPClient interop", () => {
  beforeEach(async () => {
    await Log.init({ print: true })
  })

  afterEach(async () => {
    await Instance.disposeAll()
  })

  test("built-in server listing excludes namespace helper functions", () => {
    const servers = LSPServer.builtInServers()

    expect(servers.length).toBeGreaterThan(0)
    expect(servers.map((server) => server.id)).toContain("typescript")
    expect(servers.every((server) => typeof server.id === "string")).toBe(true)
    expect(servers.every((server) => typeof server.root === "function")).toBe(true)
    expect(servers.every((server) => typeof server.spawn === "function")).toBe(true)
    expect(servers).not.toContain(LSPServer.spawnStdio)
  })

  test("handles workspace/workspaceFolders request", async () => {
    const handle = spawnFakeServer() as any

    const client = await Instance.provide({
      directory: process.cwd(),
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: process.cwd(),
        }),
    })

    await client.connection.sendNotification("test/trigger", {
      method: "workspace/workspaceFolders",
    })

    await new Promise((r) => setTimeout(r, 100))

    expect(client.connection).toBeDefined()

    await client.shutdown()
  }, 15_000)

  test("handles client/registerCapability request", async () => {
    const handle = spawnFakeServer() as any

    const client = await Instance.provide({
      directory: process.cwd(),
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: process.cwd(),
        }),
    })

    await client.connection.sendNotification("test/trigger", {
      method: "client/registerCapability",
    })

    await new Promise((r) => setTimeout(r, 100))

    expect(client.connection).toBeDefined()

    await client.shutdown()
  }, 15_000)

  test("handles client/unregisterCapability request", async () => {
    const handle = spawnFakeServer() as any

    const client = await Instance.provide({
      directory: process.cwd(),
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: process.cwd(),
        }),
    })

    await client.connection.sendNotification("test/trigger", {
      method: "client/unregisterCapability",
    })

    await new Promise((r) => setTimeout(r, 100))

    expect(client.connection).toBeDefined()

    await client.shutdown()
  }, 15_000)

  test("shutdown uses server dispose hook when provided", async () => {
    const handle = spawnFakeServer() as any
    const originalKill = handle.process.kill.bind(handle.process)
    let disposeCalls = 0
    let directKillCalls = 0

    handle.dispose = async () => {
      disposeCalls++
      originalKill()
    }
    handle.process.kill = () => {
      directKillCalls++
      return true
    }

    const client = await Instance.provide({
      directory: process.cwd(),
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: process.cwd(),
        }),
    })

    await client.shutdown()

    expect(disposeCalls).toBe(1)
    expect(directKillCalls).toBe(0)
  }, 15_000)

  test("shutdown observes pending JSON-RPC rejection after connection dispose", async () => {
    const handle = spawnHangingShutdownServer() as any
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason)
    }
    process.on("unhandledRejection", onUnhandled)
    try {
      const client = await Instance.provide({
        directory: process.cwd(),
        fn: () =>
          LSPClient.create({
            serverID: "hanging-shutdown",
            server: handle as unknown as LSPServer.Handle,
            root: process.cwd(),
          }),
      })

      await client.shutdown()
      await Bun.sleep(50)

      expect(unhandled).toHaveLength(0)
    } finally {
      process.off("unhandledRejection", onUnhandled)
      handle.process.kill()
    }
  }, 15_000)

  test("server process error after initialize is observed by the client", async () => {
    const handle = spawnFakeServer() as any
    const client = await Instance.provide({
      directory: process.cwd(),
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: process.cwd(),
        }),
    })

    try {
      await expectNoProcessErrors(async () => {
        handle.process.emit("error", new Error("post-init lsp process error"))
      })
    } finally {
      await client.shutdown()
    }
  }, 15_000)

  test("typescript client initializes when the server uses a supervised stdio handle", async () => {
    const supervisorHandles: Array<ProcessSupervisor.Handle & { disposeCalls: () => number }> = []
    const restoreSupervisor = ProcessSupervisor.setFactoryForTest(async () => {
      const handle = spawnSupervisorStyleFakeServer()
      supervisorHandles.push(handle)
      return handle
    })
    try {
      await Instance.provide({
        directory: process.cwd(),
        fn: async () => {
          const server = await LSPServer.Typescript.spawn(process.cwd())
          expect(server).toBeDefined()

          const client = await LSPClient.create({
            serverID: "typescript",
            server: server!,
            root: process.cwd(),
          })

          expect(client.connection).toBeDefined()
          expect(supervisorHandles[0]?.disposeCalls()).toBe(0)
          await client.shutdown()
          expect(supervisorHandles[0]?.disposeCalls()).toBe(1)
        },
      })
    } finally {
      restoreSupervisor()
      await Promise.all(supervisorHandles.map((handle) => handle.dispose()))
    }
  }, 15_000)

  test("instance dispose closes LSP server that is still initializing", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await fs.writeFile(
          path.join(dir, "opencorvus.json"),
          JSON.stringify({
            $schema: "https://opencorvus.ai/config.json",
            lsp: {
              slow: {
                command: [
                  process.execPath,
                  path.join(__dirname, "../fixture/lsp/slow-lsp-server.js"),
                  path.join(dir, "lsp-started.tmp"),
                  path.join(dir, "lsp-closed.tmp"),
                  "250",
                ],
                extensions: [".race"],
              },
            },
          }),
          "utf8",
        )
        await fs.writeFile(path.join(dir, "file.race"), "x\n", "utf8")
      },
    })

    const started = path.join(tmp.path, "lsp-started.tmp")
    const closed = path.join(tmp.path, "lsp-closed.tmp")
    const file = path.join(tmp.path, "file.race")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const touch = LSP.touchFile(file, false)
        expect(await waitForFile(started)).toBe(true)

        await Instance.dispose()
        await touch.catch(() => undefined)

        expect(await waitForFile(closed, 1000)).toBe(true)
      },
    })
  }, 15_000)

  test("idle LSP clients are disposed before a replacement is started", async () => {
    const restore = LSP.setRetentionForTest({ clientIdleTtlMs: 1 })
    try {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await fs.writeFile(
            path.join(dir, "opencorvus.json"),
            JSON.stringify({
              $schema: "https://opencorvus.ai/config.json",
              lsp: {
                slow: {
                  command: [
                    process.execPath,
                    path.join(__dirname, "../fixture/lsp/slow-lsp-server.js"),
                    path.join(dir, "lsp-started.tmp"),
                    path.join(dir, "lsp-closed.tmp"),
                    "0",
                  ],
                  extensions: [".idle"],
                },
              },
            }),
            "utf8",
          )
          await fs.writeFile(path.join(dir, "file.idle"), "x\n", "utf8")
        },
      })

      const started = path.join(tmp.path, "lsp-started.tmp")
      const closed = path.join(tmp.path, "lsp-closed.tmp")
      const file = path.join(tmp.path, "file.idle")

      try {
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            await LSP.touchFile(file, false)
            expect(await waitForFile(started)).toBe(true)

            await Bun.sleep(20)
            await LSP.touchFile(file, false)

            expect(await waitForFile(closed, 1000)).toBe(true)
            const status = await LSP.status()
            expect(status.filter((item) => item.id === "slow" && item.status === "connected")).toHaveLength(1)
          },
        })
      } finally {
        await Instance.disposeAll()
      }
    } finally {
      restore()
    }
  }, 15_000)

  test("broken LSP server entries expire and allow a later retry", async () => {
    const restore = LSP.setRetentionForTest({ brokenTtlMs: 10_000 })
    try {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          const attempts = path.join(dir, "lsp-attempts.tmp")
          await fs.writeFile(
            path.join(dir, "opencorvus.json"),
            JSON.stringify({
              $schema: "https://opencorvus.ai/config.json",
              lsp: {
                broken: {
                  command: [
                    process.execPath,
                    "-e",
                    "require('node:fs').appendFileSync(process.argv[1], 'x'); process.exit(1)",
                    attempts,
                  ],
                  extensions: [".badlsp"],
                },
              },
            }),
            "utf8",
          )
          await fs.writeFile(path.join(dir, "file.badlsp"), "x\n", "utf8")
        },
      })

      const attempts = path.join(tmp.path, "lsp-attempts.tmp")
      const file = path.join(tmp.path, "file.badlsp")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await LSP.touchFile(file, false)
          expect(await fs.readFile(attempts, "utf8")).toBe("x")

          await LSP.touchFile(file, false)
          expect(await fs.readFile(attempts, "utf8")).toBe("x")

          const restoreShortTtl = LSP.setRetentionForTest({ brokenTtlMs: 1 })
          try {
            await Bun.sleep(20)
            await LSP.touchFile(file, false)
          } finally {
            restoreShortTtl()
          }

          expect(await fs.readFile(attempts, "utf8")).toBe("xx")
        },
      })
    } finally {
      restore()
    }
  }, 15_000)
})
