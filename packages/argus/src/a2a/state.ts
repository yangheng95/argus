import { Log } from "@/util/log"

/**
 * A2AState — Per-task runtime state (in-memory, not persisted).
 *
 * Manages the current task's runtime context including vision summaries,
 * session IDs for child agents, and orchestrator phase tracking.
 */
export namespace A2AState {
  const log = Log.create({ service: "a2a.state" })

  export type Phase =
    | "idle"
    | "planning"
    | "executing"
    | "evaluating"
    | "replanning"
    | "completing"
    | "error"

  export interface TaskRuntime {
    taskID: string
    sessionID: string
    phase: Phase
    currentStepID: string | null
    currentStepIndex: number
    visionSummary: string
    replanCount: number
    maxReplans: number
    stepRetryCount: number
    maxStepRetries: number
    guiSessionID: string | null
    planSessionID: string | null
    goalID: string | null
    startedAt: number
  }

  // ── Global state ────────────────────────────────────────────

  let enabled = false
  let current: TaskRuntime | null = null

  export function isActive(): boolean {
    return enabled && current !== null
  }

  export function isEnabled(): boolean {
    return enabled
  }

  export function setEnabled(value: boolean) {
    enabled = value
    log.info("a2a mode", { enabled })
  }

  // ── Task runtime ────────────────────────────────────────────

  export function begin(input: {
    taskID: string
    sessionID: string
    maxReplans?: number
    maxStepRetries?: number
  }): TaskRuntime {
    current = {
      taskID: input.taskID,
      sessionID: input.sessionID,
      phase: "idle",
      currentStepID: null,
      currentStepIndex: 0,
      visionSummary: "",
      replanCount: 0,
      maxReplans: input.maxReplans ?? 3,
      stepRetryCount: 0,
      maxStepRetries: input.maxStepRetries ?? 3,
      guiSessionID: null,
      planSessionID: null,
      goalID: null,
      startedAt: Date.now(),
    }
    log.info("task runtime started", { taskID: input.taskID })
    return current
  }

  export function get(): TaskRuntime | null {
    return current
  }

  export function require(): TaskRuntime {
    if (!current) throw new Error("No active A2A task runtime")
    return current
  }

  export function setPhase(phase: Phase) {
    if (!current) return
    const prev = current.phase
    current.phase = phase
    log.info("phase transition", { taskID: current.taskID, from: prev, to: phase })
  }

  export function setVisionSummary(summary: string) {
    if (!current) return
    current.visionSummary = summary
  }

  export function setCurrentStep(stepID: string | null, stepIndex: number) {
    if (!current) return
    current.currentStepID = stepID
    current.currentStepIndex = stepIndex
    current.stepRetryCount = 0
  }

  export function incrementStepRetry(): number {
    if (!current) return 0
    current.stepRetryCount++
    return current.stepRetryCount
  }

  export function incrementReplan(): number {
    if (!current) return 0
    current.replanCount++
    return current.replanCount
  }

  export function setGoalID(goalID: string) {
    if (!current) return
    current.goalID = goalID
  }

  export function setGuiSessionID(sessionID: string) {
    if (!current) return
    current.guiSessionID = sessionID
  }

  export function setPlanSessionID(sessionID: string) {
    if (!current) return
    current.planSessionID = sessionID
  }

  export function end() {
    if (current) {
      log.info("task runtime ended", {
        taskID: current.taskID,
        duration: Date.now() - current.startedAt,
        replans: current.replanCount,
      })
    }
    current = null
  }
}
