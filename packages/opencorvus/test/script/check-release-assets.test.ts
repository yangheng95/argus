import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import fs from "fs"
import path from "path"
import os from "os"

// 2026-05-11 codex review found the release workflow passed
// `--require-archives` to check-release-assets.ts but no upstream step
// created the `.tar.gz` / `.zip` files, so every release build failed
// the validator. The fix adds a "Package CLI archive" step to
// .github/workflows/build.yml. These tests pin the validator contract
// so the archive requirement remains load-bearing: presence passes,
// absence fails with the documented error.

const CHECK_SCRIPT = path.resolve(import.meta.dir, "../../../..", "script", "check-release-assets.ts")

interface RunResult {
  ok: boolean
  stderr: string
  stdout: string
}

async function runCheckForPlatforms(distDir: string, platforms: string, args: string[]): Promise<RunResult> {
  const proc = Bun.spawn(
    ["bun", CHECK_SCRIPT, "cli", "--dir", distDir, "--platforms", platforms, "--version", "9.9.9", ...args],
    { stdout: "pipe", stderr: "pipe" },
  )
  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  return { ok: exitCode === 0, stdout, stderr }
}

async function runCheck(distDir: string, args: string[]): Promise<RunResult> {
  return runCheckForPlatforms(distDir, "linux-x64", args)
}

function seedPlatformDir(root: string, platform: string, binaryName = "opencorvus") {
  const dir = path.join(root, `opencorvus-${platform}`)
  fs.mkdirSync(path.join(dir, "ui"), { recursive: true })
  fs.writeFileSync(path.join(dir, binaryName), "#!/usr/bin/env sh\nexit 0\n")
  fs.writeFileSync(path.join(dir, "ui", "index.html"), "<html></html>")
  fs.writeFileSync(path.join(dir, "ui", "app.abc.js"), "/* ui */")
  fs.writeFileSync(path.join(dir, "ui", "app.abc.css"), "/* ui */")
  return dir
}

let workdir: string

beforeEach(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), "release-assets-"))
})

afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true })
})

describe("check-release-assets cli --require-archives", () => {
  test("passes when the matching .tar.gz archive exists for a linux platform", async () => {
    seedPlatformDir(workdir, "linux-x64")
    fs.writeFileSync(path.join(workdir, "opencorvus-linux-x64.tar.gz"), "")
    const res = await runCheck(workdir, ["--require-archives"])
    expect(res.ok).toBe(true)
    expect(res.stdout).toContain("CLI assets validated for linux-x64")
  })

  test("fails when --require-archives is set but the archive is missing", async () => {
    seedPlatformDir(workdir, "linux-x64")
    const res = await runCheck(workdir, ["--require-archives"])
    expect(res.ok).toBe(false)
    expect(res.stderr).toContain("Missing required file")
    expect(res.stderr).toContain("opencorvus-linux-x64.tar.gz")
  })

  test("passes without archive when --require-archives is NOT set (dev snapshot)", async () => {
    seedPlatformDir(workdir, "linux-x64")
    const res = await runCheck(workdir, [])
    expect(res.ok).toBe(true)
  })

  test("requires the Windows CLI binary to use the .exe archive name", async () => {
    seedPlatformDir(workdir, "windows-x64", "opencorvus.exe")
    const res = await runCheckForPlatforms(workdir, "windows-x64", [])
    expect(res.ok).toBe(true)
    expect(res.stdout).toContain("CLI assets validated for windows-x64")
  })

  test("rejects extensionless Windows CLI binary directories", async () => {
    seedPlatformDir(workdir, "windows-x64", "opencorvus")
    const res = await runCheckForPlatforms(workdir, "windows-x64", [])
    expect(res.ok).toBe(false)
    expect(res.stderr).toContain("Missing required file")
    expect(res.stderr).toContain("opencorvus.exe")
  })

  test("rejects .exe-only Linux CLI binary directories", async () => {
    seedPlatformDir(workdir, "linux-x64", "opencorvus.exe")
    const res = await runCheck(workdir, [])
    expect(res.ok).toBe(false)
    expect(res.stderr).toContain("Missing required file")
    expect(res.stderr).toContain("opencorvus")
  })

  test("validates every requested CLI variant archive", async () => {
    seedPlatformDir(workdir, "linux-x64")
    seedPlatformDir(workdir, "linux-x64-baseline")
    seedPlatformDir(workdir, "linux-x64-musl")
    seedPlatformDir(workdir, "linux-x64-baseline-musl")
    fs.writeFileSync(path.join(workdir, "opencorvus-linux-x64.tar.gz"), "")
    fs.writeFileSync(path.join(workdir, "opencorvus-linux-x64-baseline.tar.gz"), "")
    fs.writeFileSync(path.join(workdir, "opencorvus-linux-x64-musl.tar.gz"), "")
    fs.writeFileSync(path.join(workdir, "opencorvus-linux-x64-baseline-musl.tar.gz"), "")

    const proc = Bun.spawn(
      [
        "bun",
        CHECK_SCRIPT,
        "cli",
        "--dir",
        workdir,
        "--platforms",
        "linux-x64,linux-x64-baseline,linux-x64-musl,linux-x64-baseline-musl",
        "--version",
        "9.9.9",
        "--require-archives",
      ],
      { stdout: "pipe", stderr: "pipe" },
    )
    const exitCode = await proc.exited
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()

    expect(stderr).toBe("")
    expect(exitCode).toBe(0)
    expect(stdout).toContain("linux-x64-baseline-musl")
  })
})
