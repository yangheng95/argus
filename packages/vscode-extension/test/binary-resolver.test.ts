import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { executableName, resolveBundledBinary, resolveTarget } from "../src/sidecar/binary-resolver"
import { UnsupportedPlatformError } from "../src/sidecar/errors"

describe("resolveTarget", () => {
  test("maps each supported (platform, arch) to the official VS Code target", () => {
    expect(resolveTarget("win32", "x64")).toBe("win32-x64")
    expect(resolveTarget("win32", "arm64")).toBe("win32-arm64")
    expect(resolveTarget("darwin", "x64")).toBe("darwin-x64")
    expect(resolveTarget("darwin", "arm64")).toBe("darwin-arm64")
    expect(resolveTarget("linux", "x64")).toBe("linux-x64")
    expect(resolveTarget("linux", "arm64")).toBe("linux-arm64")
  })

  test("throws UnsupportedPlatformError on unknown combinations", () => {
    expect(() => resolveTarget("freebsd" as any, "x64")).toThrow(UnsupportedPlatformError)
    expect(() => resolveTarget("linux", "ia32" as any)).toThrow(UnsupportedPlatformError)
  })
})

describe("executableName", () => {
  test("appends .exe on Windows targets only", () => {
    expect(executableName("win32-x64")).toBe("opencorvus.exe")
    expect(executableName("win32-arm64")).toBe("opencorvus.exe")
    expect(executableName("darwin-x64")).toBe("opencorvus")
    expect(executableName("linux-arm64")).toBe("opencorvus")
  })
})

describe("resolveBundledBinary", () => {
  let extensionRoot: string

  beforeEach(() => {
    extensionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-ext-bin-"))
  })

  afterEach(() => {
    try {
      fs.rmSync(extensionRoot, { recursive: true, force: true })
    } catch {}
    delete process.env.OPENCORVUS_DEV_BINARY
  })

  test("resolves binary when it exists at the expected path", () => {
    const target = "linux-x64"
    const dir = path.join(extensionRoot, "bin", target)
    fs.mkdirSync(dir, { recursive: true })
    const binPath = path.join(dir, "opencorvus")
    fs.writeFileSync(binPath, "#!/bin/sh\nexit 0\n")
    const result = resolveBundledBinary({
      extensionRoot,
      targetOverride: target,
      ignoreEnvOverride: true,
    })
    expect(result.target).toBe(target)
    expect(result.binaryPath).toBe(binPath)
  })

  test("throws UnsupportedPlatformError when the binary is missing", () => {
    expect(() =>
      resolveBundledBinary({
        extensionRoot,
        targetOverride: "linux-x64",
        ignoreEnvOverride: true,
      }),
    ).toThrow(UnsupportedPlatformError)
  })

  test("dev override (env) wins when provided and the file exists", () => {
    const fake = path.join(extensionRoot, "fake-binary")
    fs.writeFileSync(fake, "#!/bin/sh\n")
    process.env.OPENCORVUS_DEV_BINARY = fake
    const result = resolveBundledBinary({ extensionRoot })
    expect(result.binaryPath).toBe(fake)
  })

  test("dev override that points at a missing file throws UnsupportedPlatformError", () => {
    process.env.OPENCORVUS_DEV_BINARY = path.join(extensionRoot, "nonexistent")
    expect(() => resolveBundledBinary({ extensionRoot })).toThrow(UnsupportedPlatformError)
  })

  test("ignoreEnvOverride bypasses dev override even when env is set", () => {
    process.env.OPENCORVUS_DEV_BINARY = "/totally/missing"
    expect(() =>
      resolveBundledBinary({
        extensionRoot,
        targetOverride: "linux-x64",
        ignoreEnvOverride: true,
      }),
    ).toThrow(UnsupportedPlatformError)
    // ↑ throws because targetOverride binary is missing, NOT because of
    //   the env override (which would have thrown a different message).
  })

  test("ensures executable bit on non-Windows targets", () => {
    if (process.platform === "win32") {
      // chmod has no effect on Windows; skip.
      return
    }
    const target = "linux-x64"
    const dir = path.join(extensionRoot, "bin", target)
    fs.mkdirSync(dir, { recursive: true })
    const binPath = path.join(dir, "opencorvus")
    fs.writeFileSync(binPath, "#!/bin/sh\n", { mode: 0o644 })
    resolveBundledBinary({ extensionRoot, targetOverride: target, ignoreEnvOverride: true })
    const stat = fs.statSync(binPath)
    expect(stat.mode & 0o111).toBeGreaterThan(0)
  })
})
