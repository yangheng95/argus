import { afterEach, beforeEach, expect, test } from "bun:test"
import { Config } from "../../src/config/config"
import { Global } from "../../src/global"
import { Skill } from "../../src/skill"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import os from "os"
import path from "path"
import fs from "fs/promises"

// Filter out built-in skills so tests focus on user-defined/project skills only
function nonBuiltin(skills: Skill.Info[]) {
  return skills.filter((s) => !s.builtin)
}

const sharedHome = process.env.OPENCORVUS_TEST_HOME || path.join(os.tmpdir(), "opencorvus-test-home")
const sharedConfig = path.join(sharedHome, "config")
const globalConfigFiles = ["config.json", "opencorvus.json", "opencorvus.jsonc"] as const
const globalConfigBackup = new Map<string, string | undefined>()

async function cleanGlobalSkills() {
  await fs.mkdir(sharedHome, { recursive: true })
  await fs.mkdir(sharedConfig, { recursive: true })
  await Promise.all([
    fs.rm(path.join(sharedHome, ".claude"), { recursive: true, force: true }).catch(() => {}),
    fs.rm(path.join(sharedHome, ".agents"), { recursive: true, force: true }).catch(() => {}),
    fs.rm(path.join(sharedConfig, "config.json"), { force: true }).catch(() => {}),
    fs.rm(path.join(sharedConfig, "opencorvus.json"), { force: true }).catch(() => {}),
    fs.rm(path.join(sharedConfig, "opencorvus.jsonc"), { force: true }).catch(() => {}),
  ])
}

async function clearGlobalConfig() {
  globalConfigBackup.clear()
  for (const name of globalConfigFiles) {
    const file = path.join(Global.Path.config, name)
    const content = await fs.readFile(file, "utf8").catch(() => undefined)
    globalConfigBackup.set(name, content)
    await fs.rm(file, { force: true }).catch(() => {})
  }
}

async function restoreGlobalConfig() {
  for (const name of globalConfigFiles) {
    const file = path.join(Global.Path.config, name)
    const content = globalConfigBackup.get(name)
    if (content === undefined) {
      await fs.rm(file, { force: true }).catch(() => {})
      continue
    }
    await fs.writeFile(file, content)
  }
  globalConfigBackup.clear()
}

beforeEach(async () => {
  await Instance.disposeAll()
  Config.global.reset()
  process.env.OPENCORVUS_CONFIG_DIR = sharedConfig
  await clearGlobalConfig()
  await cleanGlobalSkills()
})

afterEach(async () => {
  await Instance.disposeAll()
  Config.global.reset()
  process.env.OPENCORVUS_CONFIG_DIR = sharedConfig
  await cleanGlobalSkills()
  await restoreGlobalConfig()
})

async function createGlobalSkill(homeDir: string) {
  const skillDir = path.join(homeDir, ".claude", "skills", "global-test-skill")
  await fs.mkdir(skillDir, { recursive: true })
  await Bun.write(
    path.join(skillDir, "SKILL.md"),
    `---
name: global-test-skill
description: A global skill from ~/.claude/skills for testing.
---

# Global Test Skill

This skill is loaded from the global home directory.
`,
  )
}

test("discovers skills from .opencorvus/skill/ directory", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".opencorvus", "skill", "test-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: test-skill
description: A test skill for verification.
---

# Test Skill

Instructions here.
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      expect(nonBuiltin(skills).length).toBe(1)
      const testSkill = skills.find((s) => s.name === "test-skill")
      expect(testSkill).toBeDefined()
      expect(testSkill!.description).toBe("A test skill for verification.")
      expect(testSkill!.location).toContain(path.join("skill", "test-skill", "SKILL.md"))
    },
  })
})

test("returns skill directories from Skill.dirs", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".opencorvus", "skill", "dir-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: dir-skill
description: Skill for dirs test.
---

# Dir Skill
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const dirs = await Skill.dirs()
      const skillDir = path.join(tmp.path, ".opencorvus", "skill", "dir-skill")
      expect(dirs).toContain(skillDir)
      expect(dirs.length).toBe(1)
    },
  })
})

test("discovers multiple skills from .opencorvus/skill/ directory", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir1 = path.join(dir, ".opencorvus", "skill", "skill-one")
      const skillDir2 = path.join(dir, ".opencorvus", "skill", "skill-two")
      await Bun.write(
        path.join(skillDir1, "SKILL.md"),
        `---
name: skill-one
description: First test skill.
---

# Skill One
`,
      )
      await Bun.write(
        path.join(skillDir2, "SKILL.md"),
        `---
name: skill-two
description: Second test skill.
---

# Skill Two
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      expect(nonBuiltin(skills).length).toBe(2)
      expect(skills.find((s) => s.name === "skill-one")).toBeDefined()
      expect(skills.find((s) => s.name === "skill-two")).toBeDefined()
    },
  })
})

test("skips skills with missing frontmatter", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".opencorvus", "skill", "no-frontmatter")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `# No Frontmatter

Just some content without YAML frontmatter.
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      expect(nonBuiltin(skills)).toEqual([])
    },
  })
})

test("discovers skills from .claude/skills/ directory", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".claude", "skills", "claude-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: claude-skill
description: A skill in the .claude/skills directory.
---

# Claude Skill
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      expect(nonBuiltin(skills).length).toBe(1)
      const claudeSkill = skills.find((s) => s.name === "claude-skill")
      expect(claudeSkill).toBeDefined()
      expect(claudeSkill!.location).toContain(path.join(".claude", "skills", "claude-skill", "SKILL.md"))
    },
  })
})

test("discovers global skills from ~/.claude/skills/ directory", async () => {
  await using tmp = await tmpdir({ git: true })

  await createGlobalSkill(sharedHome)
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      expect(nonBuiltin(skills).length).toBe(1)
      const globalTestSkill = skills.find((s) => s.name === "global-test-skill")
      expect(globalTestSkill).toBeDefined()
      expect(globalTestSkill!.description).toBe("A global skill from ~/.claude/skills for testing.")
      expect(globalTestSkill!.location).toContain(path.join(".claude", "skills", "global-test-skill", "SKILL.md"))
    },
  })
})

test("returns empty array when no skills exist", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      expect(nonBuiltin(skills)).toEqual([])
    },
  })
})

test("does not expose removed builtin plan or coding skills", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect(await Skill.get("plan")).toBeUndefined()
      expect(await Skill.get("coding")).toBeUndefined()
      expect(await Skill.get("panel-control")).toBeDefined()
    },
  })
})

test("discovers skills from .agents/skills/ directory", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".agents", "skills", "agent-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: agent-skill
description: A skill in the .agents/skills directory.
---

# Agent Skill
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      expect(nonBuiltin(skills).length).toBe(1)
      const agentSkill = skills.find((s) => s.name === "agent-skill")
      expect(agentSkill).toBeDefined()
      expect(agentSkill!.location).toContain(path.join(".agents", "skills", "agent-skill", "SKILL.md"))
    },
  })
})

test("discovers global skills from ~/.agents/skills/ directory", async () => {
  await using tmp = await tmpdir({ git: true })

  const skillDir = path.join(sharedHome, ".agents", "skills", "global-agent-skill")
  await fs.mkdir(skillDir, { recursive: true })
  await Bun.write(
    path.join(skillDir, "SKILL.md"),
    `---
name: global-agent-skill
description: A global skill from ~/.agents/skills for testing.
---

# Global Agent Skill

This skill is loaded from the global home directory.
`,
  )

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      expect(nonBuiltin(skills).length).toBe(1)
      const globalAgentSkill = skills.find((s) => s.name === "global-agent-skill")
      expect(globalAgentSkill).toBeDefined()
      expect(globalAgentSkill!.description).toBe("A global skill from ~/.agents/skills for testing.")
      expect(globalAgentSkill!.location).toContain(path.join(".agents", "skills", "global-agent-skill", "SKILL.md"))
    },
  })
})

test("discovers skills from both .claude/skills/ and .agents/skills/", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const claudeDir = path.join(dir, ".claude", "skills", "claude-skill")
      const agentDir = path.join(dir, ".agents", "skills", "agent-skill")
      await Bun.write(
        path.join(claudeDir, "SKILL.md"),
        `---
name: claude-skill
description: A skill in the .claude/skills directory.
---

# Claude Skill
`,
      )
      await Bun.write(
        path.join(agentDir, "SKILL.md"),
        `---
name: agent-skill
description: A skill in the .agents/skills directory.
---

# Agent Skill
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      expect(nonBuiltin(skills).length).toBe(2)
      expect(skills.find((s) => s.name === "claude-skill")).toBeDefined()
      expect(skills.find((s) => s.name === "agent-skill")).toBeDefined()
    },
  })
})

test("properly resolves directories that skills live in", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const opencorvusSkillDir = path.join(dir, ".opencorvus", "skill", "agent-skill")
      const opencorvusSkillsDir = path.join(dir, ".opencorvus", "skills", "agent-skill")
      const claudeDir = path.join(dir, ".claude", "skills", "claude-skill")
      const agentDir = path.join(dir, ".agents", "skills", "agent-skill")
      await Bun.write(
        path.join(claudeDir, "SKILL.md"),
        `---
name: claude-skill
description: A skill in the .claude/skills directory.
---

# Claude Skill
`,
      )
      await Bun.write(
        path.join(agentDir, "SKILL.md"),
        `---
name: agent-skill
description: A skill in the .agents/skills directory.
---

# Agent Skill
`,
      )
      await Bun.write(
        path.join(opencorvusSkillDir, "SKILL.md"),
        `---
name: opencorvus-skill
description: A skill in the .opencorvus/skill directory.
---

# OpenCorvus Skill
`,
      )
      await Bun.write(
        path.join(opencorvusSkillsDir, "SKILL.md"),
        `---
name: opencorvus-skill
description: A skill in the .opencorvus/skills directory.
---

# OpenCorvus Skill
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const dirs = await Skill.dirs()
      expect(dirs.length).toBe(4)
    },
  })
})
