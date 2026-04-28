import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { ExecutorDiscovery } from "../../src/executor/discovery"

const env = {
  search: process.env.OPENCORVUS_EXECUTOR_SEARCH_PATHS,
}

describe("executor discovery", () => {
  afterEach(() => {
    process.env.OPENCORVUS_EXECUTOR_SEARCH_PATHS = env.search
  })

  test("finds codex and claude binaries from custom search paths", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-exec-"))
    const codex = path.join(dir, process.platform === "win32" ? "codex.exe" : "codex")
    const claude = path.join(dir, process.platform === "win32" ? "claude.exe" : "claude")
    await fs.writeFile(codex, "")
    await fs.writeFile(claude, "")
    process.env.OPENCORVUS_EXECUTOR_SEARCH_PATHS = dir

    const found = await ExecutorDiscovery.scan()

    expect(found.opencode.available).toBe(true)
    expect(found.codex.available).toBe(true)
    expect(found.codex.path).toBe(codex)
    expect(found["claude-code"].available).toBe(true)
    expect(found["claude-code"].path).toBe(claude)
  })

  test.if(process.platform === "win32")("prefers claude.exe over claude.cmd on Windows", async () => {
    // Regression: Node child_process.spawn refuses .cmd without shell:true
    // (CVE-2024-27980), and the Anthropic Claude Agent SDK spawns without
    // a shell. If discovery returns a .cmd path the SDK exits immediately
    // with code 1 — exactly the symptom seen in benchmark/claude-code runs.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-exec-"))
    const cmd = path.join(dir, "claude.cmd")
    const exe = path.join(dir, "claude.exe")
    await fs.writeFile(cmd, "")
    await fs.writeFile(exe, "")
    process.env.OPENCORVUS_EXECUTOR_SEARCH_PATHS = dir

    const found = await ExecutorDiscovery.scan()

    expect(found["claude-code"].available).toBe(true)
    expect(found["claude-code"].path).toBe(exe)
  })
})
