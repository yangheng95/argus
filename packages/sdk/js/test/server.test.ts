import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createOpenCorvusServer } from "../src/server"

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isPidAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ESRCH") return false
    if (code === "EPERM") return true
    throw error
  }
}

async function waitForPidFile(file: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      return Number(readFileSync(file, "utf8"))
    }
    await delay(10)
  }
  throw new Error(`Timed out waiting for pid file: ${file}`)
}

async function waitForPidExit(pid: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true
    await delay(20)
  }
  return !isPidAlive(pid)
}

async function killIfAlive(pid: number | undefined) {
  if (pid === undefined || !isPidAlive(pid)) return
  process.kill(pid)
  await waitForPidExit(pid, 2_000)
}

async function removeTempDir(dir: string) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== "EBUSY" && code !== "ENOTEMPTY") throw error
      await delay(50)
    }
  }
  rmSync(dir, { recursive: true, force: true })
}

describe("createOpenCorvusServer", () => {
  test(
    "terminates the spawned process when startup times out",
    async () => {
      const tempDir = mkdtempSync(path.join(tmpdir(), "opencorvus-sdk-server-"))
      const pidFile = path.join(tempDir, "fake-server.pid")
      const previousCwd = process.cwd()
      const previousBinPath = process.env.OPENCORVUS_BIN_PATH
      const previousPidFile = process.env.OPENCORVUS_FAKE_PID_FILE
      let pid: number | undefined

      writeFileSync(
        path.join(tempDir, "serve"),
        [
          'const fs = require("node:fs")',
          "fs.writeFileSync(process.env.OPENCORVUS_FAKE_PID_FILE, String(process.pid))",
          "setInterval(() => {}, 10_000)",
          "",
        ].join("\n"),
      )

      process.chdir(tempDir)
      process.env.OPENCORVUS_BIN_PATH = "node"
      process.env.OPENCORVUS_FAKE_PID_FILE = pidFile

      try {
        const startup = createOpenCorvusServer({ timeout: 300, port: 0 })
        pid = await waitForPidFile(pidFile, 2_000)

        await expect(startup).rejects.toThrow("Timeout waiting for server to start after 300ms")
        expect(await waitForPidExit(pid, 2_000)).toBe(true)
      } finally {
        await killIfAlive(pid)
        process.chdir(previousCwd)
        if (previousBinPath === undefined) delete process.env.OPENCORVUS_BIN_PATH
        else process.env.OPENCORVUS_BIN_PATH = previousBinPath
        if (previousPidFile === undefined) delete process.env.OPENCORVUS_FAKE_PID_FILE
        else process.env.OPENCORVUS_FAKE_PID_FILE = previousPidFile
        await removeTempDir(tempDir)
      }
    },
    { timeout: 10_000 },
  )
})
