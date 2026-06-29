import { describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import type { PermissionNext } from "../../src/permission/next"
import type { Tool } from "../../src/tool/tool"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { SkillMount } from "../../src/skill/mounts"
import { SystemPrompt } from "../../src/session/system"
import { SkillTool } from "../../src/tool/skill"
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
      process.env.OPENCORVUS_TEST_HOME = home
    }
  })

  test("execute without name searches compatible skill metadata", async () => {
    await using tmp = await tmpdir({
      git: true,
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

    const home = process.env.OPENCORVUS_TEST_HOME
    process.env.OPENCORVUS_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const build = await Agent.get("build")
          expect(build).toBeDefined()
          const tool = await SkillTool.init({ agent: build })
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
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        for (let index = 1; index <= 7; index++) {
          const name = `default-limit-skill-${index}`
          await Bun.write(
            path.join(dir, ".opencorvus", "skill", name, "SKILL.md"),
            `---
name: ${name}
description: Common default limit workflow ${index}.
mounted_agents:
  - build
---

# Default Limit Skill ${index}

Common default limit workflow body ${index}.
`,
          )
        }
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

          const listResult = await tool.execute({}, ctx)
          expect(listResult.metadata.count).toBe(5)
          expect(listResult.metadata.total).toBe(7)
          expect(listResult.metadata.names).toHaveLength(5)
          expect(listResult.output).toContain("<matched>5</matched>")
          expect(listResult.output).toContain("<total_compatible>7</total_compatible>")

          const searchResult = await tool.execute({ query: "common default limit workflow" }, ctx)
          expect(searchResult.metadata.count).toBe(5)
          expect(searchResult.metadata.total).toBe(7)
          expect(searchResult.metadata.names).toHaveLength(5)
          expect(searchResult.output).toContain("<matched>5</matched>")
          expect(searchResult.output).toContain("<total_compatible>7</total_compatible>")
        },
      })
    } finally {
      process.env.OPENCORVUS_TEST_HOME = home
    }
  })

  test("execute without name fuzzy-searches skill title and content", async () => {
    await using tmp = await tmpdir({
      git: true,
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

    const home = process.env.OPENCORVUS_TEST_HOME
    process.env.OPENCORVUS_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const build = await Agent.get("build")
          expect(build).toBeDefined()
          const surface = await SkillMount.resolve({ agent: build!, availableToolNames: ["skill"] })
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

    const home = process.env.OPENCORVUS_TEST_HOME
    process.env.OPENCORVUS_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const build = await Agent.get("build")
          expect(build).toBeDefined()
          const tool = await SkillTool.init({ agent: build })
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
      init: async (dir) => {
        const visualSkillDir = path.join(dir, ".opencorvus", "skill", "visual-acceptance")
        await Bun.write(
          path.join(visualSkillDir, "SKILL.md"),
          `---
name: visual-acceptance
description: Visual QA acceptance workflow. QA means Quality Assurance.
required_tools:
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

          const visualQaSkill = await SkillTool.init({ agent: visualQa })
          const frontendDesignSkill = await SkillTool.init({ agent: frontendDesign })
          const buildSkill = await SkillTool.init({ agent: build })
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
      init: async (dir) => {
        const allowedSkillDir = path.join(dir, ".opencorvus", "skill", "integrity-acceptance")
        await Bun.write(
          path.join(allowedSkillDir, "SKILL.md"),
          `---
name: integrity-acceptance
description: Integrity preview acceptance workflow.
required_tools:
  - browser_preview_compare_scroll_slices
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

    const home = process.env.OPENCORVUS_TEST_HOME
    process.env.OPENCORVUS_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const integrity = await Agent.get("integrity")
          expect(integrity).toBeDefined()

          const integritySkill = await SkillTool.init({ agent: integrity })
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
