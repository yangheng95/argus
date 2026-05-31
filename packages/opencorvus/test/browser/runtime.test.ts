import { describe, expect, test } from "bun:test"
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

  test("defines the shared browser launch arguments", () => {
    expect(BrowserRuntime.defaultLaunchArgs()).toContain("--disable-dev-shm-usage")
    expect(BrowserRuntime.defaultLaunchArgs()).toContain("--disable-remote-fonts")
  })

  test("uses a stable launch timeout policy for all browser callers", () => {
    const previous = process.env.OPENCORVUS_BROWSER_LAUNCH_TIMEOUT_MS

    try {
      delete process.env.OPENCORVUS_BROWSER_LAUNCH_TIMEOUT_MS
      expect(BrowserRuntime.resolveBrowserLaunchTimeoutMs()).toBe(60_000)
      expect(BrowserRuntime.resolveBrowserLaunchTimeoutMs(12_345)).toBe(12_345)

      process.env.OPENCORVUS_BROWSER_LAUNCH_TIMEOUT_MS = "90000"
      expect(BrowserRuntime.resolveBrowserLaunchTimeoutMs()).toBe(90_000)
      expect(BrowserRuntime.resolveBrowserLaunchTimeoutMs(7_000)).toBe(7_000)

      process.env.OPENCORVUS_BROWSER_LAUNCH_TIMEOUT_MS = "not-a-number"
      expect(BrowserRuntime.resolveBrowserLaunchTimeoutMs()).toBe(60_000)
    } finally {
      if (previous === undefined) delete process.env.OPENCORVUS_BROWSER_LAUNCH_TIMEOUT_MS
      else process.env.OPENCORVUS_BROWSER_LAUNCH_TIMEOUT_MS = previous
    }
  })
})
