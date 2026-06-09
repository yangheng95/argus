import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { UnsupportedPlatformError } from "./errors"

/**
 * Resolve the OpenCorvus sidecar binary bundled inside the VSIX.
 *
 * Maps Node `process.platform`/`process.arch` → official VS Code
 * platform-specific extension target string (plan §8 / §19.3 step F):
 *   win32-x64, win32-arm64, darwin-x64, darwin-arm64, linux-x64, linux-arm64
 *
 * Layout inside an installed VSIX:
 *   <extensionPath>/bin/<target>/opencorvus[.exe]
 *
 * Behaviour is fail-loud (plan §1 "明确失败"):
 *   - target unsupported → UnsupportedPlatformError
 *   - binary missing for current target → UnsupportedPlatformError with a
 *     remote-vs-local hint (plan §9: WSL / SSH users must install the
 *     matching remote VSIX, not the host one).
 */

export interface ResolvedBinary {
  target: string
  binaryPath: string
}

export function resolveTarget(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
  if (platform === "win32" && arch === "x64") return "win32-x64"
  if (platform === "win32" && arch === "arm64") return "win32-arm64"
  if (platform === "darwin" && arch === "x64") return "darwin-x64"
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64"
  if (platform === "linux" && arch === "x64") return "linux-x64"
  if (platform === "linux" && arch === "arm64") return "linux-arm64"
  throw new UnsupportedPlatformError(`${platform}-${arch}`, "(target resolution)")
}

export function executableName(target: string): string {
  return target.startsWith("win32-") ? "opencorvus.exe" : "opencorvus"
}

export interface ResolveOptions {
  extensionRoot: string
  /** Override target string (used by tests). */
  targetOverride?: string
  /** Skip env override (used by production callers). */
  ignoreEnvOverride?: boolean
}

export function resolveBundledBinary(opts: ResolveOptions): ResolvedBinary {
  // Dev-only override: extension developers point at a fresh build of
  // the sidecar without repacking the VSIX. The env var is read via
  // direct property access (NOT process.env[name]) so esbuild's
  // `define` substitution can rewrite the read site to `undefined` in
  // production bundles, dead-code-eliminating the entire branch
  // (plan §17). The literal string never makes it into the release
  // bundle either, so a release VSIX cannot be tricked into loading
  // a dev sidecar via env at runtime.
  if (!opts.ignoreEnvOverride && process.env.OPENCORVUS_DEV_BINARY) {
    const override = process.env.OPENCORVUS_DEV_BINARY
    if (!fs.existsSync(override)) {
      throw new UnsupportedPlatformError(`dev-override (OPENCORVUS_DEV_BINARY) does not exist`, opts.extensionRoot)
    }
    return { target: opts.targetOverride ?? "dev-override", binaryPath: override }
  }

  const target = opts.targetOverride ?? resolveTarget()
  const binDir = path.join(opts.extensionRoot, "bin", target)
  const binaryPath = path.join(binDir, executableName(target))

  if (!fs.existsSync(binaryPath)) {
    const hostKind = detectExtensionHostHint()
    throw new UnsupportedPlatformError(`${target} (host=${hostKind})`, opts.extensionRoot)
  }

  // Best-effort: ensure executable bit on Unix. Tar extraction in some
  // installers loses it; fixing it here is cheap and idempotent.
  if (target !== "win32-x64" && target !== "win32-arm64") {
    try {
      const stat = fs.statSync(binaryPath)
      if ((stat.mode & 0o111) === 0) {
        fs.chmodSync(binaryPath, stat.mode | 0o111)
      }
    } catch {
      // chmod failure is not fatal — spawn will surface a clear EACCES
      // and the user gets the right error.
    }
  }

  return { target, binaryPath }
}

/**
 * Best-effort detection of "where this extension host is running" so the
 * UnsupportedPlatformError can hint "install in remote, not local". This
 * is heuristic only; never used for control flow.
 */
function detectExtensionHostHint(): string {
  if (process.env["WSL_DISTRO_NAME"]) return `WSL/${process.env["WSL_DISTRO_NAME"]}`
  if (process.env["SSH_CONNECTION"]) return "ssh-remote"
  if (process.env["REMOTE_CONTAINERS"] === "true") return "dev-container"
  if (process.env["CODESPACES"] === "true") return "codespace"
  return `${os.platform()}-${os.arch()}`
}
