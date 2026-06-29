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
        await pause(300)
        expect(await exists(marker)).toBe(true)
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

        expect(await exists(marker)).toBe(true)
        const status = await MCP.status()
        expect(status.marker.status).toBe("failed")
      },
    })
  })
})
