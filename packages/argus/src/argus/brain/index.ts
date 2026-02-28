import z from "zod"
import { generateObject } from "ai"
import { Bus } from "../../bus"
import { Provider } from "../../provider/provider"
import { Log } from "../../util/log"
import { MonitorEvent } from "../monitor/events"
import type {
  BrainDecision,
  DiffResult,
  MonitorConfig,
  VisionAnalysis,
} from "../monitor/types"
import { analyzeScreenshot } from "./vision"
import { CommandQueue } from "./queue"
import { Autonomy } from "./autonomy"

import BRAIN_PROMPT from "./prompt/brain.txt"

export { CommandQueue } from "./queue"
export { Autonomy } from "./autonomy"

const log = Log.create({ service: "monitor-brain" })

const BrainDecisionSchema = z.object({
  action: z.enum([
    "analyze_change",
    "execute_command",
    "suggest_action",
    "auto_execute",
    "ask_user",
    "wait",
  ]),
  reasoning: z.string(),
  toolCalls: z.array(z.string()).optional(),
  suggestion: z.string().optional(),
  commandID: z.string().optional(),
})

interface ActionHistoryEntry {
  decision: BrainDecision
  timestamp: number
  result?: string
}

// Keep a rolling history of recent actions for context
const actionHistory: ActionHistoryEntry[] = []
const MAX_HISTORY = 20

function addHistory(entry: ActionHistoryEntry) {
  actionHistory.push(entry)
  if (actionHistory.length > MAX_HISTORY) {
    actionHistory.shift()
  }
}

export namespace Brain {
  export async function processChange(input: {
    screenshot: Buffer
    diffResult: DiffResult
    config: MonitorConfig
    abort: AbortSignal
  }): Promise<void> {
    if (input.abort.aborted) return

    try {
      // Step 1: Vision analysis
      const analysis = await analyzeScreenshot({
        screenshot: input.screenshot,
        config: input.config,
      })

      if (input.abort.aborted) return

      // Publish vision analysis event
      await Bus.publish(MonitorEvent.VisionAnalysis, {
        timestamp: analysis.timestamp,
        description: analysis.description,
        changeType: analysis.changeType,
        severity: analysis.severity,
        regions: analysis.regions,
      })

      log.info("vision analysis completed", {
        changeType: analysis.changeType,
        severity: analysis.severity,
        description: analysis.description.slice(0, 100),
      })

      // Step 2: Check if urgent commands should preempt
      const pendingCommand = CommandQueue.peek()
      if (
        pendingCommand?.priority === "urgent" &&
        analysis.severity !== "critical"
      ) {
        log.info("urgent command preempts non-critical change, processing queue first")
        await processQueue({ config: input.config, abort: input.abort })
        return
      }

      // Step 3: Brain decision
      const decision = await decide({
        analysis,
        pendingCommands: CommandQueue.list(),
        actionHistory: actionHistory.slice(-10),
        config: input.config,
      })

      if (input.abort.aborted) return

      await Bus.publish(MonitorEvent.BrainDecision, {
        action: decision.action,
        reasoning: decision.reasoning,
        timestamp: Date.now(),
      })

      // Step 4: Execute decision with autonomy gating
      const result = await execute(decision, analysis, input.config, input.abort)

      addHistory({
        decision,
        timestamp: Date.now(),
        result,
      })
    } catch (err) {
      if (input.abort.aborted) return
      log.error("processChange failed", {
        error: err instanceof Error ? err.message : String(err),
      })
      await Bus.publish(MonitorEvent.Anomaly, {
        message: `Brain processing failed: ${err instanceof Error ? err.message : String(err)}`,
        severity: "high",
        timestamp: Date.now(),
      })
    }
  }

  export async function processQueue(input: {
    config: MonitorConfig
    abort: AbortSignal
  }): Promise<void> {
    if (input.abort.aborted) return

    const command = CommandQueue.dequeue()
    if (!command) return

    log.info("processing queued command", {
      id: command.id,
      priority: command.priority,
    })

    await Bus.publish(MonitorEvent.CommandProcessed, {
      id: command.id,
      result: "processed",
      timestamp: Date.now(),
    })

    await Bus.publish(MonitorEvent.BrainAction, {
      action: "execute_command",
      result: command.content.slice(0, 200),
      timestamp: Date.now(),
    })

    addHistory({
      decision: {
        action: "execute_command",
        reasoning: `Processing queued command: ${command.content.slice(0, 100)}`,
        commandID: command.id,
      },
      timestamp: Date.now(),
      result: "queued command processed",
    })
  }

  async function decide(context: {
    analysis?: VisionAnalysis
    pendingCommands: Array<{ id: string; priority: string; content: string }>
    actionHistory: ActionHistoryEntry[]
    config: MonitorConfig
  }): Promise<BrainDecision> {
    const modelRef = context.config.brainModel ?? (await Provider.defaultModel())
    const model = await Provider.getModel(modelRef.providerID, modelRef.modelID)
    const language = await Provider.getLanguage(model)

    const contextMessage = buildContextMessage(context)

    const result = await generateObject({
      model: language,
      messages: [
        { role: "system", content: BRAIN_PROMPT },
        { role: "user", content: contextMessage },
      ],
      schema: BrainDecisionSchema,
      temperature: 0.1,
    })

    const decision = result.object

    // Apply autonomy gating — downgrade if not allowed
    if (
      decision.action === "auto_execute" ||
      decision.action === "execute_command"
    ) {
      const tools = decision.toolCalls ?? []
      const check = Autonomy.shouldAutoExecute(
        context.config.autonomyLevel,
        tools,
      )
      if (!check.allowed) {
        log.info("autonomy gating: downgrading decision", {
          original: decision.action,
          reason: check.reason,
        })
        // Downgrade based on autonomy level
        if (context.config.autonomyLevel <= 1) {
          decision.action = "suggest_action"
          decision.suggestion =
            decision.suggestion ?? decision.reasoning
        } else {
          decision.action = "ask_user"
        }
      }
    }

    return decision
  }

  async function execute(
    decision: BrainDecision,
    analysis: VisionAnalysis | undefined,
    config: MonitorConfig,
    abort: AbortSignal,
  ): Promise<string> {
    if (abort.aborted) return "aborted"

    switch (decision.action) {
      case "analyze_change": {
        // Just record the analysis, no further action needed
        log.info("brain: analyze_change", {
          description: analysis?.description?.slice(0, 100),
        })
        await Bus.publish(MonitorEvent.BrainAction, {
          action: "analyze_change",
          result: analysis?.description,
          timestamp: Date.now(),
        })
        return "analyzed"
      }

      case "execute_command": {
        // Process next command from queue
        await processQueue({ config, abort })
        return "command_executed"
      }

      case "suggest_action": {
        log.info("brain: suggest_action", {
          suggestion: decision.suggestion,
        })
        await Bus.publish(MonitorEvent.BrainAction, {
          action: "suggest_action",
          result: decision.suggestion ?? decision.reasoning,
          timestamp: Date.now(),
        })
        return "suggested"
      }

      case "auto_execute": {
        log.info("brain: auto_execute", {
          tools: decision.toolCalls,
        })
        await Bus.publish(MonitorEvent.BrainAction, {
          action: "auto_execute",
          result: decision.reasoning,
          timestamp: Date.now(),
        })
        return "auto_executed"
      }

      case "ask_user": {
        log.info("brain: ask_user", {
          suggestion: decision.suggestion,
        })
        await Bus.publish(MonitorEvent.BrainAction, {
          action: "ask_user",
          result: decision.suggestion ?? decision.reasoning,
          timestamp: Date.now(),
        })
        return "asked_user"
      }

      case "wait": {
        log.info("brain: wait")
        return "waiting"
      }

      default:
        return "unknown_action"
    }
  }

  function buildContextMessage(context: {
    analysis?: VisionAnalysis
    pendingCommands: Array<{ id: string; priority: string; content: string }>
    actionHistory: ActionHistoryEntry[]
    config: MonitorConfig
  }): string {
    const parts: string[] = []

    parts.push(`Autonomy Level: ${context.config.autonomyLevel} (${Autonomy.describeLevel(context.config.autonomyLevel)})`)

    if (context.analysis) {
      parts.push(`\n## Screen Change Detected`)
      parts.push(`Type: ${context.analysis.changeType}`)
      parts.push(`Severity: ${context.analysis.severity}`)
      parts.push(`Description: ${context.analysis.description}`)
      if (context.analysis.regions.length > 0) {
        parts.push(
          `Regions: ${context.analysis.regions.map((r) => `${r.label} (${r.x},${r.y} ${r.w}x${r.h})`).join("; ")}`,
        )
      }
    }

    if (context.pendingCommands.length > 0) {
      parts.push(`\n## Pending Commands (${context.pendingCommands.length})`)
      for (const cmd of context.pendingCommands.slice(0, 5)) {
        parts.push(`- [${cmd.priority}] ${cmd.content.slice(0, 100)}`)
      }
    }

    if (context.actionHistory.length > 0) {
      parts.push(`\n## Recent Actions`)
      for (const entry of context.actionHistory.slice(-5)) {
        parts.push(
          `- ${entry.decision.action}: ${entry.decision.reasoning.slice(0, 80)} → ${entry.result ?? "pending"}`,
        )
      }
    }

    parts.push(`\nDecide what action to take.`)
    return parts.join("\n")
  }
}
