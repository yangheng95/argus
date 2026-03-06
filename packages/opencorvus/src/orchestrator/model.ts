import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { Identifier } from "@/id/id"
import { PermissionNext } from "@/permission/next"
import { Question } from "@/question"
import { Snapshot } from "@/snapshot"

export const Budget = z.object({
  maxRuns: z.number().int().positive().optional(),
  maxReplans: z.number().int().positive().optional(),
  maxEvaluations: z.number().int().positive().optional(),
  maxWallTimeMs: z.number().int().positive().optional(),
})

export const ChannelBinding = z.object({
  platform: z.string(),
  channel: z.string(),
  thread: z.string(),
  payload: z.record(z.string(), z.any()).optional(),
})

export const GoalInput = z.object({
  description: z.string(),
  criteria: z.string(),
  priority: z.enum(["blocking", "advisory"]).optional(),
  metadata: z
    .object({
      check_selector: z.array(z.string()).optional(),
    })
    .optional(),
})

export const CheckConfig = z.object({
  build: z.array(z.string()).optional(),
  test: z.array(z.string()).optional(),
  lint: z.array(z.string()).optional(),
  verify_cmd: z.array(z.string()).optional(),
  artifact: z
    .object({
      require_changed_files: z.boolean().optional(),
      min_changed_files: z.number().int().min(0).optional(),
      require_diff: z.boolean().optional(),
      require_summary: z.boolean().optional(),
      mode: z.enum(["soft", "strict"]).optional(),
    })
    .optional(),
  visual: z
    .object({
      target: z.literal("web"),
      url: z.string().url(),
      require_text: z.array(z.string()).optional(),
      require_title: z.string().optional(),
      timeout_ms: z.number().int().positive().optional(),
      mode: z.enum(["soft", "strict"]).optional(),
    })
    .optional(),
  judge: z
    .object({
      enabled: z.boolean().optional(),
      prompt: z.string().optional(),
      mode: z.enum(["soft", "strict"]).optional(),
    })
    .optional(),
  timeout_ms: z.number().int().positive().optional(),
})

export const CreateTaskInput = z.object({
  project: z.string().optional(),
  requestID: z.string().optional(),
  source: z.string().optional(),
  title: z.string().optional(),
  request: z.string(),
  priority: z.enum(["high", "normal", "low"]).optional(),
  budget: Budget.optional(),
  checks: CheckConfig.optional(),
  goals: GoalInput.array().optional(),
  channelBinding: ChannelBinding.optional(),
  metadata: z.record(z.string(), z.any()).optional(),
})

export const Task = z.object({
  id: Identifier.schema("task"),
  projectID: z.string(),
  sessionID: Identifier.schema("session").nullable().optional(),
  activePlanVersionID: Identifier.schema("plan").nullable().optional(),
  activeRunID: Identifier.schema("run").nullable().optional(),
  requestID: z.string().optional(),
  source: z.string(),
  title: z.string(),
  request: z.string(),
  status: z.enum(["queued", "planning", "running", "blocked", "evaluating", "completed", "failed", "cancelled"]),
  priority: z.enum(["high", "normal", "low"]),
  blockingReason: z.string().optional(),
  error: z.string().optional(),
  budget: Budget.optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
    started: z.number().optional(),
    completed: z.number().optional(),
  }),
})

export const PlanVersion = z.object({
  id: Identifier.schema("plan"),
  taskID: Identifier.schema("task"),
  version: z.number().int(),
  status: z.enum(["active", "superseded"]),
  summary: z.string(),
  prompt: z.string(),
  metadata: z.record(z.string(), z.any()).optional(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
  }),
})

export const Goal = z.object({
  id: Identifier.schema("goal"),
  taskID: Identifier.schema("task"),
  planVersionID: Identifier.schema("plan"),
  description: z.string(),
  criteria: z.string(),
  priority: z.enum(["blocking", "advisory"]),
  status: z.enum(["pending", "passed", "failed"]),
  orderIndex: z.number().int(),
  metadata: z
    .object({
      check_selector: z.array(z.string()).optional(),
    })
    .optional(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
  }),
})

export const ExecutorRef = z.object({
  sessionID: Identifier.schema("session").optional(),
  queueTaskID: Identifier.schema("task").optional(),
})

export const Run = z.object({
  id: Identifier.schema("run"),
  taskID: Identifier.schema("task"),
  planVersionID: Identifier.schema("plan").nullable().optional(),
  sessionID: Identifier.schema("session").nullable().optional(),
  executor: z.literal("opencode"),
  status: z.enum(["queued", "accepted", "running", "blocked", "completed", "failed", "aborted"]),
  phase: z.enum(["plan", "execute", "evaluate", "replan"]),
  blockingReason: z.string().optional(),
  error: z.string().optional(),
  retryCount: z.number().int(),
  executorRef: ExecutorRef.optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
    started: z.number().optional(),
    completed: z.number().optional(),
  }),
})

export const Interaction = z.object({
  id: Identifier.schema("interaction"),
  taskID: Identifier.schema("task"),
  runID: Identifier.schema("run"),
  sessionID: Identifier.schema("session").nullable().optional(),
  externalID: z.string(),
  type: z.enum(["permission", "question"]),
  status: z.enum(["pending", "answered", "rejected", "expired"]),
  title: z.string(),
  body: z.string(),
  payload: z.record(z.string(), z.any()).optional(),
  response: z.record(z.string(), z.any()).optional(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
    resolved: z.number().optional(),
  }),
})

export const Artifact = z.object({
  id: Identifier.schema("artifact"),
  taskID: Identifier.schema("task"),
  runID: Identifier.schema("run"),
  deliveryID: Identifier.schema("delivery").nullable().optional(),
  kind: z.enum(["patch", "changed_file", "log", "report", "image", "diff", "html_trace", "link"]),
  label: z.string(),
  payload: z.record(z.string(), z.any()).optional(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
  }),
})

export const Delivery = z.object({
  id: Identifier.schema("delivery"),
  taskID: Identifier.schema("task"),
  runID: Identifier.schema("run"),
  status: z.literal("ready"),
  summary: z.string(),
  result: z.object({
    summary: z.string(),
    changedFiles: z.string().array(),
    diffs: Snapshot.FileDiff.array(),
  }),
  time: z.object({
    created: z.number(),
    updated: z.number(),
  }),
})

export const EvaluationCheck = z.object({
  name: z.string(),
  status: z.enum(["passed", "failed", "skipped"]),
  evidence: z.string().optional(),
})

export const Evaluation = z.object({
  id: Identifier.schema("evaluation"),
  taskID: Identifier.schema("task"),
  runID: Identifier.schema("run"),
  deliveryID: Identifier.schema("delivery").nullable().optional(),
  status: z.enum(["pending", "passed", "failed", "inconclusive"]),
  verdict: z.enum(["accepted", "rejected", "inconclusive"]),
  summary: z.string(),
  checks: EvaluationCheck.array(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
    completed: z.number().optional(),
  }),
})

export const ProgressSnapshot = z.object({
  id: Identifier.schema("progress"),
  taskID: Identifier.schema("task"),
  status: z.enum(["created", "running", "blocked", "completed", "failed", "cancelled"]),
  summary: z.string(),
  payload: z.record(z.string(), z.any()).optional(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
  }),
})

export const Progress = z.object({
  task: Task,
  plan: PlanVersion.optional(),
  goals: Goal.array(),
  run: Run.optional(),
  pendingInteractions: Interaction.array(),
  delivery: Delivery.optional(),
  evaluation: Evaluation.optional(),
  snapshots: ProgressSnapshot.array(),
})

export const ReplyInteractionInput = z.object({
  reply: PermissionNext.Reply.optional(),
  message: z.string().optional(),
  answers: z.array(Question.Answer).optional(),
})

export const RejectInteractionInput = z.object({
  message: z.string().optional(),
})

export const TaskAccepted = z.object({
  task_id: Identifier.schema("task"),
})

export const TaskMessageInput = z.object({
  text: z.string(),
  source: z.string().optional(),
  user_id: z.string().optional(),
})

export const TaskMessageResult = z.object({
  kind: z.enum(["preference", "goal", "plan", "note"]),
  message: z.string(),
  should_resume: z.boolean(),
})

export const TaskBrief = z.object({
  content: z.string(),
  preferences: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
    }),
  ),
  notes: z.array(
    z.object({
      kind: z.string(),
      content: z.string(),
    }),
  ),
  goals: z.array(
    z.object({
      description: z.string(),
      criteria: z.string(),
    }),
  ),
})

export const TaskBoardCard = z.object({
  id: z.string(),
  kind: z.enum(["goal", "interaction", "preference", "note", "run", "plan_hint"]),
  title: z.string(),
  detail: z.string().optional(),
  status: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
})

export const TaskBoardLane = z.object({
  id: z.string(),
  title: z.string(),
  cards: TaskBoardCard.array(),
})

export const TaskBoard = z.object({
  task: Task,
  plan: PlanVersion.optional(),
  run: Run.optional(),
  delivery: Delivery.optional(),
  evaluation: Evaluation.optional(),
  interactions: Interaction.array(),
  artifacts: Artifact.array(),
  snapshots: ProgressSnapshot.array(),
  brief: z.object({
    content: z.string(),
    updated_at: z.number(),
  }),
  lanes: TaskBoardLane.array(),
})

export const ProjectTaskSummary = z.object({
  task: Task,
  plan: PlanVersion.optional(),
  run: Run.optional(),
  evaluation: Evaluation.optional(),
  pending_interactions: z.number().int(),
  updated_at: z.number(),
})

export const ProjectBoard = z.object({
  project: z.object({
    id: z.string(),
    name: z.string().optional(),
    worktree: z.string(),
  }),
  summary: z.object({
    total_tasks: z.number().int(),
    open_tasks: z.number().int(),
    running_tasks: z.number().int(),
    blocked_tasks: z.number().int(),
    completed_tasks: z.number().int(),
    failed_tasks: z.number().int(),
    cancelled_tasks: z.number().int(),
    median_completion_ms: z.number().int().optional(),
  }),
  tasks: ProjectTaskSummary.array(),
})

export const TaskEvent = z.object({
  event_id: z.string(),
  task_id: Identifier.schema("task"),
  run_id: Identifier.schema("run").optional(),
  type: z.string(),
  timestamp: z.number(),
  summary: z.string(),
  payload: z.record(z.string(), z.any()),
})

export const Event = {
  TaskCreated: BusEvent.define("orchestrator.task.created", z.object({ taskID: Identifier.schema("task"), status: Task.shape.status, summary: z.string() })),
  TaskUpdated: BusEvent.define("orchestrator.task.updated", z.object({ taskID: Identifier.schema("task"), status: Task.shape.status, summary: z.string() })),
  PlanCreated: BusEvent.define("orchestrator.plan.created", z.object({ taskID: Identifier.schema("task"), planID: Identifier.schema("plan"), summary: z.string() })),
  PlanActivated: BusEvent.define("orchestrator.plan.activated", z.object({ taskID: Identifier.schema("task"), planID: Identifier.schema("plan"), summary: z.string() })),
  GoalPassed: BusEvent.define("orchestrator.goal.passed", z.object({ taskID: Identifier.schema("task"), goalID: Identifier.schema("goal"), summary: z.string() })),
  GoalFailed: BusEvent.define("orchestrator.goal.failed", z.object({ taskID: Identifier.schema("task"), goalID: Identifier.schema("goal"), summary: z.string() })),
  RunCreated: BusEvent.define("orchestrator.run.created", z.object({ taskID: Identifier.schema("task"), runID: Identifier.schema("run"), status: Run.shape.status, summary: z.string() })),
  RunUpdated: BusEvent.define("orchestrator.run.updated", z.object({ taskID: Identifier.schema("task"), runID: Identifier.schema("run"), status: Run.shape.status, summary: z.string() })),
  InteractionRequested: BusEvent.define("orchestrator.interaction.requested", z.object({ taskID: Identifier.schema("task"), runID: Identifier.schema("run"), interactionID: Identifier.schema("interaction"), requestType: Interaction.shape.type, summary: z.string() })),
  InteractionResolved: BusEvent.define("orchestrator.interaction.resolved", z.object({ taskID: Identifier.schema("task"), runID: Identifier.schema("run"), interactionID: Identifier.schema("interaction"), status: Interaction.shape.status, summary: z.string() })),
  DeliveryReady: BusEvent.define("orchestrator.delivery.ready", z.object({ taskID: Identifier.schema("task"), runID: Identifier.schema("run"), deliveryID: Identifier.schema("delivery"), summary: z.string() })),
  EvaluationCompleted: BusEvent.define("orchestrator.evaluation.completed", z.object({ taskID: Identifier.schema("task"), runID: Identifier.schema("run"), evaluationID: Identifier.schema("evaluation"), status: Evaluation.shape.status, verdict: Evaluation.shape.verdict, summary: z.string() })),
  TaskMessageRecorded: BusEvent.define("orchestrator.task.message", z.object({ taskID: Identifier.schema("task"), kind: TaskMessageResult.shape.kind, source: z.string(), text: z.string(), summary: z.string() })),
}
