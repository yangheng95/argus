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
  console.error("existing managed sidecar detected (PID=4242, port=9999). Stop it before opening this workspace in VS Code.")
  process.exit(3)
}

const delayMs = Number(process.env.FAKE_SIDECAR_DELAY_MS || 0)
const neverHandshake = process.env.FAKE_SIDECAR_NEVER_HANDSHAKE === "1"

const server = createServer((req, res) => {
  record("request", { method: req.method, url: req.url })
  if (req.url === "/global/health") {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ healthy: true, version: "fake" }))
    return
  }
  if (req.url === "/shutdown" && req.method === "POST") {
    record("shutdown")
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ ok: true }))
    setTimeout(() => process.exit(0), 25)
    return
  }
  res.writeHead(404)
  res.end()
})

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
