import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { resolveBrowserNodeSidecarRuntime, type BrowserNodeSidecarRuntime } from "@/browser/runtime/node-sidecar"
import { BrowserRuntime } from "@/browser/runtime"
import { browserPreviewViewportByID, type BrowserPreviewViewportID } from "./viewport"
import { ServeRuntimeMemoryMetrics } from "@/runtime/memory-metrics"
import { findBrowserPreviewTargetByID } from "./persist"

const LIVE_COMMAND_TIMEOUT_MILLISECONDS = 60_000
const LIVE_NAVIGATION_TIMEOUT_MILLISECONDS = 20_000
const LIVE_SETTLE_MILLISECONDS = 80
const LIVE_IDLE_TIMEOUT_MILLISECONDS = 120_000
const LIVE_CLOSE_TIMEOUT_MILLISECONDS = 5_000

export type BrowserPreviewLiveInput =
  | { kind: "click"; x: number; y: number; button?: "left" | "middle" | "right" }
  | { kind: "wheel"; x: number; y: number; deltaX: number; deltaY: number }
  | { kind: "key"; key: string }

export async function captureBrowserPreviewLiveSnapshot(input: {
  taskID: string
  targetID: string
  viewportID: BrowserPreviewViewportID
  signal?: AbortSignal
}): Promise<Buffer> {
  const target = browserPreviewLiveTarget(input)
  const session = await browserPreviewLiveSession(input)
  const result = await session.command(
    {
      kind: "snapshot",
      url: target.url,
      viewport: browserPreviewViewportByID(input.viewportID),
      navigationTimeoutMs: LIVE_NAVIGATION_TIMEOUT_MILLISECONDS,
      settleMs: LIVE_SETTLE_MILLISECONDS,
    },
    input.signal,
  )
  return Buffer.from(result.pngBase64, "base64")
}

export async function interactBrowserPreviewLive(input: {
  taskID: string
  targetID: string
  viewportID: BrowserPreviewViewportID
  inputs: BrowserPreviewLiveInput[]
  signal?: AbortSignal
}): Promise<Buffer> {
  const target = browserPreviewLiveTarget(input)
  const session = await browserPreviewLiveSession(input)
  const result = await session.command(
    {
      kind: "input",
      url: target.url,
      viewport: browserPreviewViewportByID(input.viewportID),
      navigationTimeoutMs: LIVE_NAVIGATION_TIMEOUT_MILLISECONDS,
      settleMs: LIVE_SETTLE_MILLISECONDS,
      inputs: input.inputs,
    },
    input.signal,
  )
  return Buffer.from(result.pngBase64, "base64")
}

export async function closeBrowserPreviewLiveSessions(): Promise<void> {
  const sessions = [...liveSessions.values()]
  liveSessions.clear()
  await Promise.all(sessions.map((session) => session.close()))
}

export class BrowserPreviewLiveTargetNotFoundError extends Error {
  constructor(readonly targetID: string) {
    super(`Browser preview target not found: ${targetID}`)
    this.name = "BrowserPreviewLiveTargetNotFoundError"
  }
}

function browserPreviewLiveTarget(input: { taskID: string; targetID: string }) {
  const target = findBrowserPreviewTargetByID({ taskID: input.taskID, targetID: input.targetID })
  if (!target) throw new BrowserPreviewLiveTargetNotFoundError(input.targetID)
  return target
}

type BrowserPreviewLiveCommand =
  | {
      kind: "snapshot"
      url: string
      viewport: { width: number; height: number }
      navigationTimeoutMs: number
      settleMs: number
    }
  | {
      kind: "input"
      url: string
      viewport: { width: number; height: number }
      navigationTimeoutMs: number
      settleMs: number
      inputs: BrowserPreviewLiveInput[]
    }

type BrowserPreviewLiveResult = {
  pngBase64: string
  url: string
  title: string
  viewport: { width: number; height: number }
}

const liveSessions = new Map<string, BrowserPreviewLiveSidecar>()
const liveMetrics = {
  created: 0,
  closed: 0,
  idleClosed: 0,
  forcedKilled: 0,
  errors: 0,
}

ServeRuntimeMemoryMetrics.register({
  id: "browser-preview-live",
  snapshot: () => {
    let pendingCommands = 0
    let stderrBytes = 0
    for (const session of liveSessions.values()) {
      pendingCommands += session.pendingCommands
      stderrBytes += session.stderrBytes
    }
    return {
      active: liveSessions.size,
      pendingCommands,
      stderrBytes,
      ...liveMetrics,
    }
  },
})

async function browserPreviewLiveSession(input: {
  taskID: string
  targetID: string
  viewportID: BrowserPreviewViewportID
}): Promise<BrowserPreviewLiveSidecar> {
  const key = `${input.taskID}:${input.targetID}:${input.viewportID}`
  const existing = liveSessions.get(key)
  if (existing && !existing.closed) return existing
  const runtime = await resolveBrowserNodeSidecarRuntime()
  const executablePath = await BrowserRuntime.findBrowserExecutable()
  const launchTimeoutMs = BrowserRuntime.resolveBrowserLaunchTimeoutMs(undefined)
  const session = new BrowserPreviewLiveSidecar(
    {
      taskID: input.taskID,
      targetID: input.targetID,
      viewportID: input.viewportID,
    },
    runtime,
    executablePath,
    launchTimeoutMs,
    () => {
      if (liveSessions.get(key) === session) liveSessions.delete(key)
    },
  )
  liveSessions.set(key, session)
  return session
}

export function browserPreviewLiveStats() {
  return {
    active: liveSessions.size,
    ...liveMetrics,
  }
}

class BrowserPreviewLiveSidecar {
  readonly child: ChildProcessWithoutNullStreams
  readonly createdAt = Date.now()
  lastActiveAt = this.createdAt
  private readonly pending = new Map<
    number,
    {
      resolve: (result: BrowserPreviewLiveResult) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  private stdoutBuffer = ""
  private stderr = ""
  private sequence = 0
  closed = false

  constructor(
    readonly owner: {
      taskID: string
      targetID: string
      viewportID: BrowserPreviewViewportID
    },
    runtime: BrowserNodeSidecarRuntime,
    executablePath: string,
    launchTimeoutMs: number,
    private readonly onClose: () => void,
  ) {
    liveMetrics.created++
    this.child = spawn(runtime.nodeExecutable, ["-e", BROWSER_PREVIEW_LIVE_SCRIPT], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        OPENCORVUS_PLAYWRIGHT_REQUIRE_PATH: runtime.playwrightRequirePath,
        OPENCORVUS_BROWSER_EXECUTABLE: executablePath,
        OPENCORVUS_BROWSER_LAUNCH_ARGS: JSON.stringify(BrowserRuntime.defaultLaunchArgs()),
        OPENCORVUS_BROWSER_LAUNCH_TIMEOUT_MS: String(launchTimeoutMs),
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    })
    this.child.stdout.setEncoding("utf8")
    this.child.stderr.setEncoding("utf8")
    this.child.stdout.on("data", (chunk) => this.handleStdout(String(chunk)))
    this.child.stderr.on("data", (chunk) => {
      this.stderr += String(chunk)
      if (this.stderr.length > 8_000) this.stderr = this.stderr.slice(-8_000)
    })
    this.child.once("error", (error) => this.closeWithError(error, onClose))
    this.child.once("exit", (code, signal) =>
      this.closeWithError(
        new Error(`Browser preview live sidecar exited with ${signal ?? code}. ${this.stderr}`),
        onClose,
      ),
    )
  }

  get pendingCommands(): number {
    return this.pending.size
  }

  get stderrBytes(): number {
    return Buffer.byteLength(this.stderr, "utf8")
  }

  command(command: BrowserPreviewLiveCommand, signal?: AbortSignal): Promise<BrowserPreviewLiveResult> {
    if (this.closed) return Promise.reject(new Error("Browser preview live sidecar is closed."))
    if (signal?.aborted) {
      return Promise.reject(
        signal.reason instanceof Error ? signal.reason : new Error("Browser preview live command aborted."),
      )
    }
    this.lastActiveAt = Date.now()
    const id = ++this.sequence
    const line = `${JSON.stringify({ id, command })}\n`
    return new Promise<BrowserPreviewLiveResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(id)
        if (!pending) return
        this.pending.delete(id)
        pending.reject(new Error(`Browser preview live command timed out. ${this.stderr}`))
      }, LIVE_COMMAND_TIMEOUT_MILLISECONDS)
      const abort = () => {
        const pending = this.pending.get(id)
        if (!pending) return
        this.pending.delete(id)
        pending.reject(
          signal?.reason instanceof Error ? signal.reason : new Error("Browser preview live command aborted."),
        )
      }
      signal?.addEventListener("abort", abort, { once: true })
      this.pending.set(id, {
        resolve: (result) => {
          signal?.removeEventListener("abort", abort)
          clearTimeout(timer)
          this.lastActiveAt = Date.now()
          this.armIdleTimer()
          resolve(result)
        },
        reject: (error) => {
          signal?.removeEventListener("abort", abort)
          clearTimeout(timer)
          this.lastActiveAt = Date.now()
          this.armIdleTimer()
          reject(error)
        },
        timer,
      })
      this.child.stdin.write(line, (error) => {
        if (!error) return
        const pending = this.pending.get(id)
        if (!pending) return
        this.pending.delete(id)
        pending.reject(error)
      })
    })
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    for (;;) {
      const index = this.stdoutBuffer.indexOf("\n")
      if (index < 0) return
      const line = this.stdoutBuffer.slice(0, index).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(index + 1)
      if (!line) continue
      let message: { id?: number; ok?: boolean; result?: BrowserPreviewLiveResult; error?: string }
      try {
        message = JSON.parse(line)
      } catch {
        this.stderr += `\nInvalid live sidecar JSON: ${line.slice(0, 500)}`
        continue
      }
      const id = typeof message.id === "number" ? message.id : undefined
      if (!id) continue
      const pending = this.pending.get(id)
      if (!pending) continue
      this.pending.delete(id)
      if (message.ok && message.result) pending.resolve(message.result)
      else pending.reject(new Error(message.error || "Browser preview live sidecar command failed."))
    }
  }

  private armIdleTimer(): void {
    if (this.closed) return
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => {
      liveMetrics.idleClosed++
      void this.close()
    }, LIVE_IDLE_TIMEOUT_MILLISECONDS)
    this.idleTimer.unref?.()
  }

  private clearIdleTimer(): void {
    if (!this.idleTimer) return
    clearTimeout(this.idleTimer)
    this.idleTimer = undefined
  }

  private closeWithError(error: Error, onClose: () => void): void {
    if (this.closed) return
    this.closed = true
    liveMetrics.errors++
    liveMetrics.closed++
    this.clearIdleTimer()
    for (const [id, pending] of this.pending) {
      this.pending.delete(id)
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    onClose()
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    liveMetrics.closed++
    this.clearIdleTimer()
    for (const [id, pending] of this.pending) {
      this.pending.delete(id)
      clearTimeout(pending.timer)
      pending.reject(new Error("Browser preview live sidecar closed."))
    }
    this.onClose()
    const exited = new Promise<void>((resolve) => {
      if (this.child.exitCode !== null || this.child.signalCode !== null) {
        resolve()
        return
      }
      this.child.once("exit", () => resolve())
    })
    terminateChildTree(this.child, "SIGTERM")
    const forceKillTimer = setTimeout(() => {
      liveMetrics.forcedKilled++
      terminateChildTree(this.child, "SIGKILL")
    }, LIVE_CLOSE_TIMEOUT_MILLISECONDS)
    forceKillTimer.unref?.()
    try {
      await exited
    } finally {
      clearTimeout(forceKillTimer)
    }
  }
}

function terminateChildTree(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  const pid = child.pid
  if (!pid) return
  if (process.platform === "win32") {
    child.kill(signal)
    return
  }
  try {
    process.kill(-pid, signal)
  } catch {
    child.kill(signal)
  }
}

const BROWSER_PREVIEW_LIVE_SCRIPT = String.raw`
const { chromium } = require(process.env.OPENCORVUS_PLAYWRIGHT_REQUIRE_PATH || "playwright");

let browser;
let context;
let page;
let currentUrl = "";
let currentViewport = "";
let inputBuffer = "";
let commandChain = Promise.resolve();

function viewportKey(viewport) {
  return viewport.width + "x" + viewport.height;
}

async function ensurePage(command, options = {}) {
  const key = viewportKey(command.viewport);
  if (!browser) {
    browser = await chromium.launch({
      executablePath: process.env.OPENCORVUS_BROWSER_EXECUTABLE,
      headless: true,
      args: JSON.parse(process.env.OPENCORVUS_BROWSER_LAUNCH_ARGS),
      timeout: Number(process.env.OPENCORVUS_BROWSER_LAUNCH_TIMEOUT_MS || "300000"),
    });
  }
  if (!page || currentViewport !== key) {
    if (context) {
      await context.close().catch(() => undefined);
    }
    context = undefined;
    page = undefined;
    context = await browser.newContext({
      viewport: { width: command.viewport.width, height: command.viewport.height },
      deviceScaleFactor: 1,
    });
    page = await context.newPage();
    currentUrl = "";
    currentViewport = key;
  }
  if (currentUrl !== command.url || options.reload === true) {
    await page.goto(command.url, { waitUntil: "load", timeout: command.navigationTimeoutMs });
    currentUrl = command.url;
  }
  return page;
}

async function settle(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function capture(command) {
  const activePage = await ensurePage(command);
  await settle(command.settleMs);
  const png = await activePage.screenshot({ type: "png" });
  return {
    pngBase64: Buffer.from(png).toString("base64"),
    url: activePage.url(),
    title: await activePage.title().catch(() => ""),
    viewport: command.viewport,
  };
}

function buttonName(value) {
  if (value === "middle" || value === "right") return value;
  return "left";
}

async function applyInput(activePage, input) {
  if (input.kind === "click") {
    await activePage.mouse.click(input.x, input.y, { button: buttonName(input.button) });
  } else if (input.kind === "wheel") {
    await activePage.mouse.move(input.x, input.y);
    await activePage.mouse.wheel(input.deltaX, input.deltaY);
  } else if (input.kind === "key") {
    await activePage.keyboard.press(input.key);
  } else {
    throw new Error("Unsupported browser preview live input: " + input.kind);
  }
}

async function applyInputs(command) {
  const activePage = await ensurePage(command);
  for (const input of command.inputs) {
    await applyInput(activePage, input);
  }
  return capture(command);
}

async function handle(message) {
  const command = message.command;
  const result = command.kind === "input" ? await applyInputs(command) : await capture(command);
  process.stdout.write(JSON.stringify({ id: message.id, ok: true, result }) + "\n");
}

function writeErrorResponse(id, error) {
  process.stdout.write(JSON.stringify({
    id,
    ok: false,
    error: String(error && error.message || error),
  }) + "\n");
}

function enqueueCommand(message) {
  const run = async () => {
    try {
      await handle(message);
    } catch (error) {
      writeErrorResponse(message && message.id, error);
    }
  };
  commandChain = commandChain.then(run, run);
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  inputBuffer += chunk;
  for (;;) {
    const index = inputBuffer.indexOf("\n");
    if (index < 0) return;
    const line = inputBuffer.slice(0, index).trim();
    inputBuffer = inputBuffer.slice(index + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      writeErrorResponse(0, error);
      continue;
    }
    enqueueCommand(message);
  }
});

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (browser) await browser.close().catch(() => undefined);
  process.exit(0);
}

process.stdin.on("end", shutdown);
process.stdin.on("close", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
`
