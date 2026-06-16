import { afterEach, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Agent } from "../../src/agent/agent"
import { AgentRoleContract } from "../../src/agent/role-contract"
import { PromptCatalog } from "../../src/config/prompt-catalog"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { PermissionNext } from "../../src/permission/next"
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
        expect(
          agent,
          `AgentRoleContract.all["${id}"] has no matching Agent.list() entry — likely missing from agent.ts state() / NATIVE_DEFAULTS`,
        ).toBeDefined()
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
      expect(build!.prompt).toBe(BUILD_CORE)
      expect(build!.effective_prompt).toContain(BUILD_CORE)
      expect(build!.effective_prompt).toContain("Active prompt profile: frontend expert squad.")
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
      expect(visualQa!.prompt).toBe(VISUAL_QA_CORE)
      expect(visualQa!.effective_prompt).toContain(VISUAL_QA_CORE)
      expect(visualQa!.effective_prompt).toContain("Active prompt profile: frontend expert squad.")
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
      expect(build!.prompt).toBe(`${BUILD_CORE}\n\nExtra build-stage instruction`)
      expect(build!.effective_prompt).toContain(BUILD_CORE)
      expect(build!.effective_prompt).toContain("Active prompt profile: frontend expert squad.")
      expect(build!.effective_prompt.endsWith("\n\nExtra build-stage instruction")).toBe(true)
      expect(coding!.default_prompt).not.toBe(build!.default_prompt)
      expect(coding!.effective_prompt).not.toBe(build!.effective_prompt)
    },
  })
})

test("mission uses coordination tools without generic subagent dispatch", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const mission = await Agent.get("mission")
      expect(mission?.tools?.include).toContain("panel")
      expect(mission?.tools?.include).toContain("mission_state")
      expect(mission?.tools?.include).toContain("wait")
      expect(mission?.tools?.include).not.toContain("task")
      expect(PermissionNext.evaluate("panel", "*", mission?.permission).action).toBe("allow")
      expect(PermissionNext.evaluate("mission_state", "*", mission?.permission).action).toBe("allow")
      expect(PermissionNext.evaluate("wait", "*", mission?.permission).action).toBe("allow")
    },
  })
})

test("explore has read-only panel status tools available", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const explore = await Agent.get("explore")
      expect(explore?.tools?.include).toContain("panel")
      expect(PermissionNext.evaluate("panel", "*", explore?.permission).action).toBe("allow")
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

test("integrity prompt is host-owned so catalog cannot diverge from team runtime", async () => {
  expect(AgentRoleContract.get("integrity").promptEditable).toBe(false)
  expect(AgentRoleContract.promptMode("integrity")).toBe("none")

  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const entries = await PromptCatalog.list()
      expect(entries.find((entry) => entry.scope === "agent" && entry.key === "integrity")).toBeUndefined()
      expect(await Agent.nativeDefaultPrompt("integrity")).toContain("submit_integrity_consensus")
    },
  })

  expect(() =>
    Config.Info.parse({
      agent: {
        integrity: { prompt_append: "replace team integrity prompt" },
      },
    }),
  ).toThrow("prompt configuration is not editable")
})

test("deep-research and frontend-design role descriptions keep document research distinct from UI replication", () => {
  expect(AgentRoleContract.description("frontend-design")).toContain("frontend implementation template")
  expect(AgentRoleContract.description("frontend-design")).toContain(
    "generated code and PRD/SPEC/report material are reference inputs only",
  )
  expect(AgentRoleContract.description("frontend-design")).toContain(
    "rewritten webpage must be based on ainvest-frontend-design",
  )
  expect(AgentRoleContract.description("frontend-design")).toContain(
    "not the owner for PRD/SPEC/report webpage research",
  )
  expect(AgentRoleContract.description("frontend-design")).toContain("UI implementation or replication")
  expect(AgentRoleContract.description("frontend-design")).toContain("Single-shot task-scope evidence/handoff producer")
  expect(AgentRoleContract.description("frontend-design")).toContain(
    "do not use it as a repeatable repair, retry, or implementation iteration agent",
  )

  expect(AgentRoleContract.description("deep-research")).toContain("PRD/SPEC/report source material")
  expect(AgentRoleContract.description("deep-research")).toContain(
    "Dedicated webpage functional/visual investigation division belongs to frontend-research",
  )

  expect(AgentRoleContract.description("frontend-research")).toContain("Frontend research agent")
  expect(AgentRoleContract.description("frontend-research")).toContain("host-prepared rendered webpage evidence")
  expect(AgentRoleContract.description("frontend-research")).toContain(
    "source-backed webpage investigation work packets",
  )
  expect(AgentRoleContract.description("frontend-research")).toContain("frontend_research_brief")
  expect(AgentRoleContract.description("frontend-research")).toContain("page interface verification")
  expect(AgentRoleContract.description("frontend-research")).toContain("API adaptation documentation handoff cues")
  expect(AgentRoleContract.description("frontend-research")).toContain(
    "PRD outline, or document material are reference inputs only",
  )
  expect(AgentRoleContract.description("frontend-research")).toContain(
    "downstream webpage rewriting must be based on ainvest-frontend-design",
  )
  expect(AgentRoleContract.description("frontend-research")).toContain("does not call build")
  expect(AgentRoleContract.description("frontend-research")).toContain(
    "does not create the frontend implementation template",
  )
  expect(AgentRoleContract.description("frontend-research")).toContain(
    "Single-shot task-scope investigation publisher",
  )
  expect(AgentRoleContract.description("frontend-research")).toContain(
    "do not use it as a repeatable crawler, repair, retry, or implementation iteration agent",
  )
})

test("public workflow docs and live prompt describe the current model only", async () => {
  const root = path.resolve(import.meta.dirname, "../../../..")
  const docsFiles = [
    "packages/web/src/content/docs/index.mdx",
    "packages/web/src/content/docs/zh-cn/index.mdx",
    "packages/web/src/content/docs/agents.mdx",
    "packages/web/src/content/docs/zh-cn/agents.mdx",
    "packages/web/src/content/docs/concepts/architecture.mdx",
    "packages/web/src/content/docs/zh-cn/concepts/architecture.mdx",
    "packages/web/src/content/docs/concepts/goal-run-task.mdx",
    "packages/web/src/content/docs/zh-cn/concepts/goal-run-task.mdx",
    "packages/web/src/content/docs/concepts/agent-loop.mdx",
    "packages/web/src/content/docs/zh-cn/concepts/agent-loop.mdx",
    "packages/web/src/content/docs/operations/benchmark.mdx",
    "packages/web/src/content/docs/zh-cn/operations/benchmark.mdx",
    "packages/web/src/content/docs/reference/env.mdx",
    "packages/web/src/content/docs/zh-cn/reference/env.mdx",
    "packages/web/src/content/docs/reference/evaluator.mdx",
    "packages/web/src/content/docs/zh-cn/reference/evaluator.mdx",
    "packages/web/src/content/docs/reference/sdk.mdx",
    "packages/web/src/content/docs/zh-cn/reference/sdk.mdx",
    "packages/web/src/content/docs/troubleshooting.mdx",
    "packages/web/src/content/docs/zh-cn/troubleshooting.mdx",
    "packages/web/src/content/docs/start/install.mdx",
    "packages/web/src/content/docs/zh-cn/start/install.mdx",
    "packages/web/src/content/docs/permissions.mdx",
    "packages/web/src/content/docs/zh-cn/permissions.mdx",
    "packages/web/src/content/docs/plugins.mdx",
    "packages/web/src/content/docs/zh-cn/plugins.mdx",
    "packages/web/src/content/docs/skills.mdx",
    "packages/web/src/content/docs/zh-cn/skills.mdx",
  ]
  const livePromptFiles = [
    "packages/web/src/content/docs/start/quickstart.mdx",
    "packages/web/src/content/docs/zh-cn/start/quickstart.mdx",
    "packages/opencorvus/src/session/prompt/system.txt",
  ]

  const deletedDocPatterns: RegExp[] = [
    /deliver[- ]agent/i,
    /交付 agent/i,
    /Task Agent/,
    /Goal Agent/,
    /Spec Agent/,
    /TaskAgent/,
    /GoalPool/,
    /\bPlanner\b/,
    /removed-planning-package/,
    /src\/task-agent/,
    /src\/orchestrator\/task-loop/,
    /src\/executor\/opencode/,
    /acceptance\/checks\/per-goal/,
    /evaluateGoal/,
    /selectorsSatisfied/,
    /assistant\.evaluator/,
    /spec → goals/,
    /execute → evaluate → deliver/,
    /plan → execute/,
    /→ deliver/,
    /\.\.\/opencorvus\//,
  ]
  const staleExplanationPatterns: RegExp[] = [
    /old host/i,
    /old `[^`]+`.*removed/i,
    /has been removed/i,
    /retired/i,
    /deliver gate/i,
    /removed per-goal/i,
    /per-goal evaluator/i,
    /no longer uses/i,
    /not a separate/i,
    /not a standalone/i,
    /旧的 host/i,
    /已删除/,
    /已废弃/,
    /不再把/,
    /不是独立/,
    /交付阶段 worker/,
  ]
  for (const file of docsFiles) {
    const text = await fs.readFile(path.join(root, file), "utf8")
    for (const pattern of deletedDocPatterns) {
      expect(text, `${file} must not contain deleted public workflow term ${pattern}`).not.toMatch(pattern)
    }
    for (const pattern of staleExplanationPatterns) {
      expect(
        text,
        `${file} must describe the current workflow directly instead of explaining stale terms ${pattern}`,
      ).not.toMatch(pattern)
    }
  }

  for (const file of [...docsFiles, ...livePromptFiles]) {
    const text = await fs.readFile(path.join(root, file), "utf8")
    expect(text, file).not.toContain("planner_agent_running")
    expect(text, file).not.toMatch(/\|\s*`planner`\s*\|/)
    expect(text, file).not.toMatch(/requirements.*GoalContract/i)
    expect(text, file).not.toMatch(/需求阶段。.*GoalContract/)
  }
})

test("sdk reference api links resolve to canonical API docs", async () => {
  const root = path.resolve(import.meta.dirname, "../../../..")
  const enSdk = await fs.readFile(path.join(root, "packages/web/src/content/docs/reference/sdk.mdx"), "utf8")
  const zhSdk = await fs.readFile(path.join(root, "packages/web/src/content/docs/zh-cn/reference/sdk.mdx"), "utf8")
  const rawMarkdownRoute = await fs.readFile(path.join(root, "packages/web/src/pages/[...slug].md.ts"), "utf8")

  expect(enSdk).not.toContain("(./api.md)")
  expect(zhSdk).not.toContain("(./api.md)")
  expect(enSdk).toContain("](/docs/reference/api/)")
  expect(zhSdk).toContain("](/docs/zh-cn/reference/api/)")
  expect(rawMarkdownRoute).toContain('"reference/sdk/api": "reference/api"')
  expect(rawMarkdownRoute).toContain('"zh-cn/reference/sdk/api": "zh-cn/reference/api"')
})
