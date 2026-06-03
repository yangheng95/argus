import { afterEach, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Agent } from "../../src/agent/agent"
import { AgentRoleContract } from "../../src/agent/role-contract"
import { PromptCatalog } from "../../src/config/prompt-catalog"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import BUILD_CORE from "../../src/prompt/core/build-core.txt"
import VISUAL_QA_CORE from "../../src/prompt/core/visual-qa-core.txt"
import PROMPT_CODING from "../../src/agent/prompt/coding.txt"

afterEach(async () => {
  Config.global.reset()
  await Instance.disposeAll()
})

test("every role contract id has a matching registered agent (no silent missing registrations)", async () => {
  // Codex impl review round 3 §D — the original "if (!agent) continue"
  // pattern silently passed when an entry in AgentRoleContract.all was
  // not registered in Agent.list(). Strengthen the assertion so missing
  // a role registration (e.g. forgetting to add fact-check to
  // agent.ts state()) loudly fails this test.
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agents = await Agent.list()
      const byID = new Map(agents.map((a) => [a.name, a]))
      for (const [id, contract] of Object.entries(AgentRoleContract.all)) {
        const agent = byID.get(id)
        expect(agent, `AgentRoleContract.all["${id}"] has no matching Agent.list() entry — likely missing from agent.ts state() / NATIVE_DEFAULTS`).toBeDefined()
        expect(agent!.description).toBe(contract.description)
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

test("build prompt catalog default matches the runtime build core prompt", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const entries = await PromptCatalog.list()
      const build = entries.find((entry) => entry.scope === "agent" && entry.key === "build")
      expect(build).toBeDefined()
      expect(await Agent.nativeDefaultPrompt("build")).toBe(BUILD_CORE)
      expect(build!.prompt_mode).toBe("append")
      expect(build!.prompt).toBe("")
      expect(build!.effective_prompt).toBe(BUILD_CORE)
      expect(build!.default_prompt).toBe(BUILD_CORE)
      expect(build!.default_prompt).not.toBe(PROMPT_CODING)
    },
  })
})

test("visual-qa prompt catalog default matches the runtime visual QA core prompt", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const entries = await PromptCatalog.list()
      const visualQa = entries.find((entry) => entry.scope === "agent" && entry.key === "visual-qa")
      expect(visualQa).toBeDefined()
      expect(await Agent.nativeDefaultPrompt("visual-qa")).toBe(VISUAL_QA_CORE)
      expect(visualQa!.prompt_mode).toBe("append")
      expect(visualQa!.prompt).toBe("")
      expect(visualQa!.effective_prompt).toBe(VISUAL_QA_CORE)
      expect(visualQa!.default_prompt).toBe(VISUAL_QA_CORE)
      expect(visualQa!.default_prompt).not.toBe(BUILD_CORE)
      expect(visualQa!.default_prompt).not.toBe(PROMPT_CODING)
    },
  })
})

test("coding prompt catalog default matches the direct assistant prompt", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const entries = await PromptCatalog.list()
      const coding = entries.find((entry) => entry.scope === "agent" && entry.key === "coding")
      expect(coding).toBeDefined()
      expect(await Agent.nativeDefaultPrompt("coding")).toBe(PROMPT_CODING)
      expect(coding!.prompt_mode).toBe("override")
      expect(coding!.prompt).toBe(PROMPT_CODING)
      expect(coding!.effective_prompt).toBe(PROMPT_CODING)
      expect(coding!.default_prompt).toBe(PROMPT_CODING)
    },
  })
})

test("coding override and build append catalog entries stay distinct", async () => {
  await using tmp = await tmpdir({
    git: true,
    config: {
      agent: {
        coding: { prompt: "Custom coding prompt" },
        build: { prompt_append: "Extra build-stage instruction" },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const entries = await PromptCatalog.list()
      const coding = entries.find((entry) => entry.scope === "agent" && entry.key === "coding")
      const build = entries.find((entry) => entry.scope === "agent" && entry.key === "build")

      expect(coding).toBeDefined()
      expect(build).toBeDefined()
      expect(coding!.prompt_mode).toBe("override")
      expect(coding!.default_prompt).toBe(PROMPT_CODING)
      expect(coding!.prompt).toBe("Custom coding prompt")
      expect(coding!.effective_prompt).toBe("Custom coding prompt")
      expect(build!.prompt_mode).toBe("append")
      expect(build!.default_prompt).toBe(BUILD_CORE)
      expect(build!.prompt).toBe("Extra build-stage instruction")
      expect(build!.effective_prompt).toBe(`${BUILD_CORE}\n\nExtra build-stage instruction`)
      expect(coding!.default_prompt).not.toBe(build!.default_prompt)
      expect(coding!.effective_prompt).not.toBe(build!.effective_prompt)
    },
  })
})

test("compaction prompt is host-owned and not configurable", async () => {
  expect(AgentRoleContract.get("compaction").promptEditable).toBe(false)
  expect(AgentRoleContract.promptMode("compaction")).toBe("none")

  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const entries = await PromptCatalog.list()
      expect(entries.find((entry) => entry.scope === "agent" && entry.key === "compaction")).toBeUndefined()
    },
  })

  expect(() =>
    Config.Info.parse({
      agent: {
        compaction: { prompt: "replace host handoff" },
      },
    }),
  ).toThrow("prompt configuration is not editable")
})

test("research and frontend-design role descriptions keep document research distinct from UI replication", () => {
  expect(AgentRoleContract.description("frontend-design")).toContain("frontend implementation template")
  expect(AgentRoleContract.description("frontend-design")).toContain("not the owner for PRD/SPEC/report webpage research")
  expect(AgentRoleContract.description("frontend-design")).toContain("UI implementation or replication")

  expect(AgentRoleContract.description("research")).toContain("PRD/SPEC/report source material")
  expect(AgentRoleContract.description("research")).toContain("Dedicated webpage functional/visual PRD evidence belongs to frontend-research")

  expect(AgentRoleContract.description("frontend-research")).toContain("Frontend research coordinator")
  expect(AgentRoleContract.description("frontend-research")).toContain("delegates deep investigation packets to build")
  expect(AgentRoleContract.description("frontend-research")).toContain("frontend_research_brief")
  expect(AgentRoleContract.description("frontend-research")).toContain("does not directly investigate pages")
  expect(AgentRoleContract.description("frontend-research")).toContain("does not create the frontend implementation template")
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
