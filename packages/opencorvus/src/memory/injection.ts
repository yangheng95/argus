import { EffectiveConfig } from "@/config/effective"
import { Memory } from "@/memory"
import { Log } from "@/util/log"

export namespace MemoryInjection {
  const log = Log.create({ service: "memory.injection" })

  const MEMORY_RECALL_INSTRUCTION = `## Memory Policy

You have access to a typed persistent memory store via the \`memory\` tool.

Memory kinds:
- \`profile\`: stable user or project facts and operating constraints
- \`lesson\`: reusable gotchas, root causes, practices, and inspirations that should influence future work
- \`fact\`: concrete project knowledge — setup, config, environment, testing methods, deployment procedures
- \`episode\`: historical task or session summaries for reference

### Recall First
1. Start from the auto-recalled memory below when present and relevant
2. If context is incomplete, call \`memory.search\` with better keywords before planning
3. Use \`memory.get\` for the most promising result IDs when you need full details

### Proactive Writing — Do This Throughout Your Work
Write to memory whenever you discover something worth preserving for future tasks. Do not wait until the end.

Write \`kind: "lesson"\` for:
- Gotchas, root causes, and non-obvious fixes
- Patterns that worked or failed and why
- Insights about how the codebase or system behaves
- Inspirations and ideas worth revisiting in future tasks

Write \`kind: "fact"\` for:
- How to run tests, linters, or builds for this project
- Deployment, release, and CI/CD procedures
- Environment setup and configuration details
- Tool versions, paths, and important env vars
- Project structure decisions and key conventions

Write \`kind: "episode"\` for:
- Summaries of completed tasks — what was done, what approach was taken, and why
- Historical decisions with context that future agents will need
- Similar past work that is relevant to future tasks

Write \`kind: "profile"\` for:
- Stable user preferences and project-wide constraints
- Team conventions and coding standards

**Actively look for opportunities to write memory.** If you discover how to run tests, encounter a tricky deployment step, find a non-obvious environment configuration, get an inspiration for improvement, or complete a significant task — write it down immediately. Future agents and future sessions will benefit.`

  export async function systemPromptSection(input: {
    projectID: string
    sessionID: string
    query: string
    memoryToolAvailable: boolean
  }): Promise<string | null> {
    const config = await EffectiveConfig.effective({ sessionID: input.sessionID })
    if (config.experimental?.memory?.enabled === false) return null

    const section = Memory.promptSection({
      query: input.query,
      projectId: input.projectID,
      sessionID: input.sessionID,
      scope: "all",
      limit: 4,
      minScore: 0.15,
      heading: "Auto-Recalled Memory",
      includeEpisodes: true,
    })
    log.info("memory prompt section assembled", {
      sessionID: input.sessionID,
      recalled: Boolean(section),
    })
    if (!input.memoryToolAvailable) return section
    if (!section) return MEMORY_RECALL_INSTRUCTION
    return [section, "", MEMORY_RECALL_INSTRUCTION].join("\n")
  }
}
