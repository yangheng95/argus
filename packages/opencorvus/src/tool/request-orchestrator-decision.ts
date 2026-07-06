import z from "zod"
import { cancelPendingAgentCoordinationRequest, createAgentCoordinationRequest } from "@/engine/agent-coordination"
import { dispatchTaskLoop } from "@/engine/queue"
import { taskIDForSession } from "@/orchestrator/task-event"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Tool } from "./tool"

const RequestOrchestratorDecisionInput = z.object({
  summary: z.string().min(1).describe("Short human-readable summary of the scheduling issue."),
  details: z.string().min(1).describe("Concrete evidence and context the orchestrator must decide from."),
  blocking: z.boolean().describe("True when the worker cannot responsibly continue this turn without a decision."),
  requested_decision: z
    .string()
    .min(1)
    .describe(
      "The scheduling question the orchestrator must answer. Do not use response action literals such as redispatch or redispatch_worker here.",
    ),
  evidence_refs: z.array(z.string().min(1)).optional().describe("Artifact, file, event, session, or log references."),
  goal_id: z.string().min(1).optional().describe("Goal id if this request belongs to one goal."),
  goal_run_id: z.string().min(1).optional().describe("Goal run id if this request belongs to one attempt."),
  severity: z.enum(["info", "blocked", "failure"]).optional(),
})

type RequestOrchestratorDecisionParams = z.infer<typeof RequestOrchestratorDecisionInput>
type DispatchTaskLoop = typeof dispatchTaskLoop

export async function executeRequestOrchestratorDecision(
  params: RequestOrchestratorDecisionParams,
  ctx: Tool.Context,
  dispatch: DispatchTaskLoop = dispatchTaskLoop,
) {
  const taskID = typeof ctx.extra?.taskID === "string" ? ctx.extra.taskID : undefined
  if (!taskID) {
    throw new Error("request_orchestrator_decision requires ctx.extra.taskID; this tool only works in task workers")
  }
  const session = await Session.get(ctx.sessionID)
  const runtimeContract = SessionPrompt.getSessionRuntimeContract(ctx.sessionID)
  const owningTask = taskIDForSession(ctx.sessionID)
  if (owningTask && owningTask !== taskID) {
    throw new Error(
      `request_orchestrator_decision session ${ctx.sessionID} belongs to task ${owningTask}, not ${taskID}`,
    )
  }
  const derivedGoalID = runtimeContract?.identity.goalID ?? session.goalID
  if (params.goal_id && derivedGoalID && params.goal_id !== derivedGoalID) {
    throw new Error(
      `request_orchestrator_decision goal_id ${params.goal_id} does not match session goal ${derivedGoalID}`,
    )
  }
  const derivedGoalRunID = runtimeContract?.identity.goalRunID
  if (params.goal_run_id && derivedGoalRunID && params.goal_run_id !== derivedGoalRunID) {
    throw new Error(
      `request_orchestrator_decision goal_run_id ${params.goal_run_id} does not match runtime goal_run ${derivedGoalRunID}`,
    )
  }
  const goalID = derivedGoalID ?? params.goal_id
  const goalRunID = derivedGoalRunID ?? params.goal_run_id
  const row = await createAgentCoordinationRequest({
    taskID,
    sessionID: ctx.sessionID,
    agent: ctx.agent,
    messageID: ctx.messageID,
    callID: ctx.callID,
    summary: params.summary,
    details: params.details,
    blocking: params.blocking,
    requestedDecision: params.requested_decision,
    evidenceRefs: params.evidence_refs,
    severity: params.severity,
    goalID,
    goalRunID,
  })

  if (!row.createdNow) {
    return {
      title: "coordination request",
      output: JSON.stringify({
        request_id: row.payload.request_id,
        task_id: taskID,
        session_id: ctx.sessionID,
        blocking: row.payload.blocking,
        replayed: true,
        orchestrator_wake: "not_dispatched",
        message:
          "Existing coordination request returned for this message replay. No duplicate orchestrator wake emitted.",
      }),
      metadata: {
        requestID: row.payload.request_id,
        taskID,
        sessionID: ctx.sessionID,
      },
    }
  }

  let dispatchResult: Awaited<ReturnType<DispatchTaskLoop>>
  try {
    dispatchResult = await dispatch({
      taskID,
      event: {
        note:
          `Worker coordination request ${row.payload.request_id} from ${ctx.agent}: ` +
          `${row.payload.summary}. Read the pending coordination request in task context and respond through ` +
          `respond_agent_coordination.`,
        coordinationRequest: { requestID: row.payload.request_id },
      },
    })
  } catch (error) {
    await cancelPendingAgentCoordinationRequest({
      taskID,
      requestID: row.payload.request_id,
      reason: `orchestrator wake failed: ${error instanceof Error ? error.message : String(error)}`,
    })
    throw error
  }
  if (dispatchResult === "ignored") {
    await cancelPendingAgentCoordinationRequest({
      taskID,
      requestID: row.payload.request_id,
      reason: "orchestrator wake ignored",
    })
    throw new Error(
      `request_orchestrator_decision recorded ${row.payload.request_id} but orchestrator wake was ignored`,
    )
  }

  return {
    title: "coordination request",
    output: JSON.stringify({
      request_id: row.payload.request_id,
      task_id: taskID,
      session_id: ctx.sessionID,
      blocking: params.blocking,
      orchestrator_wake: dispatchResult,
      message:
        "Coordination request recorded and orchestrator wake accepted. Do not wait silently for a response in this turn.",
    }),
    metadata: {
      requestID: row.payload.request_id,
      taskID,
      sessionID: ctx.sessionID,
    },
  }
}

export const RequestOrchestratorDecisionTool = Tool.define("request_orchestrator_decision", {
  description: `Create a visible worker-to-orchestrator coordination request for the current task.

Use this when you need the orchestrator to choose scheduling, scope, retry, cancellation, or user-question policy. This is not a blocking RPC: the request is persisted and the task orchestrator is woken after current live ownership can drain. If blocking=true, record the request and then end this worker turn through your required terminal/status tool instead of waiting silently.

Do not use task messages, hidden notes, or a new subtask chat to ask the orchestrator for a decision.`,
  parameters: RequestOrchestratorDecisionInput,
  async execute(params, ctx) {
    return executeRequestOrchestratorDecision(params, ctx)
  },
})
