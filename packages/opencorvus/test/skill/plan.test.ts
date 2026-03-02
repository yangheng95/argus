import { test, expect } from "bun:test"
import { Skill } from "../../src/skill"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

test("plan skill is registered as a builtin", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skill = await Skill.get("plan")
      expect(skill).toBeDefined()
      expect(skill!.location).toBe("builtin")
    },
  })
})

test("plan skill has correct name and description", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skill = await Skill.get("plan")
      expect(skill!.name).toBe("plan")
      expect(skill!.description).toContain("complex tasks")
    },
  })
})

test("plan skill content includes all four workflow phases", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skill = await Skill.get("plan")
      const content = skill!.content
      expect(content).toContain("Phase 1")
      expect(content).toContain("Phase 2")
      expect(content).toContain("Phase 3")
      expect(content).toContain("Phase 4")
    },
  })
})

test("plan skill content references PlannerTool and task sub-agents", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skill = await Skill.get("plan")
      const content = skill!.content
      expect(content).toContain("planner")
      expect(content).toContain("task")
    },
  })
})

test("plan skill content includes When to Load trigger conditions", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skill = await Skill.get("plan")
      const content = skill!.content
      expect(content).toContain("When to Load")
    },
  })
})

test("plan skill appears in Skill.all() builtin list", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      const builtins = skills.filter((s) => s.location === "builtin")
      const names = builtins.map((s) => s.name)
      expect(names).toContain("plan")
      expect(names).toContain("coding")
      expect(names).toContain("desktop")
    },
  })
})

test("user-defined plan skill overrides builtin", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = require("path").join(dir, ".opencorvus", "skill", "plan")
      await Bun.write(
        require("path").join(skillDir, "SKILL.md"),
        `---
name: plan
description: Custom plan skill override.
---

# Custom Plan Skill

Overrides the builtin.
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skill = await Skill.get("plan")
      expect(skill!.description).toBe("Custom plan skill override.")
      expect(skill!.location).not.toBe("builtin")
    },
  })
})
