import { describe, expect, test } from "bun:test"

import {
  runBrowserNodeSidecar,
  type BrowserNodeSidecarRunResult,
} from "../../src/browser/runtime/node-executor"
import type { BrowserNodeSidecarRuntime } from "../../src/browser/runtime/node-sidecar"

const RUNTIME: BrowserNodeSidecarRuntime = {
  nodeExecutable: process.env.OPENCORVUS_BROWSER_MCP_NODE ?? (process.platform === "win32" ? "node.exe" : "node"),
  playwrightRequirePath: "playwright",
  packaged: false,
}

describe("browser Node sidecar executor", () => {
  test("returns parsed JSON with exit metadata", async () => {
    const run = await execute<{ value: number }>(`
      const input = JSON.parse(Buffer.from(process.env.TEST_PAYLOAD || "", "base64").toString("utf8"));
      process.stdout.write(JSON.stringify({ value: input.value + 1 }));
    `, { value: 41 })

    expect(run.result).toEqual({ value: 42 })
    expect(run.exitCode).toBe(0)
    expect(run.signal).toBeNull()
  })

  test("returns non-zero exit metadata when stdout is valid JSON", async () => {
    const run = await execute<{ ok: false }>(`
      process.stdout.write(JSON.stringify({ ok: false }));
      process.exitCode = 7;
    `, {})

    expect(run.result).toEqual({ ok: false })
    expect(run.exitCode).toBe(7)
  })

  test("includes stderr when stdout is not valid JSON", async () => {
    await expect(execute(`
      process.stderr.write("diagnostic detail");
      process.stdout.write("not-json");
    `, {})).rejects.toThrow("diagnostic detail")
  })

  test("kills a sidecar that exceeds the hard timeout", async () => {
    await expect(execute(`
      setTimeout(() => {}, 10_000);
    `, {}, { hardTimeoutMs: 25 })).rejects.toThrow("timed out after 25ms")
  })

  test("kills a sidecar when the abort signal fires", async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(new Error("executor aborted by test")), 25)

    await expect(execute(`
      setTimeout(() => {}, 10_000);
    `, {}, { signal: controller.signal, hardTimeoutMs: 5_000 })).rejects.toThrow("executor aborted by test")
  })
})

function execute<TResult>(
  script: string,
  payload: unknown,
  options: {
    signal?: AbortSignal
    hardTimeoutMs?: number
  } = {},
): Promise<BrowserNodeSidecarRunResult<TResult>> {
  return runBrowserNodeSidecar<TResult>({
    runtime: RUNTIME,
    script,
    payload,
    payloadEnvName: "TEST_PAYLOAD",
    hardTimeoutMs: options.hardTimeoutMs ?? 5_000,
    signal: options.signal,
    label: "test sidecar",
  })
}
