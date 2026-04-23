/**
 * RequirementsService — thin wrapper around RequirementsAgent providing
 * error normalization and lifecycle logging. Narrow scope: REQ-N parsing +
 * foundational decisions. Fidelity review has moved under the Architect
 * (the authoritative decomposer); goal checks live there too.
 *
 * RequirementsAgent owns its own tool-level stall detection; this service
 * only normalizes errors and lifecycle logging.
 */
import type { TextHooks } from "@/llm/api"
import { Log } from "@/util/log"
import { RequirementsAgent, type RequirementsResult } from "./agent"
import type { DecisionLog } from "@/decision-log"
import type { VisualSpec } from "@/design-analyst/types"

const log = Log.create({ service: "requirements-service" })

export class RequirementsFailureError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "RequirementsFailureError"
  }
}

export namespace RequirementsService {
  /**
   * Parse a task into REQ-N requirements + foundational decisions.
   *
  * No runtime wall-clock watchdog here. Cancellation comes from the caller's
  * AbortSignal or the agent's own tool-level stall detector.
   */
  export async function run(input: {
    title: string
    request: string
    /** Base64 image attachments — injected as vision content alongside the request text. */
    attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>
    /** Advisory visual contract produced by design_analysis. */
    designSpecs?: VisualSpec[]
    taskID?: string
    sessionID?: string
    signal?: AbortSignal
    stream?: TextHooks
    onStatus?: (summary: string) => void | Promise<void>
    decisionLog?: DecisionLog
  }): Promise<RequirementsResult> {
    log.info("requirements service starting", {
      taskID: input.taskID,
      title: input.title,
    })

    const start = Date.now()
    try {
      const result = await RequirementsAgent.run({
        title: input.title,
        request: input.request,
        attachments: input.attachments,
        designSpecs: input.designSpecs,
        taskID: input.taskID,
        sessionID: input.sessionID,
        signal: input.signal,
        stream: input.stream,
        onStatus: input.onStatus,
        decisionLog: input.decisionLog,
      })

      if (result.requirements.length === 0) {
        throw new RequirementsFailureError("requirements agent produced no REQ-N entries")
      }

      log.info("requirements service completed", {
        taskID: input.taskID,
        requirementCount: result.requirements.length,
        decisionCount: result.decisions.length,
        durationMs: Date.now() - start,
      })

      return result
    } catch (err) {
      if (err instanceof RequirementsFailureError) throw err
      throw new RequirementsFailureError(
        `requirements failed: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      )
    }
  }
}
