import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { ExecutorName } from "@/executor/contract"
import { ProtocolCapabilities, ProtocolRefs, ProtocolSettings } from "@/executor/protocol"
import { Identifier } from "@/id/id"
import { PermissionNext } from "@/permission/next"
import { Question } from "@/question"
import { Snapshot } from "@/snapshot"

/** Task statuses that indicate a terminal or notable state change worth mirroring to channels. */
export const TASK_TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const

/** Run statuses that indicate a terminal or notable state change worth mirroring to channels. */
export const RUN_TERMINAL_STATUSES = ["blocked", "failed", "completed", "aborted"] as const

export const Budget = z.object({
  maxRuns: z.number().int().positive().optional(),
  maxFixRuns: z.number().int().positive().optional(),
  maxExecutorGroups: z.number().int().positive().optional(),
})

export const ChannelBinding = z.object({
  platform: z.string(),
  channel: z.string(),
  thread: z.string(),
  payload: z.record(z.string(), z.any()).optional(),
})

export const PlanningProvider = z.enum(["opencorvus", "executor"])
export const EvaluationProvider = z.enum(["opencorvus", "hybrid"])

export const StageRouting = z.object({
  spec: PlanningProvider.optional(),
  plan: PlanningProvider.optional(),
  evaluation: EvaluationProvider.optional(),
})

export const GoalKind = z.enum(["bootstrap", "feature", "verification", "integration", "system"])

import { AcceptanceSpecSchema } from "@/acceptance/types"

export const GoalInput = z.object({
  description: z.string(),
  criteria: z.string(),
  priority: z.enum(["blocking", "advisory"]).optional(),
  source: z.string().optional(),
  title: z.string().optional(),
  objective: z.string().optional(),
  requirement_ids: z.array(z.string()).optional(),
  depends_on_goal_ids: z.array(z.string()).optional(),
  owned_paths: z.array(z.string()).optional(),
  acceptance_specs: z.array(AcceptanceSpecSchema).optional(),
  kind: GoalKind.optional(),
  metadata: z
    .object({
      check_selector: z.array(z.string()).optional(),
    })
    .passthrough()
    .optional(),
})

export const MilestoneInput = z.object({
  title: z.string(),
  description: z.string().optional(),
  goals: GoalInput.array(),
})

export const NamedCheckFamily = z.enum(["build", "test", "lint", "verify_cmd"])

export const NamedCheckConfig = z.object({
  label: z.string().min(1).optional(),
  family: NamedCheckFamily.optional(),
  commands: z.array(z.string().min(1)).min(1),
  enabled: z.boolean().optional(),
  cwd: z.string().min(1).optional(),
})

export const CheckConfig = z.object({
  build: z.union([z.array(z.string()), z.literal(false)]).optional(),
  test: z.union([z.array(z.string()), z.literal(false)]).optional(),
  lint: z.union([z.array(z.string()), z.literal(false)]).optional(),
  verify_cmd: z.union([z.array(z.string()), z.literal(false)]).optional(),
  named: z.record(z.string(), NamedCheckConfig).optional(),
  startup: z
    .object({
      command: z.string().min(1),
      ready_url: z.string().url().optional(),
      ready_text: z.string().optional(),
      timeout_ms: z.number().int().positive().optional(),
      warmup_ms: z.number().int().positive().optional(),
      require_exit_zero: z.boolean().optional(),
      mode: z.enum(["soft", "strict"]).optional(),
    })
    .optional(),
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
  puppeteer: z
    .object({
      target: z.literal("web"),
      url: z.string().url(),
      browser: z.enum(["chrome", "edge", "chromium"]).optional(),
      executable_path: z.string().optional(),
      wait_for_selector: z.string().optional(),
      wait_for_text: z.string().optional(),
      require_text: z.array(z.string()).optional(),
      require_title: z.string().optional(),
      full_page: z.boolean().optional(),
      viewport: z
        .object({
          width: z.number().int().positive().optional(),
          height: z.number().int().positive().optional(),
        })
        .optional(),
      timeout_ms: z.number().int().positive().optional(),
      mode: z.enum(["soft", "strict"]).optional(),
    })
    .optional(),
  ui_review: z
    .object({
      target: z.literal("web"),
      url: z.string().url().optional(),
      prompt: z.string().optional(),
      focus: z.array(z.enum(["layout", "hierarchy", "clarity", "navigation", "feedback", "accessibility"])).optional(),
      timeout_ms: z.number().int().positive().optional(),
      mode: z.enum(["soft", "strict"]).optional(),
    })
    .optional(),
  code_quality: z
    .object({
      enabled: z.boolean().optional(),
      prompt: z.string().optional(),
      max_diffs: z.number().int().positive().optional(),
      mode: z.enum(["soft", "strict"]).optional(),
    })
    .optional(),
  code_review: z
    .object({
      enabled: z.boolean().optional(),
      prompt: z.string().optional(),
      max_diffs: z.number().int().positive().optional(),
      mode: z.enum(["soft", "strict"]).optional(),
    })
    .optional(),
  dead_code_review: z
    .object({
      enabled: z.boolean().optional(),
      prompt: z.string().optional(),
      max_diffs: z.number().int().positive().optional(),
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
  spec_check: z
    .object({
      enabled: z.boolean().optional(),
      prompt: z.string().optional(),
      mode: z.enum(["soft", "strict"]).optional(),
    })
    .optional(),
  custom: z.record(z.string(), z.record(z.string(), z.any())).optional(),
  timeout_ms: z.number().int().positive().optional(),
})

/**
 * API-boundary attachment payload. Callers that cannot upload out-of-band (HTTP
 * clients, benchmark scripts, channel ingress) send the raw bytes base64-encoded.
 * The orchestrator decodes them exactly once at task-creation time, writes them
 * to AttachmentStore, and never carries base64 further into the system.
 */
export const TaskAttachmentInput = z.object({
  /** MIME type, e.g. "image/png", "application/pdf", "audio/mpeg" */
  mime: z.string(),
  /** Base64-encoded file bytes (no data-URL prefix) */
  data: z.string(),
  /** Optional display name shown in the overlay message and LLM file part */
  filename: z.string().optional(),
})

/**
 * Persisted attachment reference. Once the bytes live in AttachmentStore
 * (`<projectDir>/.opencorvus/attachments/<sha>.<ext>`), every downstream layer
 * — queue table row, task loop, orchestrator, design-analyst, requirements — only
 * carries this small, URL-addressable reference. Agents that need the raw
 * bytes for multimodal LLM input read them back through AttachmentStore.
 *
 * `intent` lets evaluator gates and downstream agents consume the same
 * attachment store with different semantics. Today three intents are wired:
 *   - "visual_reference" — picked up by the deliver-time visual SSIM gate
 *     (user-uploaded screenshots, Figma frames, URL screenshots).
 *   - "design_token"     — design-analyst input only, not a verification gate.
 *   - "spec_artifact"    — generic supporting material (request docs etc).
 * Other intents may appear later (api_contract, test_fixture, …); leaving
 * the field free-form keeps that extension cheap. Missing intent defaults
 * to `visual_reference` for image MIMEs and `spec_artifact` otherwise.
 */
export const TaskAttachment = z.object({
  /** sha256 hex digest of the file bytes */
  sha: z.string(),
  /** Server-relative URL the overlay (and AI SDK) can GET to fetch the bytes */
  url: z.string(),
  /** MIME type, preserved from the original upload */
  mime: z.string(),
  /** Byte length of the stored file */
  size: z.number().int().nonnegative(),
  /** Optional display name shown in the overlay message */
  filename: z.string().optional(),
  /** Semantic role for downstream consumers. See struct comment above. */
  intent: z.string().optional(),
  /** Where the attachment came from. Useful for UI labelling and audit. */
  source: z.string().optional(),
})

export const CreateTaskInput = z.object({
  project: z.string().optional(),
  requestID: z.string().optional(),
  source: z.string().optional(),
  executor: ExecutorName.optional(),
  title: z.string().optional(),
  request: z.string(),
  /** File attachments (images / PDF / text / audio / video). Base64 bytes are
   *  decoded once at task creation, stored under the project's attachment dir,
   *  and downstream always use references — not base64. */
  attachments: TaskAttachmentInput.array().optional(),
  // Priority levels (highest first):
  //  - "critical": repair-shaped follow-ups emitted by `submit_next_task` —
  //                jump the queued serial queue ahead of normal/high. Never
  //                preempts an already-active task in the same project; only
  //                takes the next queued slot.
  //  - "high"/"normal"/"low": user-facing levels; also used by iteration /
  //                recommendation follow-ups from `submit_next_task`.
  priority: z.enum(["critical", "high", "normal", "low"]).optional(),
  /** Defaults to "workflow" (full pipeline). Pass "build" to bypass the pipeline
   *  and run the build agent directly — used for one-shot edits. */
  kind: z.enum(["workflow", "build"]).optional(),
  budget: Budget.optional(),
  checks: CheckConfig.optional(),
  routing: StageRouting.optional(),
  goals: GoalInput.array().optional(),
  milestones: MilestoneInput.array().optional(),
  channelBinding: ChannelBinding.optional(),
  metadata: z.record(z.string(), z.any()).optional(),
})

export const Task = z.object({
  id: Identifier.schema("task"),
  projectID: z.string(),
  directory: z.string().optional(),
  sessionID: Identifier.schema("session").nullable().optional(),
  activePlanVersionID: Identifier.schema("plan").nullable().optional(),
  activeRunID: Identifier.schema("run").nullable().optional(),
  requestID: z.string().optional(),
  source: z.string(),
  title: z.string(),
  request: z.string(),
  status: z.enum(["queued", "active", "completed", "failed", "cancelled"]),
  priority: z.enum(["critical", "high", "normal", "low"]),
  /** "workflow" — runs the full requirements→design→architect→execute→deliver pipeline.
   *  "build" — bypasses the pipeline and runs the build agent directly. Used for
   *  one-shot edits / Q&A / quick fixes. Both kinds share the same task table
   *  and queue, so cancel/list/audit are uniform. */
  kind: z.enum(["workflow", "build"]).default("workflow"),
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
  milestoneID: z.string().nullable().optional(),
  description: z.string(),
  criteria: z.string(),
  priority: z.enum(["blocking", "advisory"]),
  status: z.enum(["pending", "running", "passed", "failed"]),
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

export const Milestone = z.object({
  id: z.string(),
  taskID: Identifier.schema("task"),
  planVersionID: Identifier.schema("plan"),
  title: z.string(),
  description: z.string(),
  status: z.enum(["pending", "active", "passed", "failed"]),
  orderIndex: z.number().int(),
  metadata: z.record(z.string(), z.any()).optional(),
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
  executor: ExecutorName,
  status: z.enum(["queued", "accepted", "running", "blocked", "completed", "failed", "aborted"]),
  phase: z.enum(["plan", "execute", "evaluate", "deliver", "dispatch", "retry"]),
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

export const ExecutorSession = z.object({
  id: z.string(),
  taskID: Identifier.schema("task"),
  runID: Identifier.schema("run"),
  provider: ExecutorName,
  protocol: z.string(),
  protocolVersion: z.string(),
  transport: z.enum(["inproc", "stdio", "ws", "http"]),
  status: z.enum(["active", "completed", "failed", "aborted"]),
  refs: ProtocolRefs.optional(),
  capabilities: ProtocolCapabilities.optional(),
  settings: ProtocolSettings.optional(),
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
  kind: z.enum(["patch", "changed_file", "log", "report", "image", "diff", "html_trace", "link", "git_ref", "pr"]),
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
  status: z.enum(["candidate", "publishing", "delivered", "failed"]),
  summary: z.string(),
  result: z.object({
    summary: z.string(),
    changedFiles: z.string().array(),
    diffs: Snapshot.FileDiff.array(),
    artifacts: z
      .array(
        z.object({
          kind: z.string(),
          label: z.string(),
          payload: z.record(z.string(), z.any()).optional(),
        }),
      )
      .optional(),
    publish: z.record(z.string(), z.any()).optional(),
  }),
  time: z.object({
    created: z.number(),
    updated: z.number(),
  }),
})

export const EvaluationCheck = z.object({
  name: z.string(),
  label: z.string().optional(),
  family: z.string().optional(),
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
  status: z.enum(["created", "active", "completed", "failed", "cancelled"]),
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
  milestones: Milestone.array().optional(),
  run: Run.optional(),
  pendingInteractions: Interaction.array(),
  delivery: Delivery.optional(),
  evaluation: Evaluation.optional(),
  snapshots: ProgressSnapshot.array(),
})

export const ReplyInteractionInput = z.object({
  reply: PermissionNext.Reply.optional(),
  autoReply: z.boolean(),
  message: z.string().optional(),
  answers: z.array(Question.Answer).optional(),
})

export const RejectInteractionInput = z.object({
  autoReply: z.boolean(),
  message: z.string().optional(),
})

export const UpdateGoalInput = z.object({
  description: z.string().min(1),
  acceptance_specs: z.array(AcceptanceSpecSchema).min(1),
})

export const UpdateTaskChecksInput = z.object({
  checks: CheckConfig.optional(),
  selection: z.record(z.string(), z.boolean()).optional(),
})

export const TaskAccepted = z.object({
  task_id: Identifier.schema("task"),
})

export const TaskMessageInput = z.object({
  text: z.string(),
  source: z.string().optional(),
  user_id: z.string().optional(),
  attachments: TaskAttachmentInput.array().optional(),
})

export const InjectMessageInput = z.object({
  message: z.string().min(1),
})

export const TaskMessageResult = z.object({
  kind: z.enum(["goal", "plan", "note"]),
  message: z.string(),
  should_resume: z.boolean(),
})

export const TaskBrief = z.object({
  content: z.string(),
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

export const TaskChannelBinding = z.object({
  id: z.string(),
  platform: z.string(),
  channel: z.string(),
  thread: z.string(),
  payload: z.record(z.string(), z.any()).optional(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
  }),
})

export const TaskBoardFailure = z.object({
  source: z.enum(["task", "run", "interaction", "evaluation"]),
  title: z.string(),
  summary: z.string(),
  checks: EvaluationCheck.array().optional(),
})

export const TaskBoardNextStep = z.object({
  kind: z.enum(["resolve_blocker", "retry", "replan", "observe", "review_delivery", "message"]),
  title: z.string(),
  detail: z.string().optional(),
})

export const TaskBoardOverview = z.object({
  headline: z.string(),
  summary: z.string(),
  currentFailure: TaskBoardFailure.optional(),
  nextStep: TaskBoardNextStep,
  controls: z.object({
    canRetry: z.boolean(),
    canReplan: z.boolean(),
    canCancel: z.boolean(),
  }),
})

export const SpecSnapshot = z.object({
  content: z.string(),
  file: z.string().optional(),
  source: z.record(z.string(), z.any()).optional(),
  time: z.object({
    created: z.number(),
  }),
})

export const TaskBoardGoalRun = z.object({
  id: z.string(),
  goalID: z.string(),
  status: z.string(),
  sessionID: z.string().optional(),
  /** opencode executor's native session (distinct from run session). */
  executorSessionID: z.string().optional(),
  /** Pipeline-planner child session — required so planner rounds attach to the goal. */
  plannerSessionID: z.string().optional(),
  workspaceDir: z.string().optional(),
  error: z.string().optional(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
    started: z.number().optional(),
    completed: z.number().optional(),
  }),
})

// ---------------------------------------------------------------------------
// MiniWorkflow — workflow state projected to TaskBoard
// ---------------------------------------------------------------------------

export const TaskBoardWorkflowStep = z.object({
  id: z.string(),
  label: z.string(),
  tool: z.string(),
  scope: z.enum(["task", "goal"]),
  skippable: z.boolean(),
  status: z.enum(["pending", "running", "completed", "skipped", "failed"]),
})

export const TaskBoardWorkflow = z.object({
  id: z.string(),
  name: z.string(),
  steps: TaskBoardWorkflowStep.array(),
  goalLoopStepIDs: z.array(z.string()),
})

export const TaskBoardRequirement = z.object({
  id: z.string(),
  description: z.string(),
  type: z.enum(["explicit", "inferred", "system"]),
  priority: z.enum(["blocking", "advisory"]),
})

export const TaskBoardArchitect = z.object({
  summary: z.string(),
  contractCount: z.number(),
  categories: z.array(z.string()),
})

export const TaskBoardGoalWorkflowStep = z.object({
  stepID: z.string(),
  label: z.string(),
  status: z.enum(["pending", "running", "completed", "skipped", "failed"]),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  /** Human-readable summary: "5 steps", "12 files", "3/4 checks" */
  summary: z.string().optional(),
})

export const TaskBoardGoalContract = z.object({
  key: z.string(),
  value: z.string(),
  reason: z.string().optional(),
})

export const TaskBoardGoalWorkflow = z.object({
  goalID: z.string(),
  goalTitle: z.string(),
  goalStatus: z.string(),
  priority: z.enum(["blocking", "advisory"]),
  steps: TaskBoardGoalWorkflowStep.array(),
  /** Architect contracts relevant to this specific goal */
  contracts: TaskBoardGoalContract.array().optional(),
})

// ---------------------------------------------------------------------------
// TaskBoard — full board projection
// ---------------------------------------------------------------------------

export const TaskBoard = z.object({
  lastSequence: z.number().optional(),
  task: Task,
  spec: SpecSnapshot.optional(),
  plan: PlanVersion.optional(),
  goalRuns: TaskBoardGoalRun.array().optional(),
  run: Run.optional(),
  delivery: Delivery.optional(),
  candidateDelivery: Delivery.optional(),
  acceptedDelivery: Delivery.optional(),
  evaluation: Evaluation.optional(),
  interactions: Interaction.array(),
  channels: TaskChannelBinding.array(),
  artifacts: Artifact.array(),
  overview: TaskBoardOverview,
  brief: z.object({
    content: z.string(),
    updated_at: z.number(),
  }),

  // ── New workflow-structured fields ──
  /** Active workflow state (from task.metadata._workflow + WorkflowRegistry) */
  workflow: TaskBoardWorkflow.optional(),
  /** Structured requirements from Requirements Agent output */
  requirements: TaskBoardRequirement.array().optional(),
  /** Architect Agent consensus summary */
  architect: TaskBoardArchitect.optional(),
  /** Per-goal workflow groups with step-level progress */
  goalWorkflows: TaskBoardGoalWorkflow.array().optional(),
  /** Task-level rollup of every quality criterion that touched this task —
   *  per-goal evaluator outcomes, delivery agent verifications, and external
   *  quality gates (e.g. visual-diff). Persisted in task.metadata.criteria_results
   *  and exposed here so the overlay's EvaluationCriteriaPanel and the delivery
   *  agent's `query_criteria` tool both read from the same place. */
  criteriaResults: EvaluationCheck.array().optional(),
})

export const TaskProject = z.object({
  id: z.string(),
  name: z.string().optional(),
  worktree: z.string(),
})

export const ProjectTaskSummary = z.object({
  task: Task,
  project: TaskProject.nullable().optional(),
  plan: PlanVersion.optional(),
  run: Run.optional(),
  evaluation: Evaluation.optional(),
  pending_interactions: z.number().int(),
  updated_at: z.number(),
})

export const TaskListSummary = z.object({
  total_tasks: z.number().int(),
  open_tasks: z.number().int(),
  running_tasks: z.number().int(),
  blocked_tasks: z.number().int(),
  completed_tasks: z.number().int(),
  failed_tasks: z.number().int(),
  cancelled_tasks: z.number().int(),
  median_completion_ms: z.number().int().optional(),
})

export const ProjectBoard = z.object({
  project: TaskProject,
  summary: TaskListSummary,
  tasks: ProjectTaskSummary.array(),
})

export const GlobalTaskBoard = z.object({
  summary: TaskListSummary,
  tasks: ProjectTaskSummary.array(),
})

export const TaskEvent = z.object({
  event_id: z.string(),
  task_id: Identifier.schema("task"),
  run_id: Identifier.schema("run").optional(),
  type: z.string(),
  timestamp: z.number(),
  sequence: z.number().int().nonnegative().optional(),
  summary: z.string(),
  payload: z.record(z.string(), z.any()),
})

export const ArtifactAudit = z.object({
  source_files_added: z.number(),
  config_files_added: z.number(),
  doc_files_added: z.number(),
  source_file_count: z.number(),
  doc_file_count: z.number(),
  non_source_churn_ratio: z.number(),
  readme_proliferation_count: z.number(),
  out_of_scope_file_count: z.number(),
  scaffold_noise_count: z.number(),
  placeholder_count: z.number(),
  out_of_scope_files: z.string().array(),
  unmapped_files: z.string().array(),
  placeholder_hits: z.string().array(),
  duplicate_docs: z.string().array(),
  scaffold_expansion_flags: z.string().array(),
})

export const RunMetrics = z.object({
  meaningful_change_gap_ms: z.number(),
  noop_cycle_count: z.number(),
  repeat_command_ratio: z.number(),
  repeat_reasoning_similarity: z.number(),
  required_check_pass_rate: z.number(),
  critical_check_pass_rate: z.number(),
  check_relevance_score: z.number(),
  verification_edit_ratio: z.number(),
  feature_coverage_p0: z.number(),
  scope_drift_score: z.number(),
  plan_to_change_traceability: z.number(),
  delivery_focus_score: z.number(),
})

export type AgentStageType = "assistant" | "requirements" | "spec" | "goal" | "architect" | "planner" | "evaluator" | "delivery"

export const Event = {
  AgentUpdated: BusEvent.define("agent.updated", z.object({ taskID: z.string(), runID: z.string().optional(), stage: z.string(), kind: z.string(), id: z.string().optional(), toolName: z.string().optional(), text: z.string().optional(), summary: z.string() })),
  TaskCreated: BusEvent.define("task.created", z.object({ taskID: Identifier.schema("task"), status: Task.shape.status, summary: z.string() })),
  TaskUpdated: BusEvent.define("task.updated", z.object({ taskID: Identifier.schema("task"), status: Task.shape.status, summary: z.string() })),
  SpecCreated: BusEvent.define("spec.created", z.object({ taskID: Identifier.schema("task"), specID: Identifier.schema("spec"), summary: z.string() })),
  SpecUpdated: BusEvent.define("spec.updated", z.object({ taskID: Identifier.schema("task"), specID: Identifier.schema("spec"), status: z.string(), summary: z.string() })),
  SpecApproved: BusEvent.define("spec.approved", z.object({ taskID: Identifier.schema("task"), specID: Identifier.schema("spec"), summary: z.string() })),
  PlanCreated: BusEvent.define("plan.created", z.object({ taskID: Identifier.schema("task"), planID: Identifier.schema("plan"), summary: z.string() })),
  PlanActivated: BusEvent.define("plan.activated", z.object({ taskID: Identifier.schema("task"), planID: Identifier.schema("plan"), summary: z.string() })),
  GoalProgress: BusEvent.define("goal.progress", z.object({ taskID: Identifier.schema("task"), goalRunID: z.string(), summary: z.string() })),
  GoalPassed: BusEvent.define("goal.passed", z.object({ taskID: Identifier.schema("task"), goalID: Identifier.schema("goal"), summary: z.string() })),
  GoalFailed: BusEvent.define("goal.failed", z.object({ taskID: Identifier.schema("task"), goalID: Identifier.schema("goal"), summary: z.string() })),
  MilestoneActivated: BusEvent.define("milestone.activated", z.object({ taskID: Identifier.schema("task"), milestoneID: z.string(), summary: z.string() })),
  MilestonePassed: BusEvent.define("milestone.passed", z.object({ taskID: Identifier.schema("task"), milestoneID: z.string(), summary: z.string() })),
  MilestoneFailed: BusEvent.define("milestone.failed", z.object({ taskID: Identifier.schema("task"), milestoneID: z.string(), summary: z.string() })),
  RunCreated: BusEvent.define("run.created", z.object({ taskID: Identifier.schema("task"), runID: Identifier.schema("run"), status: Run.shape.status, summary: z.string() })),
  RunUpdated: BusEvent.define("run.updated", z.object({ taskID: Identifier.schema("task"), runID: Identifier.schema("run"), status: Run.shape.status, summary: z.string() })),
  InteractionRequested: BusEvent.define("interaction.requested", z.object({ taskID: Identifier.schema("task"), runID: Identifier.schema("run").optional(), interactionID: Identifier.schema("interaction"), requestType: Interaction.shape.type, summary: z.string() })),
  InteractionResolved: BusEvent.define("interaction.resolved", z.object({ taskID: Identifier.schema("task"), runID: Identifier.schema("run").optional(), interactionID: Identifier.schema("interaction"), status: Interaction.shape.status, summary: z.string() })),
  DeliveryReady: BusEvent.define("delivery.ready", z.object({ taskID: Identifier.schema("task"), runID: Identifier.schema("run"), deliveryID: Identifier.schema("delivery"), summary: z.string() })),
  EvaluationCompleted: BusEvent.define("evaluation.completed", z.object({ taskID: Identifier.schema("task"), runID: Identifier.schema("run"), evaluationID: Identifier.schema("evaluation"), status: Evaluation.shape.status, verdict: Evaluation.shape.verdict, summary: z.string() })),
  TaskMessageRecorded: BusEvent.define("task.message", z.object({ taskID: Identifier.schema("task"), kind: TaskMessageResult.shape.kind, source: z.string(), text: z.string(), summary: z.string() })),
  RunProgress: BusEvent.define("run.progress", z.object({ taskID: Identifier.schema("task"), runID: Identifier.schema("run"), type: z.string(), summary: z.string(), payload: z.record(z.string(), z.any()).optional() })),
  RunOutput: BusEvent.define("run.output", z.object({ taskID: Identifier.schema("task"), runID: Identifier.schema("run"), type: z.string(), text: z.string() })),
  MessageInjected: BusEvent.define("message.injected", z.object({ taskID: Identifier.schema("task"), runID: Identifier.schema("run"), text: z.string(), summary: z.string() })),

  // ── MiniWorkflow events ──
  WorkflowSelected: BusEvent.define("workflow.selected", z.object({ taskID: Identifier.schema("task"), workflowID: z.string(), workflowName: z.string(), summary: z.string() })),
  WorkflowStepUpdated: BusEvent.define("workflow.step.updated", z.object({ taskID: Identifier.schema("task"), stepID: z.string(), goalID: z.string().optional(), status: z.enum(["pending", "running", "completed", "skipped", "failed"]), summary: z.string() })),
  GoalWorkflowProgress: BusEvent.define("goal.workflow.progress", z.object({ taskID: Identifier.schema("task"), goalID: Identifier.schema("goal"), completedSteps: z.number(), totalSteps: z.number(), currentStep: z.string().optional(), summary: z.string() })),

  // ── Phase-level completion events (per specs/new-arch.svg "SSE 事件扩展") ──
  // Emitted when a sub-agent finishes a major phase. The Panel uses these to
  // refresh its Requirements / Architect sections without having to track
  // individual workflow steps.
  RequirementsCompleted: BusEvent.define(
    "requirements.completed",
    z.object({
      taskID: Identifier.schema("task"),
      requirementCount: z.number(),
      goalCount: z.number(),
      decisionCount: z.number(),
      traceabilityCount: z.number(),
      fidelityScore: z.number().optional(),
      summary: z.string(),
    }),
  ),
  ArchitectCompleted: BusEvent.define(
    "architect.completed",
    z.object({
      taskID: Identifier.schema("task"),
      contractCount: z.number(),
      categories: z.array(z.string()),
      blueprintSummary: z.string().optional(),
      summary: z.string(),
    }),
  ),
}
