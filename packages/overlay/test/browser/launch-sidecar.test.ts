import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { launchBrowser } from "../launch.ts"

test("launchBrowser terminates the sidecar when browser launch fails", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const tempDir = mkdtempSync(join(tmpdir(), "opencorvus-overlay-launch-fail-"))
  const hookPath = join(tempDir, "record-sidecar-pid.cjs")
  const pidPath = join(tempDir, "sidecar.pid")
  const previousBrowserExecutable = process.env.OPENCORVUS_BROWSER_EXECUTABLE
  const previousNodeOptions = process.env.NODE_OPTIONS
  const previousPidPath = process.env.OPENCORVUS_BROWSER_SIDECAR_PID_FILE
  try {
    writeFileSync(
      hookPath,
      [
        'const fs = require("node:fs");',
        "const file = process.env.OPENCORVUS_BROWSER_SIDECAR_PID_FILE;",
        "if (file) fs.writeFileSync(file, String(process.pid));",
      ].join("\n"),
    )
    process.env.OPENCORVUS_BROWSER_EXECUTABLE = join(tempDir, "missing-browser-executable")
    process.env.OPENCORVUS_BROWSER_SIDECAR_PID_FILE = pidPath
    process.env.NODE_OPTIONS = [previousNodeOptions, `--require=${hookPath.replace(/\\/g, "/")}`]
      .filter(Boolean)
      .join(" ")

    await assert.rejects(() => launchBrowser())

    assert.equal(existsSync(pidPath), true)
    const sidecarPid = Number(readFileSync(pidPath, "utf8"))
    assert.equal(Number.isSafeInteger(sidecarPid), true)
    assert.equal(await waitForProcessExit(sidecarPid), true)
  } finally {
    if (previousBrowserExecutable === undefined) delete process.env.OPENCORVUS_BROWSER_EXECUTABLE
    else process.env.OPENCORVUS_BROWSER_EXECUTABLE = previousBrowserExecutable
    if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS
    else process.env.NODE_OPTIONS = previousNodeOptions
    if (previousPidPath === undefined) delete process.env.OPENCORVUS_BROWSER_SIDECAR_PID_FILE
    else process.env.OPENCORVUS_BROWSER_SIDECAR_PID_FILE = previousPidPath
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test("launchBrowser sidecar cleanup uses process-tree ownership", () => {
  const launcher = readFileSync(new URL("../launch.ts", import.meta.url), "utf8")

  expectSource(launcher, 'detached: process.platform !== "win32"')
  expectSource(launcher, 'if (process.platform === "win32") {\\n    await killWindowsProcessTree(pid)\\n    return\\n  }')
  expectSource(launcher, "await waitForBrowserSidecarTreeExit(child, this.exitTask, BROWSER_RPC_TERMINATE_GRACE_MS)")
  expectSource(launcher, "browserSidecarProcessGroupIsRunning(pid)")
  expectSource(launcher, 'this.refreshPendingRpcTimers("stdout")\\n    this.buffer += chunk')
  assert.equal(launcher.includes('if (signal === "SIGKILL") await killWindowsProcessTree(pid)'), false)
  assert.equal(launcher.includes("else child.kill(signal)"), false)
  assert.equal(launcher.includes("Promise.race([this.exitTask, delay(BROWSER_RPC_TERMINATE_GRACE_MS)]"), false)
})

function expectSource(source: string, expected: string): void {
  assert.equal(source.includes(expected.replace(/\\n/g, "\n")), true)
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

async function waitForProcessExit(pid: number): Promise<boolean> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!processExists(pid)) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return !processExists(pid)
}
