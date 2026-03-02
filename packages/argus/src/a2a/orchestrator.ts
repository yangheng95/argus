import { Log } from "@/util/log"
import { Config } from "@/config/config"
import { Bus } from "@/bus"
import { TaskQueue } from "./queue"
import { A2AState } from "./state"
import { A2AProtocol } from "./protocol"
import { VisionAgent } from "./vision-agent"
import { PlanAgent } from "./plan-agent"
import { GuiAgent } from "./gui-agent"
import { GoalAgent } from "./goal-agent"
import { A2AContext } from "./context"
import { Capture } from "@/argus/perception/capture"
import { WindowManager } from "@/argus/perception/window"

/**
 * Orchestrator — Legacy A2A pipeline (opt-in only).
 *
 * NOTE: This is the legacy rigid state machine. By default, the LLM handles
 * all orchestration through its own tool use (screen, input, planner, goal, etc.).
 * This pipeline is only activated when ARGUS_A2A_ENABLED=1 is explicitly set.
 *
 * Pipeline: TaskQueue → PlanAgent → [VisionAgent → GuiAgent → GoalAgent]* → Context
 */
export namespace Orchestrator {
  const log = Log.create({ service: "a2a.orchestrator" })

  let running = false
  let abortController: AbortController | null = null
  /** Event-driven wake-up: resolves when a new task is enqueued */
  let wakeResolver: (() => void) | null = null

  /**
   * Wake up the orchestrator loop if it's sleeping waiting for tasks.
   * Called by TaskQueue.enqueue() via prompt.ts to eliminate polling delay.
   */
  export function wake(): void {
    if (wakeResolver) {
      wakeResolver()
      wakeResolver = null
    }
  }

  /**
   * Start the orchestrator loop.
   * Runs continuously, dequeuing tasks and executing them.
   * Uses event-driven wake-up instead of polling.
   */
  export async function run(): Promise<void> {
    const cfg = await Config.get()
    const a2a = cfg.a2a

    if (!a2a?.enabled) {
      log.warn("A2A mode is not enabled in config")
      return
    }

    A2AState.setEnabled(true)
    running = true
    abortController = new AbortController()

    log.info("orchestrator started")

    try {
      while (running && !abortController.signal.aborted) {
        const task = TaskQueue.dequeueAny()
        if (!task) {
          // Wait for wake-up signal (from enqueue) or timeout after 10s as fallback
          await waitForWake(10_000, abortController.signal)
          continue
        }

        await executeTask(task)
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        log.error("orchestrator error", { err })
      }
    } finally {
      running = false
      A2AState.setEnabled(false)
      A2AState.end()
      log.info("orchestrator stopped")
    }
  }

  /**
   * Start the orchestrator in background mode if not already running.
   * Returns true when a new loop is started.
   */
  export function start(): boolean {
    if (running) {
      // Already running — just wake it in case it's sleeping
      wake()
      return false
    }
    void run().catch((err) => {
      log.error("orchestrator background loop failed", { err })
      running = false
      A2AState.setEnabled(false)
    })
    return true
  }

  /**
   * Execute a single task through the full A2A pipeline.
   */
  async function executeTask(task: TaskQueue.QueuedTask): Promise<void> {
    const cfg = await Config.get()
    const maxReplans = cfg.a2a?.max_replans ?? 3
    const maxStepRetries = cfg.a2a?.max_step_retries ?? 3

    // Initialize task runtime
    const runtime = A2AState.begin({
      taskID: task.id,
      sessionID: task.sessionID,
      maxReplans,
      maxStepRetries,
    })

    log.info("executing task", { taskID: task.id, prompt: task.prompt.slice(0, 80) })

    try {
      // ── Phase: Planning ──────────────────────────────────
      A2AState.setPhase("planning")
      TaskQueue.updateStatus(task.id, "planning")

      // Get initial screen state for context
      let screenSummary = ""
      try {
        const capture = await Capture.take({ mode: "auto" })
        if (capture) {
          const vision = await VisionAgent.analyze({
            screenshot: capture.buffer,
            context: `About to start task: ${task.prompt}`,
            previousSummary: task.previousSummary ?? undefined,
          })
          screenSummary = VisionAgent.toText(vision)
          A2AState.setVisionSummary(vision.runningSummary)
        }
      } catch (err) {
        log.warn("initial screen capture failed", { err })
      }

      let planResult = await PlanAgent.plan({
        parentSessionID: task.sessionID,
        prompt: task.prompt,
        previousSummary: task.previousSummary ?? undefined,
        screenSummary,
      })

      if (planResult.steps.length === 0) {
        log.warn("plan has no steps", { taskID: task.id })
        TaskQueue.fail(task.id, "Plan agent produced no steps")
        return
      }

      // ── Phase: Execution loop ────────────────────────────
      A2AState.setPhase("executing")
      TaskQueue.updateStatus(task.id, "executing")

      let completed = false
      let replanCount = 0

      while (!completed && replanCount <= maxReplans && !abortController?.signal.aborted) {
        const steps = planResult.steps

        for (let i = 0; i < steps.length; i++) {
          if (abortController?.signal.aborted) break

          const step = steps[i]
          A2AState.setCurrentStep(step.id, i)

          Bus.publish(A2AProtocol.StepStarted, {
            taskID: task.id,
            stepID: step.id,
            stepIndex: i,
            totalSteps: steps.length,
            description: step.description,
          })

          log.info("executing step", {
            taskID: task.id,
            step: i + 1,
            total: steps.length,
            description: step.description.slice(0, 60),
          })

          // Step execution with retries
          let stepSuccess = false
          let stepRetries = 0
          let lastError = ""

          while (stepRetries < maxStepRetries && !stepSuccess) {
            // a. Vision: analyze current screen
            let visionText = ""
            try {
              const capture = await Capture.take({ mode: "auto" })
              if (capture) {
                const binding = await WindowManager.getBinding()
                const vision = await VisionAgent.analyze({
                  screenshot: capture.buffer,
                  context: step.description,
                  previousSummary: A2AState.get()?.visionSummary,
                  boundWindow: binding
                    ? {
                        title: binding.info.title,
                        width: binding.info.width,
                        height: binding.info.height,
                      }
                    : undefined,
                })
                visionText = VisionAgent.toText(vision)
                A2AState.setVisionSummary(vision.runningSummary)

                Bus.publish(A2AProtocol.VisionResult, {
                  taskID: task.id,
                  description: vision.description,
                  runningSummary: vision.runningSummary,
                  suggestedAction: vision.suggestedAction
                    ? `${vision.suggestedAction.type} at (${vision.suggestedAction.coordinates?.x}, ${vision.suggestedAction.coordinates?.y})`
                    : undefined,
                  screenshotHash: vision.screenshotHash,
                })
              }
            } catch (err) {
              log.warn("vision analysis failed for step", { step: i, err })
              visionText = "(vision analysis unavailable)"
            }

            // b. GUI: execute the step
            const guiResult = await GuiAgent.execute({
              parentSessionID: task.sessionID,
              stepDescription: step.description,
              visionText,
              stepIndex: i,
              totalSteps: steps.length,
              existingSessionID: A2AState.get()?.guiSessionID ?? undefined,
            })

            if (guiResult.success) {
              stepSuccess = true
              GoalAgent.recordStepSuccess()

              Bus.publish(A2AProtocol.StepCompleted, {
                taskID: task.id,
                stepID: step.id,
                success: true,
                summary: guiResult.summary,
                retryCount: stepRetries,
              })
            } else {
              stepRetries++
              lastError = guiResult.error ?? guiResult.summary
              GoalAgent.recordStepFailure()
              A2AState.incrementStepRetry()

              log.info("step failed, retrying", {
                taskID: task.id,
                step: i + 1,
                retry: stepRetries,
                error: lastError.slice(0, 100),
              })

              Bus.publish(A2AProtocol.StepCompleted, {
                taskID: task.id,
                stepID: step.id,
                success: false,
                summary: lastError,
                retryCount: stepRetries,
              })
            }
          }

          // Step exhausted retries — evaluate via Goal Agent
          if (!stepSuccess) {
            A2AState.setPhase("evaluating")

            const evaluation = await GoalAgent.evaluateAndDecide({
              taskID: task.id,
              goalID: planResult.goalID ?? "",
              screenSummary: A2AState.get()?.visionSummary ?? "",
              recentActions: lastError,
              planStatus: `Step ${i + 1}/${steps.length} failed after ${maxStepRetries} retries`,
              consecutiveFailures: stepRetries,
            })

            if (evaluation.action === "replan") {
              // Re-planning
              A2AState.setPhase("replanning")
              replanCount++
              A2AState.incrementReplan()

              log.info("replanning", {
                taskID: task.id,
                attempt: replanCount,
                reason: evaluation.reason.slice(0, 100),
              })

              planResult = await PlanAgent.replan({
                parentSessionID: task.sessionID,
                originalPrompt: task.prompt,
                failedStepDescription: step.description,
                errorDetail: lastError,
                screenSummary: A2AState.get()?.visionSummary,
                attempt: replanCount,
              })

              A2AState.setPhase("executing")
              break // Break inner for-loop to restart with new plan
            }

            if (evaluation.action === "deadlock") {
              log.info("task deadlocked", { taskID: task.id, reason: evaluation.reason })
              TaskQueue.fail(task.id, `Deadlock: ${evaluation.reason}`)
              A2AState.setPhase("error")
              A2AState.end()
              return
            }

            // "continue" → move to next step anyway
            A2AState.setPhase("executing")
          }

          // After successful step, check if overall goal is achieved
          if (stepSuccess && planResult.goalID) {
            const evaluation = await GoalAgent.evaluateAndDecide({
              taskID: task.id,
              goalID: planResult.goalID,
              screenSummary: A2AState.get()?.visionSummary ?? "",
              recentActions: `Step ${i + 1} completed successfully`,
              planStatus: `Step ${i + 1}/${steps.length} done`,
              consecutiveFailures: 0,
            })

            if (evaluation.action === "achieved") {
              log.info("goal achieved", { taskID: task.id })
              completed = true
              break
            }
          }
        }

        // If all steps completed without early goal achievement
        if (!completed && !abortController?.signal.aborted) {
          // Final goal check
          if (planResult.goalID) {
            const finalEval = await GoalAgent.evaluateAndDecide({
              taskID: task.id,
              goalID: planResult.goalID,
              screenSummary: A2AState.get()?.visionSummary ?? "",
              recentActions: "All plan steps completed",
              planStatus: "All steps executed",
              consecutiveFailures: 0,
            })

            if (finalEval.action === "achieved") {
              completed = true
            } else if (finalEval.action === "replan" && replanCount < maxReplans) {
              replanCount++
              A2AState.incrementReplan()
              planResult = await PlanAgent.replan({
                parentSessionID: task.sessionID,
                originalPrompt: task.prompt,
                failedStepDescription: "All steps completed but goal not achieved",
                errorDetail: finalEval.reason,
                screenSummary: A2AState.get()?.visionSummary,
                attempt: replanCount,
              })
              continue // Restart execution with new plan
            } else {
              // Either deadlock or exhausted replans
              TaskQueue.fail(task.id, `Goal not achieved after ${replanCount} replans: ${finalEval.reason}`)
              A2AState.setPhase("error")
              A2AState.end()
              return
            }
          } else {
            // No goal set — assume all steps = success
            completed = true
          }
        }
      }

      // ── Phase: Completing ────────────────────────────────
      A2AState.setPhase("completing")

      const summary = await A2AContext.summarize({
        taskPrompt: task.prompt,
        success: completed,
        planSummary: planResult.summary,
        actionLog: A2AState.get()?.visionSummary ?? "",
        finalScreenSummary: A2AState.get()?.visionSummary ?? "",
        errorMessage: completed ? undefined : "Task did not complete successfully",
      })

      if (completed) {
        TaskQueue.complete(task.id, summary)
        log.info("task completed successfully", { taskID: task.id })
      } else {
        TaskQueue.fail(task.id, summary)
        log.info("task failed", { taskID: task.id })
      }
    } catch (err) {
      log.error("task execution error", { taskID: task.id, err })
      TaskQueue.fail(task.id, `Execution error: ${(err as Error).message}`)
      A2AState.setPhase("error")
    } finally {
      A2AState.end()
    }
  }

  /**
   * Stop the orchestrator.
   */
  export function stop() {
    running = false
    abortController?.abort()
    log.info("orchestrator stop requested")
  }

  export function isRunning(): boolean {
    return running
  }

  // ── Helpers ────────────────────────────────────────────────

  function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, ms)
      signal?.addEventListener("abort", () => {
        clearTimeout(timeout)
        reject(new DOMException("Aborted", "AbortError"))
      })
    })
  }
}
