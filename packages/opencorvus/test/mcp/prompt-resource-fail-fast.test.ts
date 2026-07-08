import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { runIsolatedBunTest } from "../harness/isolated-bun-runner"

describe("MCP prompt and resource listing", () => {
  test(
    "runs the mocked MCP client fail-fast suite in an isolated process",
    async () => {
      const isolated = resolve(import.meta.dir, "isolated/prompt-resource-fail-fast.isolated.ts")
      expect(isolated.endsWith("prompt-resource-fail-fast.isolated.ts")).toBe(true)
      await runIsolatedBunTest({
        suiteName: "isolated MCP prompt/resource suite",
        isolatedFile: isolated,
        temporaryPrefix: "opencorvus-mcp-isolated-",
        expectedPassCount: 21,
      })
    },
    { timeout: 0 },
  )
})
