import { describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import type { PermissionNext } from "../../src/permission/next"
import type { Tool } from "../../src/tool/tool"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
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
          const tool = await SkillTool.init()
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
          const tool = await SkillTool.init()
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

  test("removed webpage-generate skill is not visible and ainvest design system loads for build", async () => {
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
          const ainvestResult = await buildSkill.execute(
            { name: "ainvest-design-system" },
            { ...baseCtx, ask: async () => {} },
          )

          expect(buildResult.output).not.toContain("<name>webpage-generate</name>")
          expect(frontendDesignResult.output).not.toContain("<name>webpage-generate</name>")
          expect(ainvestResult.output).toContain('<skill_content name="ainvest-design-system">')
          expect(ainvestResult.output).toContain("Closed-System Rule")
          expect(ainvestResult.output).toContain("Base directory for this skill:")
          expect(ainvestResult.output).toContain("assets/tokens/color.json")
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
  - webpage_render
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
          expect(frontendDesignResult.output).toContain("<name>visual-acceptance</name>")
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
})
