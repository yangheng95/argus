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
const visualHoldMs = Number(process.env.OPENCORVUS_E2E_HOLD_MS ?? 0)
const visualEnabled = process.env.OPENCORVUS_E2E_VISUAL === "1" || Boolean(process.env.OPENCORVUS_E2E_VISUAL_DIR)
const visualSettleMs = Number(process.env.OPENCORVUS_E2E_VISUAL_SETTLE_MS ?? 1_000)

async function main() {
  if (!Number.isInteger(vscodeIdleMs) || vscodeIdleMs <= 0) {
    throw new Error(`VSCODE_E2E_IDLE_MS must be a positive integer, got ${process.env.VSCODE_E2E_IDLE_MS}`)
  }
  if (!Number.isInteger(visualHoldMs) || visualHoldMs < 0) {
    throw new Error(`OPENCORVUS_E2E_HOLD_MS must be a non-negative integer, got ${process.env.OPENCORVUS_E2E_HOLD_MS}`)
  }
  if (!Number.isInteger(visualSettleMs) || visualSettleMs < 0) {
    throw new Error(
      `OPENCORVUS_E2E_VISUAL_SETTLE_MS must be a non-negative integer, got ${process.env.OPENCORVUS_E2E_VISUAL_SETTLE_MS}`,
    )
  }
  if (visualEnabled && process.platform !== "win32") {
    throw new Error("VS Code visual E2E screenshot capture currently requires a Windows runner")
  }
  runBuild()
  assertBuiltOverlayUi()

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencorvus-vscode-e2e-"))
  const workspace = path.join(tempRoot, "workspace")
  fs.mkdirSync(workspace, { recursive: true })
  fs.writeFileSync(path.join(workspace, "sample.ts"), "export const sample = 1\n")

  const eventsFile = path.join(tempRoot, "sidecar-events.jsonl")
  const testLogFile = path.join(tempRoot, "extension-test-events.jsonl")
  const visualDir = visualEnabled
    ? path.resolve(repoRoot, process.env.OPENCORVUS_E2E_VISUAL_DIR ?? path.join("tmp", "vscode-extension-visual-e2e"))
    : undefined
  const visualAckFile = visualEnabled ? path.join(tempRoot, "visual-capture.ack") : undefined
  const visualScreenshotFile = visualDir ? path.join(visualDir, "opencorvus-webview.png") : undefined
  const visualReportFile = visualDir ? path.join(visualDir, "visual-report.json") : undefined
  if (visualDir) fs.mkdirSync(visualDir, { recursive: true })
  const wrapper = createSidecarWrapper(tempRoot)
  console.log(`[e2e] temp=${tempRoot}`)
  console.log(`[e2e] vscode=${vscodeVersion}`)
  console.log(`[e2e] idle-timeout-ms=${vscodeIdleMs}`)
  console.log(`[e2e] visual-hold-ms=${visualHoldMs}`)
  console.log(`[e2e] visual-enabled=${visualEnabled ? "1" : "0"}`)
  if (visualDir) console.log(`[e2e] visual-dir=${visualDir}`)
  console.log(`[e2e] sidecar-wrapper=${wrapper}`)

  try {
    const code = await runVsCodeCli({
      workspace,
      userDataDir: path.join(tempRoot, "user-data"),
      extensionsDir: path.join(tempRoot, "extensions"),
      visual:
        visualEnabled && visualAckFile && visualScreenshotFile && visualReportFile
          ? {
              testLogFile,
              ackFile: visualAckFile,
              screenshotFile: visualScreenshotFile,
              reportFile: visualReportFile,
            }
          : undefined,
      env: {
        OPENCORVUS_DEV_BINARY: wrapper,
        OPENCORVUS_E2E_EVENTS_FILE: eventsFile,
        OPENCORVUS_E2E_TEST_LOG: testLogFile,
        OPENCORVUS_E2E_VISUAL_ACK_FILE: visualAckFile,
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
  const failedResponses = events.filter(
    (event) =>
      event.type === "response" && typeof event.status === "number" && event.status >= 400 && event.url !== "/shutdown",
  )
  if (failedResponses.length > 0) {
    throw new Error(`VS Code webview received failing sidecar responses; responses=${JSON.stringify(failedResponses)}`)
  }
  if (visualEnabled) {
    const ready = testEvents.find((event) => event.type === "visual.ready")
    if (!ready) throw new Error(`VS Code visual E2E did not emit visual.ready; events=${JSON.stringify(testEvents)}`)
  }
  console.log(`[e2e] OK events=${events.map((event) => event.type).join(",")}`)
}

async function runVsCodeCli(options: {
  workspace: string
  userDataDir: string
  extensionsDir: string
  env: NodeJS.ProcessEnv
  visual?: {
    testLogFile: string
    ackFile: string
    screenshotFile: string
    reportFile: string
  }
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
    let visualDone = !options.visual
    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        if (settled) return
        settled = true
        child.kill("SIGTERM")
        reject(new Error(`VS Code E2E had no output for ${vscodeIdleMs}ms`))
      }, vscodeIdleMs)
    }
    const fail = (error: Error) => {
      if (idleTimer) clearTimeout(idleTimer)
      if (settled) return
      settled = true
      try {
        child.kill("SIGTERM")
      } catch {}
      reject(error)
    }
    if (options.visual) {
      captureWhenVisualReady(options.visual)
        .then(() => {
          visualDone = true
          resetIdle()
        })
        .catch((error) => {
          fail(error instanceof Error ? error : new Error(String(error)))
        })
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
      fail(error)
    })
    child.on("close", (code, signal) => {
      if (idleTimer) clearTimeout(idleTimer)
      if (settled) return
      settled = true
      if (signal) reject(new Error(`VS Code E2E exited by signal ${signal}`))
      else if (!visualDone) reject(new Error("VS Code E2E closed before visual screenshot capture completed"))
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

async function captureWhenVisualReady(options: {
  testLogFile: string
  ackFile: string
  screenshotFile: string
  reportFile: string
}) {
  await waitForEvent(options.testLogFile, "visual.ready", vscodeIdleMs)
  if (visualSettleMs > 0) await sleep(visualSettleMs)
  const capture = captureWindowsScreen(options.screenshotFile)
  assertVisualCapture(capture)
  const report = {
    generatedAt: new Date().toISOString(),
    screenshot: options.screenshotFile,
    windowTitle: capture.windowTitle,
    width: capture.width,
    height: capture.height,
    bytes: capture.bytes,
    sampledColors: capture.sampledColors,
    readyEvent: "visual.ready",
    settleMs: visualSettleMs,
  }
  fs.writeFileSync(options.reportFile, `${JSON.stringify(report, null, 2)}\n`)
  fs.writeFileSync(options.ackFile, `${JSON.stringify(report)}\n`)
  console.log(`[e2e] visual screenshot=${options.screenshotFile}`)
  console.log(`[e2e] visual report=${options.reportFile}`)
}

async function waitForEvent(file: string, type: string, idleMs: number) {
  const started = Date.now()
  while (Date.now() - started < idleMs) {
    const events = fs.existsSync(file) ? readEvents(file) : []
    if (events.some((event) => event.type === type)) return
    await sleep(100)
  }
  throw new Error(`timed out waiting for ${type} in ${file}`)
}

function captureWindowsScreen(file: string): {
  windowTitle: string
  width: number
  height: number
  bytes: number
  sampledColors: number
} {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[void][System.Reflection.Assembly]::LoadWithPartialName('System.Runtime.InteropServices')
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class OpencorvusWin32 {
  public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
  public static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
  public const UInt32 SWP_NOMOVE = 0x0002;
  public const UInt32 SWP_NOSIZE = 0x0001;
  public const UInt32 SW_RESTORE = 9;
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, UInt32 uFlags);
  [DllImport("user32.dll")]
  public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, UInt32 nFlags);
}
"@
$process = Get-Process Code -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle.Contains('[Extension Development Host]') } |
  Select-Object -First 1
if (-not $process) {
  throw 'Could not find VS Code Extension Development Host window'
}
[void][OpencorvusWin32]::ShowWindow($process.MainWindowHandle, [OpencorvusWin32]::SW_RESTORE)
[void][OpencorvusWin32]::SetWindowPos($process.MainWindowHandle, [OpencorvusWin32]::HWND_TOPMOST, 0, 0, 0, 0, [OpencorvusWin32]::SWP_NOMOVE -bor [OpencorvusWin32]::SWP_NOSIZE)
[void][OpencorvusWin32]::SetForegroundWindow($process.MainWindowHandle)
Start-Sleep -Milliseconds 300
$rect = New-Object OpencorvusWin32+RECT
if (-not [OpencorvusWin32]::GetWindowRect($process.MainWindowHandle, [ref]$rect)) {
  throw 'GetWindowRect failed for VS Code Extension Development Host window'
}
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -lt 800 -or $height -lt 600) {
  throw "VS Code Extension Development Host window too small: $width x $height"
}
$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$hdc = $graphics.GetHdc()
$printed = [OpencorvusWin32]::PrintWindow($process.MainWindowHandle, $hdc, 2)
$graphics.ReleaseHdc($hdc)
if (-not $printed) {
  [void][OpencorvusWin32]::SetWindowPos($process.MainWindowHandle, [OpencorvusWin32]::HWND_NOTOPMOST, 0, 0, 0, 0, [OpencorvusWin32]::SWP_NOMOVE -bor [OpencorvusWin32]::SWP_NOSIZE)
  throw 'PrintWindow failed for VS Code Extension Development Host window'
}
[void][OpencorvusWin32]::SetWindowPos($process.MainWindowHandle, [OpencorvusWin32]::HWND_NOTOPMOST, 0, 0, 0, 0, [OpencorvusWin32]::SWP_NOMOVE -bor [OpencorvusWin32]::SWP_NOSIZE)
$colors = New-Object 'System.Collections.Generic.HashSet[int]'
$stepX = [Math]::Max(1, [Math]::Floor($width / 32))
$stepY = [Math]::Max(1, [Math]::Floor($height / 32))
for ($x = 0; $x -lt $width; $x += $stepX) {
  for ($y = 0; $y -lt $height; $y += $stepY) {
    [void]$colors.Add($bitmap.GetPixel($x, $y).ToArgb())
  }
}
$bitmap.Save(${psLiteral(file)}, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
$info = Get-Item -LiteralPath ${psLiteral(file)}
[Console]::WriteLine((@{
  windowTitle = $process.MainWindowTitle
  width = $width
  height = $height
  bytes = $info.Length
  sampledColors = $colors.Count
} | ConvertTo-Json -Compress))
`
  const encoded = Buffer.from(script, "utf16le").toString("base64")
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new Error(`visual screenshot capture failed: ${result.stderr || result.stdout}`)
  }
  const line = result.stdout.trim().split(/\r?\n/).at(-1)
  if (!line) throw new Error("visual screenshot capture produced no metadata")
  return JSON.parse(line)
}

function psLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function assertVisualCapture(capture: {
  windowTitle?: string
  width: number
  height: number
  bytes: number
  sampledColors: number
}) {
  if (!capture.windowTitle || !capture.windowTitle.includes("[Extension Development Host]")) {
    throw new Error(`visual screenshot did not target VS Code Extension Development Host: ${capture.windowTitle}`)
  }
  if (capture.width < 800 || capture.height < 600) {
    throw new Error(`visual screenshot dimensions too small: ${capture.width}x${capture.height}`)
  }
  if (capture.bytes < 10_000) {
    throw new Error(`visual screenshot file is too small: ${capture.bytes} bytes`)
  }
  if (capture.sampledColors < 8) {
    throw new Error(`visual screenshot appears blank: sampledColors=${capture.sampledColors}`)
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createSidecarWrapper(tempRoot: string): string {
  const runtime = process.execPath
  if (process.platform === "win32") {
    const wrapper = path.join(tempRoot, "fake-sidecar.cmd")
    fs.writeFileSync(wrapper, `@echo off\r\n"${runtime}" "${fakeSidecar}" %*\r\n`, "utf8")
    return wrapper
  }

  const wrapper = path.join(tempRoot, "fake-sidecar")
  fs.writeFileSync(wrapper, `#!/usr/bin/env sh\nexec "${runtime}" "${fakeSidecar}" "$@"\n`, {
    encoding: "utf8",
    mode: 0o755,
  })
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
