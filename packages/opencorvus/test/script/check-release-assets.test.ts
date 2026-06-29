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
  const rgName = platform.startsWith("windows") ? "rg.exe" : "rg"
  fs.mkdirSync(path.join(dir, "bin"), { recursive: true })
  fs.mkdirSync(path.join(dir, "ui"), { recursive: true })
  fs.writeFileSync(path.join(dir, binaryName), "#!/usr/bin/env sh\nexit 0\n")
  fs.writeFileSync(path.join(dir, "bin", rgName), "#!/usr/bin/env sh\nexit 0\n")
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

function seedNamedOverlayFiles(root: string, binaryName: string, files: string[] = []) {
  fs.writeFileSync(path.join(root, binaryName), "")
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

  test("rejects CLI platform directories without packaged ripgrep", async () => {
    const dir = seedPlatformDir(workdir, "linux-x64")
    fs.rmSync(path.join(dir, "bin", "rg"))

    const res = await runCheck(workdir, [])

    expect(res.ok).toBe(false)
    expect(res.stderr).toContain("Missing required file")
    expect(res.stderr).toContain(path.join("bin", "rg"))
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
    seedOverlayFiles(onlyApp, "darwin-arm64", ["OpenCorvus_9.9.9_aarch64.app.tar.gz"])
    const missingDmg = await runOverlayCheck(onlyApp, "darwin-arm64", ["--require-bundle"])
    expect(missingDmg.ok).toBe(false)
    expect(missingDmg.stderr).toContain("Missing macOS DMG bundle")

    const completeDir = assetCaseDir("mac-complete")
    seedOverlayFiles(completeDir, "darwin-arm64", [
      "OpenCorvus_9.9.9_aarch64.dmg",
      "OpenCorvus_9.9.9_aarch64.app.tar.gz",
    ])
    const complete = await runOverlayCheck(completeDir, "darwin-arm64", ["--require-bundle"])
    expect(complete.ok).toBe(true)
    expect(complete.stdout).toContain("Overlay assets validated for darwin-arm64")
  })

  test("rejects stale-version macOS bundles", async () => {
    const staleDir = assetCaseDir("mac-stale-version")
    seedOverlayFiles(staleDir, "darwin-arm64", [
      "OpenCorvus_8.8.8_aarch64.dmg",
      "OpenCorvus_8.8.8_aarch64.app.tar.gz",
    ])
    const stale = await runOverlayCheck(staleDir, "darwin-arm64", ["--require-bundle"])
    expect(stale.ok).toBe(false)
    expect(stale.stderr).toContain("Missing macOS DMG bundle")
    expect(stale.stderr).toContain("OpenCorvus_8.8.8_aarch64.dmg")
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

  test("rejects stale-version Linux bundles", async () => {
    const staleDir = assetCaseDir("linux-stale-version")
    seedOverlayFiles(staleDir, "linux-x64", [
      "OpenCorvus_8.8.8_amd64.AppImage",
      "OpenCorvus_8.8.8_amd64.deb",
      "OpenCorvus-8.8.8-1.x86_64.rpm",
    ])
    const stale = await runOverlayCheck(staleDir, "linux-x64", ["--require-bundle"])
    expect(stale.ok).toBe(false)
    expect(stale.stderr).toContain("Missing Linux AppImage bundle")
    expect(stale.stderr).toContain("OpenCorvus_8.8.8_amd64.AppImage")
  })

  test("requires platform architecture suffixes for Linux bundles", async () => {
    const arm64Dir = assetCaseDir("linux-arm64-complete")
    seedOverlayFiles(arm64Dir, "linux-arm64", [
      "OpenCorvus_9.9.9_arm64.AppImage",
      "OpenCorvus_9.9.9_arm64.deb",
      "OpenCorvus-9.9.9-1.aarch64.rpm",
    ])
    const arm64 = await runOverlayCheck(arm64Dir, "linux-arm64", ["--require-bundle"])
    expect(arm64.ok).toBe(true)
    expect(arm64.stdout).toContain("Overlay assets validated for linux-arm64")

    const wrongArchDir = assetCaseDir("linux-x64-wrong-arch")
    seedOverlayFiles(wrongArchDir, "linux-x64", [
      "OpenCorvus_9.9.9_arm64.AppImage",
      "OpenCorvus_9.9.9_arm64.deb",
      "OpenCorvus-9.9.9-1.aarch64.rpm",
    ])
    const wrongArch = await runOverlayCheck(wrongArchDir, "linux-x64", ["--require-bundle"])
    expect(wrongArch.ok).toBe(false)
    expect(wrongArch.stderr).toContain("Missing Linux AppImage bundle")
    expect(wrongArch.stderr).toContain("OpenCorvus_9.9.9_arm64.AppImage")
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

  test("rejects same-version wrong-architecture macOS and Windows bundles", async () => {
    const macWrongArch = assetCaseDir("mac-arm64-wrong-arch")
    seedOverlayFiles(macWrongArch, "darwin-arm64", [
      "OpenCorvus_9.9.9_x64.dmg",
      "OpenCorvus_9.9.9_x64.app.tar.gz",
    ])
    const mac = await runOverlayCheck(macWrongArch, "darwin-arm64", ["--require-bundle"])
    expect(mac.ok).toBe(false)
    expect(mac.stderr).toContain("Missing macOS DMG bundle")
    expect(mac.stderr).toContain("OpenCorvus_9.9.9_x64.dmg")

    const windowsWrongArch = assetCaseDir("windows-x64-wrong-arch")
    seedOverlayFiles(windowsWrongArch, "windows-x64", [
      "OpenCorvus_9.9.9_arm64_en-US.msi",
      "OpenCorvus_9.9.9_arm64-setup.exe",
    ])
    const windows = await runOverlayCheck(windowsWrongArch, "windows-x64", ["--require-bundle"])
    expect(windows.ok).toBe(false)
    expect(windows.stderr).toContain("Missing Windows MSI bundle")
    expect(windows.stderr).toContain("OpenCorvus_9.9.9_arm64_en-US.msi")
  })

  test("still allows dev overlay snapshots without installer bundles", async () => {
    seedOverlayBinary(workdir, "linux-x64")
    const res = await runOverlayCheck(workdir, "linux-x64", [])
    expect(res.ok).toBe(true)
    expect(res.stdout).toContain("Overlay assets validated for linux-x64")
  })

  test("rejects platform-mismatched overlay executables", async () => {
    const linuxExe = assetCaseDir("linux-with-windows-exe")
    seedNamedOverlayFiles(linuxExe, "opencorvus-overlay.exe")
    const linux = await runOverlayCheck(linuxExe, "linux-x64", [])
    expect(linux.ok).toBe(false)
    expect(linux.stderr).toContain("Missing linux-x64 overlay binary")

    const windowsNoExt = assetCaseDir("windows-with-extensionless-binary")
    seedNamedOverlayFiles(windowsNoExt, "opencorvus-overlay")
    const windows = await runOverlayCheck(windowsNoExt, "windows-x64", [])
    expect(windows.ok).toBe(false)
    expect(windows.stderr).toContain("Missing windows-x64 overlay binary")
  })
})
