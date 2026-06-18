import type { Message } from "@/session/message"
import type { AgentReport, AgentReportContext } from "@/agent/report"
import { paragraphSummary } from "@/agent/report"
import { runAgentSession } from "@/agent/runner"
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
      buildUserPrompt: () => input.prompt,
      buildUserParts: input.buildUserParts,
    })
    return {
      sessionID: out.session.id,
      finalText: finalTextFromMessage(out.finalMessage),
      finalMessage: out.finalMessage,
    }
  }
}
