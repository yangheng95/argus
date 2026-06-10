import { test, expect } from "bun:test"
import { Skill } from "../../src/skill"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import fs from "fs/promises"

// Filter out built-in skills so tests focus on user-defined/project skills only
function nonBuiltin(skills: Skill.Info[]) {
  return skills.filter((s) => !s.builtin)
}

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

  const home = process.env.OPENCORVUS_TEST_HOME
  process.env.OPENCORVUS_TEST_HOME = tmp.path

  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const dirs = await Skill.dirs()
        const skillDir = path.join(tmp.path, ".opencorvus", "skill", "dir-skill")
        expect(dirs).toContain(skillDir)
        expect(dirs.length).toBe(1)
      },
    })
  } finally {
    process.env.OPENCORVUS_TEST_HOME = home
  }
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

test("filters expired skills by expires_at frontmatter", async () => {
  const past = new Date(Date.now() - 60_000).toISOString()
  const future = new Date(Date.now() + 60_000).toISOString()
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      await Bun.write(
        path.join(dir, ".opencorvus", "skill", "expired-skill", "SKILL.md"),
        `---
name: expired-skill
description: Expired skill should not load.
expires_at: ${past}
---

# Expired Skill
`,
      )
      await Bun.write(
        path.join(dir, ".opencorvus", "skill", "active-skill", "SKILL.md"),
        `---
name: active-skill
description: Active skill should load.
expires_at: ${future}
---

# Active Skill
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      expect(skills.find((s) => s.name === "expired-skill")).toBeUndefined()
      const active = skills.find((s) => s.name === "active-skill")
      expect(active).toBeDefined()
      expect(active!.expires_at).toBe(future)
    },
  })
})

test("records duplicate skill locations after expiry filtering", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      await Bun.write(
        path.join(dir, ".claude", "skills", "shared-review", "SKILL.md"),
        `---
name: shared-review
description: Shared review skill from Claude directory.
---

# Shared Review
`,
      )
      await Bun.write(
        path.join(dir, ".agents", "skills", "shared-review", "SKILL.md"),
        `---
name: shared-review
description: Shared review skill from Agents directory.
---

# Shared Review
`,
      )
      await Bun.write(
        path.join(dir, ".codex", "skills", "expired-shared-review", "SKILL.md"),
        `---
name: shared-review
description: Expired duplicate should not be reported.
expires_at: ${new Date(Date.now() - 60_000).toISOString()}
---

# Expired Shared Review
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = nonBuiltin(await Skill.all())
      const shared = skills.find((s) => s.name === "shared-review")
      const claudeLocation = path.join(tmp.path, ".claude", "skills", "shared-review", "SKILL.md")
      const agentsLocation = path.join(tmp.path, ".agents", "skills", "shared-review", "SKILL.md")
      const expiredLocation = path.join(tmp.path, ".codex", "skills", "expired-shared-review", "SKILL.md")
      expect(skills.filter((s) => s.name === "shared-review").length).toBe(1)
      expect(shared).toBeDefined()
      expect(shared!.duplicate_locations).toContain(claudeLocation)
      expect(shared!.duplicate_locations).toContain(agentsLocation)
      expect(shared!.duplicate_locations).not.toContain(expiredLocation)
      expect(shared!.duplicate_locations.length).toBe(2)
    },
  })
})

test("dedupes .opencorvus/skills when reached by external and config directory scans", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      await Bun.write(
        path.join(dir, ".opencorvus", "skills", "shared-opencorvus", "SKILL.md"),
        `---
name: shared-opencorvus
description: Shared OpenCorvus plural skill.
---

# Shared OpenCorvus
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = nonBuiltin(await Skill.all())
      const shared = skills.find((s) => s.name === "shared-opencorvus")
      expect(skills.filter((s) => s.name === "shared-opencorvus").length).toBe(1)
      expect(shared).toBeDefined()
      expect(shared!.location).toBe(path.join(tmp.path, ".opencorvus", "skills", "shared-opencorvus", "SKILL.md"))
      expect(shared!.duplicate_locations).toEqual([])
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

  const originalHome = process.env.OPENCORVUS_TEST_HOME
  process.env.OPENCORVUS_TEST_HOME = tmp.path

  try {
    await createGlobalSkill(tmp.path)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const skills = await Skill.all()
        expect(nonBuiltin(skills).length).toBe(1)
        const globalTestSkill = skills.find((s) => s.name === "global-test-skill")
        expect(globalTestSkill).toBeDefined()
        expect(globalTestSkill!.description).toBe("A global skill from ~/.claude/skills for testing.")
        expect(globalTestSkill!.location).toContain(path.join(".claude", "skills", "global-test-skill", "SKILL.md"))
        expect(globalTestSkill!.duplicate_locations).toEqual([])
      },
    })
  } finally {
    process.env.OPENCORVUS_TEST_HOME = originalHome
  }
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

test("does not expose removed builtin plan, coding, panel-control, webpage-generate, or ainvest design system skills", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect(await Skill.get("plan")).toBeUndefined()
      expect(await Skill.get("coding")).toBeUndefined()
      expect(await Skill.get("panel-control")).toBeUndefined()
      expect(await Skill.get("webpage-generate")).toBeUndefined()
      expect(await Skill.get("ainvest-design-system")).toBeUndefined()
    },
  })
})

test("registers builtin research-report skill without stage routing metadata", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skill = await Skill.get("research-report")
      expect(skill).toBeDefined()
      expect(skill!.builtin).toBe(true)
      expect("stage" in skill!).toBe(false)
      expect(skill!.required_tools).toContain("websearch")
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

  const originalHome = process.env.OPENCORVUS_TEST_HOME
  process.env.OPENCORVUS_TEST_HOME = tmp.path

  try {
    const skillDir = path.join(tmp.path, ".agents", "skills", "global-agent-skill")
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
  } finally {
    process.env.OPENCORVUS_TEST_HOME = originalHome
  }
})

test("discovers skills from .codex/skills/ directory", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".codex", "skills", "codex-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: codex-skill
description: A skill in the .codex/skills directory.
---

# Codex Skill
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      expect(nonBuiltin(skills).length).toBe(1)
      const codexSkill = skills.find((s) => s.name === "codex-skill")
      expect(codexSkill).toBeDefined()
      expect(codexSkill!.location).toContain(path.join(".codex", "skills", "codex-skill", "SKILL.md"))
    },
  })
})

test("discovers global skills from ~/.codex/skills/ directory", async () => {
  await using tmp = await tmpdir({ git: true })

  const originalHome = process.env.OPENCORVUS_TEST_HOME
  process.env.OPENCORVUS_TEST_HOME = tmp.path

  try {
    const skillDir = path.join(tmp.path, ".codex", "skills", "global-codex-skill")
    await fs.mkdir(skillDir, { recursive: true })
    await Bun.write(
      path.join(skillDir, "SKILL.md"),
      `---
name: global-codex-skill
description: A global skill from ~/.codex/skills for testing.
---

# Global Codex Skill

This skill is loaded from the global home directory.
`,
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const skills = await Skill.all()
        expect(nonBuiltin(skills).length).toBe(1)
        const globalCodexSkill = skills.find((s) => s.name === "global-codex-skill")
        expect(globalCodexSkill).toBeDefined()
        expect(globalCodexSkill!.description).toBe("A global skill from ~/.codex/skills for testing.")
        expect(globalCodexSkill!.location).toContain(path.join(".codex", "skills", "global-codex-skill", "SKILL.md"))
      },
    })
  } finally {
    process.env.OPENCORVUS_TEST_HOME = originalHome
  }
})

test("discovers skills from .claude/skills/, .agents/skills/, .codex/skills/, and .opencorvus/skills/", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const claudeDir = path.join(dir, ".claude", "skills", "claude-skill")
      const agentDir = path.join(dir, ".agents", "skills", "agent-skill")
      const codexDir = path.join(dir, ".codex", "skills", "codex-skill")
      const opencorvusDir = path.join(dir, ".opencorvus", "skills", "opencorvus-agent-skill")
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
        path.join(codexDir, "SKILL.md"),
        `---
name: codex-skill
description: A skill in the .codex/skills directory.
---

# Codex Skill
`,
      )
      await Bun.write(
        path.join(opencorvusDir, "SKILL.md"),
        `---
name: opencorvus-agent-skill
description: A skill in the .opencorvus/skills directory.
---

# OpenCorvus Agent Skill
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      expect(nonBuiltin(skills).length).toBe(4)
      expect(skills.find((s) => s.name === "claude-skill")).toBeDefined()
      expect(skills.find((s) => s.name === "agent-skill")).toBeDefined()
      expect(skills.find((s) => s.name === "codex-skill")).toBeDefined()
      expect(skills.find((s) => s.name === "opencorvus-agent-skill")).toBeDefined()
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
      const codexDir = path.join(dir, ".codex", "skills", "codex-skill")
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
        path.join(codexDir, "SKILL.md"),
        `---
name: codex-skill
description: A skill in the .codex/skills directory.
---

# Codex Skill
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
      expect(dirs.length).toBe(5)
    },
  })
})
