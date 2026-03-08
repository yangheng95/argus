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
})
