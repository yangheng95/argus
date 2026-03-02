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

You have access to a persistent memory store via the \`memory\` tool. Before answering questions about prior work, decisions, architectural choices, user preferences, project history, or any past context:

1. Call \`memory\` with \`action: "search"\` and a relevant query
2. Use the search results to inform your response
3. If you need more detail from a specific memory, call \`memory\` with \`action: "list"\` to browse available files

When you learn something important that should persist across sessions (architectural decisions, user preferences, project patterns, debugging insights), save it with \`action: "write"\`.

You can also delete outdated or incorrect memories with \`action: "delete"\`.`

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
