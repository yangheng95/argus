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

import { Log } from "@/util/log"
import { runAgentSession } from "@/agent/runner"
import type { AgentSessionContinuation } from "@/engine/stage-continuation"
import { filterAgentTools } from "@/agent/filter-tools"
import { createAgentCoordinationRuntimeTools } from "@/agent/coordination-runtime-tools"
import { createReadonlyRetrievalTools } from "@/agent/retrieval-tools"
import FACT_CHECK_CORE from "@/prompt/core/fact-check-core.txt"
import { createFactCheckOutputTools, type FactCheckCollector } from "./tools"
import type { FactCheckItem, FactCheckReport } from "./schema"

const log = Log.create({ service: "fact-check-agent" })

/** Maximum number of characters of target-message text injected into the
 *  fact-check user prompt.  Bounded because the message can be large
 *  (e.g. an architect goal graph dump) and an unbounded copy would blow
 *  the prompt budget. The fact-check agent has `read` etc. if it
 *  needs to inspect more.
 *
 *  Module-scope so buildFactCheckUserPrompt (also at module scope) can
 *  see it. Previously a duplicate lived inside FactCheckAgent namespace
 *  — buildFactCheckUserPrompt could not reach it from outside the
 *  namespace, producing TS2552 against the local `targetMessageText`. */
const TARGET_MESSAGE_TEXT_CAP = 8000

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
      ? targetMessageText.slice(0, TARGET_MESSAGE_TEXT_CAP) +
        `\n\n…(truncated; ${targetMessageText.length - TARGET_MESSAGE_TEXT_CAP} more chars)`
      : targetMessageText
    sections.push(`# Target message content\n\n\`\`\`\n${body}\n\`\`\``)
  } else {
    sections.push(
      "# Target message content\n\n_(The target assistant message had no text parts. Inspect the registered fact_check_items below and use your retrieval tools to verify the claims directly.)_",
    )
  }
  sections.push(
    `# Registered fact-check items (${input.factCheckItems.length})\n\n` + renderFactCheckItems(input.factCheckItems),
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
    continuation?: AgentSessionContinuation
    onSessionCreated?: (sessionID: string) => void
  }

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

    const retrievalTools = await filterAgentTools(createReadonlyRetrievalTools(), "fact-check", {
      taskID: input.taskID,
      sessionID: input.orchestratorSessionID,
    })
    const coordinationTools = await filterAgentTools(
      await createAgentCoordinationRuntimeTools({
        agent: "fact-check",
        taskID: input.taskID,
        signal: input.signal,
      }),
      "fact-check",
      {
        taskID: input.taskID,
        sessionID: input.orchestratorSessionID,
      },
    )
    const outputToolKit = createFactCheckOutputTools()
    // Continuation mode appends a visible same-session recovery prompt from
    // runAgentSession, so buildUserPrompt is not called and the stale target
    // snapshot must not become an extra preflight dependency.
    const targetMessageText = input.continuation
      ? ""
      : await loadTargetMessageText(input.targetSessionID, input.targetMessageID)

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
        continuation: input.continuation,
        onSessionCreated: input.onSessionCreated
          ? (session) => {
              input.onSessionCreated!(session.id)
            }
          : undefined,
        toolKit: {
          tools: { ...retrievalTools, ...coordinationTools, ...outputToolKit.tools },
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
