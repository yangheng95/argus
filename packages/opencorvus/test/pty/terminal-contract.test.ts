import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Pty } from "../../src/pty"
import { TerminalProfile } from "../../src/pty/profile"
import { tmpdir } from "../fixture/fixture"

function terminalConfig(args = ["-e", "process.stdin.on('data', c => process.stdout.write('ECHO:' + c.toString()))"]) {
  return {
    terminal: {
      default_profile_id: "test",
      profiles: {
        test: {
          label: "Test terminal",
          command: process.execPath,
          args,
          env: { TERM: "xterm-256color" },
        },
        second: {
          label: "Second terminal",
          command: process.execPath,
          args,
          env: { TERM: "xterm-256color" },
        },
      },
    },
  }
}

function createInput(cwd: string): Pty.CreateInput {
  return {
    profileID: "test",
    cwd,
    cols: 80,
    rows: 24,
    title: "contract",
  }
}

function socket() {
  const sent: Pty.ServerMessage[] = []
  const closed: Array<{ code?: number; reason?: string }> = []
  return {
    sent,
    closed,
    raw: {
      readyState: 1,
      data: {},
      send(data: string | Uint8Array | ArrayBuffer) {
        const text = typeof data === "string" ? data : Buffer.from(data).toString("utf8")
        sent.push(JSON.parse(text) as Pty.ServerMessage)
      },
      close(code?: number, reason?: string) {
        closed.push({ code, reason })
      },
    },
  }
}

async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 40; i++) {
    if (predicate()) return
    await Bun.sleep(50)
  }
  expect(predicate()).toBe(true)
}

describe("pty terminal contract", () => {
  test("lists configured terminal profiles with the configured default", async () => {
    await using dir = await tmpdir({ git: true, config: terminalConfig() })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const profiles = await TerminalProfile.list()

        expect(profiles.defaultProfileID).toBe("test")
        expect(profiles.profiles).toContainEqual({ id: "test", label: "Test terminal", icon: "terminal" })
        expect(profiles.profiles).toContainEqual({ id: "second", label: "Second terminal", icon: "terminal" })
        expect(profiles.profiles.every((profile) => typeof profile.icon === "string")).toBe(true)
      },
    })
  })

  test("create requires configured terminal profile", async () => {
    await using dir = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        await expect(Pty.create(createInput(dir.path))).rejects.toBeInstanceOf(TerminalProfile.ConfigError)
      },
    })
  })

  test("list rejects a default profile that is not explicitly configured", async () => {
    await using unknownDefault = await tmpdir({
      git: true,
      config: {
        terminal: {
          default_profile_id: "missing",
          profiles: {
            test: {
              label: "Test terminal",
              command: process.execPath,
              args: [],
              env: { TERM: "xterm-256color" },
            },
          },
        },
      },
    })

    await Instance.provide({
      directory: unknownDefault.path,
      fn: async () => {
        await expect(TerminalProfile.list()).rejects.toBeInstanceOf(TerminalProfile.ConfigError)
      },
    })
  })

  test("create rejects unknown profile and cwd outside project", async () => {
    await using dir = await tmpdir({ git: true, config: terminalConfig() })
    await using outside = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        await expect(Pty.create({ ...createInput(dir.path), profileID: "missing" })).rejects.toBeInstanceOf(
          TerminalProfile.ConfigError,
        )
        await expect(Pty.create({ ...createInput(outside.path) })).rejects.toBeInstanceOf(TerminalProfile.ConfigError)
      },
    })
  })

  test("typed websocket receives ready, sends input, and replays retained output by cursor", async () => {
    await using dir = await tmpdir({ git: true, config: terminalConfig() })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const session = await Pty.create(createInput(dir.path))
        try {
          const first = socket()
          const handler = Pty.connect(session.id, first.raw)
          expect(first.sent[0]?.type).toBe("ready")

          handler?.onMessage(JSON.stringify({ type: "input", data: "abc\r" }))
          await waitFor(() => first.sent.some((event) => event.type === "output" && event.data.includes("ECHO:abc")))

          const lastOutput = first.sent.findLast((event) => event.type === "output")
          expect(lastOutput?.type).toBe("output")
          handler?.onClose()

          const second = socket()
          Pty.connect(session.id, second.raw, 0)
          expect(second.sent[0]?.type).toBe("ready")
          expect(second.sent.some((event) => event.type === "output" && event.data.includes("ECHO:abc"))).toBe(true)
          expect(second.sent.findLast((event) => event.type === "output")?.cursor).toBe(lastOutput?.cursor)
        } finally {
          await Pty.remove(session.id)
        }
      },
    })
  })

  test("malformed websocket message is a protocol close", async () => {
    await using dir = await tmpdir({ git: true, config: terminalConfig() })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const session = await Pty.create(createInput(dir.path))
        try {
          const ws = socket()
          const handler = Pty.connect(session.id, ws.raw)
          handler?.onMessage("not-json")

          expect(ws.sent.some((event) => event.type === "error")).toBe(true)
          expect(ws.closed[0]?.code).toBe(1002)
        } finally {
          await Pty.remove(session.id)
        }
      },
    })
  })
})
