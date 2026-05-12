import { afterEach, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Agent } from "../../src/agent/agent"
import { AgentRoleContract } from "../../src/agent/role-contract"
import { PromptCatalog } from "../../src/config/prompt-catalog"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  Config.global.reset()
  await Instance.disposeAll()
})

test("native agent descriptions come from the code-owned role contract", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agents = await Agent.list()
      for (const [id, contract] of Object.entries(AgentRoleContract.all)) {
        const agent = agents.find((item) => item.name === id)
        if (!agent) continue
        expect(agent.description).toBe(contract.description)
      }
    },
  })
})

test("editable native prompt catalog entries have non-empty defaults", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const entries = await PromptCatalog.list()
      const byKey = new Map(entries.filter((entry) => entry.scope === "agent").map((entry) => [entry.key, entry]))
      for (const contract of Object.values(AgentRoleContract.all)) {
        const entry = byKey.get(contract.id)
        if (!contract.promptEditable) {
          expect(entry).toBeUndefined()
          continue
        }
        expect(entry, contract.id).toBeDefined()
        if (contract.defaultPromptRequired) {
          expect(entry!.default_prompt.trim().length, contract.id).toBeGreaterThan(0)
        }
        expect(entry!.description).toBe(contract.description)
      }
    },
  })
})

test("public docs and live prompt do not describe deleted planner or requirements-owned goals", async () => {
  const root = process.cwd()
  const files = [
    "packages/web/src/content/docs/agents.mdx",
    "packages/web/src/content/docs/zh-cn/agents.mdx",
    "packages/web/src/content/docs/start/quickstart.mdx",
    "packages/web/src/content/docs/zh-cn/start/quickstart.mdx",
    "docs/product/en/start/quickstart.md",
    "docs/product/zh-CN/start/quickstart.md",
    "packages/opencorvus/src/session/prompt/system.txt",
  ]
  for (const file of files) {
    const text = await fs.readFile(path.join(root, file), "utf8")
    expect(text, file).not.toContain("planner_agent_running")
    expect(text, file).not.toMatch(/\|\s*`planner`\s*\|/)
    expect(text, file).not.toMatch(/requirements.*GoalContract/i)
    expect(text, file).not.toMatch(/需求阶段。.*GoalContract/)
  }
})
