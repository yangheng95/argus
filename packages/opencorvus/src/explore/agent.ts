import type { Message } from "@/session/message"
import type { AgentReport, AgentReportContext } from "@/agent/report"
import { paragraphSummary } from "@/agent/report"
import { runAgentSession } from "@/agent/runner"
import { renderAgentContextPacketSection, type AgentContextPacket } from "@/agent/context-packet"
import type { SessionPrompt } from "@/session/prompt"
import EXPLORE_CORE from "@/agent/prompt/explore.txt"

export namespace ExploreAgent {
  export interface RunInput {
    prompt: string
    sessionTitle: string
    existingSessionID?: string
    parentSessionID?: string
    taskID?: string
    model?: { providerID: string; modelID: string }
    signal?: AbortSignal
    toolSwitches?: Record<string, boolean>
    /** Upstream agent handoff packets supplied by the scheduler. */
    contextPackets?: AgentContextPacket[]
    buildUserParts?: () => Promise<SessionPrompt.PromptInput["parts"]>
  }

  export interface RunResult {
    sessionID: string
    finalText: string
    finalMessage: Message.WithParts
  }

  function finalTextFromMessage(message: Message.WithParts): string {
    return message.parts
      .filter((part) => part.type === "text" && typeof (part as { text?: unknown }).text === "string")
      .map((part) => ((part as { text: string }).text ?? "").trim())
      .filter(Boolean)
      .join("\n\n")
  }

  function buildReport(context?: AgentReportContext): AgentReport {
    const detail = (context?.error ?? context?.finalText ?? "Explore completed.").trim()
    return {
      summary: paragraphSummary(detail),
      detail,
    }
  }

  export async function run(input: RunInput): Promise<RunResult> {
    const promptWithContext = () => appendContextPacketsToPrompt(input.prompt, input.contextPackets)
    const userParts = input.buildUserParts
      ? async () => appendContextPacketsToParts(await input.buildUserParts!(), input.contextPackets)
      : undefined
    const out = await runAgentSession<Record<string, never>>({
      kind: "explore",
      core: EXPLORE_CORE,
      sessionTitle: input.sessionTitle,
      existingSessionID: input.existingSessionID,
      parentSessionID: input.parentSessionID,
      taskID: input.taskID,
      model: input.model,
      signal: input.signal,
      toolSwitches: input.toolSwitches,
      toolKit: {
        tools: {},
        getCollector: () => ({}),
        buildReport,
      },
      buildUserPrompt: promptWithContext,
      buildUserParts: userParts,
    })
    return {
      sessionID: out.session.id,
      finalText: finalTextFromMessage(out.finalMessage),
      finalMessage: out.finalMessage,
    }
  }
}

function appendContextPacketsToPrompt(prompt: string, packets: readonly AgentContextPacket[] | undefined): string {
  const context = renderAgentContextPacketSection(packets)
  return context ? [prompt, context].join("\n\n") : prompt
}

function appendContextPacketsToParts(
  parts: SessionPrompt.PromptInput["parts"],
  packets: readonly AgentContextPacket[] | undefined,
): SessionPrompt.PromptInput["parts"] {
  const context = renderAgentContextPacketSection(packets)
  return context ? [...parts, { type: "text", text: context }] : parts
}
