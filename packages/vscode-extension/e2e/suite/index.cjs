const assert = require("node:assert")
const fs = require("node:fs")
const vscode = require("vscode")

const eventsFile = process.env.OPENCORVUS_E2E_EVENTS_FILE
const testLogFile = process.env.OPENCORVUS_E2E_TEST_LOG
const visualHoldMs = parseNonNegativeInteger("OPENCORVUS_E2E_HOLD_MS")
const visualAckFile = process.env.OPENCORVUS_E2E_VISUAL_ACK_FILE

async function run() {
  assert(eventsFile, "OPENCORVUS_E2E_EVENTS_FILE is required")

  record("suite.start", {
    extensionIds: vscode.extensions.all.map((extension) => extension.id).filter((id) => /opencorvus/i.test(id)),
  })
  try {
    await vscode.commands.executeCommand("opencorvus.open")
    record("command.done", { command: "opencorvus.open" })
    await waitFor("OpenCorvus webview tab", () => {
      const labels = currentTabLabels()
      record("tabs", { labels })
      return labels.includes("OpenCorvus")
    })
    await waitFor("fake sidecar listen event", () =>
      readEvents().some((event) => event.type === "listen" && typeof event.port === "number"),
    )
    await waitFor(
      "webview sidecar request",
      () => readEvents().some((event) => event.type === "request" && event.url !== "/shutdown"),
      30_000,
    )
    record("visual.ready", { labels: currentTabLabels() })
    if (visualAckFile) {
      await waitFor("visual screenshot capture", () => fs.existsSync(visualAckFile), 30_000)
    }
    if (visualHoldMs > 0) {
      record("visual.hold.start", { ms: visualHoldMs })
      void vscode.window.showInformationMessage(`OpenCorvus visual E2E hold: ${Math.round(visualHoldMs / 1000)}s`)
      await delay(visualHoldMs)
      record("visual.hold.end", { ms: visualHoldMs })
    }

    await vscode.commands.executeCommand("workbench.action.closeActiveEditor")
    record("suite.done")
  } catch (error) {
    record("suite.error", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      tabs: currentTabLabels(),
      sidecarEvents: readEvents(),
    })
    throw error
  }
}

function readEvents() {
  if (!eventsFile || !fs.existsSync(eventsFile)) return []
  return fs
    .readFileSync(eventsFile, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function currentTabLabels() {
  return vscode.window.tabGroups.all.flatMap((group) => group.tabs).map((tab) => tab.label)
}

function record(type, data = {}) {
  if (!testLogFile) return
  fs.appendFileSync(testLogFile, `${JSON.stringify({ type, time: Date.now(), ...data })}\n`)
}

async function waitFor(label, predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await delay(100)
  }
  throw new Error(`timed out waiting for ${label}`)
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseNonNegativeInteger(name) {
  const value = process.env[name]
  if (value === undefined || value === "") return 0
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer, got ${value}`)
  }
  return parsed
}

module.exports = { run }
