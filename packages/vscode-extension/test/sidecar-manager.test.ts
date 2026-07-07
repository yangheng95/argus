import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { startSidecar } from "../src/sidecar/manager"

const fakeSidecar = path.resolve(import.meta.dir, "fixtures", "fake-sidecar.mjs")
const envKeys = ["FAKE_SIDECAR_EVENTS_FILE", "FAKE_SIDECAR_NEVER_HANDSHAKE", "FAKE_SIDECAR_IGNORE_SHUTDOWN"] as const
const previousEnv = new Map<string, string | undefined>()

for (const key of envKeys) previousEnv.set(key, process.env[key])

afterEach(() => {
  for (const key of envKeys) {
    const previous = previousEnv.get(key)
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
  }
})

describe("startSidecar", () => {
  test("terminates the pre-handshake sidecar process on handshake inactivity", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "oc-vscode-sidecar-timeout-"))
    const launcher = await createSidecarLauncher(root)
    const eventsFile = path.join(root, "events.ndjson")
    process.env.FAKE_SIDECAR_EVENTS_FILE = eventsFile
    process.env.FAKE_SIDECAR_NEVER_HANDSHAKE = "1"

    try {
      await expect(
        startSidecar({
          binary: { target: "test", binaryPath: launcher },
          workspace: root,
          handshakeIdleMs: 40,
        }),
      ).rejects.toThrow(/did not emit OPENCORVUS_LISTEN=/)

      const events = await waitForEvents(eventsFile)
      const start = events.find((event) => event.type === "start")
      expect(typeof start?.pid).toBe("number")
      await waitForProcessExit(start!.pid as number)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 8_000)

  test("terminates the post-handshake sidecar process tree when shutdown does not exit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "oc-vscode-sidecar-stop-"))
    const launcher = await createSidecarLauncher(root)
    const eventsFile = path.join(root, "events.ndjson")
    process.env.FAKE_SIDECAR_EVENTS_FILE = eventsFile
    process.env.FAKE_SIDECAR_IGNORE_SHUTDOWN = "1"

    try {
      const handle = await startSidecar({
        binary: { target: "test", binaryPath: launcher },
        workspace: root,
        handshakeIdleMs: 1_000,
      })

      await handle.stop({ graceTimeoutMs: 40 })

      await waitForProcessExit(handle.pid)
      const events = await waitForEvents(eventsFile)
      expect(events.some((event) => event.type === "shutdown")).toBe(true)
      if (process.platform !== "win32") {
        expect(events.some((event) => event.type === "signal" && event.signal === "SIGTERM")).toBe(true)
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 8_000)
})

async function createSidecarLauncher(root: string): Promise<string> {
  await writeFile(
    path.join(root, "sidecar"),
    `import(${JSON.stringify(pathToFileURL(fakeSidecar).href)}).catch((error) => { console.error(error); process.exit(1) })\n`,
  )
  return Bun.which("node") ?? "node"
}

async function waitForEvents(file: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const lines = (await readFile(file, "utf8")).split(/\r?\n/).filter(Boolean)
      if (lines.length > 0) return lines.map((line) => JSON.parse(line) as Record<string, unknown>)
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
    await Bun.sleep(20)
  }
  throw new Error("timed out waiting for sidecar events")
}

async function waitForProcessExit(pid: number) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (!processAlive(pid)) return
    await Bun.sleep(20)
  }
  throw new Error(`sidecar process ${pid} was still alive after startup timeout cleanup`)
}

function processAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as NodeJS.ErrnoException).code) : ""
    return code !== "ESRCH"
  }
}

function isNotFound(error: unknown) {
  return error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"
}
