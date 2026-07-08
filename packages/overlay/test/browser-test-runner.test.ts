import { expect, test } from "bun:test"
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..")
const RUNNER = path.join(ROOT, "test", "browser-runner.mjs")

function readText(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8")
}

function filesIn(rel: string, predicate: (name: string) => boolean): string[] {
  return readdirSync(path.join(ROOT, rel))
    .filter(predicate)
    .map((name) => path.posix.join(rel.replaceAll("\\", "/"), name))
    .sort()
}

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

function killProcess(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) return
  if (!processAlive(pid)) return
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
    return
  }
  try {
    process.kill(pid, "SIGKILL")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
  }
}

async function waitForDead(pid: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!processAlive(pid)) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`process ${pid} is still alive`)
}

async function runBrowserRunner(fixture: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn("node", [RUNNER, fixture], {
      cwd: ROOT,
      env: {
        ...process.env,
        OPENCORVUS_OVERLAY_BROWSER_RUNNER_IDLE_MS: "1000",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      killProcess(child.pid ?? 0)
      reject(new Error("browser runner fixture did not exit"))
    }, 15_000)
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk)
    })
    child.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once("close", (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

test("overlay browser tests have a Node-owned Playwright runner", () => {
  const pkg = JSON.parse(readText("package.json")) as { scripts: Record<string, string> }
  const runner = readText("test/browser-runner.mjs")
  const smoke = readText("test/browser/node-playwright-smoke.test.mjs")
  const topLevelUnitTests = filesIn(
    "test",
    (name) => name.endsWith(".test.ts") && name !== "browser-test-runner.test.ts",
  )
  const browserTests = filesIn("test/browser", (name) => name.endsWith(".test.ts") || name.endsWith(".test.mjs"))

  expect(pkg).toMatchObject({ type: "module" })
  expect(pkg.scripts["test"]).toBe("bun run test:unit")
  expect(pkg.scripts["test:unit"]).toBe("bun test --timeout 120000 test/*.test.ts")
  expect(pkg.scripts["test:browser"]).toBe("node test/browser-runner.mjs")
  expect(pkg.scripts["test:unit"]).not.toContain("test/browser")
  expect(runner).toContain("process.execPath")
  expect(runner).toContain("process.argv.slice(2)")
  expect(runner).toContain("explicitFiles.length > 0")
  expect(runner).toContain("OPENCORVUS_OVERLAY_BROWSER_RUNNER_IDLE_MS")
  expect(runner).toContain("resetInactivityTimer")
  expect(runner).toContain("async function terminateChildTree")
  expect(runner).toContain("waitForChildClose")
  expect(runner).toContain("let childClosed = false")
  expect(runner).toContain('child.on("close"')
  expect(runner.indexOf("childClosed = true")).toBeLessThan(runner.indexOf("if (finished) return", runner.indexOf('child.on("close"')))
  expect(runner).toContain('resetInactivityTimer("root process exit")')
  expect(runner).not.toContain('child.on("exit", (code, signal) => {\r\n  if (finished) return\r\n  finished = true')
  expect(runner).toContain("collectWindowsDescendantPids")
  expect(runner).toContain("result.status !== 0 && !childClosed && descendantPids.length === 0")
  expect(runner).toContain("await terminateChildTree(child, lastActivity)")
  expect(runner).toContain("overlay browser test process cleanup failed")
  expect(runner).toContain('stdio: ["ignore", "pipe", "pipe"]')
  expect(runner).toContain("process.stdout.write(chunk)")
  expect(runner).toContain("process.stderr.write(chunk)")
  expect(runner).not.toContain('stdio: "inherit"')
  expect(runner).toContain('"--test"')
  expect(runner).toContain("--test-concurrency=1")
  expect(runner).toContain(".test.ts")
  expect(runner).toContain("OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER")
  expect(runner).not.toContain("--experimental-transform-types")
  expect(runner).not.toContain("bun test")
  expect(runner).not.toContain("bunx playwright")
  expect(runner).not.toContain("npx playwright")

  expect(smoke).toContain('import test from "node:test"')
  expect(smoke).toContain('require("playwright")')
  expect(smoke).toContain('typeof globalThis.Bun, "undefined"')
  expect(smoke).toContain("chromium.launch")

  for (const file of topLevelUnitTests) {
    const source = readText(file)
    expect(source, `${file} must not launch overlay browser automation from bun test`).not.toContain("launchBrowser(")
    expect(source, `${file} must not launch Playwright from bun test`).not.toContain("chromium.launch")
    expect(source, `${file} must not require Playwright from bun test`).not.toContain('require("playwright")')
    expect(source, `${file} must not import Playwright from bun test`).not.toContain('from "playwright"')
    expect(source, `${file} must not import Playwright from bun test`).not.toContain("from 'playwright'")
  }

  for (const file of browserTests) {
    const source = readText(file)
    expect(source, `${file} must run under node:test`).toContain('import test from "node:test"')
    expect(source, `${file} must assert the Node runner marker`).toContain(
      "OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER",
    )
    expect(source, `${file} must assert Bun is absent`).toContain('typeof globalThis.Bun, "undefined"')
    if (file === "test/browser/node-playwright-smoke.test.mjs") continue
    expect(source, `${file} must use the shared Node sidecar launcher`).toContain('from "../launch.ts"')
    expect(source, `${file} must not launch Playwright directly`).not.toContain("chromium.launch")
    expect(source, `${file} must not require Playwright directly`).not.toContain('require("playwright")')
    expect(source, `${file} must not import Playwright directly`).not.toContain('from "playwright"')
    expect(source, `${file} must not import Playwright directly`).not.toContain("from 'playwright'")
  }

  const dist = readText("test/overlay-dist.ts")
  expect(dist).toContain('from "node:child_process"')
  expect(dist).toContain("readFile(file)")
  expect(dist).not.toContain("Bun.spawn")
  expect(dist).not.toContain("Bun.file")
})

test(
  "overlay browser runner waits for close and cleans inherited-stdio descendants after root exit",
  { timeout: 20_000 },
  async () => {
    if (process.platform === "win32") return

    const root = mkdtempSync(path.join(tmpdir(), "opencorvus-overlay-runner-close-"))
    const fixture = path.join(root, "root-exit-descendant.test.mjs")
    const pidFile = path.join(root, "descendant.pid")
    let descendantPid: number | undefined
    try {
      writeFileSync(
        fixture,
        [
          'import { spawn } from "node:child_process"',
          'import { writeFileSync } from "node:fs"',
          `const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["ignore", process.stdout, process.stderr] })`,
          "child.unref()",
          `writeFileSync(${JSON.stringify(pidFile)}, String(child.pid))`,
          "process.exit(0)",
        ].join("\n"),
      )

      const result = await runBrowserRunner(fixture)
      expect(existsSync(pidFile)).toBe(true)
      descendantPid = Number(readFileSync(pidFile, "utf8"))
      expect(result.code).toBe(1)
      expect(`${result.stdout}\n${result.stderr}`).toContain("root process exit")
      expect(`${result.stdout}\n${result.stderr}`).toContain("terminating test process")
      await waitForDead(descendantPid)
    } finally {
      if (descendantPid !== undefined) killProcess(descendantPid)
      rmSync(root, { recursive: true, force: true })
    }
  },
)

test(
  "overlay browser runner terminates a silent root process after inactivity",
  { timeout: 20_000 },
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), "opencorvus-overlay-runner-idle-"))
    const fixture = path.join(root, "silent-root.test.mjs")
    const pidFile = path.join(root, "root.pid")
    let rootPid: number | undefined
    try {
      writeFileSync(
        fixture,
        [
          'import test from "node:test"',
          'import { writeFileSync } from "node:fs"',
          'test("silent root", async () => {',
          `  writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))`,
          "  await new Promise(() => {})",
          "})",
        ].join("\n"),
      )

      const result = await runBrowserRunner(fixture)
      expect(result.code).toBe(1)
      expect(`${result.stdout}\n${result.stderr}`).toContain("terminating test process")
      expect(existsSync(pidFile)).toBe(true)
      rootPid = Number(readFileSync(pidFile, "utf8"))
      await waitForDead(rootPid)
    } finally {
      if (rootPid !== undefined) killProcess(rootPid)
      rmSync(root, { recursive: true, force: true })
    }
  },
)
