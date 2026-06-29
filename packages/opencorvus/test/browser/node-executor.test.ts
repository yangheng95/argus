import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { runBrowserNodeSidecar, type BrowserNodeSidecarRunResult } from "../../src/browser/runtime/node-executor"
import type { BrowserNodeSidecarRuntime } from "../../src/browser/runtime/node-sidecar"

const RUNTIME: BrowserNodeSidecarRuntime = {
  nodeExecutable: process.env.OPENCORVUS_BROWSER_MCP_NODE ?? (process.platform === "win32" ? "node.exe" : "node"),
  playwrightRequirePath: "playwright",
  packaged: false,
}

let tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
  tempDirs = []
})

describe("browser Node sidecar executor", () => {
  test("returns parsed JSON with exit metadata", async () => {
    const run = await execute<{ value: number }>(
      `
      const input = JSON.parse(Buffer.from(process.env.TEST_PAYLOAD || "", "base64").toString("utf8"));
      process.stdout.write(JSON.stringify({ value: input.value + 1 }));
    `,
      { value: 41 },
    )

    expect(run.result).toEqual({ value: 42 })
    expect(run.exitCode).toBe(0)
    expect(run.signal).toBeNull()
  })

  test("returns non-zero exit metadata when stdout is valid JSON", async () => {
    const run = await execute<{ ok: false }>(
      `
      process.stdout.write(JSON.stringify({ ok: false }));
      process.exitCode = 7;
    `,
      {},
    )

    expect(run.result).toEqual({ ok: false })
    expect(run.exitCode).toBe(7)
  })

  test("includes stderr when stdout is not valid JSON", async () => {
    await expect(
      execute(
        `
      process.stderr.write("diagnostic detail");
      process.stdout.write("not-json");
    `,
        {},
      ),
    ).rejects.toThrow("diagnostic detail")
  })

  test("does not kill a sidecar that keeps emitting output past the inactivity timeout", async () => {
    const run = await execute<{ ok: true }>(
      `
      let count = 0;
      const timer = setInterval(() => {
        process.stderr.write("tick");
        count += 1;
        if (count === 4) {
          clearInterval(timer);
          process.stdout.write(JSON.stringify({ ok: true }));
        }
      }, 150);
    `,
      {},
      { inactivityTimeoutMs: 500 },
    )

    expect(run.result).toEqual({ ok: true })
  })

  test("kills a silent sidecar after one inactive timeout window", async () => {
    await expect(
      execute(
        `
      setTimeout(() => {}, 10_000);
    `,
        {},
        { inactivityTimeoutMs: 25 },
      ),
    ).rejects.toThrow("inactive for 25ms")
  })

  test("kills child processes when a sidecar exceeds the inactivity timeout", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-node-sidecar-tree-"))
    tempDirs.push(dir)
    const childPidFile = path.join(dir, "child.pid")

    await expect(
      execute(
        `
      const { spawn } = require("node:child_process");
      const fs = require("node:fs");
      const input = JSON.parse(Buffer.from(process.env.TEST_PAYLOAD || "", "base64").toString("utf8"));
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 10_000)"], {
        stdio: "ignore",
        windowsHide: true,
      });
      fs.writeFileSync(input.childPidFile, String(child.pid));
      setInterval(() => {}, 10_000);
    `,
        { childPidFile },
        { inactivityTimeoutMs: 100 },
      ),
    ).rejects.toThrow("inactive for 100ms")

    const childPid = Number(fs.readFileSync(childPidFile, "utf8"))
    expect(Number.isFinite(childPid) && childPid > 0).toBe(true)
    await expectProcessGone(childPid)
  })

  test("kills a sidecar when the abort signal fires", async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(new Error("executor aborted by test")), 25)

    await expect(
      execute(
        `
      setTimeout(() => {}, 10_000);
    `,
        {},
        { signal: controller.signal, inactivityTimeoutMs: 5_000 },
      ),
    ).rejects.toThrow("executor aborted by test")
  })
})

async function expectProcessGone(pid: number): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (!processExists(pid)) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`process ${pid} was still alive after sidecar timeout`)
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function execute<TResult>(
  script: string,
  payload: unknown,
  options: {
    signal?: AbortSignal
    inactivityTimeoutMs?: number
  } = {},
): Promise<BrowserNodeSidecarRunResult<TResult>> {
  return runBrowserNodeSidecar<TResult>({
    runtime: RUNTIME,
    script,
    payload,
    payloadEnvName: "TEST_PAYLOAD",
    inactivityTimeoutMs: options.inactivityTimeoutMs ?? 5_000,
    signal: options.signal,
    label: "test sidecar",
  })
}
