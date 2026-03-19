import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { ExecutorName } from "@/executor/contracts"
import { ProtocolCapabilities, ProtocolRefs, ProtocolSettings } from "@/executor/protocol"
import { Identifier } from "@/id/id"
import { PermissionNext } from "@/permission/next"
import { Question } from "@/question"
import { Snapshot } from "@/snapshot"

export const Budget = z.object({
  maxRuns: z.number().int().positive().optional(),
  maxReplans: z.number().int().nonnegative().optional(),
  maxEvaluations: z.number().int().positive().optional(),
  maxWallTimeMs: z.number().int().positive().optional(),
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
  goal: PlanningProvider.optional(),
  plan: PlanningProvider.optional(),
  evaluation: EvaluationProvider.optional(),
})

export const RequirementPriority = z.enum(["blocking", "advisory"])
export const RequirementStatus = z.enum(["pending", "satisfied", "failed"])
export const GoalKind = z.enum(["feature", "bootstrap", "integration", "migration", "verification", "system"])
export const SpecCheckScope = z.enum(["mapped_requirements", "full_spec", "both"])

export const GoalQaProfile = z.object({
  rule_selectors: z.array(z.string()).default([]),
  goal_check_prompt: z.string().optional(),
  spec_scope: SpecCheckScope.default("mapped_requirements"),
})

const GoalMetadata = z
  .object({
    check_selector: z.array(z.string()).optional(),
    goal_snapshot_id: z.string().optional(),
    title: z.string().optional(),
    objective: z.string().optional(),
    requirement_ids: z.array(z.string()).optional(),
    depends_on_goal_ids: z.array(z.string()).optional(),
    owned_paths: z.array(z.string()).optional(),
    done_definition: z.string().optional(),
    qa_profile: GoalQaProfile.optional(),
    kind: GoalKind.optional(),
  })
  .catchall(z.any())

export const RequirementInput = z.object({
  id: z.string().min(1),
  title: z.string(),
  description: z.string(),
  priority: RequirementPriority.default("blocking"),
  acceptance: z.array(z.string().min(1)).min(1),
  evidence_refs: z.array(z.string()).default([]),
  non_goals: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
})

export const GoalContractInput = z.object({
  id: z.string().optional(),
  title: z.string(),
  objective: z.string(),
  requirement_ids: z.array(z.string()).default([]),
  depends_on_goal_ids: z.array(z.string()).default([]),
  owned_paths: z.array(z.string()).default([]),
  done_definition: z.string(),
  qa_profile: GoalQaProfile,
  priority: RequirementPriority.default("blocking"),
  kind: GoalKind.default("feature"),
  source: z.enum(["spec", "system"]).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
})

export const GoalInput = z.object({
  description: z.string(),
  criteria: z.string(),
  priority: z.enum(["blocking", "advisory"]).optional(),
  source: z.enum(["spec", "system"]).optional(),
  title: z.string().optional(),
  objective: z.string().optional(),
  requirement_ids: z.array(z.string()).optional(),
  depends_on_goal_ids: z.array(z.string()).optional(),
  owned_paths: z.array(z.string()).optional(),
  done_definition: z.string().optional(),
  qa_profile: GoalQaProfile.optional(),
  kind: GoalKind.optional(),
  metadata: GoalMetadata.optional(),
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
  goal_check: z
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
      scope: SpecCheckScope.optional(),
      mode: z.enum(["soft", "strict"]).optional(),
    })
    .optional(),
  custom: z.record(z.string(), z.record(z.string(), z.any())).optional(),
  timeout_ms: z.number().int().positive().optional(),
})

export const CreateTaskInput = z.object({
  project: z.string().optional(),
  requestID: z.string().optional(),
  source: z.string().optional(),
  directory: z.string().optional(),
  executor: ExecutorName.optional(),
  title: z.string().optional(),
  request: z.string(),
  priority: z.enum(["high", "normal", "low"]).optional(),
  budget: Budget.optional(),
  checks: CheckConfig.optional(),
  routing: StageRouting.optional(),
  goals: GoalInput.array().optional(),
  milestones: MilestoneInput.array().optional(),
  channelBinding: ChannelBinding.optional(),
  promptOverride: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
})

export const Task = z.object({
  id: Identifier.schema("task"),
  projectID: z.string(),
  directory: z.string().optional(),
  sessionID: Identifier.schema("session").nullable().optional(),
  activeSpecVersionID: Identifier.schema("spec").nullable().optional(),
  activePlanVersionID: Identifier.schema("plan").nullable().optional(),
  activeRunID: Identifier.schema("run").nullable().optional(),
  requestID: z.string().optional(),
  source: z.string(),
  title: z.string(),
  request: z.string(),
  status: z.enum(["queued", "planning", "running", "blocked", "evaluating", "delivering", "completed", "failed", "cancelled"]),
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
  specSnapshotID: Identifier.schema("spec"),
  goalSnapshotID: Identifier.schema("goal_snapshot").optional(),
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
  specSnapshotID: Identifier.schema("spec"),
  goalSnapshotID: Identifier.schema("goal_snapshot").optional(),
  title: z.string(),
  objective: z.string(),
  requirementIDs: z.array(z.string()).optional(),
  dependsOnGoalIDs: z.array(z.string()).optional(),
  ownedPaths: z.array(z.string()).optional(),
  doneDefinition: z.string().optional(),
  qaProfile: GoalQaProfile.optional(),
  kind: GoalKind.optional(),
  description: z.string(),
  criteria: z.string(),
  priority: z.enum(["blocking", "advisory"]),
  source: z.enum(["spec", "system"]).default("spec"),
  status: z.enum(["pending", "passed", "failed"]),
  orderIndex: z.number().int(),
  metadata: GoalMetadata.optional(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
  }),
})

export const GoalSnapshot = z.object({
  id: Identifier.schema("goal_snapshot"),
  taskID: Identifier.schema("task"),
  specSnapshotID: Identifier.schema("spec"),
  version: z.number().int(),
  status: z.enum(["ready", "superseded"]),
  summary: z.string(),
  metadata: z.record(z.string(), z.any()).optional(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
  }),
})

export const Requirement = z.object({
  id: Identifier.schema("requirement"),
  taskID: Identifier.schema("task"),
  specSnapshotID: Identifier.schema("spec"),
  title: z.string(),
  description: z.string(),
  status: RequirementStatus,
  priority: RequirementPriority,
  acceptance: z.array(z.string()),
  evidenceRefs: z.array(z.string()).optional(),
  nonGoals: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  orderIndex: z.number().int(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
  }),
})

export const PlanNode = z.object({
  id: Identifier.schema("plan_node"),
  taskID: Identifier.schema("task"),
  planVersionID: Identifier.schema("plan"),
  kind: z.enum(["goal", "milestone", "step"]),
  goalID: Identifier.schema("goal").optional(),
  title: z.string(),
  brief: z.string(),
  dependsOnIDs: z.array(z.string()).optional(),
  orderIndex: z.number().int(),
  metadata: z.record(z.string(), z.any()).optional(),
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
  phase: z.enum(["plan", "dispatch", "evaluate", "deliver", "replan"]),
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

export const GoalRun = z.object({
  id: Identifier.schema("goal_run"),
  taskID: Identifier.schema("task"),
  goalID: Identifier.schema("goal"),
  planNodeID: Identifier.schema("plan_node").optional(),
  coordinatorRunID: Identifier.schema("run"),
  sessionID: Identifier.schema("session").optional(),
  executor: ExecutorName,
  status: z.enum(["queued", "accepted", "running", "blocked", "completed", "failed", "aborted", "superseded"]),
  retryCount: z.number().int(),
  blockingReason: z.string().optional(),
  error: z.string().optional(),
  workspaceDir: z.string().optional(),
  baseRef: z.string().optional(),
  mergeRef: z.string().optional(),
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
  goalRunID: Identifier.schema("goal_run").optional(),
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

export const ExecutorEvent = z.object({
  id: z.string(),
  executorSessionID: z.string(),
  taskID: Identifier.schema("task"),
  runID: Identifier.schema("run"),
  goalRunID: Identifier.schema("goal_run").optional(),
  sequence: z.number().int(),
  kind: z.string(),
  summary: z.string().optional(),
  refs: ProtocolRefs.optional(),
  payload: z.record(z.string(), z.any()).optional(),
  raw: z.record(z.string(), z.any()).optional(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
    observed: z.number(),
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
  goalRunID: Identifier.schema("goal_run").optional(),
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
  goalRunID: Identifier.schema("goal_run").optional(),
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

export const EvaluationGroup = z.object({
  id: z.enum(["rules", "goal_acceptance", "spec_acceptance"]),
  label: z.string(),
  status: EvaluationCheck.shape.status,
  checks: z.array(z.string()).min(1),
})

export const EvaluatorVerdict = z.enum(["accepted", "rejected", "blocked"])

export const ArtifactAudit = z.object({
  source_files_added: z.number().int().nonnegative(),
  config_files_added: z.number().int().nonnegative(),
  doc_files_added: z.number().int().nonnegative(),
  source_file_count: z.number().int().nonnegative(),
  doc_file_count: z.number().int().nonnegative(),
  non_source_churn_ratio: z.number().min(0),
  readme_proliferation_count: z.number().int().nonnegative(),
  out_of_scope_file_count: z.number().int().nonnegative(),
  scaffold_noise_count: z.number().int().nonnegative(),
  placeholder_count: z.number().int().nonnegative(),
  out_of_scope_files: z.array(z.string()),
  unmapped_files: z.array(z.string()),
  placeholder_hits: z.array(z.string()),
  duplicate_docs: z.array(z.string()),
  scaffold_expansion_flags: z.array(z.string()),
})

export const RunMetrics = z.object({
  meaningful_change_gap_ms: z.number().int().nonnegative(),
  noop_cycle_count: z.number().int().nonnegative(),
  repeat_command_ratio: z.number().min(0).max(1),
  repeat_reasoning_similarity: z.number().min(0).max(1),
  required_check_pass_rate: z.number().min(0).max(1),
  critical_check_pass_rate: z.number().min(0).max(1),
  check_relevance_score: z.number().min(0).max(1),
  verification_edit_ratio: z.number().min(0),
  feature_coverage_p0: z.number().min(0).max(1),
  scope_drift_score: z.number().min(0).max(1),
  plan_to_change_traceability: z.number().min(0).max(1),
  delivery_focus_score: z.number().min(0).max(1),
})

export const Evaluation = z.object({
  id: Identifier.schema("evaluation"),
  taskID: Identifier.schema("task"),
  runID: Identifier.schema("run"),
  goalRunID: Identifier.schema("goal_run").optional(),
  deliveryID: Identifier.schema("delivery").nullable().optional(),
  status: z.enum(["pending", "passed", "failed"]),
  verdict: z.enum(["accepted", "rejected"]),
  summary: z.string(),
  groups: EvaluationGroup.array().optional(),
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
  snapshotVersion: z.string(),
  lastSequence: z.number().int(),
  task: Task,
  spec: z.lazy(() => SpecSnapshot).optional(),
  goalSnapshot: z.lazy(() => GoalSnapshot).optional(),
  requirements: Requirement.array().optional(),
  plan: PlanVersion.optional(),
  goals: Goal.array(),
  planNodes: PlanNode.array(),
  goalRuns: GoalRun.array(),
  milestones: Milestone.array().optional(),
  run: Run.optional(),
  pendingInteractions: Interaction.array(),
  delivery: Delivery.optional(),
  evaluation: Evaluation.optional(),
  snapshots: ProgressSnapshot.array(),
})

export const TaskExport = z.object({
  task: Task,
  spec: z.lazy(() => SpecSnapshot).optional(),
  goalSnapshot: z.lazy(() => GoalSnapshot).optional(),
  requirements: Requirement.array(),
  plan: PlanVersion.optional(),
  coordinatorRun: Run.optional(),
  goals: Goal.array(),
  planNodes: PlanNode.array(),
  goalRuns: GoalRun.array(),
  milestones: Milestone.array(),
  runs: Run.array(),
  interactions: Interaction.array(),
  snapshots: ProgressSnapshot.array(),
  deliveries: Delivery.array(),
  evaluations: Evaluation.array(),
  artifacts: Artifact.array(),
})

export const ReplyInteractionInput = z.object({
  reply: PermissionNext.Reply.optional(),
  message: z.string().optional(),
  answers: z.array(Question.Answer).optional(),
})

export const RejectInteractionInput = z.object({
  message: z.string().optional(),
})

export const UpdatePreferenceInput = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
})

export const UpdateGoalInput = z.object({
  description: z.string().min(1),
  criteria: z.string().min(1),
})

export const UpdateTaskChecksInput = z.object({
  checks: CheckConfig.optional(),
})

export const UpdateTaskBudgetInput = z.object({
  budget: Budget.nullish(),
})

export const TaskAccepted = z.object({
  task_id: Identifier.schema("task"),
})

export const TaskMessageInput = z.object({
  text: z.string(),
  source: z.string().optional(),
  user_id: z.string().optional(),
})

export const InjectMessageInput = z.object({
  message: z.string().min(1),
})

export const TaskMessageResult = z.object({
  kind: z.enum(["preference", "goal", "plan", "spec", "note"]),
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

export const TaskBoardCard = z.object({
  id: z.string(),
  kind: z.enum(["goal", "goal_run", "interaction", "preference", "note", "run", "plan_hint", "spec", "plan", "milestone", "requirement", "check", "delivery", "evaluation"]),
  title: z.string(),
  detail: z.string().optional(),
  status: z.string().optional(),
  time: z.number().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
})

export const TaskBoardLane = z.object({
  id: z.string(),
  title: z.string(),
  cards: TaskBoardCard.array(),
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
  id: Identifier.schema("spec"),
  taskID: Identifier.schema("task"),
  version: z.number().int(),
  status: z.enum(["ready", "blocked", "completed", "superseded"]),
  summary: z.string(),
  content: z.string(),
  scope: z.string(),
  outOfScope: z.string().optional(),
  evidence: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
  }),
})

export const TaskBoard = z.object({
  snapshotVersion: z.string(),
  lastSequence: z.number().int(),
  task: Task,
  spec: SpecSnapshot.optional(),
  goalSnapshot: GoalSnapshot.optional(),
  requirements: Requirement.array(),
  checks: CheckConfig.optional(),
  goals: Goal.array(),
  plan: PlanVersion.optional(),
  planNodes: PlanNode.array(),
  goalRuns: GoalRun.array(),
  milestones: Milestone.array(),
  run: Run.optional(),
  delivery: Delivery.optional(),
  candidateDelivery: Delivery.optional(),
  acceptedDelivery: Delivery.optional(),
  evaluation: Evaluation.optional(),
  interactions: Interaction.array(),
  channels: TaskChannelBinding.array(),
  artifacts: Artifact.array(),
  snapshots: ProgressSnapshot.array(),
  overview: TaskBoardOverview,
  brief: z.object({
    content: z.string(),
    updated_at: z.number(),
  }),
  lanes: TaskBoardLane.array(),
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

export const ProtocolMessageKind = z.enum(["event", "command", "reply"])

export const ProtocolMessage = z.object({
  id: Identifier.schema("protocol_event"),
  taskID: Identifier.schema("task"),
  runID: Identifier.schema("run").optional(),
  goalRunID: Identifier.schema("goal_run").optional(),
  sessionID: Identifier.schema("session").optional(),
  interactionID: Identifier.schema("interaction").optional(),
  executorSessionID: z.string().optional(),
  kind: ProtocolMessageKind,
  type: z.string(),
  source: z.string(),
  target: z.string().optional(),
  correlationID: z.string().optional(),
  causationID: z.string().optional(),
  sequence: z.number().int(),
  summary: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(),
  time: z.object({
    emitted: z.number(),
    created: z.number(),
    updated: z.number(),
  }),
})

export const AgentStage = z.enum(["spec", "goal", "planner", "judge", "delivery"])
export type AgentStageType = z.infer<typeof AgentStage>
export const AgentEventKind = z.enum(["status", "message_delta", "tool_call", "tool_delta", "tool_result", "error"])
export type AgentEventKindType = z.infer<typeof AgentEventKind>

export const Event = {
  TaskCreated: BusEvent.define("orchestrator.task.created", z.object({ taskID: Identifier.schema("task"), status: Task.shape.status, summary: z.string() })),
  TaskUpdated: BusEvent.define("orchestrator.task.updated", z.object({ taskID: Identifier.schema("task"), status: Task.shape.status, summary: z.string() })),
  SpecCreated: BusEvent.define("orchestrator.spec.created", z.object({ taskID: Identifier.schema("task"), specID: Identifier.schema("spec"), summary: z.string() })),
  PlanCreated: BusEvent.define("orchestrator.plan.created", z.object({ taskID: Identifier.schema("task"), planID: Identifier.schema("plan"), summary: z.string() })),
  PlanActivated: BusEvent.define("orchestrator.plan.activated", z.object({ taskID: Identifier.schema("task"), planID: Identifier.schema("plan"), summary: z.string() })),
  GoalPassed: BusEvent.define("orchestrator.goal.passed", z.object({ taskID: Identifier.schema("task"), goalID: Identifier.schema("goal"), summary: z.string() })),
  GoalFailed: BusEvent.define("orchestrator.goal.failed", z.object({ taskID: Identifier.schema("task"), goalID: Identifier.schema("goal"), summary: z.string() })),
  MilestoneActivated: BusEvent.define("orchestrator.milestone.activated", z.object({ taskID: Identifier.schema("task"), milestoneID: z.string(), summary: z.string() })),
  MilestonePassed: BusEvent.define("orchestrator.milestone.passed", z.object({ taskID: Identifier.schema("task"), milestoneID: z.string(), summary: z.string() })),
  MilestoneFailed: BusEvent.define("orchestrator.milestone.failed", z.object({ taskID: Identifier.schema("task"), milestoneID: z.string(), summary: z.string() })),
  RunCreated: BusEvent.define("orchestrator.run.created", z.object({ taskID: Identifier.schema("task"), runID: Identifier.schema("run"), status: Run.shape.status, summary: z.string() })),
  RunUpdated: BusEvent.define("orchestrator.run.updated", z.object({ taskID: Identifier.schema("task"), runID: Identifier.schema("run"), status: Run.shape.status, summary: z.string() })),
  InteractionRequested: BusEvent.define("orchestrator.interaction.requested", z.object({ taskID: Identifier.schema("task"), runID: Identifier.schema("run"), interactionID: Identifier.schema("interaction"), requestType: Interaction.shape.type, summary: z.string() })),
  InteractionResolved: BusEvent.define("orchestrator.interaction.resolved", z.object({ taskID: Identifier.schema("task"), runID: Identifier.schema("run"), interactionID: Identifier.schema("interaction"), status: Interaction.shape.status, summary: z.string() })),
  DeliveryReady: BusEvent.define("orchestrator.delivery.ready", z.object({ taskID: Identifier.schema("task"), runID: Identifier.schema("run"), deliveryID: Identifier.schema("delivery"), summary: z.string() })),
  EvaluationCompleted: BusEvent.define("orchestrator.evaluation.completed", z.object({ taskID: Identifier.schema("task"), runID: Identifier.schema("run"), evaluationID: Identifier.schema("evaluation"), status: Evaluation.shape.status, verdict: Evaluation.shape.verdict, summary: z.string() })),
  TaskMessageRecorded: BusEvent.define("orchestrator.task.message", z.object({ taskID: Identifier.schema("task"), kind: TaskMessageResult.shape.kind, source: z.string(), text: z.string(), summary: z.string() })),
  RunProgress: BusEvent.define("orchestrator.run.progress", z.object({
    taskID: Identifier.schema("task"),
    runID: Identifier.schema("run"),
    goalRunID: Identifier.schema("goal_run").optional(),
    executorSessionID: z.string().optional(),
    type: z.string(),
    summary: z.string(),
    sourceID: z.string().optional(),
    sourceKind: z.string().optional(),
    sourceLabel: z.string().optional(),
    status: z.string().optional(),
    payload: z.record(z.string(), z.any()).optional(),
  })),
  RunOutput: BusEvent.define("orchestrator.run.output", z.object({
    taskID: Identifier.schema("task"),
    runID: Identifier.schema("run"),
    goalRunID: Identifier.schema("goal_run").optional(),
    executorSessionID: z.string().optional(),
    type: z.string(),
    text: z.string(),
    summary: z.string().optional(),
    sourceID: z.string().optional(),
    sourceKind: z.string().optional(),
    sourceLabel: z.string().optional(),
    status: z.string().optional(),
    payload: z.record(z.string(), z.any()).optional(),
  })),
  AgentUpdated: BusEvent.define("orchestrator.agent.updated", z.object({
    taskID: Identifier.schema("task"),
    runID: Identifier.schema("run").optional(),
    stage: AgentStage,
    kind: AgentEventKind,
    id: z.string().optional(),
    toolName: z.string().optional(),
    text: z.string().optional(),
    payload: z.record(z.string(), z.any()).optional(),
    summary: z.string(),
  })),
  MessageInjected: BusEvent.define("orchestrator.message.injected", z.object({ taskID: Identifier.schema("task"), runID: Identifier.schema("run"), text: z.string(), summary: z.string() })),
}
