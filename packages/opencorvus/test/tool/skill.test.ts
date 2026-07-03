import { describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import type { PermissionNext } from "../../src/permission/next"
import type { Tool } from "../../src/tool/tool"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { SkillMount } from "../../src/skill/mounts"
import { SystemPrompt } from "../../src/session/system"
import { MCP } from "../../src/mcp"
import { SkillTool } from "../../src/tool/skill"
import { ToolRegistry } from "../../src/tool/registry"
import { Config } from "../../src/config/config"
import { PROJECT_EXPERT_SQUAD_ID, writeProjectExpertSquadPackage } from "../fixture/expert-squad"
import { tmpdir } from "../fixture/fixture"

const baseCtx: Omit<Tool.Context, "ask"> = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
}

describe("tool.skill", () => {
  test("unmounted skill is absent from search and cannot be loaded", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencorvus", "skill", "unmounted-skill")
        await Bun.write(
          path.join(skillDir, "SKILL.md"),
          `---
name: unmounted-skill
description: Skill that must stay unavailable until mounted.
---

# Unmounted Skill
`,
        )
      },
    })

    const home = process.env.OPENCORVUS_TEST_HOME
    process.env.OPENCORVUS_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const build = await Agent.get("build")
          expect(build).toBeDefined()
          const tool = await SkillTool.init({ agent: build })
          const ctx: Tool.Context = { ...baseCtx, ask: async () => {} }

          const result = await tool.execute({ query: "unmounted" }, ctx)
          expect(result.output).not.toContain("<name>unmounted-skill</name>")
          await expect(tool.execute({ name: "unmounted-skill" }, ctx)).rejects.toThrow(
            'Skill "unmounted-skill" not found or not allowed',
          )
        },
      })
    } finally {
      if (home === undefined) delete process.env.OPENCORVUS_TEST_HOME
      else process.env.OPENCORVUS_TEST_HOME = home
    }
  })

  test("execute without name searches compatible skill metadata", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } },
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencorvus", "skill", "tool-skill")
        await Bun.write(
          path.join(skillDir, "SKILL.md"),
          `---
name: tool-skill
description: Skill for tool tests.
mounted_agents:
  - build
---

# Tool Skill
`,
        )
      },
    })
    await writeProjectExpertSquadPackage(tmp.path, PROJECT_EXPERT_SQUAD_ID, {
      buildDefaultSkillRefs: ["default/skill/tool-skill"],
    })

    const home = process.env.OPENCORVUS_TEST_HOME
    process.env.OPENCORVUS_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const build = await Agent.get("build")
          expect(build).toBeDefined()
          const config = Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } })
          const tool = await SkillTool.init({ agent: build, config })
          const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
          const ctx: Tool.Context = {
            ...baseCtx,
            ask: async (req) => {
              requests.push(req)
            },
          }
          const skillPath = path.join(tmp.path, ".opencorvus", "skill", "tool-skill", "SKILL.md")

          expect(tool.description).not.toContain(pathToFileURL(skillPath).href)

          const result = await tool.execute({ query: "tool" }, ctx)

          expect(requests).toEqual([])
          expect(result.title).toBe("Skill search: tool")
          expect(result.metadata.names).toContain("tool-skill")
          expect(result.output).toContain("<skill_search>")
          expect(result.output).toContain("<name>tool-skill</name>")
          expect(result.output).toContain("<description>Skill for tool tests.</description>")
          expect(result.output).not.toContain("<stage>")
          expect(result.output).toContain(`<location>${pathToFileURL(skillPath).href}</location>`)
          expect(result.output).not.toContain("<skill_content")
        },
      })
    } finally {
      process.env.OPENCORVUS_TEST_HOME = home
    }
  })

  test("execute without name defaults list and search results to five skills", async () => {
    const defaultLimitSkillNames = Array.from({ length: 7 }, (_, index) => `default-limit-skill-${index + 1}`)
    await using tmp = await tmpdir({
      git: true,
      config: { prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } },
      init: async (dir) => {
        for (const [index, name] of defaultLimitSkillNames.entries()) {
          await Bun.write(
            path.join(dir, ".opencorvus", "skill", name, "SKILL.md"),
            `---
name: ${name}
description: Common default limit workflow ${index + 1}.
mounted_agents:
  - build
---

# Default Limit Skill ${index + 1}

Common default limit workflow body ${index + 1}.
`,
          )
        }
      },
    })
    await writeProjectExpertSquadPackage(tmp.path, PROJECT_EXPERT_SQUAD_ID, {
      buildDefaultSkillRefs: defaultLimitSkillNames.map((name) => `default/skill/${name}`),
    })

    const home = process.env.OPENCORVUS_TEST_HOME
    process.env.OPENCORVUS_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const build = await Agent.get("build")
          expect(build).toBeDefined()
          const config = Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } })
          const tool = await SkillTool.init({ agent: build, config })
          const ctx: Tool.Context = { ...baseCtx, ask: async () => {} }

          const listResult = await tool.execute({}, ctx)
          expect(listResult.metadata.count).toBe(5)
          expect(listResult.metadata.total).toBeGreaterThanOrEqual(7)
          expect(listResult.metadata.names).toHaveLength(5)
          expect(listResult.metadata.names).not.toContain("browser_preview_bind_local_module")
          expect(listResult.metadata.names).not.toContain("browser_preview_compare_regions")
          expect(listResult.output).toContain("<matched>5</matched>")
          expect(listResult.output).toContain(`<total_compatible>${listResult.metadata.total}</total_compatible>`)

          const searchResult = await tool.execute({ query: "common default limit workflow" }, ctx)
          expect(searchResult.metadata.count).toBe(5)
          expect(searchResult.metadata.total).toBeGreaterThanOrEqual(7)
          expect(searchResult.metadata.names).toHaveLength(5)
          expect(searchResult.output).toContain("<matched>5</matched>")
          expect(searchResult.output).toContain(`<total_compatible>${searchResult.metadata.total}</total_compatible>`)

        },
      })
    } finally {
      process.env.OPENCORVUS_TEST_HOME = home
    }
  })

  test("execute without name fuzzy-searches skill title and content", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } },
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencorvus", "skill", "semantic-workflow")
        await Bun.write(
          path.join(skillDir, "SKILL.md"),
          `---
name: semantic-workflow
description: General workflow with neutral metadata.
mounted_agents:
  - build
---

# Evidence Contract

Use viewport parity ledger notes and DOM affordance analysis before implementation.
`,
        )
      },
    })
    await writeProjectExpertSquadPackage(tmp.path, PROJECT_EXPERT_SQUAD_ID, {
      buildDefaultSkillRefs: ["default/skill/semantic-workflow"],
    })

    const home = process.env.OPENCORVUS_TEST_HOME
    process.env.OPENCORVUS_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const build = await Agent.get("build")
          expect(build).toBeDefined()
          const config = Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } })
          const tool = await SkillTool.init({ agent: build, config })
          const ctx: Tool.Context = { ...baseCtx, ask: async () => {} }

          const titleResult = await tool.execute({ query: "evdnc cntrct" }, ctx)
          expect(titleResult.metadata.names).toContain("semantic-workflow")
          expect(titleResult.output).toContain("<title>Evidence Contract</title>")

          const contentResult = await tool.execute({ query: "viewprt ledgr" }, ctx)
          expect(contentResult.metadata.names).toContain("semantic-workflow")
          expect(contentResult.output).not.toContain("DOM affordance analysis")
          expect(contentResult.output).not.toContain("<skill_content")
        },
      })
    } finally {
      process.env.OPENCORVUS_TEST_HOME = home
    }
  })

  test("uses the turn-scoped resolved surface for prompt and tool search", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } },
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencorvus", "skill", "needs-websearch")
        await Bun.write(
          path.join(skillDir, "SKILL.md"),
          `---
name: needs-websearch
description: Skill requiring a tool removed from the current turn.
required_tools:
  - websearch
mounted_agents:
  - build
---

# Needs Websearch
`,
        )
      },
    })
    await writeProjectExpertSquadPackage(tmp.path, PROJECT_EXPERT_SQUAD_ID, {
      buildDefaultSkillRefs: ["default/skill/needs-websearch"],
    })

    const home = process.env.OPENCORVUS_TEST_HOME
    process.env.OPENCORVUS_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const build = await Agent.get("build")
          expect(build).toBeDefined()
          const config = Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } })
          const surface = await SkillMount.resolve({ agent: build!, config, availableToolNames: ["skill"] })
          expect(surface.skills.find((skill) => skill.name === "needs-websearch")?.reason).toBe("missing_required_tool")
          const prompt = await SystemPrompt.skills(build!, { surface })
          expect(prompt ?? "").not.toContain("needs-websearch")

          const tool = await SkillTool.init({ agent: build, skillSurface: surface })
          const result = await tool.execute({ query: "websearch" }, { ...baseCtx, ask: async () => {} })
          expect(result.output).not.toContain("<name>needs-websearch</name>")
          await expect(tool.execute({ name: "needs-websearch" }, { ...baseCtx, ask: async () => {} })).rejects.toThrow(
            'Skill "needs-websearch" not found or not allowed',
          )
        },
      })
    } finally {
      process.env.OPENCORVUS_TEST_HOME = home
    }
  })

  test("execute returns skill content block with files", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } },
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencorvus", "skill", "tool-skill")
        await Bun.write(
          path.join(skillDir, "SKILL.md"),
          `---
name: tool-skill
description: Skill for tool tests.
mounted_agents:
  - build
---

# Tool Skill

Use this skill.
`,
        )
        await Bun.write(path.join(skillDir, "scripts", "demo.txt"), "demo")
      },
    })
    await writeProjectExpertSquadPackage(tmp.path, PROJECT_EXPERT_SQUAD_ID, {
      buildDefaultSkillRefs: ["default/skill/tool-skill"],
    })

    const home = process.env.OPENCORVUS_TEST_HOME
    process.env.OPENCORVUS_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const build = await Agent.get("build")
          expect(build).toBeDefined()
          const config = Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } })
          const tool = await SkillTool.init({ agent: build, config })
          const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
          const ctx: Tool.Context = {
            ...baseCtx,
            ask: async (req) => {
              requests.push(req)
            },
          }

          const result = await tool.execute({ name: "tool-skill" }, ctx)
          const dir = path.join(tmp.path, ".opencorvus", "skill", "tool-skill")
          const file = path.resolve(dir, "scripts", "demo.txt")

          expect(requests.length).toBe(1)
          expect(requests[0].permission).toBe("skill")
          expect(requests[0].patterns).toContain("tool-skill")
          expect(requests[0].always).toContain("tool-skill")

          expect(result.metadata.dir).toBe(dir)
          expect(result.output).toContain(`<skill_content name="tool-skill">`)
          expect(result.output).toContain(`Base directory for this skill: ${pathToFileURL(dir).href}`)
          expect(result.output).toContain(`<file>${file}</file>`)
        },
      })
    } finally {
      process.env.OPENCORVUS_TEST_HOME = home
    }
  })

  test("orchestrator can search and load builtin expert-squad skills", async () => {
    await using tmp = await tmpdir({ git: true })
    const home = process.env.OPENCORVUS_TEST_HOME
    process.env.OPENCORVUS_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const orchestrator = await Agent.get("orchestrator")
          expect(orchestrator).toBeDefined()
          const tool = await SkillTool.init({ agent: orchestrator })
          const ctx: Tool.Context = { ...baseCtx, agent: "orchestrator", ask: async () => {} }

          const search = await tool.execute({ query: "frontend replica expert squad" }, ctx)
          expect(search.output).toContain("<name>frontend-replica-expert-squad</name>")
          expect(search.output).toContain("<required_tools>select_expert_squad</required_tools>")
          expect(search.output).not.toContain("<name>research-report</name>")

          const loaded = await tool.execute({ name: "frontend-replica-expert-squad" }, ctx)
          expect(loaded.output).toContain('<skill_content name="frontend-replica-expert-squad">')
          expect(loaded.output).toContain("select_expert_squad")
          expect(loaded.output).toContain('profile_id: "frontend-replica"')

          const innovateSearch = await tool.execute({ query: "frontend innovate expert squad" }, ctx)
          expect(innovateSearch.output).toContain("<name>frontend-innovate-expert-squad</name>")
          const innovate = await tool.execute({ name: "frontend-innovate-expert-squad" }, ctx)
          expect(innovate.output).toContain('<skill_content name="frontend-innovate-expert-squad">')
          expect(innovate.output).toContain('profile_id: "frontend-innovate"')
          expect(innovate.output).toContain("multiple Build brainstorm drafts")
          expect(innovate.output).toContain("not a competing source of final truth")
          expect(innovate.output).toContain("Design Philosophy Contract")
          expect(innovate.output).toContain("Existing URL Redesign Flow")
          expect(innovate.output).toContain("rejected shallow or generic draft traits")
        },
      })
    } finally {
      if (home === undefined) delete process.env.OPENCORVUS_TEST_HOME
      else process.env.OPENCORVUS_TEST_HOME = home
    }
  })

  test("project expert-squad selector load does not sample package production files", async () => {
    await using tmp = await tmpdir({ git: true })
    await writeProjectExpertSquadPackage(tmp.path)
    const home = process.env.OPENCORVUS_TEST_HOME
    process.env.OPENCORVUS_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const orchestrator = await Agent.get("orchestrator")
          expect(orchestrator).toBeDefined()
          const tool = await SkillTool.init({ agent: orchestrator })
          const ctx: Tool.Context = { ...baseCtx, agent: "orchestrator", ask: async () => {} }

          const loaded = await tool.execute({ name: `${PROJECT_EXPERT_SQUAD_ID}-expert-squad` }, ctx)

          expect(loaded.output).toContain(`<skill_content name="${PROJECT_EXPERT_SQUAD_ID}-expert-squad">`)
          expect(loaded.output).toContain(`profile_id ${PROJECT_EXPERT_SQUAD_ID}`)
          expect(loaded.output).not.toContain("Base directory for this skill")
          expect(loaded.output).not.toContain(`${path.sep}agents${path.sep}`)
          expect(loaded.output).not.toContain(`${path.sep}tools${path.sep}`)
          expect(loaded.output).not.toContain(`${path.sep}mcp${path.sep}`)
          expect(loaded.output).not.toContain("source-evidence")
          expect(loaded.output).not.toContain("build-evidence")
          expect(loaded.output).not.toContain("package-browser")
          expect(loaded.metadata.dir).toBe("")
        },
      })
    } finally {
      if (home === undefined) delete process.env.OPENCORVUS_TEST_HOME
      else process.env.OPENCORVUS_TEST_HOME = home
    }
  })

  test("active project package prompt profile projects package skills but not package tools or MCP surfaces", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID },
        mcp: { browser: { enabled: false } },
      },
    })
    await writeProjectExpertSquadPackage(tmp.path)
    const home = process.env.OPENCORVUS_TEST_HOME
    process.env.OPENCORVUS_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const [orchestrator, build] = await Promise.all([Agent.get("orchestrator"), Agent.get("build")])
          expect(orchestrator).toBeDefined()
          expect(build).toBeDefined()
          const config = Config.Info.parse({
            prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID },
            mcp: { browser: { enabled: false } },
          })

          const orchestratorSurface = await SkillMount.resolve({ agent: orchestrator!, config })
          expect(orchestratorSurface.active_profile).toBe(PROJECT_EXPERT_SQUAD_ID)
          expect(orchestratorSurface.selector_skill_names).toEqual([`${PROJECT_EXPERT_SQUAD_ID}-expert-squad`])
          expect(orchestratorSurface.production_skill_names).toContain("scheduler")
          expect(orchestratorSurface.skills.map((skill) => skill.name)).toContain(`${PROJECT_EXPERT_SQUAD_ID}-expert-squad`)
          expect(orchestratorSurface.skills.map((skill) => skill.name)).toContain("scheduler")
          expect(orchestratorSurface.skills.map((skill) => skill.name)).not.toContain("implementation")

          const buildSurface = await SkillMount.resolve({ agent: build!, config })
          expect(buildSurface.active_profile).toBe(PROJECT_EXPERT_SQUAD_ID)
          expect(buildSurface.skills.map((skill) => skill.name)).toContain("implementation")
          expect(buildSurface.skills.map((skill) => skill.name)).not.toContain("scheduler")

          const skillPrompt = await SystemPrompt.skills(orchestrator!, { config, projectDirectory: tmp.path })
          expect(skillPrompt).toContain(`${PROJECT_EXPERT_SQUAD_ID}-expert-squad`)
          expect(skillPrompt).toContain("scheduler")
          expect(skillPrompt).not.toContain("source-evidence")
          expect(skillPrompt).not.toContain("build-evidence")
          expect(skillPrompt).not.toContain("package-browser")

          const tool = await SkillTool.init({ agent: orchestrator!, config })
          const ctx: Tool.Context = { ...baseCtx, agent: "orchestrator", ask: async () => {} }
          const search = await tool.execute({}, ctx)
          expect(search.output).toContain(`<name>${PROJECT_EXPERT_SQUAD_ID}-expert-squad</name>`)
          expect(search.output).toContain("<name>scheduler</name>")
          expect(search.output).not.toContain("<name>implementation</name>")
          const loaded = await tool.execute({ name: "scheduler" }, ctx)
          expect(loaded.output).toContain('<skill_content name="scheduler">')

          const buildSkill = await SkillTool.init({ agent: build!, skillSurface: buildSurface })
          const buildSearch = await buildSkill.execute(
            { query: "project implementation" },
            { ...baseCtx, agent: "build", ask: async () => {} },
          )
          expect(buildSearch.output).toContain("<name>implementation</name>")

          const toolIDs = await ToolRegistry.ids()
          expect(toolIDs).not.toContain("source-evidence")
          expect(toolIDs).not.toContain("build-evidence")
          const buildTools = await ToolRegistry.tools({ providerID: "", modelID: "" }, build!)
          expect(buildTools.map((entry) => entry.id)).not.toContain("build-evidence")

          const mcpStatus = await MCP.status()
          expect(Object.keys(mcpStatus)).not.toContain(PROJECT_EXPERT_SQUAD_ID)
          expect(Object.keys(mcpStatus)).not.toContain("package-browser")
          expect(Object.keys(await MCP.tools())).not.toContain("package-browser_snapshot")
          expect(Object.keys(await MCP.prompts())).not.toContain("package-browser_inspect")
          expect(Object.keys(await MCP.resources())).not.toContain("package-browser_dom")
          expect((await MCP.serverTools()).map((tool) => tool.key)).not.toContain("package-browser_snapshot")
          expect((await MCP.serverPrompts()).map((prompt) => prompt.key)).not.toContain("package-browser_inspect")
          expect((await MCP.serverResources()).map((resource) => resource.key)).not.toContain("package-browser_dom")
          await expect(MCP.callTool({ key: "package-browser_snapshot", args: {} })).rejects.toThrow(
            "MCP tool not found",
          )
          await expect(MCP.connect("package-browser")).rejects.toThrow("MCP server not found")
          await expect(MCP.disconnect("package-browser")).rejects.toThrow("MCP server not found")
          await expect(MCP.supportsOAuth("package-browser")).rejects.toThrow("MCP server not found")
          await expect(MCP.removeAuth("package-browser")).rejects.toThrow("MCP server not found")
        },
      })
    } finally {
      if (home === undefined) delete process.env.OPENCORVUS_TEST_HOME
      else process.env.OPENCORVUS_TEST_HOME = home
    }
  })

  test("default skill mounted_agents do not grant visibility outside manifest refs", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } },
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".opencorvus", "skill", "shared-note", "SKILL.md"),
          [
            "---",
            "name: shared-note",
            "description: Default skill with stale mounted agents.",
            "mounted_agents:",
            "  - requirements",
            "---",
            "",
            "# Shared Note",
            "",
            "This default skill is projected only to Build.",
          ].join("\n"),
        )
      },
    })
    await writeProjectExpertSquadPackage(tmp.path, PROJECT_EXPERT_SQUAD_ID, {
      buildDefaultSkillRefs: ["default/skill/shared-note"],
    })
    const home = process.env.OPENCORVUS_TEST_HOME
    process.env.OPENCORVUS_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const [build, requirements] = await Promise.all([Agent.get("build"), Agent.get("requirements")])
          expect(build).toBeDefined()
          expect(requirements).toBeDefined()
          const config = Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } })

          const buildSurface = await SkillMount.resolve({ agent: build!, config })
          expect(buildSurface.skills.map((skill) => skill.name)).toContain("shared-note")
          expect(buildSurface.skills.find((skill) => skill.name === "shared-note")?.skill.mounted_agents).toEqual([
            "build",
          ])
          const buildSkill = await SkillTool.init({ agent: build, skillSurface: buildSurface })
          expect((await buildSkill.execute({ query: "shared" }, { ...baseCtx, ask: async () => {} })).output).toContain(
            "<name>shared-note</name>",
          )
          expect(
            (await buildSkill.execute({ name: "shared-note" }, { ...baseCtx, ask: async () => {} })).output,
          ).toContain('<skill_content name="shared-note">')

          const requirementsSurface = await SkillMount.resolve({ agent: requirements!, config })
          expect(requirementsSurface.skills.map((skill) => skill.name)).not.toContain("shared-note")
          expect((await SystemPrompt.skills(requirements!, { surface: requirementsSurface })) ?? "").not.toContain(
            "shared-note",
          )
          const requirementsSkill = await SkillTool.init({ agent: requirements, skillSurface: requirementsSurface })
          await expect(
            requirementsSkill.execute({ name: "shared-note" }, { ...baseCtx, agent: "requirements", ask: async () => {} }),
          ).rejects.toThrow('Skill "shared-note" not found or not allowed')
        },
      })
    } finally {
      if (home === undefined) delete process.env.OPENCORVUS_TEST_HOME
      else process.env.OPENCORVUS_TEST_HOME = home
    }
  })

  test("removed webpage-generate and ainvest design system builtins are not visible or loadable", async () => {
    await using tmp = await tmpdir({ git: true })
    const home = process.env.OPENCORVUS_TEST_HOME
    process.env.OPENCORVUS_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const build = await Agent.get("build")
          const frontendDesign = await Agent.get("frontend-design")
          expect(build).toBeDefined()
          expect(frontendDesign).toBeDefined()

          const buildSkill = await SkillTool.init({ agent: build })
          const frontendDesignSkill = await SkillTool.init({ agent: frontendDesign })

          const buildResult = await buildSkill.execute({ query: "webpage" }, { ...baseCtx, ask: async () => {} })
          const frontendDesignResult = await frontendDesignSkill.execute(
            { query: "webpage" },
            { ...baseCtx, agent: "frontend-design", ask: async () => {} },
          )
          const ainvestSearchResult = await buildSkill.execute(
            { query: "ainvest" },
            { ...baseCtx, ask: async () => {} },
          )

          expect(buildResult.output).not.toContain("<name>webpage-generate</name>")
          expect(frontendDesignResult.output).not.toContain("<name>webpage-generate</name>")
          expect(ainvestSearchResult.output).not.toContain("<name>ainvest-design-system</name>")
          await expect(
            buildSkill.execute({ name: "ainvest-design-system" }, { ...baseCtx, ask: async () => {} }),
          ).rejects.toThrow('Skill "ainvest-design-system" not found or not allowed')
        },
      })
    } finally {
      process.env.OPENCORVUS_TEST_HOME = home
    }
  })

  test("visual-qa can load acceptance skills without reopening webpage extraction skills", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } },
      init: async (dir) => {
        const visualSkillDir = path.join(dir, ".opencorvus", "skill", "visual-acceptance")
        await Bun.write(
          path.join(visualSkillDir, "SKILL.md"),
          `---
name: visual-acceptance
description: Visual QA acceptance workflow. QA means Quality Assurance.
required_tools:
  - browser_preview_reference_regions
  - browser_preview_compare_scroll_slices
agents:
  - visual-qa
mounted_agents:
  - visual-qa
  - frontend-design
  - build
---

# Visual Acceptance

Use rendered evidence to inspect the implemented interface.
`,
        )

        const extractionSkillDir = path.join(dir, ".opencorvus", "skill", "visual-extraction")
        await Bun.write(
          path.join(extractionSkillDir, "SKILL.md"),
          `---
name: visual-extraction
description: Frontend design extraction workflow.
required_tools:
  - webpage_extract
mounted_agents:
  - visual-qa
  - frontend-design
  - build
---

# Visual Extraction

Collect source webpage evidence.
`,
        )
      },
    })
    await writeProjectExpertSquadPackage(tmp.path, PROJECT_EXPERT_SQUAD_ID, {
      agentDefaultSkillRefs: {
        "visual-qa": ["default/skill/visual-acceptance", "default/skill/visual-extraction"],
        "frontend-design": ["default/skill/visual-extraction"],
      },
    })

    const home = process.env.OPENCORVUS_TEST_HOME
    process.env.OPENCORVUS_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const visualQa = await Agent.get("visual-qa")
          const frontendDesign = await Agent.get("frontend-design")
          const build = await Agent.get("build")
          expect(visualQa).toBeDefined()
          expect(frontendDesign).toBeDefined()
          expect(build).toBeDefined()

          const config = Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } })
          const visualQaSkill = await SkillTool.init({ agent: visualQa, config })
          const frontendDesignSkill = await SkillTool.init({ agent: frontendDesign, config })
          const buildSkill = await SkillTool.init({ agent: build, config })
          const ctx: Tool.Context = { ...baseCtx, ask: async () => {} }

          const visualQaResult = await visualQaSkill.execute({ query: "visual" }, ctx)
          expect(visualQaResult.output).toContain("<name>visual-acceptance</name>")
          expect(visualQaResult.output).not.toContain("<name>visual-extraction</name>")
          await expect(visualQaSkill.execute({ name: "visual-extraction" }, ctx)).rejects.toThrow(
            'Skill "visual-extraction" not found or not allowed',
          )
          expect((await visualQaSkill.execute({ name: "visual-acceptance" }, ctx)).output).toContain(
            '<skill_content name="visual-acceptance">',
          )

          const frontendDesignResult = await frontendDesignSkill.execute({ query: "visual" }, ctx)
          expect(frontendDesignResult.output).not.toContain("<name>visual-acceptance</name>")
          expect(frontendDesignResult.output).toContain("<name>visual-extraction</name>")

          const buildResult = await buildSkill.execute({ query: "visual" }, ctx)
          expect(buildResult.output).not.toContain("<name>visual-acceptance</name>")
          expect(buildResult.output).not.toContain("<name>visual-extraction</name>")
        },
      })
    } finally {
      process.env.OPENCORVUS_TEST_HOME = home
    }
  })

  test("integrity can search and load mounted preview-compatible skills through the canonical skill tool", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } },
      init: async (dir) => {
        const allowedSkillDir = path.join(dir, ".opencorvus", "skill", "integrity-acceptance")
        await Bun.write(
          path.join(allowedSkillDir, "SKILL.md"),
          `---
name: integrity-acceptance
description: Integrity preview acceptance workflow.
required_tools:
  - browser_preview
agents:
  - integrity
mounted_agents:
  - integrity
---

# Integrity Acceptance

Use browser preview evidence to audit the delivered surface.
`,
        )

        const blockedSkillDir = path.join(dir, ".opencorvus", "skill", "integrity-extraction")
        await Bun.write(
          path.join(blockedSkillDir, "SKILL.md"),
          `---
name: integrity-extraction
description: Workflow requiring unavailable extraction tooling.
required_tools:
  - webpage_extract
mounted_agents:
  - integrity
---

# Integrity Extraction

This should stay unavailable to integrity.
`,
        )
      },
    })
    await writeProjectExpertSquadPackage(tmp.path, PROJECT_EXPERT_SQUAD_ID, {
      agentDefaultSkillRefs: {
        integrity: ["default/skill/integrity-acceptance", "default/skill/integrity-extraction"],
      },
    })

    const home = process.env.OPENCORVUS_TEST_HOME
    process.env.OPENCORVUS_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const integrity = await Agent.get("integrity")
          expect(integrity).toBeDefined()

          const config = Config.Info.parse({ prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID } })
          const integritySkill = await SkillTool.init({ agent: integrity, config })
          const ctx: Tool.Context = { ...baseCtx, agent: "integrity", ask: async () => {} }

          const result = await integritySkill.execute({ query: "integrity" }, ctx)
          expect(result.output).toContain("<name>integrity-acceptance</name>")
          expect(result.output).not.toContain("<name>integrity-extraction</name>")

          const loaded = await integritySkill.execute({ name: "integrity-acceptance" }, ctx)
          expect(loaded.output).toContain('<skill_content name="integrity-acceptance">')
          await expect(integritySkill.execute({ name: "integrity-extraction" }, ctx)).rejects.toThrow(
            'Skill "integrity-extraction" not found or not allowed',
          )
        },
      })
    } finally {
      process.env.OPENCORVUS_TEST_HOME = home
    }
  })
})
