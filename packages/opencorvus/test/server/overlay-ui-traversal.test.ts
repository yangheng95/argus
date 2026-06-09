import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { OverlayUI } from "../../src/server/overlay-ui"
import { Log } from "../../src/util/log"

Log.init({ print: false })

/**
 * Path-traversal regression for `/ui/*`.
 *
 *  - audit-2026-04-29 opencorvus F7: `path.join(dir, reqPath)` with a
 *    naive `startsWith(dir)` had two holes (no separator boundary;
 *    URL-decoded `..` segments). Replaced with path.resolve +
 *    `${dir}${sep}` prefix compare.
 *  - audit-2026-04-29 opencorvus V6.a: NUL byte poisoning — Bun.file
 *    and Node fs disagree on whether `\0` truncates a path. Reject
 *    rather than letting libc choose.
 *  - audit-2026-04-29 opencorvus V6.b: symlink escape — once the
 *    resolved path is inside dir, a malicious symlink at that path
 *    pointing outside still leaked the target's bytes via Bun.file's
 *    transparent follow. realpath compare closes the gap.
 *
 * Tests drive `OverlayUI.validatePath` directly; the route handler
 * delegates to it so this is the single point of validation.
 */

describe("OverlayUI path traversal (audit opencorvus F7 / V6)", () => {
  let tempRoot: string
  let secretFile: string

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-ui-traversal-"))
    fs.mkdirSync(path.join(tempRoot, "ui"), { recursive: true })
    fs.writeFileSync(path.join(tempRoot, "ui", "index.html"), "<html>ok</html>")
    fs.mkdirSync(path.join(tempRoot, "ui-private"), { recursive: true })
    secretFile = path.join(tempRoot, "ui-private", "secret")
    fs.writeFileSync(secretFile, "TOPSECRET")
    fs.writeFileSync(path.join(tempRoot, "secret-outside"), "OUTSIDE")
  })

  afterEach(() => {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    } catch {}
  })

  test("validatePath rejects sibling-dir traversal (audit F7)", async () => {
    const dir = path.join(tempRoot, "ui")
    const probes = [
      "/../ui-private/secret",
      "/../secret-outside",
      "/../../etc/passwd",
      "/index.html/../../secret-outside",
    ]
    for (const reqPath of probes) {
      const result = await OverlayUI.validatePath(dir, reqPath)
      expect(result).toBe(null)
    }
  })

  test("validatePath accepts legitimate subpaths (audit F7)", async () => {
    const dir = path.join(tempRoot, "ui")
    // Pre-create the files so the realpath check has something to
    // resolve — non-existent files take the ENOENT pass-through path,
    // which is fine but we want to lock the existing-file branch too.
    fs.writeFileSync(path.join(tempRoot, "ui", "ok.js"), "// ok")
    const probes = ["/index.html", "/ok.js", "/"]
    for (const reqPath of probes) {
      const expected =
        reqPath === "/"
          ? path.resolve(dir, "./") // routes handler maps "/" → "/index.html" before calling validatePath
          : path.resolve(dir, "." + reqPath)
      const result = await OverlayUI.validatePath(dir, reqPath)
      expect(result).toBe(expected)
    }
  })

  test("validatePath rejects NUL byte poisoning (audit V6.a)", async () => {
    // Hono URL-decodes %00 to a literal NUL. Bun.file / Node fs treat
    // the NUL terminator inconsistently across platforms; libc-backed
    // paths truncate, ts-backed paths do not. Reject up-front so an
    // attacker can't pick the truncation behaviour they prefer.
    const dir = path.join(tempRoot, "ui")
    const probes = ["/index.html\0/../secret-outside", "/\0/index.html", "/index.html\0"]
    for (const reqPath of probes) {
      const result = await OverlayUI.validatePath(dir, reqPath)
      expect(result).toBe(null)
    }
  })

  test("validatePath rejects symlink that escapes the overlay dir (audit V6.b)", async () => {
    // Plant a symlink inside ui/ pointing OUTSIDE. Pre-fix the path
    // check ran on the symlink path itself (which is inside ui/), but
    // Bun.file follows the link and would serve the target's bytes —
    // a real exfil vector if a tampered VSIX or a misconfigured dev
    // tree contains such a link. realpath compare closes it.
    const dir = path.join(tempRoot, "ui")
    const linkPath = path.join(dir, "leaky.txt")
    try {
      fs.symlinkSync(secretFile, linkPath)
    } catch (err) {
      // Windows without symlink privilege returns EPERM; skip — the
      // realpath compare is still exercised on POSIX runners (which
      // is where the VSIX symlink-preservation attack actually
      // manifests, since Windows VSIX strips symlinks).
      const code = (err as NodeJS.ErrnoException).code
      if (code === "EPERM" || code === "EACCES" || code === "ENOSYS") return
      throw err
    }
    const result = await OverlayUI.validatePath(dir, "/leaky.txt")
    expect(result).toBe(null)
  })

  test("validatePath accepts symlink that stays inside the overlay dir", async () => {
    // Negative control: an in-dir symlink (e.g. a vite chunk renamed
    // post-build) MUST still resolve. Otherwise the V6 fix would
    // break legitimate link-bearing bundles.
    const dir = path.join(tempRoot, "ui")
    const realTarget = path.join(dir, "real.txt")
    fs.writeFileSync(realTarget, "hello")
    const linkPath = path.join(dir, "alias.txt")
    try {
      fs.symlinkSync(realTarget, linkPath)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === "EPERM" || code === "EACCES" || code === "ENOSYS") return
      throw err
    }
    const result = await OverlayUI.validatePath(dir, "/alias.txt")
    // The pre-realpath resolved path (still inside dir).
    expect(result).toBe(linkPath)
  })

  // The Hono integration test was removed — Hono normalises `..`
  // segments in URL routing BEFORE the handler sees them, so a
  // request like `/ui/../secret` becomes `/secret` which never hits
  // the `/ui/*` handler. The handler's traversal guard exists for
  // requests that arrive with non-normalised paths (custom HTTP
  // clients, raw curl) — verifying that path with Hono's route
  // matcher would test Hono, not our guard. The pure-function
  // tests above lock the fix directly.
})
