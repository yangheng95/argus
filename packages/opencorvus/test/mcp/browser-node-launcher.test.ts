import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { BrowserMCPNodeLauncher } from "../../src/mcp/browser/node-launcher"

describe("browser MCP node launcher", () => {
  const originalNode = process.env.OPENCORVUS_BROWSER_MCP_NODE

  afterEach(() => {
    if (originalNode === undefined) {
      delete process.env.OPENCORVUS_BROWSER_MCP_NODE
    } else {
      process.env.OPENCORVUS_BROWSER_MCP_NODE = originalNode
    }
  })

  test("resolves packaged browser MCP node runtime beside the executable", async () => {
    await using tmp = await tmpdir()
    const exe = path.join(tmp.path, "opencorvus.exe")
    const runtime = path.join(tmp.path, "browser-mcp-node")
    await fs.mkdir(runtime, { recursive: true })
    await fs.writeFile(path.join(runtime, "node.exe"), "")
    await fs.writeFile(path.join(runtime, "browser.mjs"), "")

    await expect(
      BrowserMCPNodeLauncher.resolveRuntime({
        execPath: exe,
        platform: "win32",
      }),
    ).resolves.toEqual({
      node: path.join(runtime, "node.exe"),
      bundle: path.join(runtime, "browser.mjs"),
      packaged: true,
    })
  })

  test("resolves packaged browser MCP HTTP transport to the shared bundle beside the executable", async () => {
    await using tmp = await tmpdir()
    const exe = path.join(tmp.path, "opencorvus.exe")
    const runtime = path.join(tmp.path, "browser-mcp-node")
    await fs.mkdir(runtime, { recursive: true })
    await fs.writeFile(path.join(runtime, "node.exe"), "")
    await fs.writeFile(path.join(runtime, "browser.mjs"), "")

    await expect(
      BrowserMCPNodeLauncher.resolveRuntime({
        execPath: exe,
        platform: "win32",
        transport: "http",
      }),
    ).resolves.toEqual({
      node: path.join(runtime, "node.exe"),
      bundle: path.join(runtime, "browser.mjs"),
      packaged: true,
    })
  })

  test("packaged executable does not use host node override when packaged runtime is missing", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCORVUS_BROWSER_MCP_NODE = path.join(tmp.path, "host-node.exe")

    await expect(
      BrowserMCPNodeLauncher.resolveRuntime({
        execPath: path.join(tmp.path, "opencorvus.exe"),
        platform: "win32",
      }),
    ).rejects.toThrow("Browser MCP packaged runtime is missing")
  })

  test("spawns node sidecar in a killable process group on non-Windows", () => {
    expect(BrowserMCPNodeLauncher.childSpawnOptions({ env: {}, platform: "linux" }).detached).toBe(true)
    expect(BrowserMCPNodeLauncher.childSpawnOptions({ env: {}, platform: "darwin" }).detached).toBe(true)
    expect(BrowserMCPNodeLauncher.childSpawnOptions({ env: {}, platform: "win32" }).detached).toBe(false)
  })

  test("signal and stdin termination promises are observed", () => {
    const source = readFileSync(path.resolve(import.meta.dir, "../../src/mcp/browser/node-launcher.ts"), "utf8")
    expect(source).toContain('.catch((error) => logLauncherError("SIGINT terminate failed", error))')
    expect(source).toContain('.catch((error) => logLauncherError("SIGTERM terminate failed", error))')
    expect(source).toContain('void terminate("SIGTERM").catch((error) => logLauncherError("stdin close terminate failed", error))')
    expect(source).toContain('logLauncherError("process group force kill fallback failed", error)')
  })
})
