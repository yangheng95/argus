import z from "zod"
import { BusEvent } from "@/bus/bus-event"

/**
 * A2A Protocol — Bus event definitions for inter-agent communication.
 *
 * These events are the backbone of the A2A orchestration system.
 * The Orchestrator publishes lifecycle events; the Bot and UI subscribe
 * to provide real-time progress updates.
 */
export namespace A2AProtocol {
  // ── Task lifecycle ──────────────────────────────────────────

  export const TaskEnqueued = BusEvent.define(
    "a2a.task.enqueued",
    z.object({
      taskID: z.string(),
      sessionID: z.string(),
      prompt: z.string(),
      priority: z.string(),
      source: z.string(),
    }),
  )

  export const TaskDispatched = BusEvent.define(
    "a2a.task.dispatched",
    z.object({
      taskID: z.string(),
      sessionID: z.string(),
    }),
  )

  export const TaskCompleted = BusEvent.define(
    "a2a.task.completed",
    z.object({
      taskID: z.string(),
      sessionID: z.string(),
      success: z.boolean(),
      summary: z.string(),
    }),
  )

  // ── Plan lifecycle ──────────────────────────────────────────

  export const PlanReady = BusEvent.define(
    "a2a.plan.ready",
    z.object({
      taskID: z.string(),
      sessionID: z.string(),
      stepCount: z.number(),
      goalID: z.string(),
    }),
  )

  export const ReplanRequested = BusEvent.define(
    "a2a.replan.requested",
    z.object({
      taskID: z.string(),
      reason: z.string(),
      failedStepID: z.string(),
      errorDetail: z.string(),
      attempt: z.number(),
    }),
  )

  // ── Step lifecycle ──────────────────────────────────────────

  export const StepStarted = BusEvent.define(
    "a2a.step.started",
    z.object({
      taskID: z.string(),
      stepID: z.string(),
      stepIndex: z.number(),
      totalSteps: z.number(),
      description: z.string(),
    }),
  )

  export const StepCompleted = BusEvent.define(
    "a2a.step.completed",
    z.object({
      taskID: z.string(),
      stepID: z.string(),
      success: z.boolean(),
      summary: z.string(),
      retryCount: z.number(),
    }),
  )

  // ── Vision ──────────────────────────────────────────────────

  export const VisionResult = BusEvent.define(
    "a2a.vision.result",
    z.object({
      taskID: z.string(),
      description: z.string(),
      runningSummary: z.string(),
      suggestedAction: z.string().optional(),
      screenshotHash: z.string(),
    }),
  )

  // ── Goal ────────────────────────────────────────────────────

  export const GoalEvaluated = BusEvent.define(
    "a2a.goal.evaluated",
    z.object({
      taskID: z.string(),
      goalID: z.string(),
      action: z.enum(["achieved", "continue", "replan", "deadlock"]),
      reason: z.string(),
    }),
  )
}
