import { Config } from "@/config/config"
import { Memory } from "@/memory"
import { Log } from "@/util/log"

export namespace MemoryInjection {
  const log = Log.create({ service: "memory.injection" })

  const MEMORY_RECALL_INSTRUCTION = `## Memory Recall Policy

You have access to a typed persistent memory store via the \`memory\` tool.

Memory kinds:
- \`profile\`: stable user or project facts and operating constraints
- \`lesson\`: reusable gotchas, root causes, and practices that should influence future tasks
- \`fact\`: concrete project knowledge such as setup steps, config facts, and verified environment details
- \`episode\`: historical task or session summaries for reference when atomic memory is insufficient

Behavior:
1. Start from the auto-recalled memory below when present and relevant
2. If the recalled context is incomplete, call \`memory.search\` with better keywords before planning
3. Use \`memory.get\` only for the most promising result IDs when you need full details
4. Prefer \`preference\` for binding style or workflow instructions, not generic memory

When writing:
- Use \`kind: "lesson"\` for reusable gotchas and root causes
- Use \`kind: "fact"\` for stable setup or config knowledge
- Use \`kind: "episode"\` for task summaries
- Use \`kind: "profile"\` only for durable user or project facts`

  export async function systemPromptSection(input: {
    projectID: string
    sessionID: string
    query: string
  }): Promise<string | null> {
    const config = await Config.get()
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
    if (!section) return MEMORY_RECALL_INSTRUCTION
    return [section, "", MEMORY_RECALL_INSTRUCTION].join("\n")
  }
}
