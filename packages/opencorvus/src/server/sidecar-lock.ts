import crypto from "crypto"
import fs from "fs"
import path from "path"
import { Global } from "../global"
import { Log } from "../util/log"

const log = Log.create({ service: "sidecar-lock" })

export namespace SidecarLock {
  export interface LockInfo {
    pid: number
    port: number
    hostname: string
    parentPid: number
    workspace: string
    startedAt: number
  }

  /**
   * audit-2026-04-29 W2-V7 — gate lock-file consumption on a strict
   * shape check. Pre-fix the readers consumed the JSON.parse result
   * directly and assumed every field was present and well-typed; a
   * lock containing `{}` would bypass ownership checks because
   * `current.pid !== info.pid` evaluates to `undefined !== <pid>` =>
   * truthy, so release() happily deleted a foreign sidecar's empty
   * stub. Validate up-front and treat any malformed shape as if the
   * file did not exist.
   */
  function isLockInfo(x: unknown): x is LockInfo {
    if (!x || typeof x !== "object") return false
    const o = x as Record<string, unknown>
    return (
      typeof o.pid === "number" &&
      Number.isInteger(o.pid) &&
      o.pid > 0 &&
      typeof o.port === "number" &&
      Number.isInteger(o.port) &&
      o.port > 0 &&
      typeof o.hostname === "string" &&
      typeof o.parentPid === "number" &&
      Number.isInteger(o.parentPid) &&
      o.parentPid > 0 &&
      typeof o.workspace === "string" &&
      typeof o.startedAt === "number" &&
      Number.isFinite(o.startedAt)
    )
  }

  /**
   * audit-2026-04-29 W2-V8 — workspace fingerprint must distinguish
   * paths that look different but resolve to the same on-disk dir.
   * Pre-fix the safe-name was a simple `replace(/[^a-zA-Z0-9_-]/g, "_")`
   * truncated to 80 chars. Two pitfalls:
   *  (a) `/Users/Foo` and `/users/FOO` are the SAME directory on
   *      Windows NTFS / macOS HFS+ (case-insensitive). Independent
   *      safe-names produced two different lock files and two
   *      sidecars happily ran on the same workspace — exactly the
   *      §19.1.1 violation the lock was supposed to prevent.
   *  (b) Two genuinely-different paths whose safe-names truncate to
   *      the same 80 chars collide silently, with the same effect
   *      (one sidecar accidentally stomps the other's lock).
   * Fix: normalise (resolve + lowercase on case-insensitive FS) and
   * append a 16-hex-char SHA-256 prefix so collisions are
   * negligible. Keep a 40-char readable safe-name prefix so an
   * operator can still grep `ls state/` for the workspace they want.
   */
  function lockFilePath(workspace: string): string {
    const resolved = path.resolve(workspace)
    const normalized = process.platform === "win32" || process.platform === "darwin" ? resolved.toLowerCase() : resolved
    const hash = crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16)
    const safe = resolved.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40)
    return path.join(Global.Path.state, `sidecar.${safe}.${hash}.lock`)
  }

  function isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch (err: any) {
      if (err?.code === "EPERM") return true
      return false
    }
  }

  /**
   * Detect a live managed sidecar already owning this workspace.
   * Returns the live LockInfo or null.
   *
   * NOTE: regular `opencorvus serve` daemons do not write this lock,
   * so they are not detected here. That gap is documented in §19.1.1
   * follow-up: detection of non-managed external daemons is deferred.
   * Managed sidecars never co-exist with another managed sidecar on the
   * same workspace, which is the immediate VSCode multi-window concern.
   */
  export function detectExisting(workspace: string): LockInfo | null {
    const file = lockFilePath(workspace)
    let raw: string
    try {
      raw = fs.readFileSync(file, "utf8")
    } catch {
      return null
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      log.warn("malformed lock file, treating as stale", { file })
      try {
        fs.unlinkSync(file)
      } catch {}
      return null
    }
    if (!isLockInfo(parsed)) {
      log.warn("lock file shape invalid, treating as stale", { file })
      try {
        fs.unlinkSync(file)
      } catch {}
      return null
    }
    const info = parsed
    if (!isProcessAlive(info.pid)) {
      log.info("stale lock from dead pid, removing", { file, pid: info.pid })
      try {
        fs.unlinkSync(file)
      } catch {}
      return null
    }
    return info
  }

  /**
   * Write the lock file for this managed sidecar. Caller MUST call
   * release() before exiting; sidecar lifecycle hooks handle this.
   *
   * audit-2026-04-29 opencorvus F2 — uses O_EXCL (`flag: "wx"`) so the
   * lock acquisition is atomic: two sidecars racing to write the same
   * file get exactly one winner; the loser sees EEXIST. The caller
   * (sidecar.ts) detects existing locks via `detectExisting` first;
   * but between the check and the write, another sidecar could have
   * just written its own lock — without exclusive create the loser
   * silently overwrites the winner, breaking §19.1.1.
   *
   * Throws SidecarLockContendedError on EEXIST so the caller can map
   * to exit code 3 with the same message path as the regular
   * "existing instance" rejection.
   */
  export class SidecarLockContendedError extends Error {
    override readonly name = "SidecarLockContendedError"
    constructor(
      public readonly file: string,
      public readonly existing: LockInfo | null,
    ) {
      super(
        existing
          ? `existing managed sidecar holds the workspace lock (PID=${existing.pid}, port=${existing.port})`
          : `another sidecar is racing to acquire the workspace lock (file=${file})`,
      )
    }
  }

  export function acquire(info: LockInfo): { file: string; release: () => void } {
    const file = lockFilePath(info.workspace)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    try {
      fs.writeFileSync(file, JSON.stringify(info, null, 2), {
        encoding: "utf8",
        flag: "wx",
      })
    } catch (err: any) {
      if (err?.code === "EEXIST") {
        // The pre-check (detectExisting) already auto-pruned dead
        // PIDs, so a live lock here is genuine contention. Read it
        // back so the caller has the live PID for the error message.
        // audit-2026-04-29 W2-V7 — gate on isLockInfo so a malformed
        // existing file doesn't propagate `undefined` fields into
        // the error message rendering.
        let existing: LockInfo | null = null
        try {
          const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"))
          if (isLockInfo(parsed)) existing = parsed
        } catch {}
        throw new SidecarLockContendedError(file, existing)
      }
      throw err
    }
    log.info("acquired", { file, pid: info.pid, port: info.port })
    return {
      file,
      release: () => {
        // audit-2026-04-29 W2-V3 — retry release a few times on
        // EBUSY / EPERM / transient IO. Without retry, a Windows AV
        // that briefly opens the lock file forces the release to
        // fail; the sidecar then exits and leaves the lock orphaned
        // until `detectExisting` auto-prunes via the dead-PID path.
        // During that window, a new sidecar boot sees the stale
        // lock and exits 3 with a confusing "another instance" hint.
        const MAX_ATTEMPTS = 3
        let lastErr: unknown
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          try {
            const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"))
            // audit-2026-04-29 W2-V7 — fail-safe on malformed shape:
            // a lock file `{}` or `{pid: "abc"}` would let the old
            // `current.pid !== info.pid` check evaluate `undefined !==
            // <our-pid>` => true, so we'd happily delete a foreign
            // sidecar's stub. Refuse to release unless the file
            // unambiguously belongs to us.
            if (!isLockInfo(parsed)) {
              log.warn("release found malformed lock, refusing to delete", { file })
              return
            }
            const current = parsed
            if (current.pid !== info.pid) return // not ours anymore
            fs.unlinkSync(file)
            log.info("released", { file })
            return
          } catch (err: any) {
            lastErr = err
            if (err?.code === "ENOENT") return // already gone — fine
            if (attempt < MAX_ATTEMPTS) {
              // Synchronous tiny back-off; the sidecar is in
              // shutdown so we want to finish quickly.
              const until = Date.now() + 50
              while (Date.now() < until) {
                /* spin */
              }
            }
          }
        }
        log.warn("release failed after retries", { file, attempts: MAX_ATTEMPTS, error: String(lastErr) })
      },
    }
  }
}
