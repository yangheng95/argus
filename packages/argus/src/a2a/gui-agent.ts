import { Log } from "@/util/log"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Identifier } from "@/id/id"
import { A2AState } from "./state"

import GUI_PROMPT from "./prompt/gui.txt"

/**
 * GuiAgent — Executes GUI operations from a plan step.
 *
 * This is an LLM-backed agent that runs in a child session.
 * It receives step descriptions + vision analysis text (NOT images)
 * and uses screen/input tools to perform GUI interactions.
 */
export namespace GuiAgent {
  const log = Log.create({ service: "a2a.gui" })

  export interface ExecutionResult {
    sessionID: string
    success: boolean
    summary: string
    actionSummary: string
    error?: string
  }

  async function getModel() {
    const cfg = await Config.get()
    const a2a = cfg.a2a
    if (a2a?.gui_model) {
      return Provider.parseModel(a2a.gui_model)
    }
    return Provider.defaultModel()
  }

  /**
   * Execute a single plan step via GUI interaction.
   */
  export async function execute(input: {
    parentSessionID: string
    stepDescription: string
    visionText: string
    stepIndex: number
    totalSteps: number
    existingSessionID?: string
  }): Promise<ExecutionResult> {
    const timer = log.time("gui execution")

    try {
      const model = await getModel()

      // Reuse existing session or create new one
      let sessionID: string
      if (input.existingSessionID) {
        sessionID = input.existingSessionID
      } else {
        const session = await Session.create({
          parentID: input.parentSessionID,
          title: `A2A GUI: Step ${input.stepIndex + 1}/${input.totalSteps}`,
          permission: [
            { permission: "*", pattern: "*", action: "deny" },
            { permission: "screen", pattern: "*", action: "allow" },
            { permission: "input", pattern: "*", action: "allow" },
            { permission: "bash", pattern: "*", action: "allow" },
            { permission: "planner", pattern: "*", action: "allow" },
            { permission: "goal", pattern: "*", action: "allow" },
          ],
        })
        sessionID = session.id
        A2AState.setGuiSessionID(sessionID)
      }

      // Build the prompt with step info and vision context
      const prompt = [
        GUI_PROMPT,
        "",
        `## Current Step (${input.stepIndex + 1}/${input.totalSteps})`,
        input.stepDescription,
        "",
        "## Current Screen State (from Vision Agent)",
        input.visionText,
        "",
        "Execute this step. Take a screenshot after each action to verify the result.",
        "Report clearly whether the step succeeded or failed.",
      ].join("\n")

      const messageID = Identifier.ascending("message")
      const result = await SessionPrompt.prompt({
        messageID,
        sessionID,
        model: {
          modelID: model.modelID,
          providerID: model.providerID,
        },
        agent: "build",
        tools: {
          // Only GUI-related tools
          todowrite: false,
          todoread: false,
          task: false,
          edit: false,
          write: false,
          read: false,
          glob: false,
          grep: false,
          websearch: false,
          webfetch: false,
          memory: false,
        },
        parts: [{ type: "text", text: prompt }],
      })

      const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""

      // Analyze the result text to determine success/failure
      const lowerText = text.toLowerCase()
      const hasError =
        lowerText.includes("failed") ||
        lowerText.includes("error") ||
        lowerText.includes("unable to") ||
        lowerText.includes("could not") ||
        lowerText.includes("cannot")
      const hasSuccess =
        lowerText.includes("success") ||
        lowerText.includes("completed") ||
        lowerText.includes("done") ||
        lowerText.includes("achieved")

      // Heuristic: prefer explicit success/failure signals
      const success = hasSuccess && !hasError

      const executionResult: ExecutionResult = {
        sessionID,
        success,
        summary: text.slice(0, 500),
        actionSummary: text.slice(0, 200),
        error: !success ? text.slice(0, 300) : undefined,
      }

      log.info("gui execution complete", {
        sessionID,
        step: input.stepIndex + 1,
        success,
      })

      return executionResult
    } finally {
      timer.stop()
    }
  }
}
