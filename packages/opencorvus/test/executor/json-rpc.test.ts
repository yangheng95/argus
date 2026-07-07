import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { JsonRpcLineTransport } from "../../src/executor/protocol/json-rpc"
import { ProcessSupervisor } from "../../src/shell/process-supervisor"

describe("json rpc line transport", () => {
  afterEach(() => {
    mock.restore()
    delete process.env.OPENCORVUS_TRANSPORT_TEST
  })

  test("sends requests and receives notifications over line-delimited json", async () => {
    const script = [
      "const rl = require('node:readline').createInterface({ input: process.stdin, crlfDelay: Infinity })",
      "for await (const line of rl) {",
      "  const msg = JSON.parse(line)",
      "  if (msg.method === 'initialize') {",
      "    process.stdout.write(JSON.stringify({ id: msg.id, result: { ok: true } }) + '\\n')",
      "    process.stdout.write(JSON.stringify({ method: 'thread/started', params: { threadId: 'thr_test' } }) + '\\n')",
      "  }",
      "}",
    ].join("\n")

    const transport = JsonRpcLineTransport.create({
      command: [process.execPath, "-e", script],
      requestIdleMs: 1_000,
    })

    const result = await transport.request("initialize", {
      clientInfo: {
        name: "test",
        version: "0.0.1-alpha",
      },
    })
    expect(result).toEqual({ ok: true })

    const events = transport.events()
    const next = await events.next()
    expect(next.value).toEqual({
      type: "notification",
      method: "thread/started",
      params: {
        threadId: "thr_test",
      },
    })

    await transport.close()
  })

  test("fails a pending request and terminates a silent child after request inactivity", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-json-rpc-idle-"))
    const pidFile = path.join(root, "child.pid")
    const script = [
      "const fs = require('node:fs')",
      `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))`,
      "const rl = require('node:readline').createInterface({ input: process.stdin, crlfDelay: Infinity })",
      "for await (const line of rl) {",
      "  JSON.parse(line)",
      "}",
    ].join("\n")

    const transport = JsonRpcLineTransport.create({
      command: [process.execPath, "-e", script],
      requestIdleMs: 40,
    })
    let pid: number | undefined

    try {
      await waitFor(async () => (await exists(pidFile)) === true)
      pid = Number(await fs.readFile(pidFile, "utf8"))
      await expect(transport.request("initialize", { clientInfo: { name: "test", version: "0" } })).rejects.toThrow(
        /stream idle > 40ms \(json-rpc request:/,
      )
      await waitFor(() => !processAlive(pid))
    } finally {
      await transport.close()
      if (pid !== undefined && processAlive(pid)) process.kill(pid)
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("request inactivity escalates when the child ignores terminate", async () => {
    if (process.platform === "win32") return

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-json-rpc-idle-ignore-sigterm-"))
    const pidFile = path.join(root, "child.pid")
    const script = [
      "const fs = require('node:fs')",
      "process.on('SIGTERM', () => {})",
      `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))`,
      "const rl = require('node:readline').createInterface({ input: process.stdin, crlfDelay: Infinity })",
      "for await (const line of rl) {",
      "  JSON.parse(line)",
      "}",
    ].join("\n")

    const transport = JsonRpcLineTransport.create({
      command: [process.execPath, "-e", script],
      requestIdleMs: 40,
    })
    let pid: number | undefined

    try {
      await waitFor(async () => (await exists(pidFile)) === true)
      pid = Number(await fs.readFile(pidFile, "utf8"))
      await expect(transport.request("initialize", { clientInfo: { name: "test", version: "0" } })).rejects.toThrow(
        /stream idle > 40ms \(json-rpc request:/,
      )
      await waitFor(() => !processAlive(pid), 7_000)
    } finally {
      await transport.close()
      if (pid !== undefined && processAlive(pid)) process.kill(pid, "SIGKILL")
      await fs.rm(root, { recursive: true, force: true })
    }
  }, 8_000)

  test("close surfaces process cleanup failure after request inactivity", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-json-rpc-cleanup-failure-"))
    const pidFile = path.join(root, "child.pid")
    spyCleanupFailure("forced JSON-RPC process cleanup failure")
    const script = [
      "const fs = require('node:fs')",
      `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))`,
      "setTimeout(() => process.exit(0), 1000)",
      "const rl = require('node:readline').createInterface({ input: process.stdin, crlfDelay: Infinity })",
      "for await (const line of rl) {",
      "  JSON.parse(line)",
      "}",
    ].join("\n")

    const transport = JsonRpcLineTransport.create({
      command: [process.execPath, "-e", script],
      requestIdleMs: 40,
    })
    let pid: number | undefined
    const started = Date.now()

    try {
      await waitFor(async () => (await exists(pidFile)) === true)
      pid = Number(await fs.readFile(pidFile, "utf8"))
      await expect(transport.request("initialize", { clientInfo: { name: "test", version: "0" } })).rejects.toThrow(
        /stream idle > 40ms \(json-rpc request:/,
      )
      await expect(transport.close()).rejects.toThrow("forced JSON-RPC process cleanup failure")
      expect(Date.now() - started).toBeLessThan(1000)
    } finally {
      if (pid !== undefined && processAlive(pid)) process.kill(pid)
      await fs.rm(root, { recursive: true, force: true })
    }
  }, 3_000)

  test("terminates a live child when stdout closes before process exit", async () => {
    if (process.platform === "win32") {
      const source = await fs.readFile(path.resolve(import.meta.dir, "../../src/executor/protocol/json-rpc.ts"), "utf8")
      expect(source).toContain("if (!closed) {")
      expect(source).toContain("void terminateProcess().catch")
      return
    }

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-json-rpc-stdout-eof-"))
    const pidFile = path.join(root, "child.pid")
    const script = [
      "const fs = require('node:fs')",
      `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))`,
      "fs.closeSync(1)",
      "setInterval(() => {}, 1000)",
    ].join("\n")

    const transport = JsonRpcLineTransport.create({
      command: [process.execPath, "-e", script],
      requestIdleMs: 1_000,
    })
    let pid: number | undefined

    try {
      await waitFor(async () => (await exists(pidFile)) === true)
      pid = Number(await fs.readFile(pidFile, "utf8"))
      await waitFor(() => !processAlive(pid!), 7_000)
    } finally {
      await transport.close()
      if (pid !== undefined && processAlive(pid)) process.kill(pid, "SIGKILL")
      await fs.rm(root, { recursive: true, force: true })
    }
  }, 8_000)

  test("caller abort fails a pending request and terminates the child", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-json-rpc-abort-"))
    const pidFile = path.join(root, "child.pid")
    const script = [
      "const fs = require('node:fs')",
      `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))`,
      "const rl = require('node:readline').createInterface({ input: process.stdin, crlfDelay: Infinity })",
      "for await (const line of rl) {",
      "  JSON.parse(line)",
      "}",
    ].join("\n")

    const transport = JsonRpcLineTransport.create({
      command: [process.execPath, "-e", script],
      requestIdleMs: 5_000,
    })
    const controller = new AbortController()
    let pid: number | undefined

    try {
      await waitFor(async () => (await exists(pidFile)) === true)
      pid = Number(await fs.readFile(pidFile, "utf8"))
      const pending = transport.request(
        "initialize",
        { clientInfo: { name: "test", version: "0" } },
        {
          signal: controller.signal,
        },
      )
      controller.abort(new DOMException("forced caller abort", "AbortError"))

      await expect(pending).rejects.toThrow("forced caller abort")
      await waitFor(() => !processAlive(pid))
    } finally {
      await transport.close()
      if (pid !== undefined && processAlive(pid)) process.kill(pid)
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

async function exists(file: string) {
  try {
    await fs.stat(file)
    return true
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error ? String((error as NodeJS.ErrnoException).code) : ""
    if (code === "ENOENT") return false
    throw error
  }
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await Bun.sleep(10)
  }
  throw new Error("timed out waiting for condition")
}

function processAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error ? String((error as NodeJS.ErrnoException).code) : ""
    return code !== "ESRCH"
  }
}

function spyCleanupFailure(message: string): void {
  if (process.platform === "win32") {
    spyOn(ProcessSupervisor, "terminateProcessTree").mockImplementation(async () => {
      throw new Error(message)
    })
    return
  }
  spyOn(ProcessSupervisor, "terminateProcessGroup").mockImplementation(async () => {
    throw new Error(message)
  })
}
