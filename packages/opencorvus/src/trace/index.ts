/**
 * AgentTrace — append-only JSONL capture of every agent's LLM input + report.
 *
 * AUTO-ENABLED by default — set `OPENCORVUS_AGENT_TRACE=0` to opt out.
 * Rationale: this is a debug-first project; the user explicitly asked for
 * trace to be on by default so deep-debug sessions don't require remembering
 * to set an env var. The hook sites still pay only one boolean check on the
 * disabled path, so the cost is negligible.
 *
 * Per rule 22, this is the SINGLE trace abstraction every hook site uses;
 * per rule 25, the output directory is derived from `Instance.directory`
 * rather than hardcoded.
 *
 * Output layout under `<project>/.opencorvus/trace/`:
 *   - `<sessionID>.jsonl` — per-session detail (every event for that session)
 *   - `_task-<taskID>.jsonl` — per-task chronological rollup. Each event that
 *     carries taskID is appended to BOTH its session file AND the task file,
 *     so a single task's orchestrator wake + every sub-agent dispatch sit in
 *     one file in time order. Underscore prefix sorts task files to the top
 *     of `ls` for quick navigation.
 *   - `_index.jsonl` — append-only manifest. One line per (sessionID,
 *     agentName, kind="session_open") tuple, written the first time the
 *     trace sees a session. Lets you `cat _index.jsonl | jq` to map
 *     sessionID → agentName → taskID without scanning every per-session
 *     file. Index lines also fire for helper LLM calls (no sessionID), so
 *     Agent.generate and generateFollowup show up.
 *   - `helper-<agentName>-<ts>.jsonl` — for direct streamObject calls that
 *     have no session context (Agent.generate / generateFollowup).
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
  // Auto-enabled. Opt out via `OPENCORVUS_AGENT_TRACE=0` (also accepts "false"
  // / "no" / "off" for ergonomics). The empty string and unset both keep
  // tracing on by design.
  const DISABLED_VALUES = new Set(["0", "false", "no", "off"])
  const ENABLED = !DISABLED_VALUES.has((process.env.OPENCORVUS_AGENT_TRACE ?? "").toLowerCase())
  const REDACT_ATTACHMENTS = process.env.OPENCORVUS_AGENT_TRACE_REDACT_ATTACHMENTS === "1"

  export function isEnabled(): boolean {
    return ENABLED
  }

  /** Resolve the directory trace files live in. Exposed for callers that need
   *  to read trace artifacts (overlay debug panel, server `/session/:id/trace`
   *  route). Mirrors the write path: env override > Instance.directory default. */
  export function getTraceDir(): string {
    return traceDir()
  }

  function traceDir(): string {
    // Override path: benchmark runs / CI pipelines that wipe Instance.directory
    // at the end of the run (overlay-web-benchmark deletes the entire
    // temp.dir on exit) set this env to a stable location so traces survive.
    // Default — Instance.directory/.opencorvus/trace — is the right answer
    // for normal interactive sessions where the project dir is permanent.
    const override = process.env.OPENCORVUS_AGENT_TRACE_DIR
    if (override && override.length > 0) return override
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

  function taskFile(taskID: string): string {
    return path.join(traceDir(), `_task-${taskID}.jsonl`)
  }

  function indexFile(): string {
    return path.join(traceDir(), "_index.jsonl")
  }

  /** Sessions whose first event we have already indexed in `_index.jsonl`.
   *  Used to dedupe the index — first-seen sessions write a session_open line,
   *  subsequent events for the same session don't. Helper-call sessionIDs
   *  (`helper-<agentName>-<ts>`) are unique-per-call, so they index once. */
  const seenSessions = new Set<string>()

  function maybeWriteIndex(event: {
    sessionID: string
    parentSessionID?: string
    taskID?: string
    agentName: string
    kind: string
  }) {
    if (seenSessions.has(event.sessionID)) return
    seenSessions.add(event.sessionID)
    try {
      ensureDir()
      const line = safeStringify({
        ts: Date.now(),
        kind: "session_open",
        sessionID: event.sessionID,
        parentSessionID: event.parentSessionID,
        taskID: event.taskID,
        agentName: event.agentName,
        firstEvent: event.kind,
      }) + "\n"
      fs.appendFileSync(indexFile(), line, { encoding: "utf-8" })
    } catch (err) {
      log.warn("trace index append failed", {
        sessionID: event.sessionID,
        error: err instanceof Error ? err.message : String(err),
      })
    }
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

  function append(
    sessionID: string,
    event: Record<string, unknown> & {
      taskID?: string
      parentSessionID?: string
      agentName: string
      kind: string
    },
  ) {
    if (!ENABLED) return
    try {
      ensureDir()
      maybeWriteIndex({
        sessionID,
        parentSessionID: event.parentSessionID,
        taskID: event.taskID,
        agentName: event.agentName,
        kind: event.kind,
      })
      const line = safeStringify(event) + "\n"
      fs.appendFileSync(sessionFile(sessionID), line, { encoding: "utf-8" })
      // Per-task chronological rollup so a single task's full timeline (every
      // wake + every sub-agent dispatch) is grep-able in one file. The same
      // line is duplicated; consumers can dedupe on (sessionID, ts) or just
      // scan the rollup directly.
      if (typeof event.taskID === "string" && event.taskID.length > 0) {
        fs.appendFileSync(taskFile(event.taskID), line, { encoding: "utf-8" })
      }
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

  /** Capture a direct streamObject / generateText call that bypasses the
   *  session pipeline (Agent.generate, generateFollowup). Synthesises a
   *  helper sessionID from agentName + timestamp so the event lands in its
   *  own file under the same trace dir. Both the input and the structured
   *  output go in one event since these helpers are single-shot. */
  export function recordHelperLLMCall(input: {
    agentName: string
    model: { providerID: string; modelID: string }
    messages: unknown[]
    schema?: unknown
    output?: unknown
    error?: string
  }): string {
    if (!ENABLED) return ""
    const helperSessionID = `helper-${input.agentName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    append(helperSessionID, {
      ts: Date.now(),
      kind: "helper_llm_call",
      sessionID: helperSessionID,
      agentName: input.agentName,
      payload: {
        model: input.model,
        messages: redactMessages(input.messages),
        schema: input.schema,
        output: input.output,
        error: input.error,
      },
    })
    return helperSessionID
  }

  // ── Read API for debug surfaces (overlay trace panel, etc.) ──

  export interface TraceEvent {
    ts: number
    kind: string
    sessionID?: string
    parentSessionID?: string
    taskID?: string
    agentName?: string
    agentMode?: string
    payload?: Record<string, unknown>
    [key: string]: unknown
  }

  /** Read every event for a single session. Returns [] when the file does not
   *  exist (session never produced an event) or is empty. Callers SHOULD treat
   *  missing files as "no trace yet", not as an error. Lines that fail to parse
   *  are skipped (defensive — append-only writes can race with reads on a
   *  partial-line boundary). */
  export function readSessionEvents(sessionID: string): TraceEvent[] {
    if (!sessionID) return []
    const file = sessionFile(sessionID)
    let raw: string
    try {
      raw = fs.readFileSync(file, { encoding: "utf-8" })
    } catch {
      return []
    }
    return parseJsonl(raw)
  }

  /** Read all events for a task by scanning `_index.jsonl` for sessionIDs
   *  whose `taskID` matches, then merging each session's full event stream
   *  in chronological order. Helper sessions (no taskID) are excluded. The
   *  per-task rollup file (`_task-<id>.jsonl`) only receives `agent_report`
   *  events, so for the overlay's "Show all session trace" view we re-derive
   *  from the per-session files to surface llm_request payloads too. */
  export function readTaskEvents(taskID: string): TraceEvent[] {
    if (!taskID) return []
    const indexPath = indexFile()
    let indexRaw: string
    try {
      indexRaw = fs.readFileSync(indexPath, { encoding: "utf-8" })
    } catch {
      return []
    }
    const indexEntries = parseJsonl(indexRaw)
    const sessionIDs = new Set<string>()
    for (const entry of indexEntries) {
      if (typeof entry.taskID !== "string" || entry.taskID !== taskID) continue
      const sid = entry.sessionID
      if (typeof sid === "string" && sid.length > 0) sessionIDs.add(sid)
    }
    const all: TraceEvent[] = []
    for (const sid of sessionIDs) {
      for (const event of readSessionEvents(sid)) all.push(event)
    }
    all.sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0))
    return all
  }

  function parseJsonl(raw: string): TraceEvent[] {
    if (!raw) return []
    const result: TraceEvent[] = []
    for (const line of raw.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed) as TraceEvent
        result.push(parsed)
      } catch {
        // Skip malformed line — append-only writes can race a partial flush.
      }
    }
    return result
  }

  /** Capture an agent's terminal report. Used by runAgentSession,
   *  runAgentSessionWithRetry, and Orchestrator.processTask. */
  export function recordAgentReport(input: {
    sessionID: string
    parentSessionID?: string
    taskID?: string
    agentName: string
    kind: "agent_report" | "agent_report_retry_final" | "agent_report_failure" | "orchestrator_wake" | "orchestrator_wake_failure"
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
