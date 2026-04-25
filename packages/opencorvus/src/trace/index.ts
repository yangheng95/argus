/**
 * AgentTrace — append-only JSONL capture of every agent's LLM input + report.
 *
 * Activated by env `OPENCORVUS_AGENT_TRACE=1`. When unset, every entry point is
 * a noop (rule 26 — zero overhead). Per rule 22, this is the SINGLE trace
 * abstraction every hook site uses; per rule 25, the output directory is
 * derived from `Instance.directory` rather than hardcoded.
 *
 * Output: `<project>/.opencorvus/trace/<sessionID>.jsonl`. One file per child
 * session for easy correlation; the parent session id + task id sit in each
 * line's payload so consumers can stitch a task-wide view via grep.
 *
 * Event shape:
 *   { ts, kind, sessionID, parentSessionID?, taskID?, agentName, payload }
 *
 *   kind="llm_request" — captured at `LLM.stream` entry (the single chokepoint
 *     in session/llm.ts), payload carries the resolved system messages, the
 *     full LLM-view messages array, the tool inventory, the model id.
 *
 *   kind="agent_report" — captured at `runAgentSession` exit, payload carries
 *     the agent's getCollector() output + the StructuredOutput payload (when
 *     `format` is set) + the captured streamErrors.
 *
 *   kind="agent_report_retry_final" — captured at `runAgentSessionWithRetry`
 *     exit. Per-attempt reports still land via the inner `runAgentSession`
 *     events; this entry summarises the final attempt + attempt count.
 *
 *   kind="orchestrator_wake" — captured at `Orchestrator.processTask` after
 *     SessionPrompt.prompt resolves. Carries the finishReason, the assistant
 *     text content, and stream errors.
 *
 * Optional env `OPENCORVUS_AGENT_TRACE_REDACT_ATTACHMENTS=1` strips
 * `data:` URL bodies from file/image parts (replaces with a length marker)
 * so trace files do not balloon with multimodal attachment base64. Default
 * is verbatim (the user asked for "real" input).
 */
import fs from "node:fs"
import path from "node:path"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"

const log = Log.create({ service: "agent-trace" })

export namespace AgentTrace {
  const ENABLED = process.env.OPENCORVUS_AGENT_TRACE === "1"
  const REDACT_ATTACHMENTS = process.env.OPENCORVUS_AGENT_TRACE_REDACT_ATTACHMENTS === "1"

  export function isEnabled(): boolean {
    return ENABLED
  }

  function traceDir(): string {
    return path.join(Instance.directory, ".opencorvus", "trace")
  }

  function ensureDir() {
    try {
      fs.mkdirSync(traceDir(), { recursive: true })
    } catch {
      /* dir may already exist */
    }
  }

  function sessionFile(sessionID: string): string {
    return path.join(traceDir(), `${sessionID}.jsonl`)
  }

  function safeStringify(value: unknown): string {
    const seen = new WeakSet()
    return JSON.stringify(value, (_key, val) => {
      if (typeof val === "bigint") return val.toString()
      if (typeof val === "function") return `[function ${val.name || "anonymous"}]`
      if (val instanceof Error) return { name: val.name, message: val.message, stack: val.stack }
      if (val && typeof val === "object") {
        if (seen.has(val as object)) return "[circular]"
        seen.add(val as object)
      }
      return val
    })
  }

  function append(sessionID: string, event: Record<string, unknown>) {
    if (!ENABLED) return
    try {
      ensureDir()
      const line = safeStringify(event) + "\n"
      fs.appendFileSync(sessionFile(sessionID), line, { encoding: "utf-8" })
    } catch (err) {
      log.warn("trace append failed", {
        sessionID,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  function redactMessages(messages: unknown[]): unknown[] {
    if (!REDACT_ATTACHMENTS) return messages
    return messages.map((raw) => {
      const msg = raw as { role?: string; content?: unknown }
      if (!Array.isArray(msg.content)) return msg
      const redactedContent = msg.content.map((rawPart) => {
        const part = rawPart as { type?: string; data?: unknown; image?: unknown }
        if (part.type === "file" && typeof part.data === "string" && part.data.startsWith("data:")) {
          return { ...part, data: `[redacted data URL, ${part.data.length} chars]` }
        }
        if (part.type === "image" && typeof part.image === "string" && part.image.startsWith("data:")) {
          return { ...part, image: `[redacted data URL, ${part.image.length} chars]` }
        }
        return part
      })
      return { ...msg, content: redactedContent }
    })
  }

  /** Capture the LLM request at `LLM.stream` entry. */
  export function recordLLMRequest(input: {
    sessionID: string
    agentName: string
    agentMode?: string
    model: { providerID: string; modelID: string }
    system: string[]
    messages: unknown[]
    tools: Array<{ name: string; description?: string }>
    toolChoice?: string
    small?: boolean
  }) {
    if (!ENABLED) return
    append(input.sessionID, {
      ts: Date.now(),
      kind: "llm_request",
      sessionID: input.sessionID,
      agentName: input.agentName,
      agentMode: input.agentMode,
      payload: {
        model: input.model,
        small: input.small,
        toolChoice: input.toolChoice,
        system: input.system,
        messages: redactMessages(input.messages),
        tools: input.tools,
      },
    })
  }

  /** Capture an agent's terminal report. Used by runAgentSession,
   *  runAgentSessionWithRetry, and Orchestrator.processTask. */
  export function recordAgentReport(input: {
    sessionID: string
    parentSessionID?: string
    taskID?: string
    agentName: string
    kind: "agent_report" | "agent_report_retry_final" | "orchestrator_wake"
    collector?: unknown
    structured?: unknown
    streamErrors?: Array<{ reason: string; name?: string }>
    attempts?: number
    finishReason?: string
    finalText?: string
    error?: string
  }) {
    if (!ENABLED) return
    append(input.sessionID, {
      ts: Date.now(),
      kind: input.kind,
      sessionID: input.sessionID,
      parentSessionID: input.parentSessionID,
      taskID: input.taskID,
      agentName: input.agentName,
      payload: {
        collector: input.collector,
        structured: input.structured,
        streamErrors: input.streamErrors,
        attempts: input.attempts,
        finishReason: input.finishReason,
        finalText: input.finalText,
        error: input.error,
      },
    })
  }
}
