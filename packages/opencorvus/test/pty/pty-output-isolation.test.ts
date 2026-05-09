import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Pty } from "../../src/pty"
import { tmpdir } from "../fixture/fixture"

function terminalConfig() {
  return {
    terminal: {
      default_profile_id: "test",
      profiles: {
        test: {
          label: "Test terminal",
          command: process.execPath,
          args: ["-e", "process.stdin.on('data', c => process.stdout.write(c.toString()))"],
          env: { TERM: "xterm-256color" },
        },
      },
    },
  }
}

function createInput(cwd: string, title: string): Pty.CreateInput {
  return {
    profileID: "test",
    cwd,
    cols: 80,
    rows: 24,
    title,
  }
}

describe("pty", () => {
  test("does not leak output when websocket objects are reused", async () => {
    await using dir = await tmpdir({ git: true, config: terminalConfig() })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const a = await Pty.create(createInput(dir.path, "a"))
        const b = await Pty.create(createInput(dir.path, "b"))
        try {
          const outA: string[] = []
          const outB: string[] = []

          const ws = {
            readyState: 1,
            data: { events: { connection: "a" } },
            send: (data: unknown) => {
              outA.push(typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8"))
            },
            close: () => {
              // no-op (simulate abrupt drop)
            },
          }

          // Connect "a" first with ws.
          Pty.connect(a.id, ws as any)

          // Now "reuse" the same ws object for another connection.
          ws.data = { events: { connection: "b" } }
          ws.send = (data: unknown) => {
            outB.push(typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8"))
          }
          Pty.connect(b.id, ws as any)

          // Clear connect metadata writes.
          outA.length = 0
          outB.length = 0

          // Output from a must never show up in b.
          Pty.write(a.id, "AAA\n")
          await Bun.sleep(100)

          expect(outB.join("")).not.toContain("AAA")
        } finally {
          await Pty.remove(a.id)
          await Pty.remove(b.id)
        }
      },
    })
  })

  test("does not leak output when Bun recycles websocket objects before re-connect", async () => {
    await using dir = await tmpdir({ git: true, config: terminalConfig() })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const a = await Pty.create(createInput(dir.path, "a"))
        try {
          const outA: string[] = []
          const outB: string[] = []

          const ws = {
            readyState: 1,
            data: { events: { connection: "a" } },
            send: (data: unknown) => {
              outA.push(typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8"))
            },
            close: () => {
              // no-op (simulate abrupt drop)
            },
          }

          // Connect "a" first.
          Pty.connect(a.id, ws as any)
          outA.length = 0

          // Simulate Bun reusing the same websocket object for another
          // connection before the next onOpen calls Pty.connect.
          ws.data = { events: { connection: "b" } }
          ws.send = (data: unknown) => {
            outB.push(typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8"))
          }

          Pty.write(a.id, "AAA\n")
          await Bun.sleep(100)

          expect(outB.join("")).not.toContain("AAA")
        } finally {
          await Pty.remove(a.id)
        }
      },
    })
  })

  test("treats in-place socket data mutation as the same connection", async () => {
    await using dir = await tmpdir({ git: true, config: terminalConfig() })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const a = await Pty.create(createInput(dir.path, "a"))
        try {
          const out: string[] = []

          const ctx = { connId: 1 }
          const ws = {
            readyState: 1,
            data: ctx,
            send: (data: unknown) => {
              out.push(typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8"))
            },
            close: () => {
              // no-op
            },
          }

          Pty.connect(a.id, ws as any)
          out.length = 0

          // Mutating fields on ws.data should not look like a new
          // connection lifecycle when the object identity stays stable.
          ctx.connId = 2

          Pty.write(a.id, "AAA\n")
          await Bun.sleep(50)
          await Array.from({ length: 9 }).reduce(async (pending) => {
            await pending
            if (out.join("").includes("AAA")) return
            await Bun.sleep(50)
          }, Promise.resolve())

          expect(out.join("")).toContain("AAA")
        } finally {
          await Pty.remove(a.id)
        }
      },
    })
  })

  test("does not leak output when socket data changes between primitive values", async () => {
    await using dir = await tmpdir({ git: true, config: terminalConfig() })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const a = await Pty.create(createInput(dir.path, "a"))
        try {
          const outA: string[] = []
          const outB: string[] = []

          const ws = {
            readyState: 1,
            data: "a",
            send: (data: unknown) => {
              outA.push(typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8"))
            },
            close: () => {
              // no-op
            },
          }

          Pty.connect(a.id, ws as any)
          outA.length = 0

          ws.data = "b"
          ws.send = (data: unknown) => {
            outB.push(typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8"))
          }

          Pty.write(a.id, "AAA\n")
          await Bun.sleep(100)

          expect(outB.join("")).not.toContain("AAA")
        } finally {
          await Pty.remove(a.id)
        }
      },
    })
  })
})
