#!/usr/bin/env bun
import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } from "@vscode/test-electron"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { spawn, spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const extensionRoot = path.resolve(here, "..")
const repoRoot = path.resolve(extensionRoot, "..", "..")
const suitePath = path.join(extensionRoot, "e2e", "suite", "index.cjs")
const fakeSidecar = path.join(extensionRoot, "test", "fixtures", "fake-sidecar.mjs")
const vscodeVersion = process.env.VSCODE_E2E_VERSION ?? "1.85.0"
const vscodeIdleMs = Number(process.env.VSCODE_E2E_IDLE_MS ?? 120_000)

async function main() {
  if (!Number.isInteger(vscodeIdleMs) || vscodeIdleMs <= 0) {
    throw new Error(`VSCODE_E2E_IDLE_MS must be a positive integer, got ${process.env.VSCODE_E2E_IDLE_MS}`)
  }
  runBuild()
  assertBuiltOverlayUi()

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencorvus-vscode-e2e-"))
  const workspace = path.join(tempRoot, "workspace")
  fs.mkdirSync(workspace, { recursive: true })
  fs.writeFileSync(path.join(workspace, "sample.ts"), "export const sample = 1\n")

  const eventsFile = path.join(tempRoot, "sidecar-events.jsonl")
  const testLogFile = path.join(tempRoot, "extension-test-events.jsonl")
  const wrapper = createSidecarWrapper(tempRoot)
  console.log(`[e2e] temp=${tempRoot}`)
  console.log(`[e2e] vscode=${vscodeVersion}`)
  console.log(`[e2e] idle-timeout-ms=${vscodeIdleMs}`)
  console.log(`[e2e] sidecar-wrapper=${wrapper}`)

  try {
    const code = await runVsCodeCli({
      workspace,
      userDataDir: path.join(tempRoot, "user-data"),
      extensionsDir: path.join(tempRoot, "extensions"),
      env: {
        OPENCORVUS_DEV_BINARY: wrapper,
        OPENCORVUS_E2E_EVENTS_FILE: eventsFile,
        OPENCORVUS_E2E_TEST_LOG: testLogFile,
        FAKE_SIDECAR_EVENTS_FILE: eventsFile,
        FAKE_SIDECAR_FAIL: undefined,
        FAKE_SIDECAR_DELAY_MS: undefined,
        FAKE_SIDECAR_NEVER_HANDSHAKE: undefined,
      },
    })
    if (code !== 0) throw new Error(`VS Code E2E exited with code ${code}`)
  } catch (error) {
    dumpEvidence("extension-test", testLogFile)
    dumpEvidence("sidecar", eventsFile)
    throw error
  }

  const testEvents = readEvents(testLogFile)
  if (testEvents.some((event) => event.type === "suite.error")) {
    throw new Error(`VS Code extension test suite failed; events=${JSON.stringify(testEvents)}`)
  }
  assertEvent(testEvents, "suite.done")

  const events = readEvents(eventsFile)
  assertEvent(events, "listen")
  assertEvent(events, "shutdown")
  assertEvent(events, "exit")
  if (!events.some((event) => event.type === "request" && event.url !== "/shutdown")) {
    throw new Error(`VS Code webview did not send any sidecar HTTP request; events=${JSON.stringify(events)}`)
  }
  console.log(`[e2e] OK events=${events.map((event) => event.type).join(",")}`)
}

async function runVsCodeCli(options: {
  workspace: string
  userDataDir: string
  extensionsDir: string
  env: NodeJS.ProcessEnv
}): Promise<number> {
  const executable = await downloadAndUnzipVSCode({ version: vscodeVersion })
  const [command, ...profileArgs] = resolveCliArgsFromVSCodeExecutablePath(executable, { reuseMachineInstall: true })
  const args = [
    options.workspace,
    "--no-sandbox",
    "--disable-gpu-sandbox",
    "--disable-updates",
    "--disable-workspace-trust",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-telemetry",
    `--user-data-dir=${options.userDataDir}`,
    `--extensions-dir=${options.extensionsDir}`,
    `--extensionDevelopmentPath=${extensionRoot}`,
    `--extensionTestsPath=${suitePath}`,
    ...profileArgs,
  ]

  console.log(`[e2e] command=${command}`)
  console.log(`[e2e] args=${args.join(" ")}`)

  return await new Promise((resolve, reject) => {
    const spawnCommand = process.platform === "win32" ? "powershell.exe" : command
    const spawnArgs =
      process.platform === "win32"
        ? [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            `${["&", psQuote(command), ...args.map(psQuote)].join(" ")}; exit $LASTEXITCODE`,
          ]
        : args
    const child = spawn(spawnCommand, spawnArgs, {
      cwd: extensionRoot,
      env: { ...process.env, ...options.env },
      shell: false,
      windowsHide: false,
    })
    let settled = false
    let idleTimer: NodeJS.Timeout | undefined
    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        if (settled) return
        settled = true
        child.kill("SIGTERM")
        reject(new Error(`VS Code E2E had no output for ${vscodeIdleMs}ms`))
      }, vscodeIdleMs)
    }
    resetIdle()
    child.stdout?.on("data", (chunk) => {
      resetIdle()
      process.stdout.write(chunk)
    })
    child.stderr?.on("data", (chunk) => {
      resetIdle()
      process.stderr.write(chunk)
    })
    child.on("error", (error) => {
      if (idleTimer) clearTimeout(idleTimer)
      if (settled) return
      settled = true
      reject(error)
    })
    child.on("close", (code, signal) => {
      if (idleTimer) clearTimeout(idleTimer)
      if (settled) return
      settled = true
      if (signal) reject(new Error(`VS Code E2E exited by signal ${signal}`))
      else resolve(code ?? 0)
    })
  })
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function assertBuiltOverlayUi() {
  const html = path.join(extensionRoot, "media", "ui", "index.html")
  if (!fs.existsSync(html)) {
    throw new Error(`VS Code E2E build did not produce bundled overlay UI at ${html}`)
  }
}

function runBuild() {
  console.log("[e2e] building extension bundle with fresh overlay UI")
  const result = spawnSync("node", ["esbuild.mjs"], {
    cwd: extensionRoot,
    stdio: "inherit",
    shell: false,
  })
  if (result.status !== 0) {
    throw new Error(`extension build failed with status ${result.status}`)
  }
}

function createSidecarWrapper(tempRoot: string): string {
  const runtime = process.execPath
  if (process.platform === "win32") {
    const wrapper = path.join(tempRoot, "fake-sidecar.cmd")
    fs.writeFileSync(
      wrapper,
      `@echo off\r\n"${runtime}" "${fakeSidecar}" %*\r\n`,
      "utf8",
    )
    return wrapper
  }

  const wrapper = path.join(tempRoot, "fake-sidecar")
  fs.writeFileSync(
    wrapper,
    `#!/usr/bin/env sh\nexec "${runtime}" "${fakeSidecar}" "$@"\n`,
    { encoding: "utf8", mode: 0o755 },
  )
  return wrapper
}

function readEvents(file: string): Array<Record<string, unknown>> {
  if (!fs.existsSync(file)) throw new Error(`sidecar events file was not created: ${file}`)
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function assertEvent(events: Array<Record<string, unknown>>, type: string) {
  if (!events.some((event) => event.type === type)) {
    throw new Error(`missing sidecar event ${type}; events=${JSON.stringify(events)}`)
  }
}

function dumpEvidence(label: string, file: string) {
  if (!fs.existsSync(file)) {
    console.error(`[e2e] ${label} evidence missing: ${file}`)
    return
  }
  console.error(`[e2e] ${label} evidence:`)
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean)) {
    console.error(`[e2e] ${line}`)
  }
}

await main()
