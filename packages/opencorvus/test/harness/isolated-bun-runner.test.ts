import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { runIsolatedBunTest } from "./isolated-bun-runner"

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

async function waitForProcessExit(pid: number): Promise<boolean> {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (!processExists(pid)) return true
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  return !processExists(pid)
}

describe("isolated Bun runner", () => {
  test("windows cleanup uses the shared process supervisor instead of raw taskkill", () => {
    const source = readFileSync(resolve(import.meta.dir, "isolated-bun-runner.ts"), "utf8")

    expect(source).toContain('import { ProcessSupervisor } from "@/shell/process-supervisor"')
    expect(source).toContain("ProcessSupervisor.terminateProcessTree")
    expect(source).not.toContain("taskkill.exe")
  })

  test(
    "uses inactivity timeout instead of Bun's elapsed per-test timeout",
    async () => {
      await expect(
        runIsolatedBunTest({
          suiteName: "isolated runner active long fixture",
          isolatedFile: resolve(import.meta.dir, "fixtures/isolated-runner-active-long.ts"),
          temporaryPrefix: "opencorvus-isolated-runner-active-long-",
          expectedPassCount: 1,
          inactivityTimeoutMilliseconds: 1_000,
        }),
      ).resolves.toBeUndefined()
    },
    { timeout: 0 },
  )

  test(
    "terminates child tests after output inactivity",
    async () => {
      await expect(
        runIsolatedBunTest({
          suiteName: "isolated runner inactivity fixture",
          isolatedFile: resolve(import.meta.dir, "fixtures/isolated-runner-activity-hang.ts"),
          temporaryPrefix: "opencorvus-isolated-runner-hang-",
          expectedPassCount: 1,
          inactivityTimeoutMilliseconds: 200,
        }),
      ).rejects.toThrow(/no output activity for 200 milliseconds/)
    },
    { timeout: 0 },
  )

  test(
    "escalates termination when child tests ignore SIGTERM",
    async () => {
      await expect(
        runIsolatedBunTest({
          suiteName: "isolated runner SIGTERM fixture",
          isolatedFile: resolve(import.meta.dir, "fixtures/isolated-runner-ignore-sigterm.ts"),
          temporaryPrefix: "opencorvus-isolated-runner-sigterm-",
          expectedPassCount: 1,
          inactivityTimeoutMilliseconds: 200,
        }),
      ).rejects.toThrow(/no output activity for 200 milliseconds/)
    },
    { timeout: 0 },
  )

  test(
    "terminates descendant processes that inherit isolated test streams",
    async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "opencorvus-isolated-runner-child-"))
      const pidFile = resolve(tempDir, "child.pid")
      try {
        await expect(
          runIsolatedBunTest({
            suiteName: "isolated runner inherited child fixture",
            isolatedFile: resolve(import.meta.dir, "fixtures/isolated-runner-inherited-child-hang.ts"),
            temporaryPrefix: "opencorvus-isolated-runner-child-",
            expectedPassCount: 1,
            inactivityTimeoutMilliseconds: 200,
            env: {
              OPENCORVUS_ISOLATED_CHILD_PID_FILE: pidFile,
            },
          }),
        ).rejects.toThrow(/no output activity for 200 milliseconds/)

        expect(existsSync(pidFile)).toBe(true)
        const childPid = Number(readFileSync(pidFile, "utf8"))
        expect(Number.isFinite(childPid)).toBe(true)
        expect(await waitForProcessExit(childPid)).toBe(true)
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    },
    { timeout: 0 },
  )

  test(
    "terminates inherited-stream descendants after the root test process exits",
    async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "opencorvus-isolated-runner-root-exit-child-"))
      const pidFile = resolve(tempDir, "child.pid")
      try {
        await expect(
          runIsolatedBunTest({
            suiteName: "isolated runner inherited child after parent exit fixture",
            isolatedFile: resolve(import.meta.dir, "fixtures/isolated-runner-inherited-child-after-parent-exit.ts"),
            temporaryPrefix: "opencorvus-isolated-runner-root-exit-child-",
            expectedPassCount: 1,
            inactivityTimeoutMilliseconds: 2_000,
            env: {
              OPENCORVUS_ISOLATED_CHILD_PID_FILE: pidFile,
            },
          }),
        ).resolves.toBeUndefined()

        expect(existsSync(pidFile)).toBe(true)
        const childPid = Number(readFileSync(pidFile, "utf8"))
        expect(Number.isFinite(childPid)).toBe(true)
        expect(await waitForProcessExit(childPid)).toBe(true)
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    },
    { timeout: 0 },
  )

  test("parses Bun's summary instead of pass/fail text printed by tests", async () => {
    await expect(
      runIsolatedBunTest({
        suiteName: "isolated runner spoof summary fixture",
        isolatedFile: resolve(import.meta.dir, "fixtures/isolated-runner-spoof-pass.ts"),
        temporaryPrefix: "opencorvus-isolated-runner-spoof-",
        expectedPassCount: 99,
      }),
    ).rejects.toThrow()

    await expect(
      runIsolatedBunTest({
        suiteName: "isolated runner spoof summary fixture",
        isolatedFile: resolve(import.meta.dir, "fixtures/isolated-runner-spoof-pass.ts"),
        temporaryPrefix: "opencorvus-isolated-runner-spoof-",
        expectedPassCount: 1,
      }),
    ).resolves.toBeUndefined()
  })

  test("rejects Bun test arguments owned by the isolated runner", async () => {
    await expect(
      runIsolatedBunTest({
        suiteName: "isolated runner owned argument fixture",
        isolatedFile: resolve(import.meta.dir, "fixtures/isolated-runner-spoof-pass.ts"),
        temporaryPrefix: "opencorvus-isolated-runner-owned-arg-",
        expectedPassCount: 1,
        bunTestArgs: ["--timeout=5"],
      }),
    ).rejects.toThrow(/owns Bun test argument --timeout/)
  })
})
