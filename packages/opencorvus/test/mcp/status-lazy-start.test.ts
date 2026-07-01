import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { MCP } from "../../src/mcp"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

async function exists(file: string) {
  return fs
    .access(file)
    .then(() => true)
    .catch(() => false)
}

async function pause(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(predicate: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await pause(25)
  }
  expect(await predicate()).toBe(true)
}

describe("MCP status auto startup", () => {
  test("status starts configured local MCP processes asynchronously", async () => {
    await using tmp = await tmpdir({
      config: {
        mcp: {
          browser: { enabled: false },
          marker: {
            type: "local",
            command: [process.execPath, path.join("scripts", "marker-mcp.js")],
            timeout: 100,
          },
        },
      },
      init: async (dir) => {
        const scripts = path.join(dir, "scripts")
        await fs.mkdir(scripts, { recursive: true })
        await Bun.write(
          path.join(scripts, "marker-mcp.js"),
          `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(path.join(dir, "mcp-started.txt"))}, "started");`,
        )
      },
    })

    const marker = path.join(tmp.path, "mcp-started.txt")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const status = await MCP.status()

        expect(status.browser).toEqual({ status: "disabled" })
        expect(status.marker).toEqual({ status: "connecting" })
        await waitFor(async () => exists(marker))
      },
    })
  })

  test("tools starts configured MCP processes on demand", async () => {
    await using tmp = await tmpdir({
      config: {
        mcp: {
          browser: { enabled: false },
          marker: {
            type: "local",
            command: [process.execPath, path.join("scripts", "marker-mcp.js")],
            timeout: 100,
          },
        },
      },
      init: async (dir) => {
        const scripts = path.join(dir, "scripts")
        await fs.mkdir(scripts, { recursive: true })
        await Bun.write(
          path.join(scripts, "marker-mcp.js"),
          `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(path.join(dir, "mcp-started.txt"))}, "started");`,
        )
      },
    })

    const marker = path.join(tmp.path, "mcp-started.txt")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(await exists(marker)).toBe(false)

        await expect(MCP.tools()).rejects.toThrow()

        await waitFor(async () => exists(marker))
        const status = await MCP.status()
        expect(status.marker.status).toBe("failed")
      },
    })
  })
})
