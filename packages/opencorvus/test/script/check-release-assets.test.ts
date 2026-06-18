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

async function runOverlayCheck(distDir: string, platform: string, args: string[]): Promise<RunResult> {
  const proc = Bun.spawn(
    ["bun", CHECK_SCRIPT, "overlay", "--dir", distDir, "--platform", platform, "--version", "9.9.9", ...args],
    { stdout: "pipe", stderr: "pipe" },
  )
  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  return { ok: exitCode === 0, stdout, stderr }
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

function seedOverlayBinary(root: string, platform: string) {
  const name = platform.startsWith("windows") ? "opencorvus-overlay.exe" : "opencorvus-overlay"
  fs.writeFileSync(path.join(root, name), "")
}

function seedOverlayFiles(root: string, platform: string, files: string[]) {
  seedOverlayBinary(root, platform)
  for (const file of files) fs.writeFileSync(path.join(root, file), "")
}

function assetCaseDir(name: string) {
  const dir = path.join(workdir, name)
  fs.mkdirSync(dir, { recursive: true })
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

describe("check-release-assets overlay --require-bundle", () => {
  test("requires both macOS DMG and app archive bundles", async () => {
    const onlyDmg = assetCaseDir("mac-only-dmg")
    seedOverlayFiles(onlyDmg, "darwin-arm64", ["OpenCorvus_9.9.9_aarch64.dmg"])
    const missingApp = await runOverlayCheck(onlyDmg, "darwin-arm64", ["--require-bundle"])
    expect(missingApp.ok).toBe(false)
    expect(missingApp.stderr).toContain("Missing macOS app archive bundle")

    const onlyApp = assetCaseDir("mac-only-app")
    seedOverlayFiles(onlyApp, "darwin-arm64", ["OpenCorvus.app.tar.gz"])
    const missingDmg = await runOverlayCheck(onlyApp, "darwin-arm64", ["--require-bundle"])
    expect(missingDmg.ok).toBe(false)
    expect(missingDmg.stderr).toContain("Missing macOS DMG bundle")

    const completeDir = assetCaseDir("mac-complete")
    seedOverlayFiles(completeDir, "darwin-arm64", ["OpenCorvus_9.9.9_aarch64.dmg", "OpenCorvus.app.tar.gz"])
    const complete = await runOverlayCheck(completeDir, "darwin-arm64", ["--require-bundle"])
    expect(complete.ok).toBe(true)
    expect(complete.stdout).toContain("Overlay assets validated for darwin-arm64")
  })

  test("requires Linux AppImage, DEB, and RPM bundles", async () => {
    const appImage = "OpenCorvus_9.9.9_amd64.AppImage"
    const deb = "OpenCorvus_9.9.9_amd64.deb"
    const rpm = "OpenCorvus-9.9.9-1.x86_64.rpm"
    const cases = [
      { name: "linux-missing-appimage", files: [deb, rpm], missing: "Missing Linux AppImage bundle" },
      { name: "linux-missing-deb", files: [appImage, rpm], missing: "Missing Linux DEB bundle" },
      { name: "linux-missing-rpm", files: [appImage, deb], missing: "Missing Linux RPM bundle" },
    ]

    for (const item of cases) {
      const dir = assetCaseDir(item.name)
      seedOverlayFiles(dir, "linux-x64", item.files)
      const res = await runOverlayCheck(dir, "linux-x64", ["--require-bundle"])
      expect(res.ok).toBe(false)
      expect(res.stderr).toContain(item.missing)
    }

    const completeDir = assetCaseDir("linux-complete")
    seedOverlayFiles(completeDir, "linux-x64", [appImage, deb, rpm])
    const complete = await runOverlayCheck(completeDir, "linux-x64", ["--require-bundle"])
    expect(complete.ok).toBe(true)
    expect(complete.stdout).toContain("Overlay assets validated for linux-x64")
  })

  test("requires both Windows MSI and NSIS bundles", async () => {
    const msi = "OpenCorvus_9.9.9_x64_en-US.msi"
    const nsis = "OpenCorvus_9.9.9_x64-setup.exe"

    const onlyMsi = assetCaseDir("windows-only-msi")
    seedOverlayFiles(onlyMsi, "windows-x64", [msi])
    const missingNsis = await runOverlayCheck(onlyMsi, "windows-x64", ["--require-bundle"])
    expect(missingNsis.ok).toBe(false)
    expect(missingNsis.stderr).toContain("Missing Windows NSIS bundle")

    const onlyNsis = assetCaseDir("windows-only-nsis")
    seedOverlayFiles(onlyNsis, "windows-x64", [nsis])
    const missingMsi = await runOverlayCheck(onlyNsis, "windows-x64", ["--require-bundle"])
    expect(missingMsi.ok).toBe(false)
    expect(missingMsi.stderr).toContain("Missing Windows MSI bundle")

    const completeDir = assetCaseDir("windows-complete")
    seedOverlayFiles(completeDir, "windows-x64", [msi, nsis])
    const complete = await runOverlayCheck(completeDir, "windows-x64", ["--require-bundle"])
    expect(complete.ok).toBe(true)
    expect(complete.stdout).toContain("Overlay assets validated for windows-x64")
  })

  test("still allows dev overlay snapshots without installer bundles", async () => {
    seedOverlayBinary(workdir, "linux-x64")
    const res = await runOverlayCheck(workdir, "linux-x64", [])
    expect(res.ok).toBe(true)
    expect(res.stdout).toContain("Overlay assets validated for linux-x64")
  })
})
