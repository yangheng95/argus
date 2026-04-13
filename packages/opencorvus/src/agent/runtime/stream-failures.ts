/**
 * Stream failure tracker.
 *
 * session-stream used to wrap every onChunk handler in `try/catch` and
 * silently log a WARN on any thrown error. That drained failure signal away
 * from the agent main loop — a Zod crash persisting a tool-call became a
 * log line and nothing else, while the AI SDK stream went on firing deltas
 * until wall-clock oblivion. Per CLAUDE.md rule #1 we do not hide failures
 * behind fallback paths; record each one explicitly so the agent runtime
 * can decide whether to throw at the end.
 */

export type StreamFailureKind =
  | "protocol-normalize"   // tool-call/tool-result input was not a valid object
  | "persist-part"         // Session.updatePart threw (Zod, FK, etc.)
  | "persist-message"      // Session.updateMessage threw
  | "hook-other"           // any other throw inside an onChunk handler
  | "on-error"             // AI SDK onError fired
  | "flush"                // flush() throw

export interface StreamFailure {
  kind: StreamFailureKind
  reason: string
  /** Chunk type at the time of failure, when applicable. */
  chunkType?: string
  /** Tool name when the failure relates to a specific tool invocation. */
  toolName?: string
  /** Tool call id when applicable — lets downstream match to agent steps. */
  toolCallId?: string
  /** Raw payload that triggered the failure. Kept for diagnostics, clipped
   *  to something sane so we do not log a megabyte of base64. */
  raw?: unknown
  at: number
}

export interface StreamFailureSnapshot {
  count: number
  items: readonly StreamFailure[]
}

export interface StreamFailureTracker {
  record(input: Omit<StreamFailure, "at">): void
  snapshot(): StreamFailureSnapshot
}

function clipRaw(value: unknown): unknown {
  if (typeof value !== "string") return value
  return value.length > 400 ? `${value.slice(0, 400)}…(+${value.length - 400} chars)` : value
}

export function createStreamFailureTracker(): StreamFailureTracker {
  const items: StreamFailure[] = []
  return {
    record(input) {
      items.push({ ...input, raw: clipRaw(input.raw), at: Date.now() })
    },
    snapshot() {
      return { count: items.length, items: items.slice() }
    },
  }
}

/**
 * Thrown by AgentRuntime when `failurePolicy === "throw"` and the stream
 * accumulated at least one failure. Carries the snapshot so the caller can
 * surface the details (UI / logs / requirements retry context).
 */
export class AgentStreamFailureError extends Error {
  readonly snapshot: StreamFailureSnapshot
  constructor(agent: string, snapshot: StreamFailureSnapshot) {
    const first = snapshot.items[0]
    super(
      `agent "${agent}" stream produced ${snapshot.count} failure${snapshot.count === 1 ? "" : "s"}: ` +
        `${first?.kind ?? "?"} — ${first?.reason ?? "(no detail)"}`,
    )
    this.name = "AgentStreamFailureError"
    this.snapshot = snapshot
  }
}
