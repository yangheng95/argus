import { test } from "bun:test"
import { resolve } from "node:path"
import { runIsolatedBunTest } from "../harness/isolated-bun-runner"

const isolatedFile = resolve(import.meta.dir, "prompt-profile-resolver.test.ts")
const env = {
  OPENCORVUS_PROMPT_PROFILE_RESOLVER_ISOLATED_MCP_CASES: "1",
}

async function runResolverMcpExecutionTest(testName: string, expectedPassCount = 1) {
  await runIsolatedBunTest({
    suiteName: `PromptProfileResolver ${testName}`,
    isolatedFile,
    temporaryPrefix: "opencorvus-resolver-mcp-execution-",
    expectedPassCount,
    env,
    bunTestArgs: ["-t", testName],
    forbiddenOutput: ["killed "],
  })
}

test(
  "runs default MCP prompt and resource build prompt composition in an isolated Bun process",
  async () => {
    await runResolverMcpExecutionTest("composes project package build overlays with default MCP context")
  },
  { timeout: 0 },
)

test(
  "runs package MCP prompt and resource orchestrator prompt composition in an isolated Bun process",
  async () => {
    await runResolverMcpExecutionTest("composes project package Orchestrator overlay with package MCP context")
  },
  { timeout: 0 },
)

test(
  "runs scheduler package MCP tool execution in an isolated Bun process",
  async () => {
    await runResolverMcpExecutionTest(
      "projects active package MCP tools as scoped runtime providers without global MCP registration",
    )
  },
  { timeout: 0 },
)

test(
  "runs scheduler default MCP tool execution in an isolated Bun process",
  async () => {
    await runResolverMcpExecutionTest("projects scheduler default MCP tool refs from the effective config")
  },
  { timeout: 0 },
)

test(
  "runs package MCP prompt and resource provider reads in an isolated Bun process",
  async () => {
    await runResolverMcpExecutionTest("projects active package MCP prompts and resources as scoped runtime providers")
  },
  { timeout: 0 },
)

test(
  "runs prompt and resource projection without tool listing in an isolated Bun process",
  async () => {
    await runResolverMcpExecutionTest(
      "projects active package MCP prompts and resources when the server rejects tool listing",
    )
  },
  { timeout: 0 },
)

test(
  "runs concurrent scoped MCP prompt and resource reads in an isolated Bun process",
  async () => {
    await runResolverMcpExecutionTest(
      "shares concurrent scoped MCP prompt and resource reads through one local connection",
    )
  },
  { timeout: 0 },
)

test(
  "runs package MCP prompt and resource context composition in an isolated Bun process",
  async () => {
    await runResolverMcpExecutionTest("composes active package MCP prompt and resource context")
  },
  { timeout: 0 },
)

test(
  "runs package MCP global registration isolation in an isolated Bun process",
  async () => {
    await runResolverMcpExecutionTest("keeps active package MCP prompts and resources out of global MCP registration")
  },
  { timeout: 0 },
)

test(
  "runs package MCP resource link metadata projection in an isolated Bun process",
  async () => {
    await runResolverMcpExecutionTest("projects safe package MCP resource_link metadata")
  },
  { timeout: 0 },
)

test(
  "runs projected package MCP sanitizer vectors in an isolated Bun process",
  async () => {
    await runResolverMcpExecutionTest("projected package MCP", 24)
  },
  { timeout: 0 },
)

test(
  "runs worker default MCP prompt and resource provider reads in an isolated Bun process",
  async () => {
    await runResolverMcpExecutionTest("projects worker default MCP prompts and resources from the effective config")
  },
  { timeout: 0 },
)

test(
  "runs worker default MCP prompt and resource context composition in an isolated Bun process",
  async () => {
    await runResolverMcpExecutionTest("composes worker default MCP prompt and resource context")
  },
  { timeout: 0 },
)

test(
  "runs worker package MCP provider projection in an isolated Bun process",
  async () => {
    await runResolverMcpExecutionTest("projects active package worker MCP tools as scoped runtime providers")
  },
  { timeout: 0 },
)

test(
  "runs virtual-agent package MCP provider projection in an isolated Bun process",
  async () => {
    await runResolverMcpExecutionTest("projects virtual-agent package tools and MCP providers")
  },
  { timeout: 0 },
)

test(
  "runs worker package MCP tool execution in an isolated Bun process",
  async () => {
    await runResolverMcpExecutionTest("executes active package worker MCP tool providers in project scope")
  },
  { timeout: 0 },
)

test(
  "runs general selector skill projection in an isolated Bun process",
  async () => {
    await runResolverMcpExecutionTest("resolves general skill projection to selector skills and ordinary installed skills")
  },
  { timeout: 0 },
)

test(
  "runs active package selector failure isolation in an isolated Bun process",
  async () => {
    await runResolverMcpExecutionTest("active project package skill projection ignores inactive selector catalog failures")
  },
  { timeout: 0 },
)

test(
  "runs active package production skill projection isolation in an isolated Bun process",
  async () => {
    await runResolverMcpExecutionTest(
      "resolves active project package skill projection without registering package production skills globally",
    )
  },
  { timeout: 0 },
)

test(
  "runs explicit shared package skill projection in an isolated Bun process",
  async () => {
    await runResolverMcpExecutionTest("projects package shared skills only through explicit package skill refs")
  },
  { timeout: 0 },
)

test(
  "runs workflow role binding projection in an isolated Bun process",
  async () => {
    await runResolverMcpExecutionTest("scheduler capability projection uses active workflow role bindings")
  },
  { timeout: 0 },
)

test(
  "runs explicit default skill mount union in an isolated Bun process",
  async () => {
    await runResolverMcpExecutionTest("unions ordinary default skill mounts with explicit default skill refs")
  },
  { timeout: 0 },
)
