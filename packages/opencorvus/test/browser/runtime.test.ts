import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Filesystem } from "../../src/util/filesystem"
import { BrowserRuntime, findBrowserExecutable } from "../../src/browser/runtime"

describe("BrowserRuntime", () => {
  test("uses an explicit browser executable override", async () => {
    await using tmp = await tmpdir()
    const executable = path.join(tmp.path, "chrome.exe")
    await Filesystem.write(executable, "")

    await expect(findBrowserExecutable(executable)).resolves.toBe(executable)
  })

  test("fails explicitly when an override does not exist", async () => {
    await using tmp = await tmpdir()
    const missing = path.join(tmp.path, "missing-chrome.exe")

    await expect(findBrowserExecutable(missing)).rejects.toThrow(`browserExecutable not found: ${missing}`)
    try {
      await findBrowserExecutable(missing)
      throw new Error("findBrowserExecutable unexpectedly succeeded")
    } catch (error) {
      expect(error).toBeInstanceOf(BrowserRuntime.RuntimeError)
      const diagnostic = (error as BrowserRuntime.RuntimeError).diagnostic
      expect(diagnostic.code).toBe("browser_executable_not_found")
      expect(diagnostic.checkedCandidates).toEqual([missing])
      expect(diagnostic.recoveryCommand).toContain("OPENCORVUS_BROWSER_EXECUTABLE")
    }
  })

  test("uses the OpenCorvus browser executable environment override", async () => {
    const previous = process.env.OPENCORVUS_BROWSER_EXECUTABLE
    await using tmp = await tmpdir()
    const executable = path.join(tmp.path, "managed-chrome.exe")
    await Filesystem.write(executable, "")
    process.env.OPENCORVUS_BROWSER_EXECUTABLE = executable

    try {
      await expect(findBrowserExecutable()).resolves.toBe(executable)
    } finally {
      if (previous === undefined) delete process.env.OPENCORVUS_BROWSER_EXECUTABLE
      else process.env.OPENCORVUS_BROWSER_EXECUTABLE = previous
    }
  })

  test("includes standard browser commands discovered from PATH", async () => {
    await using tmp = await tmpdir()
    const executable = path.join(tmp.path, "chromium-browser")
    await Filesystem.write(executable, "")
    await fs.chmod(executable, 0o755)

    const candidates = BrowserRuntime.resolveBrowserExecutableCandidates({
      browserCommands: ["chromium-browser"],
      defaultCandidates: [],
      envPath: tmp.path,
      homeDir: "",
      platform: "linux",
    })

    expect(candidates).toContain(executable)
  })

  test("includes Linux user-local browser commands even when PATH omits them", async () => {
    await using tmp = await tmpdir()
    const executable = path.join(tmp.path, ".local", "bin", "google-chrome")

    const candidates = BrowserRuntime.resolveBrowserExecutableCandidates({
      browserCommands: ["google-chrome"],
      defaultCandidates: [],
      envPath: "/usr/bin",
      homeDir: tmp.path,
      platform: "linux",
    })

    expect(candidates).toContain(executable)
  })

  test("defines the shared browser launch arguments", () => {
    expect(BrowserRuntime.defaultLaunchArgs()).toContain("--disable-dev-shm-usage")
    expect(BrowserRuntime.defaultLaunchArgs()).toContain("--disable-remote-fonts")
  })

  test("adds Chromium proxy launch arguments from HTTPS_PROXY", () => {
    const args = BrowserRuntime.defaultLaunchArgs({
      env: {
        HTTPS_PROXY: "http://172.25.160.1:6268",
        NO_PROXY: "localhost,127.0.0.1,::1,*.local",
      },
    })

    expect(args).toContain("--proxy-server=http://172.25.160.1:6268")
    expect(args).toContain("--proxy-bypass-list=localhost;127.0.0.1;::1;*.local")
  })

  test("adds Chromium proxy launch arguments from HTTP_PROXY", () => {
    const args = BrowserRuntime.defaultLaunchArgs({
      env: {
        HTTP_PROXY: "172.25.160.1:6268",
        NO_PROXY: "localhost,127.0.0.1,::1,*.local",
      },
    })

    expect(args).toContain("--proxy-server=http://172.25.160.1:6268")
    expect(args).toContain("--proxy-bypass-list=localhost;127.0.0.1;::1;*.local")
  })

  test("adds Chromium proxy launch arguments from ALL_PROXY", () => {
    const args = BrowserRuntime.defaultLaunchArgs({
      env: {
        ALL_PROXY: "socks5://127.0.0.1:1080",
        NO_PROXY: "localhost,127.0.0.1,::1,*.local",
      },
    })

    expect(args).toContain("--proxy-server=socks5://127.0.0.1:1080")
    expect(args).toContain("--proxy-bypass-list=localhost;127.0.0.1;::1;*.local")
  })

  test("uses BROWSER_PROXY before HTTP proxy environment variables", () => {
    const args = BrowserRuntime.defaultLaunchArgs({
      env: {
        BROWSER_PROXY: "socks5://127.0.0.1:1080",
        HTTPS_PROXY: "http://172.25.160.1:6268",
      },
    })

    expect(args).toContain("--proxy-server=socks5://127.0.0.1:1080")
    expect(args).not.toContain("--proxy-server=http://172.25.160.1:6268")
  })

  test("passes shared proxy-aware launch arguments into every webpage evidence Node sidecar", async () => {
    const files: Array<{ path: string; snippet: string }> = [
      { path: "src/browser/webpage/extract.ts", snippet: "launchArgs: BrowserRuntime.defaultLaunchArgs({" },
      { path: "src/browser/webpage/render.ts", snippet: "launchArgs: BrowserRuntime.defaultLaunchArgs({" },
      { path: "src/browser/webpage/runtime-state.ts", snippet: "launchArgs: BrowserRuntime.defaultLaunchArgs({" },
      { path: "src/browser-preview/evidence-runner.ts", snippet: "launchArgs: BrowserRuntime.defaultLaunchArgs()," },
      {
        path: "src/browser-preview/live.ts",
        snippet: "OPENCORVUS_BROWSER_LAUNCH_ARGS: JSON.stringify(BrowserRuntime.defaultLaunchArgs()),",
      },
    ]

    for (const file of files) {
      const source = await fs.readFile(path.resolve(import.meta.dir, "../../", file.path), "utf8")
      expect(source).toContain(file.snippet)
      expect(source).not.toContain('args: []')
    }
  })

  test("resolves source Playwright from the package root", async () => {
    const entry = await BrowserRuntime.resolvePlaywrightEntry()
    expect(entry.replaceAll("\\", "/")).toContain("/packages/opencorvus/node_modules/playwright/index.mjs")
  })

  test("uses a stable launch timeout policy for all browser callers", () => {
    const previous = process.env.OPENCORVUS_BROWSER_LAUNCH_TIMEOUT_MS

    try {
      delete process.env.OPENCORVUS_BROWSER_LAUNCH_TIMEOUT_MS
      expect(BrowserRuntime.resolveBrowserLaunchTimeoutMs()).toBe(300_000)
      expect(BrowserRuntime.resolveBrowserLaunchTimeoutMs(12_345)).toBe(12_345)

      process.env.OPENCORVUS_BROWSER_LAUNCH_TIMEOUT_MS = "90000"
      expect(BrowserRuntime.resolveBrowserLaunchTimeoutMs()).toBe(90_000)
      expect(BrowserRuntime.resolveBrowserLaunchTimeoutMs(7_000)).toBe(7_000)

      process.env.OPENCORVUS_BROWSER_LAUNCH_TIMEOUT_MS = "not-a-number"
      expect(BrowserRuntime.resolveBrowserLaunchTimeoutMs()).toBe(300_000)
    } finally {
      if (previous === undefined) delete process.env.OPENCORVUS_BROWSER_LAUNCH_TIMEOUT_MS
      else process.env.OPENCORVUS_BROWSER_LAUNCH_TIMEOUT_MS = previous
    }
  })
})
