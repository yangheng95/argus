/**
 * AgentTrace — captures each agent's full input (system prompt + user messages)
 * and full output (complete text) to disk for pipeline debugging.
 *
 * Always enabled. Default directory: <Instance.directory>/.opencorvus/agent-trace/
 * Override via environment variable:
 *   OPENCORVUS_AGENT_TRACE_DIR=/path/to/trace/dir
 *
 * Each agent invocation writes a formatted markdown file:
 *   <dir>/<seq>-<agent>-<attempt>.md
 */
import fs from "node:fs"
import path from "node:path"
import { Instance } from "@/project/instance"

let seq = 0
let activeTaskID: string | undefined

function serializeContent(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    // AI SDK message content can be an array of parts (text, tool_call, tool_result)
    return content
      .map((part) => {
        if (typeof part === "string") return part
        if (part && typeof part === "object") {
          if ("text" in part && typeof part.text === "string") return part.text
          if ("type" in part) return `[${part.type}] ${JSON.stringify(part, null, 2)}`
        }
        return JSON.stringify(part)
      })
      .join("\n")
  }
  if (content && typeof content === "object") return JSON.stringify(content, null, 2)
  return String(content ?? "")
}

/**
 * Resolve the trace directory.
 * Priority: OPENCORVUS_AGENT_TRACE_DIR env > .opencorvus/agent-trace/<taskID>/
 * Per-task subdirectory avoids filename collisions between concurrent tasks.
 */
function resolveTraceDir(): string | undefined {
  const envDir = process.env.OPENCORVUS_AGENT_TRACE_DIR
  if (envDir) return envDir

  try {
    const dir = Instance.directory
    if (!dir) return undefined
    const base = path.join(dir, ".opencorvus", "agent-trace")
    // Per-task subdirectory when a task is active; otherwise write to base
    return activeTaskID ? path.join(base, activeTaskID) : base
  } catch {
    // Instance not initialized yet — skip
  }
  return undefined
}

export namespace AgentTrace {
  export interface AgentInput {
    system: string
    messages: Array<{ role: string; content: unknown }>
  }

  export function enabled(): boolean {
    return !!resolveTraceDir()
  }

  /** Start tracing for a new task. Resets sequence and sets per-task subdirectory. */
  export function startTask(taskID: string): void {
    seq = 0
    activeTaskID = taskID
  }

  /**
   * Capture an agent's full input/output to disk.
   *
   * @param agent  - Agent name: "spec" | "goal" | "planner" | "task-agent" | "evaluator-investigate" | "evaluator-judge" | "delivery"
   * @param attempt - Attempt number (1-based, for quality-retry loops)
   * @param input   - System prompt + messages array sent to the LLM
   * @param output  - Full text response from the LLM
   * @param meta    - Optional metadata (model, tool call count, quality score, etc.)
   */
  export function capture(
    agent: string,
    attempt: number,
    input: AgentInput,
    output: string,
    meta?: Record<string, unknown>,
  ): void {
    const dir = resolveTraceDir()
    if (!dir) return

    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch (err) {
      console.error(`[agent-trace] failed to create dir ${dir}:`, err)
      return
    }

    seq++
    const ts = new Date().toISOString().replace(/[:.]/g, "-")
    const filename = `${String(seq).padStart(3, "0")}-${agent}-attempt${attempt}-${ts}.md`
    const filepath = path.join(dir, filename)

    const sections: string[] = []

    // Header
    sections.push(`# Agent: ${agent} (attempt ${attempt})`)
    sections.push(`- Time: ${new Date().toISOString()}`)
    sections.push(`- Sequence: ${seq}`)
    if (meta) {
      for (const [k, v] of Object.entries(meta)) {
        sections.push(`- ${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
      }
    }
    sections.push("")

    // System Prompt
    sections.push("## System Prompt")
    sections.push("")
    sections.push("````")
    sections.push(input.system)
    sections.push("````")
    sections.push("")

    // Messages
    sections.push(`## Messages (${input.messages.length})`)
    sections.push("")
    for (let i = 0; i < input.messages.length; i++) {
      const msg = input.messages[i]
      sections.push(`### Message ${i + 1} [${msg.role}]`)
      sections.push("")
      sections.push(serializeContent(msg.content))
      sections.push("")
    }

    // Output
    sections.push("## Output")
    sections.push("")
    sections.push(output || "(empty)")
    sections.push("")

    try {
      fs.writeFileSync(filepath, sections.join("\n"), "utf-8")
      console.log(`[agent-trace] wrote ${filepath} (${sections.join("\n").length} bytes)`)
    } catch (err) {
      console.error(`[agent-trace] failed to write ${filepath}:`, err)
    }
  }
}
