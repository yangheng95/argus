import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Filesystem } from "../../src/util/filesystem"

/**
 * 2026-04-30 W2-V33 — `Filesystem.resolve` must reject paths shaped
 * for the wrong OS at the system boundary, not silently mangle them.
 *
 * Pre-fix darwin instances received `C:\Users\<u>\Downloads\<x>` from
 * settings synced out of a Windows session and shoved the string into
 * `path.resolve`, which on POSIX treats `C:\...` as a relative path
 * fragment. The result was a literal directory name with embedded
 * backslashes prepended by `process.cwd()` — an unparseable mess that
 * cascaded into git invocations producing opaque "no such directory"
 * errors. Rejecting at the boundary turns "phantom corruption" into
 * `InvalidDirectoryError(reason)` with explicit operator-readable
 * detail (rule 1: don't paper over problems).
 *
 * Coverage:
 * - non-Windows + Windows-style path (`C:\` / `C:/`)        → throws
 * - Windows + bare POSIX path NOT a Bash mount               → throws
 * - Windows + Bash mount path (`/c/...`, `/mnt/c/...`)       → resolves
 * - Windows + UNC path (`//server/share`)                    → resolves
 * - same-platform paths                                      → resolve
 * - OPENCORVUS_WINDOWS_DRIVE_MOUNTS env extends mount list   → respected
 *
 * Platform mocking is via mutating `process.platform` for the duration
 * of each test — the reference loop reads it at call time, not at
 * module load, so this is sufficient.
 */

const ORIGINAL_PLATFORM = process.platform

function setPlatform(value: NodeJS.Platform) {
  Object.defineProperty(process, "platform", {
    value,
    configurable: true,
  })
}

describe("Filesystem.resolve cross-platform validation (W2-V33)", () => {
  beforeEach(() => {
    delete process.env.OPENCORVUS_WINDOWS_DRIVE_MOUNTS
  })

  afterEach(() => {
    setPlatform(ORIGINAL_PLATFORM)
    delete process.env.OPENCORVUS_WINDOWS_DRIVE_MOUNTS
  })

  describe("on darwin/linux", () => {
    beforeEach(() => setPlatform("darwin"))

    test("throws InvalidDirectoryError on a Windows-shaped path with backslash", () => {
      let thrown: unknown
      try {
        Filesystem.resolve("C:\\Users\\foo\\Downloads\\bar")
      } catch (e) {
        thrown = e
      }
      expect(thrown).toBeInstanceOf(Filesystem.InvalidDirectoryError)
      expect((thrown as Filesystem.InvalidDirectoryError).data.reason).toBe("windows-path-on-posix")
    })

    test("throws InvalidDirectoryError on a Windows-shaped path with forward slash", () => {
      let thrown: unknown
      try {
        Filesystem.resolve("D:/myhexin-local/argus")
      } catch (e) {
        thrown = e
      }
      expect(thrown).toBeInstanceOf(Filesystem.InvalidDirectoryError)
      expect((thrown as Filesystem.InvalidDirectoryError).data.reason).toBe("windows-path-on-posix")
    })

    test("accepts a normal POSIX absolute path without throwing", () => {
      // We only assert non-throw + non-empty; the actual `pathResolve`
      // call dispatches to the host's native path module, which on a
      // Windows test host still applies win32 semantics regardless of
      // our `process.platform` mock. The semantic contract this test
      // pins is "the validation branch did not reject it".
      const out = Filesystem.resolve("/Users/alice/projects/demo")
      expect(typeof out).toBe("string")
      expect(out.length).toBeGreaterThan(0)
    })

    test("accepts a relative POSIX path (resolved against cwd)", () => {
      const out = Filesystem.resolve("./packages/opencorvus")
      expect(typeof out).toBe("string")
      expect(/packages.opencorvus/i.test(out)).toBe(true)
    })
  })

  describe("on win32", () => {
    beforeEach(() => setPlatform("win32"))

    test("accepts a native Windows absolute path", () => {
      const out = Filesystem.resolve("C:/Users/alice/repo")
      // On a real win32 host normalizePath would canonicalize casing
      // via realpathSync.native; in a test bun cannot stat that path,
      // so the falsy branch returns the input. Just assert it didn't
      // throw and didn't mangle the drive letter.
      expect(out).toMatch(/^[A-Z]:[\\/]/)
    })

    test("accepts a Git Bash mount path /c/...", () => {
      const out = Filesystem.resolve("/c/Users/alice/repo")
      expect(out).toMatch(/^[Cc]:[\\/]/)
    })

    test("accepts a Cygwin/WSL mount path /mnt/c/...", () => {
      const out = Filesystem.resolve("/mnt/c/Users/alice/repo")
      expect(out).toMatch(/^[Cc]:[\\/]/)
    })

    test("accepts a /cygdrive/c/... mount path", () => {
      const out = Filesystem.resolve("/cygdrive/c/temp")
      expect(out).toMatch(/^[Cc]:[\\/]/)
    })

    test("respects OPENCORVUS_WINDOWS_DRIVE_MOUNTS for custom mount roots", () => {
      process.env.OPENCORVUS_WINDOWS_DRIVE_MOUNTS = "wsl,custom"
      const out = Filesystem.resolve("/wsl/c/Users/alice")
      expect(out).toMatch(/^[Cc]:[\\/]/)
    })

    test("throws InvalidDirectoryError on a bare POSIX-shaped path that is NOT a known mount", () => {
      let thrown: unknown
      try {
        Filesystem.resolve("/usr/local/share")
      } catch (e) {
        thrown = e
      }
      expect(thrown).toBeInstanceOf(Filesystem.InvalidDirectoryError)
      expect((thrown as Filesystem.InvalidDirectoryError).data.reason).toBe("posix-path-on-windows")
    })

    test("UNC paths starting with // are not rejected (passed through to windowsPath)", () => {
      const out = Filesystem.resolve("//fileserver/share/data")
      // windowsPath converts // → \\ for UNC; whatever pathResolve does
      // afterwards, it must not throw.
      expect(typeof out).toBe("string")
    })
  })
})
