import { afterEach, describe, expect, test, beforeEach } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { LSP } from "../../src/lsp"
import { LSPClient } from "../../src/lsp/client"
import { LSPServer } from "../../src/lsp/server"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

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
