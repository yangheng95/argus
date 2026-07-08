import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { runIsolatedBunTest } from "../harness/isolated-bun-runner"

describe("MCP transport headers", () => {
  test(
    "runs the mocked transport header suite in an isolated process",
    async () => {
      const isolated = resolve(import.meta.dir, "isolated/headers.isolated.ts")
      expect(isolated.endsWith("headers.isolated.ts")).toBe(true)
      await runIsolatedBunTest({
        suiteName: "isolated MCP transport header suite",
        isolatedFile: isolated,
        temporaryPrefix: "opencorvus-mcp-headers-isolated-",
        expectedPassCount: 5,
      })
    },
    { timeout: 0 },
  )
})
