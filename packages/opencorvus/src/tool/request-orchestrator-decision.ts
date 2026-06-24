import z from "zod"
import { createAgentCoordinationRequest } from "@/engine/agent-coordination"
import { dispatchTaskLoop } from "@/engine/queue"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Tool } from "./tool"

const RequestOrchestratorDecisionInput = z.object({
  summary: z.string().min(1).describe("Short human-readable summary of the scheduling issue."),
  details: z.string().min(1).describe("Concrete evidence and context the orchestrator must decide from."),
  blocking: z.boolean().describe("True when the worker cannot responsibly continue this turn without a decision."),
  requested_decision: z.string().min(1).describe("The exact decision requested from the orchestrator."),
  evidence_refs: z.array(z.string().min(1)).optional().describe("Artifact, file, event, session, or log references."),
  goal_id: z.string().min(1).optional().describe("Goal id if this request belongs to one goal."),
  goal_run_id: z.string().min(1).optional().describe("Goal run id if this request belongs to one attempt."),
  severity: z.enum(["info", "blocked", "failure"]).optional(),
})

export const RequestOrchestratorDecisionTool = Tool.define("request_orchestrator_decision", {
  description: `Create a visible worker-to-orchestrator coordination request for the current task.

Use this when you need the orchestrator to choose scheduling, scope, retry, cancellation, user-question, or redispatch policy. This is not a blocking RPC: the request is persisted and the task orchestrator is woken after current live ownership can drain. If blocking=true, record the request and then end this worker turn through your required terminal/status tool instead of waiting silently.

Do not use task messages, hidden notes, or a new subtask chat to ask the orchestrator for a decision.`,
  parameters: RequestOrchestratorDecisionInput,
  async execute(params, ctx) {
    const taskID = typeof ctx.extra?.taskID === "string" ? ctx.extra.taskID : undefined
    if (!taskID) {
      throw new Error("request_orchestrator_decision requires ctx.extra.taskID; this tool only works in task workers")
    }
    const session = await Session.get(ctx.sessionID)
    const runtimeContract = SessionPrompt.getSessionRuntimeContract(ctx.sessionID)
    const goalID = params.goal_id ?? session.goalID ?? runtimeContract?.identity.goalID
    const goalRunID = params.goal_run_id ?? runtimeContract?.identity.goalRunID
    const row = createAgentCoordinationRequest({
      taskID,
      sessionID: ctx.sessionID,
      agent: ctx.agent,
      messageID: ctx.messageID,
      summary: params.summary,
      details: params.details,
      blocking: params.blocking,
      requestedDecision: params.requested_decision,
      evidenceRefs: params.evidence_refs,
      severity: params.severity,
      goalID,
      goalRunID,
    })

    void dispatchTaskLoop({
      taskID,
      event: {
        note:
          `Worker coordination request ${row.payload.request_id} from ${ctx.agent}: ` +
          `${row.payload.summary}. Read the pending coordination request in task context and respond through ` +
          `respond_agent_coordination.`,
      },
    })

    return {
      title: "coordination request",
      output: JSON.stringify({
        request_id: row.payload.request_id,
        task_id: taskID,
        session_id: ctx.sessionID,
        blocking: params.blocking,
        message:
          "Coordination request recorded and orchestrator wake dispatched. Do not wait silently for a response in this turn.",
      }),
      metadata: {
        requestID: row.payload.request_id,
        taskID,
        sessionID: ctx.sessionID,
      },
    }
  },
})
