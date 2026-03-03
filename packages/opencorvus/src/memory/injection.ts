import { Config } from "@/config/config"
import { Log } from "@/util/log"

/**
 * Memory recall system prompt section.
 *
 * Architecture reference: OpenClaw buildMemorySection()
 * - Memory is NOT auto-injected into the system prompt.
 * - Instead, a system prompt instruction tells the agent to call memory_search
 *   before answering questions about prior work, decisions, or preferences.
 * - Memory content enters the LLM context as tool results, not system prompt text.
 */
export namespace MemoryInjection {
  const log = Log.create({ service: "memory.injection" })

  const MEMORY_RECALL_INSTRUCTION = `## Memory Recall

You have access to a persistent memory store via the \`memory\` tool.

### At the start of every task — search BEFORE planning:

1. Call \`memory\` with \`action: "search"\` using keywords from the task (e.g. the app name, technology, pattern, or problem type)
2. If results are sparse, try a second search with broader or alternate keywords
3. Use any recalled prior work, known patterns, gotchas, or preferences to inform your plan — do not re-discover what is already known

This is not optional. Prior sessions may have already solved parts of this problem or identified traps you should avoid. Skipping memory recall risks duplicating work or repeating past mistakes.

### During execution — write as you go:

After each significant discovery or completed subtask, call \`memory\` with \`action: "write"\` to record:
- Solutions and exact steps that worked
- Gotchas, traps, or unexpected behaviors encountered
- Environment-specific details (paths, config values, platform quirks)
- Patterns confirmed to work well in this project

Do not batch writes to the end. If a step reveals something worth keeping, write it immediately before moving on.

### After task completion — write a summary:

Write a final memory entry summarising: what was accomplished, key decisions made, anything that was tricky, and what the next steps would be if this task were revisited.

### Other memory actions:

- \`action: "list"\` — browse available memory files when search results are sparse
- \`action: "delete"\` — remove outdated or incorrect memories`

  /**
   * Returns the memory recall instruction for the system prompt,
   * or null if memory is disabled.
   *
   * Called from prompt.ts during system prompt assembly.
   * This only adds an instruction — actual memory content enters via tool calls.
   */
  export async function systemPromptSection(): Promise<string | null> {
    const config = await Config.get()
    if (config.experimental?.memory?.enabled === false) return null

    log.info("memory recall instruction added to system prompt")
    return MEMORY_RECALL_INSTRUCTION
  }
}
