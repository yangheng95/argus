import { test } from "bun:test"
import { resolve } from "node:path"
import { runIsolatedBunTest } from "../harness/isolated-bun-runner"

const isolatedFile = resolve(import.meta.dir, "prompt-profile-resolver.test.ts")
const env = {
  OPENCORVUS_PROMPT_PROFILE_RESOLVER_ISOLATED_MCP_CASES: "1",
}

async function runResolverMcpToolExecutionTest(testName: string) {
  await runIsolatedBunTest({
    suiteName: `PromptProfileResolver ${testName}`,
    isolatedFile,
    temporaryPrefix: "opencorvus-resolver-mcp-tool-execution-",
    expectedPassCount: 1,
    env,
    bunTestArgs: ["-t", testName],
    forbiddenOutput: ["killed "],
  })
}

test(
  "runs scheduler package MCP tool execution in an isolated Bun process",
  async () => {
    await runResolverMcpToolExecutionTest(
      "projects active package MCP tools as scoped runtime providers without global MCP registration",
    )
  },
  { timeout: 0 },
)

test(
  "runs scheduler default MCP tool execution in an isolated Bun process",
  async () => {
    await runResolverMcpToolExecutionTest("projects scheduler default MCP tool refs from the effective config")
  },
  { timeout: 0 },
)

test(
  "runs prompt and resource projection without tool listing in an isolated Bun process",
  async () => {
    await runResolverMcpToolExecutionTest(
      "projects active package MCP prompts and resources when the server rejects tool listing",
    )
  },
  { timeout: 0 },
)

test(
  "runs worker package MCP tool execution in an isolated Bun process",
  async () => {
    await runResolverMcpToolExecutionTest("executes active package worker MCP tool providers in project scope")
  },
  { timeout: 0 },
)
