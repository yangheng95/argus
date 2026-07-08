import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { runIsolatedBunTest } from "../harness/isolated-bun-runner"

describe("MCP OAuth browser flow", () => {
  test(
    "runs the mocked OAuth browser suite in an isolated process",
    async () => {
      const isolated = resolve(import.meta.dir, "isolated/oauth-browser.isolated.ts")
      expect(isolated.endsWith("oauth-browser.isolated.ts")).toBe(true)
      await runIsolatedBunTest({
        suiteName: "isolated MCP OAuth browser suite",
        isolatedFile: isolated,
        temporaryPrefix: "opencorvus-mcp-oauth-isolated-",
        expectedPassCount: 3,
      })
    },
    { timeout: 0 },
  )
})
