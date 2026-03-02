import z from "zod"
import { generateObject } from "ai"
import { Provider } from "@/provider/provider"
import { Goal } from "@/session/goal"
import { Log } from "@/util/log"
import { Bus } from "@/bus"
import { A2AProtocol } from "./protocol"

import JUDGE_PROMPT from "./prompt/goal-judge.txt"

/**
 * GoalAgent — Evaluates goal achievement with enhanced A2A capabilities.
 *
 * Extends the existing Goal namespace's evaluation cascade with:
 * - A "replan" action for triggering re-planning when stuck
 * - Richer context from Vision Agent summaries
 * - Consecutive failure tracking for smart re-plan triggers
 */
export namespace GoalAgent {
  const log = Log.create({ service: "a2a.goal" })

  // ── Types ──────────────────────────────────────────────────

  export type Action = "achieved" | "continue" | "replan" | "deadlock"

  export const EvaluationResult = z.object({
    achieved: z.boolean().describe("Whether the goal has been achieved"),
    confidence: z.number().min(0).max(1).describe("Confidence in the judgment (0-1)"),
    reasoning: z.string().describe("Detailed reasoning for the judgment"),
    nextStep: z.string().nullable().describe("Suggested next step if not achieved"),
    deadlock: z.boolean().describe("Whether the situation appears deadlocked"),
    shouldReplan: z.boolean().describe("Whether a different approach/plan is needed"),
    replanHint: z
      .string()
      .nullable()
      .describe("If shouldReplan=true, hint about what to try differently"),
  })
  export type EvaluationResult = z.infer<typeof EvaluationResult>

  export interface EvaluationContext {
    taskID: string
    goalID: string
    screenSummary: string
    recentActions: string
    planStatus: string
    consecutiveFailures: number
  }

  export interface EvaluationDecision {
    action: Action
    reason: string
    confidence: number
    nextStep?: string
    replanHint?: string
  }

  // ── State ──────────────────────────────────────────────────

  let consecutiveStepFailures = 0
  const REPLAN_THRESHOLD = 3 // Trigger replan after N consecutive step failures

  export function resetFailureCount() {
    consecutiveStepFailures = 0
  }

  export function recordStepFailure() {
    consecutiveStepFailures++
  }

  export function recordStepSuccess() {
    consecutiveStepFailures = 0
  }

  // ── Evaluation ─────────────────────────────────────────────

  /**
   * Evaluate goal achievement and decide next action.
   * This is the enhanced A2A version that adds "replan" as an action.
   */
  export async function evaluateAndDecide(ctx: EvaluationContext): Promise<EvaluationDecision> {
    const timer = log.time("goal evaluation")

    try {
      const goal = Goal.get(ctx.goalID)
      if (!goal) {
        return {
          action: "deadlock",
          reason: `Goal ${ctx.goalID} not found`,
          confidence: 1.0,
        }
      }

      // Stage 1: Programmatic check (if verify_cmd is set)
      const cmdResult = await Goal.programmaticCheck(goal)
      if (cmdResult === true) {
        log.info("goal achieved via programmatic check", { goalID: ctx.goalID })
        Goal.update(ctx.goalID, { status: "achieved" })
        recordStepSuccess()
        return {
          action: "achieved",
          reason: `verify_cmd "${goal.verifyCmd}" exited with code 0`,
          confidence: 1.0,
        }
      }

      // Stage 2: Check consecutive failure threshold for automatic replan
      if (consecutiveStepFailures >= REPLAN_THRESHOLD) {
        log.info("consecutive failure threshold reached", {
          goalID: ctx.goalID,
          failures: consecutiveStepFailures,
        })
        const result: EvaluationDecision = {
          action: "replan",
          reason: `${consecutiveStepFailures} consecutive step failures — current approach is not working`,
          confidence: 0.9,
          replanHint: "Try a completely different approach. The current sequence of actions is failing repeatedly.",
        }
        consecutiveStepFailures = 0 // Reset for the new plan
        return result
      }

      // Stage 3: LLM Judge evaluation
      const judgeResult = await judgeEvaluation(goal, ctx)

      // Increment goal's attempt counter
      const newAttempts = goal.currentAttempts + 1
      const entry: Goal.EvaluationEntry = {
        attempt: newAttempts,
        timestamp: Date.now(),
        action: judgeResult.achieved ? "achieved" : judgeResult.deadlock ? "deadlock" : "continue",
        confidence: judgeResult.confidence,
        reasoning: judgeResult.reasoning,
        nextStep: judgeResult.nextStep,
      }
      Goal.update(ctx.goalID, {
        currentAttempts: newAttempts,
        progressLog: [...goal.progressLog, entry],
      })

      // Decide action
      if (judgeResult.achieved && judgeResult.confidence >= 0.8) {
        Goal.update(ctx.goalID, { status: "achieved" })
        recordStepSuccess()

        Bus.publish(A2AProtocol.GoalEvaluated, {
          taskID: ctx.taskID,
          goalID: ctx.goalID,
          action: "achieved",
          reason: judgeResult.reasoning,
        })

        return {
          action: "achieved",
          reason: judgeResult.reasoning,
          confidence: judgeResult.confidence,
          nextStep: judgeResult.nextStep ?? undefined,
        }
      }

      if (judgeResult.shouldReplan) {
        Bus.publish(A2AProtocol.GoalEvaluated, {
          taskID: ctx.taskID,
          goalID: ctx.goalID,
          action: "replan",
          reason: judgeResult.reasoning,
        })

        return {
          action: "replan",
          reason: judgeResult.reasoning,
          confidence: judgeResult.confidence,
          replanHint: judgeResult.replanHint ?? undefined,
        }
      }

      // Deadlock detection
      if (judgeResult.deadlock || newAttempts >= goal.maxAttempts) {
        const isMaxAttempts = newAttempts >= goal.maxAttempts
        Goal.update(ctx.goalID, { status: "failed" })

        Bus.publish(A2AProtocol.GoalEvaluated, {
          taskID: ctx.taskID,
          goalID: ctx.goalID,
          action: "deadlock",
          reason: isMaxAttempts
            ? `Max attempts (${goal.maxAttempts}) reached`
            : judgeResult.reasoning,
        })

        return {
          action: "deadlock",
          reason: isMaxAttempts
            ? `Max attempts (${goal.maxAttempts}) reached. ${judgeResult.reasoning}`
            : judgeResult.reasoning,
          confidence: judgeResult.confidence,
        }
      }

      // Continue
      Bus.publish(A2AProtocol.GoalEvaluated, {
        taskID: ctx.taskID,
        goalID: ctx.goalID,
        action: "continue",
        reason: judgeResult.reasoning,
      })

      return {
        action: "continue",
        reason: judgeResult.reasoning,
        confidence: judgeResult.confidence,
        nextStep: judgeResult.nextStep ?? undefined,
      }
    } finally {
      timer.stop()
    }
  }

  // ── Judge LLM ──────────────────────────────────────────────

  async function judgeEvaluation(
    goal: Goal.Info,
    ctx: EvaluationContext,
  ): Promise<EvaluationResult> {
    try {
      // Use a small/fast model for evaluation
      const modelInfo = await Provider.getModel("anthropic", "claude-haiku-4-5-20251001").catch(
        async () => {
          const def = await Provider.defaultModel()
          return Provider.getModel(def.providerID, def.modelID)
        },
      )
      const language = await Provider.getLanguage(modelInfo)

      const userPrompt = [
        "## Goal to Evaluate",
        `**Description:** ${goal.description}`,
        `**Success Criteria:** ${goal.criteria}`,
        `**Attempt:** ${goal.currentAttempts + 1} of ${goal.maxAttempts}`,
        `**Consecutive Step Failures:** ${ctx.consecutiveFailures}`,
        "",
        "## Current Screen State",
        ctx.screenSummary || "(no screen summary available)",
        "",
        "## Recent Actions",
        ctx.recentActions || "(no recent actions)",
        "",
        "## Plan Status",
        ctx.planStatus || "(no plan status available)",
        "",
        "Evaluate whether the goal has been achieved. Consider whether the current approach is working or if a different plan is needed.",
      ].join("\n")

      const result = await generateObject({
        model: language,
        temperature: 0,
        messages: [
          { role: "system", content: JUDGE_PROMPT },
          { role: "user", content: userPrompt },
        ],
        schema: EvaluationResult,
      })

      log.info("judge evaluation", {
        goalID: goal.id,
        achieved: result.object.achieved,
        confidence: result.object.confidence,
        shouldReplan: result.object.shouldReplan,
        deadlock: result.object.deadlock,
      })

      return result.object
    } catch (err) {
      log.warn("judge evaluation failed", { goalID: goal.id, err })
      return {
        achieved: false,
        confidence: 0,
        reasoning: "Judge evaluation failed due to an error. Defaulting to continue.",
        nextStep: "Review the goal criteria and retry.",
        deadlock: false,
        shouldReplan: false,
        replanHint: null,
      }
    }
  }
}
