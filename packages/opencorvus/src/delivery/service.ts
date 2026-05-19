/**
 * Legacy delivery service shell.
 *
 * The legacy delivery runtime is retired. Workflow acceptance
 * lives in the integrity session; stale callers must fail loudly instead of
 * starting any host-owned verification path.
 */
import type { DeliveryDecision } from "./arbiter"
import type { DeliveryInfo, GoalInfo } from "./checks"

export class DeliveryFailureError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "DeliveryFailureError"
  }
}

type AttachmentLike = {
  sha: string
  url: string
  mime: string
  size: number
  filename?: string
  intent?: string
  source?: string
}

export namespace DeliveryService {
  export async function verify(_input: {
    task: { id?: string; title: string; request: string; sessionID?: string; metadata?: Record<string, unknown>; design_specs?: Array<{ id: string; category: string; title: string; requirement: string; applies_to: string; severity: "must" | "should"; rationale?: string }> }
    goals: GoalInfo[]
    delivery: DeliveryInfo
    attachments?: AttachmentLike[]
    signal?: AbortSignal
    iteration?: number
    parentSessionID?: string
    runID?: string
    deliveryID?: string
    specSnapshotID?: string
    criteriaResults?: Array<{
      name: string
      status: "passed" | "failed" | "skipped" | "inconclusive"
      evidence?: string
      family?: string
      label?: string
      goal_id?: string
      goal_run_id?: string
    }>
  }): Promise<DeliveryDecision> {
    throw new DeliveryFailureError(
      "DeliveryService.verify is retired. Workflow acceptance must run inside the integrity review session.",
    )
  }
}
