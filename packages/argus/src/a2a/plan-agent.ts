import { Log } from "@/util/log"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { MessageV2 } from "@/session/message"
import { Identifier } from "@/id/id"
import { TaskPlan } from "@/memory/task-plan"
import { Goal } from "@/session/goal"
import { Bus } from "@/bus"
import { A2AProtocol } from "./protocol"
import { A2AState } from "./state"
import { PermissionNext } from "@/permission/next"

import PLAN_PROMPT from "./prompt/plan.txt"

/**
 * PlanAgent — Decomposes tasks into step-by-step execution plans.
 *
 * This is an LLM-backed agent that runs in a child session.
 * It uses the planner and goal tools to create structured plans.
 */
export namespace PlanAgent {
  const log = Log.create({ service: "a2a.plan" })

  export interface PlanResult {
    sessionID: string
    goalID: string | null
    steps: PlanStep[]
    summary: string
  }

  export interface PlanStep {
    id: string
    description: string
    priority: number
    parentID: string | null
  }

  async function getModel() {
    const cfg = await Config.get()
    const a2a = cfg.a2a
    if (a2a?.plan_model) {
      return Provider.parseModel(a2a.plan_model)
    }
    return Provider.defaultModel()
  }

  /**
   * Create an initial plan for a task.
   */
  export async function plan(input: {
    parentSessionID: string
    prompt: string
    previousSummary?: string
    screenSummary?: string
  }): Promise<PlanResult> {
    const timer = log.time("planning")

    try {
      const model = await getModel()

      // Create a child session for the plan agent
      const session = await Session.create({
        parentID: input.parentSessionID,
        title: `A2A Plan: ${input.prompt.slice(0, 50)}`,
        permission: [
          { permission: "*", pattern: "*", action: "deny" },
          { permission: "websearch", pattern: "*", action: "allow" },
          { permission: "webfetch", pattern: "*", action: "allow" },
          { permission: "read", pattern: "*", action: "allow" },
          { permission: "glob", pattern: "*", action: "allow" },
          { permission: "grep", pattern: "*", action: "allow" },
          { permission: "memory", pattern: "*", action: "allow" },
          { permission: "planner", pattern: "*", action: "allow" },
          { permission: "goal", pattern: "*", action: "allow" },
        ],
      })

      A2AState.setPlanSessionID(session.id)

      // Build the prompt with context
      const parts: string[] = [PLAN_PROMPT, ""]
      parts.push(`## Task\n${input.prompt}`)
      if (input.previousSummary) {
        parts.push(`\n## Previous Task Summary\n${input.previousSummary}`)
      }
      if (input.screenSummary) {
        parts.push(`\n## Current Screen State\n${input.screenSummary}`)
      }
      parts.push("\nCreate a detailed plan for this task. Use the `planner` tool to record steps and the `goal` tool to set the success criteria.")

      const messageID = Identifier.ascending("message")
      const result = await SessionPrompt.prompt({
        messageID,
        sessionID: session.id,
        model: {
          modelID: model.modelID,
          providerID: model.providerID,
        },
        agent: "build",
        tools: {
          // Only allow planning-related tools
          todowrite: false,
          todoread: false,
          task: false,
          screen: false,
          input: false,
          edit: false,
          write: false,
        },
        parts: [{ type: "text", text: parts.join("\n") }],
      })

      // Extract the plan from the session's task plan
      const tasks = TaskPlan.list(session.id)
      const goals = Goal.listActive(session.id)

      const steps: PlanStep[] = tasks
        .filter((t) => t.status !== "cancelled")
        .sort((a, b) => b.priority - a.priority) // higher priority = earlier step
        .map((t) => ({
          id: t.id,
          description: t.goal,
          priority: t.priority,
          parentID: t.parentID,
        }))

      const goalID = goals.length > 0 ? goals[0].id : null
      const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""

      const planResult: PlanResult = {
        sessionID: session.id,
        goalID,
        steps,
        summary: text.slice(0, 500),
      }

      log.info("plan created", {
        sessionID: session.id,
        steps: steps.length,
        goalID,
      })

      if (goalID) {
        A2AState.setGoalID(goalID)
        Bus.publish(A2AProtocol.PlanReady, {
          taskID: A2AState.get()?.taskID ?? "",
          sessionID: session.id,
          stepCount: steps.length,
          goalID,
        })
      }

      return planResult
    } finally {
      timer.stop()
    }
  }

  /**
   * Re-plan after a failure. Creates a new plan with error context.
   */
  export async function replan(input: {
    parentSessionID: string
    originalPrompt: string
    failedStepDescription: string
    errorDetail: string
    screenSummary?: string
    attempt: number
  }): Promise<PlanResult> {
    const timer = log.time("replanning")

    try {
      const taskID = A2AState.get()?.taskID ?? ""

      Bus.publish(A2AProtocol.ReplanRequested, {
        taskID,
        reason: input.errorDetail,
        failedStepID: "",
        errorDetail: input.errorDetail,
        attempt: input.attempt,
      })

      const replanPrompt = [
        input.originalPrompt,
        "",
        "## Previous Attempt Failed",
        `**Failed Step:** ${input.failedStepDescription}`,
        `**Error:** ${input.errorDetail}`,
        `**Attempt:** ${input.attempt}`,
        "",
        "Create a NEW plan that avoids the previous failure. Try a different approach.",
      ].join("\n")

      return plan({
        parentSessionID: input.parentSessionID,
        prompt: replanPrompt,
        screenSummary: input.screenSummary,
      })
    } finally {
      timer.stop()
    }
  }
}
