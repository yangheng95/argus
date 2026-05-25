/**
 * Fact-Check Agent — verifies factual claims registered by upstream
 * worker agents in their terminal report `fact_check_items[]`.
 *
 * Per specs/fact-check-agent-2026-05-25.md §4 / §5:
 *   - Read-only retrieval surface (web / code / memory; NO edit / bash /
 *     memory_write / git).
 *   - Terminal tool `report_fact_check_result`.
 *   - fact-check-core.txt does NOT receive the registration fragment
 *     (anti-recursion).
 *   - Orchestrator dispatches via the `fact_check` tool (step 6); this
 *     module is the agent runtime.
 */

import { tool } from "ai"
import z from "zod"
import { Log } from "@/util/log"
import { runAgentSession } from "@/agent/runner"
import { createAgentContextTools } from "@/agent/context-tools"
import { filterAgentTools } from "@/agent/filter-tools"
import { exaMcpCall } from "@/tool/exa-mcp"
import TurndownService from "turndown"
import { abortAfterAny } from "@/util/abort"
import FACT_CHECK_CORE from "@/prompt/core/fact-check-core.txt"
import { createFactCheckOutputTools, type FactCheckCollector } from "./tools"
import type { FactCheckItem, FactCheckReport } from "./schema"

const log = Log.create({ service: "fact-check-agent" })

const TURNDOWN = new TurndownService({ headingStyle: "atx" })

const WEBFETCH_MAX_BYTES = 5 * 1024 * 1024
const WEBFETCH_DEFAULT_TIMEOUT_MS = 30 * 1000
const WEBFETCH_MAX_TIMEOUT_MS = 120 * 1000

/**
 * fact-check uses a read-only retrieval surface. The codebase / memory /
 * websearch tools come from createAgentContextTools (single source); we
 * add webfetch + external_code_search inline as AI SDK tool wrappers
 * over the same exaMcpCall + fetch pipeline the global registry uses,
 * so the agent runtime stays self-contained without re-routing through
 * Tool.define adapters.
 */
function buildFactCheckRetrievalTools() {
  return {
    webfetch: tool({
      description:
        "Fetch a URL and return its content as markdown. Use for direct verification of API " +
        "docs, changelogs, GitHub readmes, RFCs, etc. Returns up to ~5MB.",
      inputSchema: z.object({
        url: z.string().describe("HTTP(S) URL to fetch"),
        format: z.enum(["text", "markdown", "html"]).default("markdown"),
        timeout: z.number().optional().describe("Timeout in seconds (max 120)"),
      }),
      execute: async ({ url, format, timeout }, options) => {
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
          throw new Error("URL must start with http:// or https://")
        }
        const timeoutMs = Math.min(
          (timeout ?? WEBFETCH_DEFAULT_TIMEOUT_MS / 1000) * 1000,
          WEBFETCH_MAX_TIMEOUT_MS,
        )
        const { signal, clearTimeout: clearTo } = abortAfterAny(timeoutMs, options?.abortSignal)
        try {
          const resp = await fetch(url, {
            signal,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36",
              Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
          })
          if (!resp.ok) {
            throw new Error(`webfetch ${url} → HTTP ${resp.status}`)
          }
          const reader = resp.body?.getReader()
          if (!reader) throw new Error(`webfetch ${url} → empty body`)
          const chunks: Uint8Array[] = []
          let received = 0
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (!value) continue
            received += value.byteLength
            if (received > WEBFETCH_MAX_BYTES) {
              try {
                reader.cancel()
              } catch {}
              throw new Error(`webfetch ${url} → response exceeds ${WEBFETCH_MAX_BYTES} bytes`)
            }
            chunks.push(value)
          }
          const buf = new Uint8Array(received)
          let offset = 0
          for (const c of chunks) {
            buf.set(c, offset)
            offset += c.byteLength
          }
          const decoded = new TextDecoder("utf-8").decode(buf)
          if (format === "html") return decoded
          if (format === "text") {
            return decoded.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
          }
          return TURNDOWN.turndown(decoded)
        } finally {
          clearTo()
        }
      },
    }),
    external_code_search: tool({
      description:
        "Search external libraries / SDKs / framework docs via Exa code search. Returns code " +
        "snippets and explanations to verify factual claims about third-party APIs (React, " +
        "pandas, Next.js, etc.).",
      inputSchema: z.object({
        query: z.string().describe("Search query — name the library + concept clearly"),
        tokensNum: z.number().min(1000).max(50000).default(5000),
      }),
      execute: async ({ query, tokensNum }, options) => {
        const text = await exaMcpCall({
          name: "get_code_context_exa",
          arguments: { query, tokensNum },
          timeoutMs: 30_000,
          signal: options?.abortSignal,
          label: "fact-check external code search",
        })
        return (
          text ??
          "No code snippets or documentation found. Try a different query — be more specific about the library or programming concept."
        )
      },
    }),
  }
}

function renderFactCheckItems(items: FactCheckItem[]): string {
  if (items.length === 0) {
    return "_No fact-check items registered by the upstream worker. Inspect the message content itself for load-bearing factual claims and verify those._"
  }
  return items
    .map(
      (item, idx) =>
        `${idx + 1}. **${item.claim}**\n` +
        `   - confidence: \`${item.confidence}\`\n` +
        `   - category: \`${item.category}\`\n` +
        `   - source: \`${item.source}\``,
    )
    .join("\n\n")
}

function buildFactCheckUserPrompt(input: FactCheckAgent.RunInput, targetMessageText: string): string {
  const sections: string[] = []
  sections.push("# Delegation")
  sections.push(
    `Orchestrator is asking fact-check to verify factual claims in the most recent assistant ` +
      `message from worker session \`${input.targetSessionID}\` (agent: \`${input.targetAgent}\`).`,
  )
  sections.push(`# Why this was dispatched\n\n${input.reason}`)
  sections.push(
    `# Target message snapshot\n\n` +
      `- session: \`${input.targetSessionID}\`\n` +
      `- message_id: \`${input.targetMessageID}\`\n` +
      `- content_hash: \`${input.targetMessageContentHash}\`\n` +
      "\n" +
      "The orchestrator already verified the target session is in a terminal state before " +
      "calling you. You can rely on the message content being stable for the duration of this " +
      "fact-check session.",
  )
  if (targetMessageText.trim().length > 0) {
    const truncated = targetMessageText.length > TARGET_MESSAGE_TEXT_CAP
    const body = truncated
      ? targetMessageText.slice(0, TARGET_MESSAGE_TEXT_CAP) + `\n\n…(truncated; ${targetMessageText.length - TARGET_MESSAGE_TEXT_CAP} more chars)`
      : targetMessageText
    sections.push(`# Target message content\n\n\`\`\`\n${body}\n\`\`\``)
  } else {
    sections.push(
      "# Target message content\n\n_(The target assistant message had no text parts. Inspect the registered fact_check_items below and use your retrieval tools to verify the claims directly.)_",
    )
  }
  sections.push(
    `# Registered fact-check items (${input.factCheckItems.length})\n\n` +
      renderFactCheckItems(input.factCheckItems),
  )
  sections.push(
    "# Output contract\n\n" +
      "Inspect every registered item using your tools, then call `report_fact_check_result` " +
      "exactly once with the full structured report. The `report.scope` MUST echo the " +
      `snapshot above verbatim: target_session_id=\`${input.targetSessionID}\`, ` +
      `target_agent=\`${input.targetAgent}\`, target_message_id=\`${input.targetMessageID}\`, ` +
      `target_message_content_hash=\`${input.targetMessageContentHash}\`. ` +
      "Follow the verdict decision tree from fact-check-core.txt and the evidence discipline " +
      "(every verified / corrected item must cite ≥1 evidence pointer).",
  )
  return sections.join("\n\n")
}

/**
 * Extract the concatenated text/reasoning content of the target session's
 * latest assistant message so the fact-check agent can inspect the actual
 * claims (codex impl review §2).
 *
 * @internal — exported for the direct regression test at
 * test/fact-check/load-target-message-text.test.ts (codex impl review
 * round 4). Not part of the fact-check public API; callers outside this
 * module should go through `FactCheckAgent.run` which invokes this
 * function as part of prompt construction.
 *
 * Failure semantics (codex impl review round 2 §B-2 — rule 7 no silent
 * fallback):
 *   - Message.stream errors (DB error, session not found) → THROW.  The
 *     orchestrator tool's catch persists outcome=tool_error so the
 *     orchestrator LLM sees the failure rather than getting a fake
 *     "no text" report.
 *   - Message exists in stream but has no text/reasoning parts → return
 *     empty string (this IS the honest "no text" case).
 *   - Message id not in stream (worker truncated the session or a stale
 *     id was passed) → THROW with a clear error message.
 */
export async function loadTargetMessageText(sessionID: string, messageID: string): Promise<string> {
  const { Message } = await import("@/session/message")
  for await (const msg of Message.stream(sessionID)) {
    if (msg.info.id !== messageID) continue
    const parts: string[] = []
    for (const part of msg.parts) {
      if (part.type === "text" || part.type === "reasoning") {
        parts.push(part.text)
      }
    }
    return parts.join("\n\n").trim()
  }
  // The stream completed without seeing the requested message id.
  // Throw — orchestrator catch persists tool_error so the caller knows
  // the snapshot the host took has gone stale (rule 7).
  throw new Error(
    `fact-check: target message ${messageID} not found in session ${sessionID} (snapshot stale or wrong target id)`,
  )
}

export namespace FactCheckAgent {
  export interface RunInput {
    /** Target worker session whose latest assistant message is being verified. */
    targetSessionID: string
    /** Target worker's agent name ("build" / "architect" / ...) — used in
     *  the prompt for the LLM to know which kind of content it is verifying. */
    targetAgent: string
    /** Snapshot from Session.snapshotLatestAssistant() at the orchestrator
     *  tool entry. Same values are echoed back in FactCheckReport.scope so
     *  the persistence layer can key the artifact. */
    targetMessageID: string
    targetMessageContentHash: string
    /** fact_check_items extracted from the target worker's terminal report. */
    factCheckItems: FactCheckItem[]
    /** Free-text reason the orchestrator wrote when invoking the tool. */
    reason: string
    /** Orchestrator session id (used as the persistence idempotency key and
     *  as the parent for the child fact-check session). */
    orchestratorSessionID: string
    /** Optional explicit task id; otherwise inherits from the orchestrator
     *  session via runAgentSession internals. */
    taskID?: string
    signal?: AbortSignal
    onSessionCreated?: (sessionID: string) => void
  }

  /** Maximum number of characters of target-message text injected into the
   *  fact-check user prompt.  Bounded because the message can be large
   *  (e.g. an architect goal graph dump) and an unbounded copy would blow
   *  the prompt budget. The fact-check agent has `read_file` etc. if it
   *  needs to inspect more. */
  const TARGET_MESSAGE_TEXT_CAP = 8000

  export interface RunOutput {
    /** Child fact-check session id (surfaced to overlay for UI nesting). */
    sessionID: string
    /** The structured report the agent submitted. */
    report: FactCheckReport
    /** Terminal outcome flag for the persist layer. */
    outcome: "completed" | "aborted" | "tool_error"
  }

  export async function run(input: RunInput): Promise<RunOutput> {
    log.info("fact-check starting", {
      targetSessionID: input.targetSessionID,
      targetAgent: input.targetAgent,
      items: input.factCheckItems.length,
    })

    const contextTools = await filterAgentTools(createAgentContextTools(), "fact-check")
    const retrievalTools = buildFactCheckRetrievalTools()
    const outputToolKit = createFactCheckOutputTools()
    // Load target message text up-front so the prompt builder has it.
    const targetMessageText = await loadTargetMessageText(input.targetSessionID, input.targetMessageID)

    let runErrored = false
    try {
      const out = await runAgentSession<FactCheckCollector>({
        kind: "fact-check",
        // Anti-recursion: the registration fragment is NOT applied here.
        core: FACT_CHECK_CORE,
        sessionTitle: `Fact-check: ${input.targetAgent} (${input.targetSessionID.slice(0, 12)})`,
        parentSessionID: input.orchestratorSessionID,
        taskID: input.taskID,
        signal: input.signal,
        onSessionCreated: input.onSessionCreated
          ? (session) => {
              input.onSessionCreated!(session.id)
            }
          : undefined,
        toolKit: {
          tools: { ...contextTools, ...retrievalTools, ...outputToolKit.tools },
          getCollector: outputToolKit.getCollector,
          buildReport: outputToolKit.buildReport,
        },
        buildUserPrompt: () => buildFactCheckUserPrompt(input, targetMessageText),
        terminalTool: {
          toolName: "report_fact_check_result",
          isSatisfied: (collector) => Boolean(collector.report),
          shouldExposeOnlyTerminalTool: () => false,
        },
      })

      const collector = out.collector
      if (!collector.report) {
        // Runner should have already thrown via terminal-tool contract,
        // but guard explicitly so we never return a half-shape (rule 7).
        throw new Error(
          `fact-check: agent terminated without calling report_fact_check_result (session=${out.session.id})`,
        )
      }

      const outcome: RunOutput["outcome"] = input.signal?.aborted ? "aborted" : "completed"
      log.info("fact-check finished", {
        sessionID: out.session.id,
        verdict: collector.report.overall_verdict,
        verified: collector.report.verified.length,
        corrected: collector.report.corrected.length,
        unresolved: collector.report.unresolved.length,
        outcome,
      })
      return { sessionID: out.session.id, report: collector.report, outcome }
    } catch (err) {
      runErrored = true
      if (input.signal?.aborted) {
        log.info("fact-check aborted", {
          targetSessionID: input.targetSessionID,
          error: err instanceof Error ? err.message : String(err),
        })
      } else {
        log.error("fact-check tool error", {
          targetSessionID: input.targetSessionID,
          error: err instanceof Error ? err.message : String(err),
        })
      }
      throw err
    } finally {
      if (runErrored) {
        // Reset the collector so a retry from the orchestrator side
        // doesn't accidentally see stale state. (The runtime is one-shot
        // per call; collector is local to this invocation.)
        outputToolKit.reset()
      }
    }
  }
}
