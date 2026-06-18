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
 * Output layout under `<project>/.opencorvus/r/`:
 *   - `s/<task-session-key>/trace.jsonl` — per-session detail
 *   - `t/<task-key>/trace.jsonl` — per-task chronological rollup. Each event that
 *     carries taskID is appended to BOTH its session file AND the task file,
 *     so a single task's orchestrator wake + every sub-agent dispatch sit in
 *     one file in time order. Underscore prefix sorts task files to the top
 *     of `ls` for quick navigation.
 *   - `_index.jsonl` — append-only manifest. One line per session bucket
 *     (kind="session_open") or non-session domain bucket (kind="domain_open").
 *     Lets you `cat _index.jsonl | jq` to map sessionID/domain → agentName →
 *     taskID without scanning every detail file.
 *   - `_non-session.jsonl` — direct structured helper LLM calls that have no
 *     session context (Agent.generate / generateFollowup). These carry an
 *     explicit non-session domain label and never masquerade as sessions.
 *
 * Event shape:
 *   { ts, kind, domain, sessionID?, parentSessionID?, taskID?, agentName, payload }
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
 * `data:` URL bodies are stripped from trace payloads by default so trace files
 * do not balloon with multimodal attachment base64. Set
 * `OPENCORVUS_AGENT_TRACE_REDACT_ATTACHMENTS=0` only for explicit local
 * development captures; event and blob byte budgets still apply.
 */
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { SessionObservability } from "@/util/session-observability"
import type { AgentReport } from "@/agent/report"
import { ServeRuntimeMemoryMetrics } from "@/runtime/memory-metrics"

const log = Log.create({ service: "agent-trace" })

export namespace AgentTrace {
  export const NON_SESSION_DOMAIN = "non-session"
  // Auto-enabled. Opt out via `OPENCORVUS_AGENT_TRACE=0` (also accepts "false"
  // / "no" / "off" for ergonomics). The empty string and unset both keep
  // tracing on by design.
  const DISABLED_VALUES = new Set(["0", "false", "no", "off"])
  const ENABLED = !DISABLED_VALUES.has((process.env.OPENCORVUS_AGENT_TRACE ?? "").toLowerCase())
  const READ_TAIL_BYTES = 2 * 1024 * 1024
  const DEFAULT_EVENT_BYTES = 512 * 1024
  const DEFAULT_SINGLE_BLOB_BYTES = 2 * 1024 * 1024
  const DEFAULT_TASK_BLOB_BYTES = 32 * 1024 * 1024
  const metrics = {
    eventsWritten: 0,
    bytesWritten: 0,
    boundedEvents: 0,
    blobRefs: 0,
    truncatedPayloads: 0,
    blobBytesWritten: 0,
  }

  ServeRuntimeMemoryMetrics.register({
    id: "trace",
    snapshot: () => ({ ...metrics }),
  })

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
    // Default — Instance.directory/.opencorvus/r — is the right answer
    // for normal interactive sessions where the project dir is permanent.
    const override = process.env.OPENCORVUS_AGENT_TRACE_DIR
    if (override && override.length > 0) {
      const normalized = override.replaceAll("\\", "/")
      if (normalized.includes("/.opencorvus/runtime") || normalized.endsWith("/.opencorvus/runtime")) {
        throw new Error(`OPENCORVUS_AGENT_TRACE_DIR must not point at legacy runtime layout: ${override}`)
      }
      return override
    }
    return ProjectRuntimePaths.projectRuntimeRoot(Instance.directory)
  }

  function ensureDir() {
    try {
      fs.mkdirSync(traceDir(), { recursive: true })
    } catch {
      /* dir may already exist */
    }
  }

  function sessionFile(sessionID: string, taskID: string): string {
    return ProjectRuntimePaths.tracePathFromRuntimeRoot(traceDir(), taskID, sessionID)
  }

  function domainFile(taskID: string, domain: string): string {
    return ProjectRuntimePaths.taskAbsoluteFromRuntimeRoot(traceDir(), taskID, "trace", `_${domain}.jsonl`)
  }

  function taskFile(taskID: string): string {
    return ProjectRuntimePaths.taskAbsoluteFromRuntimeRoot(traceDir(), taskID, "trace.jsonl")
  }

  function indexFile(taskID: string): string {
    return ProjectRuntimePaths.taskAbsoluteFromRuntimeRoot(traceDir(), taskID, "trace", "_index.jsonl")
  }

  function blobDir(taskID: string): string {
    return ProjectRuntimePaths.taskAbsoluteFromRuntimeRoot(traceDir(), taskID, "trace", "blobs")
  }

  type TraceBucket = { sessionID: string } | { domain: string }

  /** Buckets whose first event we have already indexed in `_index.jsonl`.
   *  Used to dedupe the index — first-seen sessions write a session_open line,
   *  and first-seen non-session domains write a domain_open line. */
  const seenBuckets = new Set<string>()

  function bucketKey(bucket: TraceBucket, agentName: string): string {
    if ("sessionID" in bucket) return `session:${bucket.sessionID}`
    return `domain:${bucket.domain}:${agentName}`
  }

  function maybeWriteIndex(
    bucket: TraceBucket,
    event: {
      parentSessionID?: string
      taskID?: string
      agentName: string
      kind: string
    },
  ) {
    if (!event.taskID) return
    const key = bucketKey(bucket, event.agentName)
    if (seenBuckets.has(key)) return
    seenBuckets.add(key)
    try {
      ensureDir()
      const bucketFields =
        "sessionID" in bucket
          ? { kind: "session_open", sessionID: bucket.sessionID }
          : { kind: "domain_open", domain: bucket.domain }
      const line =
        safeStringify({
          ts: Date.now(),
          ...bucketFields,
          parentSessionID: event.parentSessionID,
          taskID: event.taskID,
          agentName: event.agentName,
          firstEvent: event.kind,
        }) + "\n"
      const file = indexFile(event.taskID)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.appendFileSync(file, line, { encoding: "utf-8" })
    } catch (err) {
      log.warn("trace index append failed", {
        ...bucket,
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

  function envBytes(name: string, fallback: number): number {
    const raw = process.env[name]
    if (!raw) return fallback
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
  }

  function redactAttachmentsEnabled(): boolean {
    return !DISABLED_VALUES.has((process.env.OPENCORVUS_AGENT_TRACE_REDACT_ATTACHMENTS ?? "1").toLowerCase())
  }

  function byteLength(value: string): number {
    return Buffer.byteLength(value, "utf8")
  }

  function redactDataURL(value: string): string {
    if (!redactAttachmentsEnabled()) return value
    if (!value.startsWith("data:")) return value
    const comma = value.indexOf(",")
    const media = comma >= 0 ? value.slice(0, Math.min(comma, 80)) : "data:"
    return `[redacted data URL, ${value.length} chars, ${media}]`
  }

  function redactValue(value: unknown): unknown {
    const seen = new WeakMap<object, unknown>()
    const visit = (input: unknown): unknown => {
      if (typeof input === "string") return redactDataURL(input)
      if (!input || typeof input !== "object") return input
      if (input instanceof Error) return input
      const existing = seen.get(input)
      if (existing) return existing
      if (Array.isArray(input)) {
        const out: unknown[] = []
        seen.set(input, out)
        for (const item of input) out.push(visit(item))
        return out
      }
      const out: Record<string, unknown> = {}
      seen.set(input, out)
      for (const [key, val] of Object.entries(input)) out[key] = visit(val)
      return out
    }
    return visit(value)
  }

  function taskBlobBytes(taskID: string): number {
    let total = 0
    try {
      for (const name of fs.readdirSync(blobDir(taskID))) {
        try {
          const stat = fs.statSync(path.join(blobDir(taskID), name))
          if (stat.isFile()) total += stat.size
        } catch {}
      }
    } catch {}
    return total
  }

  function summarizePayload(payload: unknown): unknown {
    if (!payload || typeof payload !== "object") return typeof payload
    if (Array.isArray(payload)) return { type: "array", length: payload.length }
    const record = payload as Record<string, unknown>
    return {
      type: "object",
      keys: Object.keys(record).slice(0, 20),
    }
  }

  function payloadReference(taskID: string, event: { kind: string; payload?: unknown }) {
    if (event.payload === undefined) return undefined
    const payloadJSON = safeStringify(event.payload)
    const bytes = byteLength(payloadJSON)
    const singleLimit = envBytes("OPENCORVUS_AGENT_TRACE_BLOB_MAX_BYTES", DEFAULT_SINGLE_BLOB_BYTES)
    const taskLimit = envBytes("OPENCORVUS_AGENT_TRACE_TASK_BLOB_MAX_BYTES", DEFAULT_TASK_BLOB_BYTES)
    if (bytes > singleLimit) {
      return {
        tracePayloadTruncated: true,
        reason: "single_blob_limit",
        bytes,
        maxBytes: singleLimit,
        summary: summarizePayload(event.payload),
      }
    }
    const current = taskBlobBytes(taskID)
    if (current + bytes > taskLimit) {
      return {
        tracePayloadTruncated: true,
        reason: "task_blob_limit",
        bytes,
        taskBytes: current,
        maxTaskBytes: taskLimit,
        summary: summarizePayload(event.payload),
      }
    }
    const sha256 = crypto.createHash("sha256").update(payloadJSON).digest("hex")
    const filename = `${sha256}.json`
    const absolute = path.join(blobDir(taskID), filename)
    fs.mkdirSync(path.dirname(absolute), { recursive: true })
    if (!fs.existsSync(absolute)) {
      fs.writeFileSync(absolute, payloadJSON, "utf8")
      metrics.blobBytesWritten += bytes
    }
    metrics.blobRefs++
    return {
      tracePayloadRef: {
        sha256,
        bytes,
        path: ProjectRuntimePaths.taskRelative(taskID, "trace", "blobs", filename),
      },
      summary: summarizePayload(event.payload),
    }
  }

  function boundedEvent(
    event: Record<string, unknown> & {
      taskID?: string
      kind: string
      payload?: unknown
    },
  ): Record<string, unknown> & { taskID?: string; kind: string } {
    const redacted = redactValue(event) as Record<string, unknown> & {
      taskID?: string
      kind: string
      payload?: unknown
    }
    const max = envBytes("OPENCORVUS_AGENT_TRACE_EVENT_MAX_BYTES", DEFAULT_EVENT_BYTES)
    const line = safeStringify(redacted)
    if (byteLength(line) <= max || typeof redacted.taskID !== "string" || redacted.payload === undefined)
      return redacted
    const ref = payloadReference(redacted.taskID, redacted)
    return {
      ...redacted,
      payload: ref,
      traceBounded: true,
      originalEventBytes: byteLength(line),
      eventMaxBytes: max,
    }
  }

  function append(
    bucket: TraceBucket,
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
      if (typeof event.taskID !== "string" || event.taskID.length === 0) {
        throw new Error(`trace event ${event.kind} missing taskID`)
      }
      maybeWriteIndex(bucket, {
        parentSessionID: event.parentSessionID,
        taskID: event.taskID,
        agentName: event.agentName,
        kind: event.kind,
      })
      const bounded = boundedEvent(event)
      const line = safeStringify(bounded) + "\n"
      metrics.eventsWritten++
      metrics.bytesWritten += byteLength(line) * 2
      if (bounded.traceBounded === true) metrics.boundedEvents++
      const payload = bounded.payload as Record<string, unknown> | undefined
      if (payload?.tracePayloadTruncated === true) metrics.truncatedPayloads++
      if ("sessionID" in bucket) {
        const file = sessionFile(bucket.sessionID, event.taskID)
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.appendFileSync(file, line, { encoding: "utf-8" })
        writeSessionTraceIndex(bucket.sessionID, event.taskID)
      } else {
        const file = domainFile(event.taskID, bucket.domain)
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.appendFileSync(file, line, { encoding: "utf-8" })
      }
      // Per-task chronological rollup so a single task's full timeline (every
      // wake + every sub-agent dispatch) is grep-able in one file. The same
      // line is duplicated; consumers can dedupe on (sessionID, ts) or just
      // scan the rollup directly.
      const file = taskFile(event.taskID)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.appendFileSync(file, line, { encoding: "utf-8" })
    } catch (err) {
      log.warn("trace append failed", {
        ...bucket,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  function sessionBucket(explicitSessionID: string): { sessionID: string } {
    const ambient = SessionObservability.current()
    if (ambient && ambient.id !== explicitSessionID) {
      throw new Error(`Trace session mismatch: context=${ambient.id} input=${explicitSessionID}`)
    }
    return { sessionID: ambient?.id ?? explicitSessionID }
  }

  function findSessionTraceFile(sessionID: string): string | undefined {
    const indexPath = ProjectRuntimePaths.sessionTraceIndexPathFromRuntimeRoot(traceDir(), sessionID)
    let raw: string
    try {
      raw = fs.readFileSync(indexPath, "utf8")
    } catch {
      return undefined
    }
    try {
      const parsed = JSON.parse(raw) as { sessionID?: unknown; taskID?: unknown }
      if (parsed.sessionID !== sessionID || typeof parsed.taskID !== "string") return undefined
      return sessionFile(sessionID, parsed.taskID)
    } catch {
      return undefined
    }
  }

  function writeSessionTraceIndex(sessionID: string, taskID: string) {
    const indexPath = ProjectRuntimePaths.sessionTraceIndexPathFromRuntimeRoot(traceDir(), sessionID)
    fs.mkdirSync(path.dirname(indexPath), { recursive: true })
    fs.writeFileSync(indexPath, JSON.stringify({ sessionID, taskID }) + "\n", "utf8")
  }

  function firstExisting(candidates: string[]): string | undefined {
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate
    }
    return undefined
  }

  function redactMessages(messages: unknown[]): unknown[] {
    return redactValue(messages) as unknown[]
  }

  /** Capture the LLM request at `LLM.stream` entry. */
  export function recordLLMRequest(input: {
    sessionID: string
    parentSessionID?: string
    taskID: string
    agentName: string
    agentMode?: string
    model: { providerID: string; modelID: string }
    system: string[]
    messages: unknown[]
    tools: Array<{ name: string; description?: string }>
    /** Mirrors LLM.StreamInput['toolChoice'] — string forms or specific-tool pin. */
    toolChoice?: "auto" | "required" | "none" | { type: "tool"; toolName: string }
    small?: boolean
  }) {
    if (!ENABLED) return
    const bucket = sessionBucket(input.sessionID)
    append(bucket, {
      ts: Date.now(),
      kind: "llm_request",
      domain: "session",
      sessionID: bucket.sessionID,
      parentSessionID: input.parentSessionID,
      taskID: input.taskID,
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

  /** Capture a direct structured helper LLM call that bypasses the
   *  session pipeline (Agent.generate, generateFollowup). These are written
   *  to the explicit non-session domain bucket, not to a fabricated session.
   *  Both the input and the structured output go in one event since these
   *  helpers are single-shot. */
  export function recordHelperLLMCall(input: {
    taskID?: string
    agentName: string
    model: { providerID: string; modelID: string }
    messages: unknown[]
    schema?: unknown
    output?: unknown
    error?: string
  }): string {
    if (!ENABLED) return ""
    if (!input.taskID) return ""
    append(
      { domain: NON_SESSION_DOMAIN },
      {
        ts: Date.now(),
        kind: "helper_llm_call",
        domain: NON_SESSION_DOMAIN,
        taskID: input.taskID,
        agentName: input.agentName,
        payload: {
          model: input.model,
          messages: redactMessages(input.messages),
          schema: input.schema,
          output: input.output,
          error: input.error,
        },
      },
    )
    return NON_SESSION_DOMAIN
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
    const file = findSessionTraceFile(sessionID)
    if (!file) return []
    return readJsonlTail(file)
  }

  /** Read all events for a task from the task rollup. The rollup is the
   *  single task-level trace source: every event with taskID is appended
   *  there at write time, including llm_request and terminal reports. */
  export function readTaskEvents(taskID: string): TraceEvent[] {
    if (!taskID) return []
    const file =
      firstExisting(ProjectRuntimePaths.taskAbsoluteReadCandidatesFromRuntimeRoot(traceDir(), taskID, "trace.jsonl")) ??
      taskFile(taskID)
    const all = readJsonlTail(file)
    all.sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0))
    return all
  }

  /** Read every event for a non-session domain bucket. */
  export function readDomainEvents(domain: string, taskID?: string): TraceEvent[] {
    if (!domain || !taskID) return []
    const file =
      firstExisting(
        ProjectRuntimePaths.taskAbsoluteReadCandidatesFromRuntimeRoot(traceDir(), taskID, "trace", `_${domain}.jsonl`),
      ) ?? domainFile(taskID, domain)
    return readJsonlTail(file)
  }

  function readJsonlTail(file: string): TraceEvent[] {
    let stat: fs.Stats
    try {
      stat = fs.statSync(file)
    } catch {
      return []
    }
    if (stat.size <= 0) return []
    const start = Math.max(0, stat.size - READ_TAIL_BYTES)
    let raw: string
    try {
      if (start === 0) {
        raw = fs.readFileSync(file, { encoding: "utf-8" })
      } else {
        const fd = fs.openSync(file, "r")
        try {
          const buffer = Buffer.allocUnsafe(stat.size - start)
          const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, start)
          raw = buffer.subarray(0, bytesRead).toString("utf-8")
        } finally {
          fs.closeSync(fd)
        }
        const firstNewline = raw.indexOf("\n")
        raw = firstNewline >= 0 ? raw.slice(firstNewline + 1) : ""
      }
    } catch {
      return []
    }
    return parseJsonl(raw)
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
    taskID: string
    agentName: string
    kind:
      | "agent_report"
      | "agent_report_retry_final"
      | "agent_report_failure"
      | "orchestrator_wake"
      | "orchestrator_wake_failure"
    collector?: unknown
    structured?: unknown
    streamErrors?: Array<{ reason: string; name?: string }>
    attempts?: number
    finishReason?: string
    finalText?: string
    error?: string
    report: AgentReport
  }) {
    if (!ENABLED) return
    const bucket = sessionBucket(input.sessionID)
    append(bucket, {
      ts: Date.now(),
      kind: input.kind,
      domain: "session",
      sessionID: bucket.sessionID,
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
        report: input.report,
      },
    })
  }
}
