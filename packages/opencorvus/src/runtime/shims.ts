// Centralized process-level shims.
// All global side-effects that run once at startup are collected here
// so they are easy to audit and test.
//
// Side-effects that depend on runtime data (config parse results, server
// startup, Flag namespace, TUI context) stay in their original modules.

declare const OPENCORVUS_EMBEDDED_ENV: Record<string, string> | undefined

let installed = false

function warn(step: string, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[opencorvus bootstrap] ${step}: ${detail}\n`)
}

export function installProcessShims() {
  if (installed) return
  installed = true

  // 1. Apply embedded env vars (baked in at build time via --embed-env).
  //    External env vars take priority so users can still override at runtime.
  try {
    if (typeof OPENCORVUS_EMBEDDED_ENV === "object" && OPENCORVUS_EMBEDDED_ENV) {
      for (const [key, value] of Object.entries(OPENCORVUS_EMBEDDED_ENV)) {
        if (!(key in process.env) || process.env[key] === undefined) {
          process.env[key] = value
        }
      }
    }
  } catch (error) {
    warn("apply embedded env", error)
  }

  // 2. Restore original CWD if launched via the self-contained launcher
  //    (launcher.ts changes CWD to the binary's directory for native module resolution)
  if (process.env.OPENCORVUS_ORIGINAL_CWD) {
    try {
      process.chdir(process.env.OPENCORVUS_ORIGINAL_CWD)
    } catch (error) {
      warn("restore original cwd", error)
    }
  }

  // 3. Mark this process as an agent / opencorvus instance
  process.env.AGENT = "1"
  process.env.OPENCORVUS = "1"

  // 4. Prevent ai-sdk from logging warnings to stdout
  //    https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
  muteAISdkWarnings()

  // 5. Auto-detect Windows system proxy when no explicit env is set.
  //    Bun's fetch only honors HTTP_PROXY / HTTPS_PROXY / NO_PROXY env vars
  //    and ignores the OS-level proxy configuration (Internet Options /
  //    Settings → Network → Proxy / WPAD). On corporate VMs that ship a
  //    system proxy via Group Policy this leaves outbound fetches going
  //    direct, which then get firewalled. We mirror the Windows registry
  //    settings into env vars before any fetch fires.
  try {
    detectSystemProxy()
  } catch (error) {
    warn("detect system proxy", error)
  }
}

/**
 * Read Windows system proxy configuration and populate HTTP_PROXY /
 * HTTPS_PROXY / NO_PROXY env vars when they are not already set.
 *
 * Source: HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings
 *   - ProxyEnable     0x1 = enabled
 *   - ProxyServer     "host:port"  or  "http=h:p;https=h:p;ftp=h:p;socks=h:p"
 *   - ProxyOverride   semicolon-separated bypass; "<local>" expands to
 *                     localhost / 127.0.0.1 / ::1 / *.local
 *   - AutoConfigURL   PAC URL — we cannot evaluate JavaScript PAC files
 *                     here, so we just emit a warning so the operator knows
 *                     to configure HTTPS_PROXY manually.
 *
 * No-op on non-Windows platforms (Linux/macOS pass HTTP_PROXY via shell or
 * have richer per-network config not worth shimming here).
 */
function detectSystemProxy() {
  if (process.platform !== "win32") return
  if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) return

  const settings = readWinProxyRegistry()
  if (!settings) return

  if (settings.autoConfigUrl && !settings.proxyServer) {
    process.stderr.write(
      `[opencorvus bootstrap] Windows AutoConfigURL (PAC) detected: ${settings.autoConfigUrl}. ` +
        `Bun's fetch cannot execute PAC files — set HTTPS_PROXY explicitly to route requests.\n`,
    )
    return
  }

  if (!settings.enabled || !settings.proxyServer) return

  const { http, https } = parseWinProxyServer(settings.proxyServer)
  if (https && !process.env.HTTPS_PROXY) process.env.HTTPS_PROXY = https
  if (http && !process.env.HTTP_PROXY) process.env.HTTP_PROXY = http

  if (settings.proxyOverride && !process.env.NO_PROXY) {
    const noProxy = expandWinProxyOverride(settings.proxyOverride)
    if (noProxy) process.env.NO_PROXY = noProxy
  }
}

interface WinProxySettings {
  enabled: boolean
  proxyServer: string
  proxyOverride: string
  autoConfigUrl: string
}

function readWinProxyRegistry(): WinProxySettings | undefined {
  // execSync is heavier than ideal (~30ms) but runs once at startup and
  // avoids pulling in a native dependency just for proxy detection.
  const child_process = require("child_process") as typeof import("child_process")
  const out = child_process
    .execFileSync(
      "reg.exe",
      ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 },
    )
    .toString()

  const grab = (name: string, type: string) => {
    const re = new RegExp(`^\\s*${name}\\s+${type}\\s+(.*?)\\s*$`, "mi")
    const m = re.exec(out)
    return m ? m[1] : ""
  }

  const enableRaw = grab("ProxyEnable", "REG_DWORD")
  return {
    enabled: enableRaw ? parseInt(enableRaw, 16) !== 0 : false,
    proxyServer: grab("ProxyServer", "REG_SZ"),
    proxyOverride: grab("ProxyOverride", "REG_SZ"),
    autoConfigUrl: grab("AutoConfigURL", "REG_SZ"),
  }
}

function parseWinProxyServer(value: string): { http?: string; https?: string } {
  // Per-protocol form: "http=h:p;https=h:p;ftp=h:p;socks=h:p"
  if (value.includes("=")) {
    const out: { http?: string; https?: string } = {}
    for (const part of value.split(";")) {
      const eq = part.indexOf("=")
      if (eq <= 0) continue
      const proto = part.slice(0, eq).trim().toLowerCase()
      const addr = part.slice(eq + 1).trim()
      if (!addr) continue
      const url = addr.includes("://") ? addr : `http://${addr}`
      if (proto === "https") out.https = url
      else if (proto === "http") out.http = url
    }
    // Some configs only set http=; treat it as the https proxy too so TLS
    // requests don't silently bypass the proxy.
    if (out.http && !out.https) out.https = out.http
    return out
  }
  // Universal form: "host:port"
  const url = value.includes("://") ? value : `http://${value}`
  return { http: url, https: url }
}

function expandWinProxyOverride(value: string): string {
  const tokens = value
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
  const out: string[] = []
  for (const tok of tokens) {
    if (tok === "<local>") {
      out.push("localhost", "127.0.0.1", "::1", "*.local")
    } else {
      out.push(tok)
    }
  }
  return out.join(",")
}

export const installRuntimeShims = installProcessShims

export function muteAISdkWarnings() {
  // @ts-ignore
  globalThis.AI_SDK_LOG_WARNINGS = false
}
