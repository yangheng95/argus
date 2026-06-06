import { testRender } from "@opentui/solid"
import type { CapturedFrame } from "@opentui/core"
import type { TestRendererSetup } from "@opentui/core/testing"
import { TuiRoot } from "@/cli/cmd/tui/app"
import type { Args } from "@/cli/cmd/tui/context/args"
import { TuiConfig } from "@/config/tui"
import { Instance } from "@/project/instance"
import type { EmbeddedTuiFrame, EmbeddedTuiInfo, EmbeddedTuiInput, EmbeddedTuiResizeInput, EmbeddedTuiStartInput } from "./embedded"

interface WorkerRequest {
  id: string
  op: "start" | "status" | "resize" | "input" | "stop"
  body?: unknown
}

interface EmbeddedTuiSession {
  setup: TestRendererSetup
  cols: number
  rows: number
  mode: "dark" | "light"
  directory: string
  createdAt: number
  updatedAt: number
}

let session: EmbeddedTuiSession | undefined
const protocolWrite = process.stdout.write.bind(process.stdout)
console.log = (...args) => console.error(...args)

function respond(id: string, body: unknown) {
  protocolWrite(`${JSON.stringify({ id, ok: true, body })}\n`)
}

function fail(id: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  protocolWrite(`${JSON.stringify({ id, ok: false, error: message })}\n`)
}

function colorToCss(color: { toInts(): [number, number, number, number] }) {
  const [r, g, b, a] = color.toInts()
  if (a >= 255) return `rgb(${r}, ${g}, ${b})`
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, a / 255))})`
}

function serializeFrame(frame: CapturedFrame): EmbeddedTuiFrame {
  return {
    cols: frame.cols,
    rows: frame.rows,
    cursor: frame.cursor,
    lines: frame.lines.map((line) => ({
      spans: line.spans.map((span) => ({
        text: span.text,
        fg: colorToCss(span.fg),
        bg: colorToCss(span.bg),
        attributes: span.attributes,
        width: span.width,
      })),
    })),
  }
}

function frameText(frame: EmbeddedTuiFrame | null) {
  if (!frame) return ""
  return frame.lines.map((line) => line.spans.map((span) => span.text).join("")).join("\n")
}

async function settle(current: EmbeddedTuiSession) {
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 16))
  await current.setup.renderOnce()
  current.updatedAt = Date.now()
}

async function info(current = session): Promise<EmbeddedTuiInfo> {
  if (!current) {
    return {
      running: false,
      cols: null,
      rows: null,
      mode: null,
      directory: "",
      frame: null,
      text: "",
      createdAt: null,
      updatedAt: null,
    }
  }
  await settle(current)
  const frame = serializeFrame(current.setup.captureSpans())
  return {
    running: true,
    cols: current.cols,
    rows: current.rows,
    mode: current.mode,
    directory: current.directory,
    frame,
    text: frameText(frame),
    createdAt: current.createdAt,
    updatedAt: current.updatedAt,
  }
}

function args(input: EmbeddedTuiStartInput): Args {
  return {
    continue: input.continue,
    sessionID: input.sessionID,
    agent: input.agent,
    model: input.model,
    prompt: input.prompt,
    fork: input.fork,
  }
}

function pressKey(current: EmbeddedTuiSession, input: EmbeddedTuiInput) {
  if (input.text !== undefined) return current.setup.mockInput.typeText(input.text)
  switch (input.key) {
    case "enter":
      current.setup.mockInput.pressEnter({ ctrl: input.ctrl })
      return Promise.resolve()
    case "escape":
      current.setup.mockInput.pressEscape({ ctrl: input.ctrl })
      return Promise.resolve()
    case "tab":
      current.setup.mockInput.pressTab({ ctrl: input.ctrl })
      return Promise.resolve()
    case "backspace":
      current.setup.mockInput.pressBackspace({ ctrl: input.ctrl })
      return Promise.resolve()
    case "delete":
      return current.setup.mockInput.pressKeys(["DELETE"])
    case "arrow-up":
      current.setup.mockInput.pressArrow("up", { ctrl: input.ctrl })
      return Promise.resolve()
    case "arrow-down":
      current.setup.mockInput.pressArrow("down", { ctrl: input.ctrl })
      return Promise.resolve()
    case "arrow-left":
      current.setup.mockInput.pressArrow("left", { ctrl: input.ctrl })
      return Promise.resolve()
    case "arrow-right":
      current.setup.mockInput.pressArrow("right", { ctrl: input.ctrl })
      return Promise.resolve()
  }
  return Promise.resolve()
}

async function start(input: EmbeddedTuiStartInput & { url: string; directory: string }) {
  await stop()
  const config = await Instance.provide({
    directory: input.directory,
    fn: () => TuiConfig.get(),
  })
  const setup = await testRender(
    () =>
      <TuiRoot
        url={input.url}
        directory={input.directory}
        config={config}
        args={args(input)}
        dimensions={{ width: input.cols, height: input.rows }}
        mode={input.mode}
        onExit={async (): Promise<void> => {
          await stop()
        }}
      />,
    {
      width: input.cols,
      height: input.rows,
      kittyKeyboard: true,
    },
  )
  session = {
    setup,
    cols: input.cols,
    rows: input.rows,
    mode: input.mode,
    directory: input.directory,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  return info(session)
}

async function resize(input: EmbeddedTuiResizeInput) {
  if (!session) return info()
  session.cols = input.cols
  session.rows = input.rows
  session.setup.resize(input.cols, input.rows)
  return info(session)
}

async function input(input: EmbeddedTuiInput) {
  if (!session) throw new Error("Embedded TUI is not running. Call /tui/embed/start first.")
  await pressKey(session, input)
  return info(session)
}

async function stop() {
  const current = session
  session = undefined
  current?.setup.renderer.destroy()
  return true
}

async function handle(request: WorkerRequest) {
  switch (request.op) {
    case "start":
      return start(request.body as EmbeddedTuiStartInput & { url: string; directory: string })
    case "status":
      return info()
    case "resize":
      return resize(request.body as EmbeddedTuiResizeInput)
    case "input":
      return input(request.body as EmbeddedTuiInput)
    case "stop":
      return stop()
  }
}

let queue = Promise.resolve()

function enqueue(request: WorkerRequest) {
  queue = queue
    .then(() => handle(request))
    .then(
      (body) => respond(request.id, body),
      (error) => fail(request.id, error),
    )
}

let buffer = ""
const decoder = new TextDecoder()
const reader = Bun.stdin.stream().getReader()
try {
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    while (true) {
      const index = buffer.indexOf("\n")
      if (index < 0) break
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (!line) continue
      const request = JSON.parse(line) as WorkerRequest
      enqueue(request)
    }
  }
} finally {
  reader.releaseLock()
}
