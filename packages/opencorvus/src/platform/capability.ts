import { existsSync } from "fs"
import path from "path"
import { release } from "os"
import { overlayDiagnostic } from "../tool/overlay-client"

declare const OPENCORVUS_LIBC: string | undefined

export namespace Capability {
  export type State = "ok" | "warn" | "fail"

  export type Item = {
    id: string
    title: string
    state: State
    detail: string
    hint?: string
  }

  export type Report = {
    platform: string
    arch: string
    items: Item[]
    total: {
      ok: number
      warn: number
      fail: number
    }
  }

  let cache: Report | undefined
  let pending: Promise<Report> | undefined

  function line(id: string, title: string, state: State, detail: string, hint?: string): Item {
    return { id, title, state, detail, hint }
  }

  function text(err: unknown) {
    if (err instanceof Error) return err.message
    return String(err)
  }

  function libc() {
    const built = typeof OPENCORVUS_LIBC === "string" ? OPENCORVUS_LIBC : undefined
    return built || process.env.OPENCORVUS_LIBC || "glibc"
  }

  function wsl() {
    if (process.platform !== "linux") return false
    const value = release().toLowerCase()
    return value.includes("microsoft") || value.includes("wsl")
  }

  function session() {
    return process.env.XDG_SESSION_TYPE?.trim().toLowerCase() ?? ""
  }

  function watcherPkg() {
    const base = `@parcel/watcher-${process.platform}-${process.arch}`
    if (process.platform !== "linux") return base
    return `${base}-${libc()}`
  }

  function watcher() {
    const pkg = watcherPkg()
    try {
      require(pkg)
      return line("watcher", "File watcher binding", "ok", pkg)
    } catch (err) {
      return line(
        "watcher",
        "File watcher binding",
        "fail",
        `${pkg} not loadable: ${text(err)}`,
        "Reinstall dependencies for this platform, then run typecheck again.",
      )
    }
  }

  function displaySession() {
    if (process.platform !== "linux") {
      return line("display_session", "Display session", "ok", "n/a")
    }
    if (wsl()) {
      return line(
        "display_session",
        "Display session",
        "warn",
        `wsl (${release()})`,
        "WSL GUI automation needs WSLg/X server. For headless use Xvfb and set DISPLAY.",
      )
    }
    const type = session()
    if (type === "x11") {
      return line("display_session", "Display session", "ok", "x11")
    }
    if (type === "wayland") {
      return line(
        "display_session",
        "Display session",
        "warn",
        "wayland",
        "Wayland support depends on compositor. If capture/input is unstable, try X11.",
      )
    }
    if (type) {
      return line(
        "display_session",
        "Display session",
        "warn",
        type,
        "Unknown Linux display session. Verify capture/input compatibility.",
      )
    }
    return line(
      "display_session",
      "Display session",
      "warn",
      "unknown",
      "XDG_SESSION_TYPE is not set. Verify display server environment variables.",
    )
  }

  function overlayHint(reason: string | undefined, present: boolean) {
    if (!present) {
      return "Set OPENCORVUS_OVERLAY_BIN to a valid overlay binary, or build packages/overlay/src-tauri."
    }
    if (!reason) return "Restart OpenCorvus to reinitialize the overlay sidecar."
    if (reason === "disabled") return "Unset OPENCORVUS_OVERLAY_DISABLED to enable desktop confirmation overlay."
    if (reason === "spawn_failed") return "Check binary permissions and antivirus/quarantine, then retry."
    if (reason === "process_exited") return "Overlay process exited unexpectedly. Check logs for crash details."
    if (reason === "retry_backoff") return "Overlay is recovering from repeated failures. Wait a moment, then retry."
    if (reason === "circuit_open")
      return "Overlay entered self-protection mode after repeated failures. Wait for cooldown and retry."
    if (reason === "stdin_unavailable" || reason === "stdout_unavailable") {
      return "Overlay stdio is unavailable. Restart the process and check terminal sandbox policies."
    }
    if (reason === "stdout_read_failed" || reason === "write_failed") {
      return "Overlay IO failed. Restart and verify the binary matches current platform."
    }
    return "Restart OpenCorvus and verify overlay binary path."
  }

  export function overlayItem() {
    const diag = overlayDiagnostic()
    const present = existsSync(diag.path)
    if (!present) {
      return line(
        "overlay_confirm",
        "Desktop confirm overlay",
        "warn",
        `missing binary: ${diag.path}`,
        overlayHint(diag.reason, present),
      )
    }
    if (!diag.available) {
      return line(
        "overlay_confirm",
        "Desktop confirm overlay",
        "warn",
        `${diag.path} (unavailable: ${diag.reason || "unknown"})`,
        overlayHint(diag.reason, present),
      )
    }
    return line("overlay_confirm", "Desktop confirm overlay", "ok", diag.path)
  }

  function clipboardLinux() {
    const read = Bun.which("wl-paste") || Bun.which("xclip")
    const write = Bun.which("wl-copy") || Bun.which("xclip") || Bun.which("xsel")
    if (read && write) {
      return line("clipboard", "Clipboard bridge", "ok", `read=${path.basename(read)} write=${path.basename(write)}`)
    }
    const miss = [read ? undefined : "read", write ? undefined : "write"]
      .filter((x): x is string => Boolean(x))
      .join("+")
    return line(
      "clipboard",
      "Clipboard bridge",
      "warn",
      `linux clipboard helper incomplete (${miss})`,
      "Install wl-clipboard or xclip/xsel to improve Linux clipboard reliability.",
    )
  }

  function clipboardDarwin() {
    const bin = Bun.which("osascript")
    if (bin) return line("clipboard", "Clipboard bridge", "ok", path.basename(bin))
    return line(
      "clipboard",
      "Clipboard bridge",
      "warn",
      "osascript not found",
      "Ensure AppleScript runtime is available for native clipboard flows.",
    )
  }

  function clipboardWin(label: string) {
    const bin = Bun.which("powershell.exe") || Bun.which("pwsh.exe") || Bun.which("powershell") || Bun.which("pwsh")
    if (bin) return line("clipboard", "Clipboard bridge", "ok", `${label} via ${path.basename(bin)}`)
    return line(
      "clipboard",
      "Clipboard bridge",
      "warn",
      `${label} without powershell`,
      "Install PowerShell to keep image clipboard and paste flows stable.",
    )
  }

  function clipboard() {
    if (process.platform === "darwin") return clipboardDarwin()
    if (process.platform === "win32") return clipboardWin("windows")
    if (wsl()) return clipboardWin("wsl")
    if (process.platform === "linux") return clipboardLinux()
    return line("clipboard", "Clipboard bridge", "warn", `platform ${process.platform} not explicitly validated`)
  }

  function screenHint() {
    if (process.platform === "darwin") {
      return "Grant Screen Recording permission to OpenCorvus/Terminal and restart the app."
    }
    if (process.platform === "linux" && wsl()) {
      return "WSL needs WSLg/X server for screen capture. For headless use Xvfb and set DISPLAY."
    }
    if (process.platform === "linux" && session() === "wayland") {
      return "Wayland capture may be restricted by compositor. Try OC_ALLOW_WAYLAND=1 or switch to X11."
    }
    if (process.platform === "linux") {
      return "Ensure a desktop session is active and DISPLAY is set, then retry."
    }
    return "Install platform display dependencies and verify node-screenshots native module."
  }

  async function screen() {
    try {
      const mod = await import("node-screenshots")
      const list = mod.Monitor.all()
      if (list.length > 0) return line("screen_capture", "Screen capture backend", "ok", `monitors=${list.length}`)
      return line(
        "screen_capture",
        "Screen capture backend",
        "warn",
        "node-screenshots loaded but no monitor detected",
        screenHint(),
      )
    } catch (err) {
      return line("screen_capture", "Screen capture backend", "fail", text(err), screenHint())
    }
  }

  function inputHint() {
    if (process.platform === "win32") {
      return "Ensure Bun FFI can access user32.dll. Install @nut-tree-fork packages for fallback input paths."
    }
    if (process.platform === "darwin") {
      return "Grant Accessibility permission to OpenCorvus/Terminal and restart the app."
    }
    if (process.platform === "linux" && wsl()) {
      return "WSL input automation needs WSLg/X server. For headless use Xvfb and set DISPLAY."
    }
    if (process.platform === "linux" && session() === "wayland") {
      return "Wayland may block synthetic input on some compositors. Prefer X11 for reliability."
    }
    if (process.platform === "linux") {
      return "Ensure a desktop session is active and libnut dependencies are installed."
    }
    return "Reinstall @nut-tree-fork packages for this platform and verify accessibility permissions."
  }

  function input() {
    if (process.platform === "win32") {
      try {
        const ffi = require("bun:ffi")
        const lib = ffi.dlopen("user32.dll", {
          SetCursorPos: { args: ["i32", "i32"], returns: "i32" },
          keybd_event: { args: ["u8", "u8", "u32", "u32"], returns: "void" },
        })
        lib.close()
        return line("desktop_input", "Desktop input backend", "ok", "win32 user32.dll FFI")
      } catch (err) {
        return line("desktop_input", "Desktop input backend", "fail", text(err), inputHint())
      }
    }
    try {
      const nut = require.resolve("@nut-tree-fork/nut-js")
      const lib = require.resolve("@nut-tree-fork/libnut", { paths: [path.dirname(nut)] })
      require(lib)
      return line("desktop_input", "Desktop input backend", "ok", "nut-js + libnut")
    } catch (err) {
      return line("desktop_input", "Desktop input backend", "fail", text(err), inputHint())
    }
  }

  async function winFfi() {
    if (process.platform !== "win32") return line("win32_ffi", "Windows console FFI", "ok", "n/a")
    try {
      const ffi = await import("bun:ffi")
      const lib = ffi.dlopen("kernel32.dll", {
        GetStdHandle: { args: ["i32"], returns: "ptr" },
      })
      lib.close()
      return line("win32_ffi", "Windows console FFI", "ok", "kernel32.dll")
    } catch (err) {
      return line(
        "win32_ffi",
        "Windows console FFI",
        "fail",
        text(err),
        "Bun FFI failed to load kernel32.dll. Check runtime and platform compatibility.",
      )
    }
  }

  async function collectFresh() {
    const checks = [
      screen(),
      winFfi(),
      Promise.resolve(watcher()),
      Promise.resolve(displaySession()),
      Promise.resolve(overlayItem()),
      Promise.resolve(clipboard()),
      Promise.resolve(input()),
    ]
    const items = await Promise.all(checks)
    const total = items.reduce(
      (acc, item) => ({
        ok: acc.ok + (item.state === "ok" ? 1 : 0),
        warn: acc.warn + (item.state === "warn" ? 1 : 0),
        fail: acc.fail + (item.state === "fail" ? 1 : 0),
      }),
      { ok: 0, warn: 0, fail: 0 },
    )
    return {
      platform: process.platform,
      arch: process.arch,
      items,
      total,
    } satisfies Report
  }

  export function cached() {
    return cache
  }

  export function cachedItem(id: string) {
    return cache?.items.find((item) => item.id === id)
  }

  export async function preflight(force = false) {
    if (!force && cache) return cache
    if (!force && pending) return pending
    const task = collectFresh().then((report) => {
      cache = report
      return report
    })
    pending = task.finally(() => {
      pending = undefined
    })
    return pending
  }

  export async function collect(force = false) {
    return preflight(force)
  }
}
