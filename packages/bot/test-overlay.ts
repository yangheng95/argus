/**
 * Quick test: spawn overlay process, send test events, verify communication.
 * Usage: bun run test-overlay.ts
 */
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"

const projectRoot = path.resolve(import.meta.dirname, "../..")
const debugBin = path.join(projectRoot, "packages", "overlay", "src-tauri", "target", "debug", "opencorvus-overlay.exe")
const releaseBin = path.join(
  projectRoot,
  "packages",
  "overlay",
  "src-tauri",
  "target",
  "release",
  "opencorvus-overlay.exe",
)
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
await new Promise((r) => setTimeout(r, 3000))
console.log("--- Overlay ready, sending test events ---")

// Test 1: Click at center screen — popup should appear centered above this point
send({ type: "hint", x: 960, y: 540, action: "click", label: "click (960, 540)" })
await new Promise((r) => setTimeout(r, 2500))

// Test 2: Click at top-left area
send({ type: "hint", x: 300, y: 300, action: "click", label: "click (300, 300)" })
await new Promise((r) => setTimeout(r, 2500))

// Test 3: Type hint — should appear at same location (no coordinate change)
send({ type: "hint", x: 300, y: 300, action: "type", label: "type: Hello World" })
await new Promise((r) => setTimeout(r, 2500))

// Test 4: Key hint at bottom-right
send({ type: "hint", x: 1500, y: 800, action: "key", label: "key: Enter" })
await new Promise((r) => setTimeout(r, 2500))

// Test 5: Scroll hint
send({ type: "hint", x: 960, y: 540, action: "scroll", label: "scroll down 3" })
await new Promise((r) => setTimeout(r, 2500))

// Test 6: Done status — green accent
send({ type: "hint", x: 800, y: 400, action: "click", label: "done click (800, 400)", status: "done" })
await new Promise((r) => setTimeout(r, 2500))

// Test 7: Window highlight — should frame the specified rectangle
send({
  type: "window-highlight",
  x: 200,
  y: 150,
  width: 900,
  height: 650,
  label: "Target Window",
  duration_ms: 3000,
})
await new Promise((r) => setTimeout(r, 4000))

// Test 8: Smaller window highlight
send({
  type: "window-highlight",
  x: 500,
  y: 300,
  width: 400,
  height: 300,
  label: "Small Dialog",
  duration_ms: 2000,
})
await new Promise((r) => setTimeout(r, 3000))

console.log("--- All tests done, closing overlay ---")
proc.stdin!.end()
await new Promise((r) => setTimeout(r, 2000))
proc.kill()
process.exit(0)
