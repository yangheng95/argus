/**
 * Quick test: spawn overlay process, send test events, verify communication.
 * Usage: bun run test-overlay.ts
 */
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"

const projectRoot = path.resolve(import.meta.dirname, "../..")
const debugBin = path.join(projectRoot, "packages", "overlay", "src-tauri", "target", "debug", "opencorvus-overlay.exe")
const releaseBin = path.join(projectRoot, "packages", "overlay", "src-tauri", "target", "release", "opencorvus-overlay.exe")
const overlayBin = existsSync(releaseBin) ? releaseBin : debugBin

if (!existsSync(overlayBin)) {
  console.error("Overlay binary not found:", overlayBin)
  process.exit(1)
}

console.log(`Starting overlay: ${overlayBin}`)

const proc = spawn(overlayBin, [], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, OPENCORVUS_OVERLAY_STDIN_EXIT: "1" },
})

proc.stdout?.on("data", (data: Buffer) => {
  console.log(`[stdout] ${data.toString().trim()}`)
})
proc.stderr?.on("data", (data: Buffer) => {
  const t = data.toString().trim()
  if (t) console.error(`[stderr] ${t}`)
})
proc.on("exit", (code) => {
  console.log(`Overlay exited (code ${code})`)
})

function send(event: Record<string, unknown>) {
  const json = JSON.stringify(event)
  console.log(`[send] ${json}`)
  proc.stdin!.write(json + "\n")
}

// Wait for overlay to initialize
await new Promise(r => setTimeout(r, 3000))
console.log("--- Overlay ready, sending test events ---")

// Test 1: Click hint at center screen
send({ type: "hint", x: 960, y: 540, action: "click", label: "Test click (960, 540)" })
await new Promise(r => setTimeout(r, 2000))

// Test 2: Type hint
send({ type: "hint", x: 960, y: 540, action: "type", label: "type: Hello World" })
await new Promise(r => setTimeout(r, 2000))

// Test 3: Key hint
send({ type: "hint", x: 960, y: 540, action: "key", label: "key: Enter" })
await new Promise(r => setTimeout(r, 2000))

// Test 4: Click done
send({ type: "hint", x: 800, y: 400, action: "click", label: "done click", status: "done" })
await new Promise(r => setTimeout(r, 2000))

// Test 5: Confirm dialog
send({
  type: "confirm",
  id: "test-1",
  x: 960,
  y: 540,
  title: "Test Confirmation",
  message: "This is a test confirm dialog. Click OK or Cancel.",
  confirm: "OK",
  cancel: "Cancel",
  timeout_ms: 5000,
})
await new Promise(r => setTimeout(r, 6000))

// Test 6: Window highlight
send({
  type: "window-highlight",
  x: 200,
  y: 200,
  width: 800,
  height: 600,
  label: "Target Window",
  duration_ms: 3000,
})
await new Promise(r => setTimeout(r, 4000))

console.log("--- All tests done, closing overlay ---")
proc.stdin!.end()
await new Promise(r => setTimeout(r, 2000))
proc.kill()
process.exit(0)
