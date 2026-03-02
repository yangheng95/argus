import { generateText } from "ai"
import { Provider } from "@/provider/provider"
import { Log } from "@/util/log"

/**
 * Context — Task-to-task context summarization and transfer.
 *
 * When a task completes, this module generates a concise summary
 * that becomes the starting context for the next task.
 * This prevents unbounded context growth across tasks.
 */
export namespace A2AContext {
  const log = Log.create({ service: "a2a.context" })

  export interface SummarizationInput {
    taskPrompt: string
    success: boolean
    planSummary: string
    actionLog: string
    finalScreenSummary: string
    errorMessage?: string
  }

  /**
   * Generate a concise summary of a completed task.
   * This summary becomes `previousSummary` for the next queued task.
   */
  export async function summarize(input: SummarizationInput): Promise<string> {
    const timer = log.time("context summarization")

    try {
      // Use a small model for fast summarization
      const modelInfo = await Provider.getModel("anthropic", "claude-haiku-4-5-20251001").catch(
        async () => {
          const def = await Provider.defaultModel()
          return Provider.getModel(def.providerID, def.modelID)
        },
      )
      const language = await Provider.getLanguage(modelInfo)

      const prompt = [
        "Summarize the following task execution in 3-5 sentences. Focus on:",
        "1. What was attempted and the outcome (success/failure)",
        "2. Key state changes (apps opened, files modified, settings changed)",
        "3. Any important lessons learned or errors encountered",
        "",
        `## Task: ${input.taskPrompt}`,
        `## Outcome: ${input.success ? "SUCCESS" : "FAILED"}`,
        input.errorMessage ? `## Error: ${input.errorMessage}` : "",
        `## Plan Summary: ${input.planSummary}`,
        `## Final Screen State: ${input.finalScreenSummary}`,
        `## Action Log (last actions): ${input.actionLog.slice(0, 1000)}`,
      ]
        .filter(Boolean)
        .join("\n")

      const result = await generateText({
        model: language,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You are a concise summarizer. Output only the summary, no preamble or commentary.",
          },
          { role: "user", content: prompt },
        ],
      })

      const summary = result.text.trim()
      log.info("context summary generated", { length: summary.length })
      return summary
    } catch (err) {
      log.warn("context summarization failed, using fallback", { err })
      // Fallback: simple text summary
      return [
        `Task: ${input.taskPrompt.slice(0, 100)}`,
        `Result: ${input.success ? "completed successfully" : "failed"}`,
        input.errorMessage ? `Error: ${input.errorMessage.slice(0, 200)}` : "",
        `Screen: ${input.finalScreenSummary.slice(0, 200)}`,
      ]
        .filter(Boolean)
        .join(". ")
    } finally {
      timer.stop()
    }
  }
}
