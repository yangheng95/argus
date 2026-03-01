import { join } from "path"
import { fileURLToPath } from "url"

// Resolve the binary path relative to this source file.
// Compiled binary lives at: packages/overlay/src-tauri/target/release/argus-overlay.exe
function resolveBinaryPath(): string {
  const thisDir = fileURLToPath(new URL(".", import.meta.url))
  // Traverse: src/tool → src → packages/argus → packages/overlay
  return join(thisDir, "..", "..", "..", "overlay", "src-tauri", "target", "release", "argus-overlay.exe")
}

const BINARY_PATH = resolveBinaryPath()

let proc: ReturnType<typeof Bun.spawn> | null = null
let procDead = false

function ensureProcess(): ReturnType<typeof Bun.spawn> | null {
  if (process.env.ARGUS_OVERLAY_DISABLED === "1") return null

  // Check if binary exists (sync stat; cheap for a cached path)
  try {
    const stat = Bun.file(BINARY_PATH)
    if (!stat) return null
  } catch {
    return null
  }

  if (proc && !procDead) return proc

  try {
    proc = Bun.spawn([BINARY_PATH], {
      stdin: "pipe",
      stdout: "ignore",
      stderr: "ignore",
    })
    procDead = false

    // Mark dead when process exits so we re-spawn next call
    proc.exited.then(() => {
      procDead = true
      proc = null
    }).catch(() => {
      procDead = true
      proc = null
    })

    return proc
  } catch {
    return null
  }
}

/**
 * Show an overlay popup at the given screen coordinates.
 * Fire-and-forget — never throws, never blocks the caller.
 */
export function showOverlay(screenX: number, screenY: number, action: string, label: string): void {
  // Run entirely async; caller is not awaited
  void (async () => {
    try {
      const p = ensureProcess()
      if (!p) return

      const line = JSON.stringify({ x: screenX, y: screenY, action, label }) + "\n"
      const stdin = p.stdin
      if (!stdin || typeof stdin === "number") return
      await stdin.write(new TextEncoder().encode(line))
    } catch {
      // Silently ignore all errors — overlay is best-effort
    }
  })()
}
