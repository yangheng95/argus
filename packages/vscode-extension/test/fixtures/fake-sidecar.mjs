#!/usr/bin/env node
// Fake sidecar binary for SidecarManager tests.
// Mimics: stdout handshake → tiny HTTP server → /shutdown closes.
// Behaviour controlled via env vars:
//   FAKE_SIDECAR_DELAY_MS — wait this long before the handshake
//   FAKE_SIDECAR_FAIL=missing-token — exit 2 if no OPENCORVUS_SERVER_PASSWORD
//   FAKE_SIDECAR_FAIL=existing-instance — exit 3 immediately
//   FAKE_SIDECAR_NEVER_HANDSHAKE — exit 0 after 30s without writing handshake

import { createServer } from "node:http"
import { appendFileSync } from "node:fs"

const eventsFile = process.env.FAKE_SIDECAR_EVENTS_FILE
function record(type, data = {}) {
  if (!eventsFile) return
  appendFileSync(eventsFile, `${JSON.stringify({ type, time: Date.now(), ...data })}\n`)
}

const failMode = process.env.FAKE_SIDECAR_FAIL
if (failMode === "missing-token") {
  if (!process.env.OPENCORVUS_SERVER_PASSWORD) {
    console.error("OPENCORVUS_SERVER_PASSWORD is required for managed sidecar mode")
    process.exit(2)
  }
}
if (failMode === "existing-instance") {
  console.error(
    "existing managed sidecar detected (PID=4242, port=9999). Stop it before opening this workspace in VS Code.",
  )
  process.exit(3)
}

const delayMs = Number(process.env.FAKE_SIDECAR_DELAY_MS || 0)
const neverHandshake = process.env.FAKE_SIDECAR_NEVER_HANDSHAKE === "1"

const server = createServer((req, res) => {
  const url = req.url || "/"
  record("request", { method: req.method, url })
  if (url === "/global/health") {
    sendJson(req, res, 200, { healthy: true, version: "fake" })
    return
  }
  if ((url === "/global/tasks" || url.startsWith("/global/tasks?")) && req.method === "GET") {
    sendJson(req, res, 200, { tasks: [] })
    return
  }
  if ((url === "/tasks" || url.startsWith("/tasks?")) && req.method === "GET") {
    sendJson(req, res, 200, { tasks: [] })
    return
  }
  if (url === "/path" && req.method === "GET") {
    sendJson(req, res, 200, { directory: process.cwd() })
    return
  }
  if (url === "/vcs" && req.method === "GET") {
    sendJson(req, res, 200, null)
    return
  }
  if (url === "/config" && req.method === "GET") {
    sendJson(req, res, 200, {})
    return
  }
  if (url === "/config/prompt" && req.method === "GET") {
    sendJson(req, res, 200, [])
    return
  }
  if (url === "/config/providers" && req.method === "GET") {
    sendJson(req, res, 200, [])
    return
  }
  if (url === "/provider" && req.method === "GET") {
    sendJson(req, res, 200, { all: [] })
    return
  }
  if (url === "/provider/auth" && req.method === "GET") {
    sendJson(req, res, 200, {})
    return
  }
  if (url === "/channel" && req.method === "GET") {
    sendJson(req, res, 200, [])
    return
  }
  if (url === "/executor" && req.method === "GET") {
    sendJson(req, res, 200, [{ id: "opencorvus", label: "OpenCorvus", selectable: true, discovered: true }])
    return
  }
  if (url === "/skill/installed" && req.method === "GET") {
    sendJson(req, res, 200, [])
    return
  }
  if (url === "/skill" && req.method === "GET") {
    sendJson(req, res, 200, [])
    return
  }
  if (url === "/mcp" && req.method === "GET") {
    sendJson(req, res, 200, {})
    return
  }
  if (url === "/agent" && req.method === "GET") {
    sendJson(req, res, 200, [])
    return
  }
  if (url === "/log" && req.method === "POST") {
    sendJson(req, res, 200, { ok: true })
    return
  }
  if ((url === "/task/events" || url.startsWith("/task/events?")) && req.method === "GET") {
    sendSse(req, res, { type: "task-list.connected", taskID: null, sequence: 0 })
    return
  }
  if ((url === "/global/event" || url.startsWith("/global/event?")) && req.method === "GET") {
    sendSse(req, res, { type: "global.connected", sequence: 0 })
    return
  }
  if (url === "/shutdown" && req.method === "POST") {
    record("shutdown")
    sendJson(req, res, 200, { ok: true })
    setTimeout(() => process.exit(0), 25)
    return
  }
  record("response", { method: req.method, url, status: 404 })
  res.writeHead(404, { "Content-Type": "application/json" })
  res.end()
})

function sendJson(req, res, status, body) {
  const url = req.url || "/"
  record("response", { method: req.method, url, status })
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(JSON.stringify(body))
}

function sendSse(req, res, body) {
  const url = req.url || "/"
  record("response", { method: req.method, url, status: 200 })
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  })
  res.write(`data: ${JSON.stringify(body)}\n\n`)
  const heartbeat = setInterval(() => {
    res.write(`data: ${JSON.stringify({ type: "heartbeat", sequence: 0 })}\n\n`)
  }, 10_000)
  req.on("close", () => clearInterval(heartbeat))
}

server.listen(0, "127.0.0.1", () => {
  const addr = server.address()
  const port = typeof addr === "object" && addr ? addr.port : 0
  record("listen", { port })
  const emit = () => {
    if (neverHandshake) return
    process.stdout.write(`OPENCORVUS_LISTEN=127.0.0.1:${port}\n`)
  }
  if (delayMs > 0) setTimeout(emit, delayMs)
  else emit()
})

process.on("exit", (code) => record("exit", { code }))
process.on("SIGTERM", () => {
  record("signal", { signal: "SIGTERM" })
  process.exit(0)
})
process.on("SIGINT", () => {
  record("signal", { signal: "SIGINT" })
  process.exit(0)
})
