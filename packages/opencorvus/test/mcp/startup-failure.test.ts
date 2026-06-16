import { expect, test } from "bun:test"

import { Instance } from "../../src/project/instance"
import { MCP } from "../../src/mcp"
import { tmpdir } from "../fixture/fixture"

test("MCP status starts local transports asynchronously and records startup failure", async () => {
  await using tmp = await tmpdir({
    config: {
      mcp: {
        broken: {
          type: "local",
          command: ["opencorvus-missing-mcp-command-for-test"],
          timeout: 1,
        },
        browser: {
          enabled: false,
        },
      },
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const status = await MCP.status()
      expect(status.broken).toEqual({ status: "connecting" })

      await expect(MCP.tools()).resolves.toEqual({})
      await waitFor(async () => (await MCP.status()).broken.status === "failed")

      const failed = (await MCP.status()).broken
      expect(failed.status).toBe("failed")
      if (failed.status === "failed") {
        expect(failed.error.length).toBeGreaterThan(0)
      }
    },
  })
})

async function waitFor(predicate: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  expect(await predicate()).toBe(true)
}
