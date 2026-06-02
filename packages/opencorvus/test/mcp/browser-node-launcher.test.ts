import { afterEach, describe, expect, test } from "bun:test"
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
    await fs.writeFile(path.join(runtime, "stdio.mjs"), "")

    await expect(
      BrowserMCPNodeLauncher.resolveRuntime({
        execPath: exe,
        platform: "win32",
      }),
    ).resolves.toEqual({
      node: path.join(runtime, "node.exe"),
      bundle: path.join(runtime, "stdio.mjs"),
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
})
