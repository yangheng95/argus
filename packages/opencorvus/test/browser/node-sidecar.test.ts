import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import {
  packagedBrowserNodeRuntimePaths,
  resolveBrowserNodeSidecarRuntime,
} from "../../src/browser/runtime/node-sidecar"

describe("browser Node sidecar runtime", () => {
  const originalNode = process.env.OPENCORVUS_BROWSER_MCP_NODE

  afterEach(() => {
    if (originalNode === undefined) {
      delete process.env.OPENCORVUS_BROWSER_MCP_NODE
    } else {
      process.env.OPENCORVUS_BROWSER_MCP_NODE = originalNode
    }
  })

  test("prefers packaged browser MCP node and Playwright modules", async () => {
    await using tmp = await tmpdir()
    const runtime = path.join(tmp.path, "browser-mcp-node")
    const moduleDir = path.join(runtime, "node_modules", "playwright")
    await fs.mkdir(moduleDir, { recursive: true })
    await fs.writeFile(path.join(runtime, "node.exe"), "")
    await fs.writeFile(path.join(moduleDir, "index.js"), "")
    process.env.OPENCORVUS_BROWSER_MCP_NODE = path.join(tmp.path, "host-node.exe")

    const resolved = await resolveBrowserNodeSidecarRuntime({
      execPath: path.join(tmp.path, "opencorvus.exe"),
      platform: "win32",
    })

    expect(resolved).toEqual({
      nodeExecutable: path.join(runtime, "node.exe"),
      playwrightRequirePath: path.join(moduleDir, "index.js"),
      packaged: true,
    })
  })

  test("computes packaged Node, Playwright, and MCP bundle paths from one source", async () => {
    await using tmp = await tmpdir()
    const paths = packagedBrowserNodeRuntimePaths({
      execPath: path.join(tmp.path, "opencorvus.exe"),
      platform: "win32",
    })

    expect(paths).toEqual({
      nodeExecutable: path.join(tmp.path, "browser-mcp-node", "node.exe"),
      playwrightRequirePath: path.join(tmp.path, "browser-mcp-node", "node_modules", "playwright", "index.js"),
      mcpBundle: path.join(tmp.path, "browser-mcp-node", "browser.mjs"),
    })
  })

  test("uses configured source Node only for Bun development runtime", async () => {
    process.env.OPENCORVUS_BROWSER_MCP_NODE = "custom-node.exe"

    const resolved = await resolveBrowserNodeSidecarRuntime({
      execPath: process.platform === "win32" ? "C:\\tools\\bun.exe" : "/usr/local/bin/bun",
      platform: process.platform,
    })

    expect(resolved.nodeExecutable).toBe("custom-node.exe")
    expect(resolved.playwrightRequirePath.replaceAll("\\", "/")).toContain("/node_modules/playwright/")
    expect(resolved.packaged).toBe(false)
  })

  test("rejects packaged executable without packaged browser runtime", async () => {
    await using tmp = await tmpdir()

    await expect(
      resolveBrowserNodeSidecarRuntime({
        execPath: path.join(tmp.path, "opencorvus.exe"),
        platform: "win32",
      }),
    ).rejects.toThrow("Browser Node sidecar runtime is missing")
  })
})
