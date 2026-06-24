import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { ExecutorName } from "@/executor/contract"
import { Identifier } from "@/id/id"
import { Reply as PermissionReply } from "@/permission/types"
import { Answer as QuestionAnswer } from "@/question/types"
import { isModelReference } from "@/provider/model-ref"

export const Budget = z.object({
  maxExecutorGroups: z.number().int().positive().optional(),
})

export const ChannelBinding = z.object({
  platform: z.string(),
  channel: z.string(),
  thread: z.string(),
  payload: z.record(z.string(), z.any()).optional(),
})

const PlanningProvider = z.enum(["opencorvus", "executor"])
const EvaluationProvider = z.enum(["opencorvus", "hybrid"])

export const StageRouting = z.object({
  spec: PlanningProvider.optional(),
  plan: PlanningProvider.optional(),
  evaluation: EvaluationProvider.optional(),
})

export const GoalKind = z.enum(["bootstrap", "feature", "verification", "integration", "system"])

export const AcceptanceDiffSummary = z
  .object({
    file: z.string(),
    additions: z.number().optional(),
    deletions: z.number().optional(),
    status: z.enum(["added", "deleted", "modified"]).optional(),
  })
  .meta({
    ref: "AcceptanceDiffSummary",
  })
export type AcceptanceDiffSummary = z.infer<typeof AcceptanceDiffSummary>

import { AcceptanceSpecSchema } from "@/acceptance/types"
import { IntegrityReviewCompletedPayloadSchema } from "@/integrity/team-schema"

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
  playwright: z
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
const TaskAttachmentInput = z.object({
  /** MIME type, e.g. "image/png", "application/pdf", "audio/mpeg" */
  mime: z.string(),
  /** Base64-encoded file bytes (no data-URL prefix) */
  data: z.string(),
  /** Optional display name shown in the overlay message and LLM file part */
  filename: z.string().optional(),
})

/**
 * Persisted attachment reference. Once the bytes live in AttachmentStore
 * (`<projectDir>/.opencorvus/r/b/a/<sha>.<ext>`), every downstream layer
 * — queue table row, task loop, orchestrator, frontend-design, requirements — only
 * carries this small, URL-addressable reference. Agents that need the raw
 * bytes for multimodal LLM input read them back through AttachmentStore.
 *
 * `intent` lets evaluator gates and downstream agents consume the same
 * attachment store with different semantics. Today three intents are wired:
 *   - "visual_reference" — picked up by the deliver-time visual SSIM gate
 *     (user-uploaded screenshots, Figma frames, URL screenshots).
 *   - "design_token"     — frontend-design input only, not a verification gate.
 *   - "spec_artifact"    — generic supporting material (request docs etc).
 * Other intents may appear later (api_contract, test_fixture, …); leaving
 * the field free-form keeps that extension cheap. Missing intent defaults
 * to `visual_reference` for image MIMEs and `spec_artifact` otherwise.
 */
const TaskAttachment = z.object({
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
  model: z
    .string()
    .refine(isModelReference, {
      message: 'Model must be in the format "provider/model".',
    })
    .optional(),
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
  /** Queue preference. false starts immediately; true leaves the task queued
   *  until a later queue advance. */
  queue: z.boolean().default(false),
  /** Defaults to "workflow" (full pipeline). Pass "build" to bypass the pipeline
   *  and run the build agent directly — used for one-shot edits. */
  kind: z.enum(["workflow", "build"]).optional(),
  promptProfile: z.string().min(1).optional(),
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
  /** ID of the task that spawned this one — projected read-only from
   *  `metadata.parent_task_id` (single source of truth, no DB column).
   *  Overlay uses this to render lineage as a tree; agent panels can also
   *  see it but reconcile children via findChildrenOfTask(). */
  parentTaskID: Identifier.schema("task").nullable().optional(),
  source: z.string(),
  title: z.string(),
  request: z.string(),
  status: z.enum(["queued", "active", "completed", "failed", "cancelled"]),
  terminalReason: z.enum(["completed", "failed", "cancelled", "interrupted"]).optional(),
  priority: z.enum(["critical", "high", "normal", "low"]),
  queue: z
    .object({
      order: z.number(),
      revision: z.string().optional(),
    })
    .optional(),
  /** "workflow" — runs the full requirements→design→architect→execute→deliver pipeline.
   *  "build" — bypasses the pipeline and runs the build agent directly. Used for
   *  one-shot edits / Q&A / quick fixes. Both kinds share the same task table
   *  and queue, so cancel/list/audit are uniform. */
  kind: z.enum(["workflow", "build"]).default("workflow"),
  blockingReason: z.string().optional(),
  error: z.string().optional(),
  budget: Budget.optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  /** Persisted attachment references carried from task creation. Exposed so the
   *  overlay can render each attachment as a file part underneath the user's
   *  request bubble (images inline, other MIMEs as filename chips). */
  attachments: TaskAttachment.array().optional(),
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

const ExecutorRef = z.object({
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

export const Interaction = z.object({
  id: Identifier.schema("interaction"),
  taskID: Identifier.schema("task"),
  runID: Identifier.schema("run").nullable(),
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
  acceptanceID: Identifier.schema("acceptance").nullable().optional(),
  kind: z.enum(["patch", "changed_file", "log", "report", "image", "diff", "link", "git_ref", "pr"]),
  label: z.string(),
  payload: z.record(z.string(), z.any()).optional(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
  }),
})

export const Acceptance = z.object({
  id: Identifier.schema("acceptance"),
  taskID: Identifier.schema("task"),
  runID: Identifier.schema("run"),
  status: z.enum(["candidate", "publishing", "delivered", "failed"]),
  summary: z.string(),
  result: z.object({
    summary: z.string(),
    changedFiles: z.string().array(),
    diffs: AcceptanceDiffSummary.array(),
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
  status: z.enum(["passed", "failed", "skipped", "inconclusive"]),
  evidence: z.string().optional(),
})

export const Evaluation = z.object({
  id: Identifier.schema("evaluation"),
  taskID: Identifier.schema("task"),
  runID: Identifier.schema("run"),
  acceptanceID: Identifier.schema("acceptance").nullable().optional(),
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

const ProgressSnapshot = z.object({
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

/**
 * Live session activity for a task — surfaces pre-plan agent work (requirements /
 * architect / integrity-review / frontend-design) that would otherwise be invisible
 * because `goals` and `run` are empty until the architect finishes decomposing.
 * Derived from protocol_event + session.kind; no FSM column involved.
 */
export const ActiveSession = z.object({
  sessionID: Identifier.schema("session"),
  kind: z.string(),
  goalID: Identifier.schema("goal").nullable(),
  lastActivityMs: z.number(),
})

export const Progress = z.object({
  task: Task,
  plan: PlanVersion.optional(),
  goals: Goal.array(),
  milestones: Milestone.array().optional(),
  run: Run.optional(),
  pendingInteractions: Interaction.array(),
  acceptance: Acceptance.optional(),
  evaluation: Evaluation.optional(),
  snapshots: ProgressSnapshot.array(),
  activeSessions: ActiveSession.array(),
})

export const ReplyInteractionInput = z.object({
  reply: PermissionReply.optional(),
  autoReply: z.boolean(),
  message: z.string().optional(),
  answers: z.array(QuestionAnswer).optional(),
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

export const TaskMessageTarget = z
  .object({
    kind: z.enum(["agent_session", "build_session"]),
    sessionID: z.string().min(1),
    goalID: z.string().min(1).optional(),
  })
  .meta({
    ref: "TaskMessageTarget",
  })
export type TaskMessageTargetInput = z.infer<typeof TaskMessageTarget>

export const TaskMessageInput = z.object({
  text: z.string(),
  source: z.string().min(1),
  target: TaskMessageTarget.optional(),
  user_id: z.string().optional(),
  promptProfile: z.string().min(1).optional(),
  attachments: TaskAttachmentInput.array().optional(),
  /** Overlay bridge envelope fields. They identify how a rendered message was
   *  displayed, not what the operator asked. The task service accepts them so
   *  replay/resume clients can reuse bridge-stamped message objects, but task
   *  semantics still come only from `text`, `source`, `target`, `user_id`, and
   *  `attachments`. */
  resolvedRole: z.string().optional(),
  channel: z.string().optional(),
})

export const InjectMessageInput = z.object({
  message: z.string().min(1),
})

export const TaskMessageResult = z.object({
  kind: z.enum(["goal", "plan", "note"]),
  message: z.string(),
  should_resume: z.boolean(),
  /** The persisted user `Message` row + parts the server just wrote.
   *  Returned so the overlay can insert the real message into its store
   *  immediately (no client-side synthetic placeholder; rule 22). The
   *  subsequent SSE `message.updated` / `message.part.updated` events
   *  carry the same ids and idempotently update the same rows. Absent
   *  when the task has no session_id (e.g. failed task short-circuit). */
  user_message: z
    .object({
      info: z.any(),
      parts: z.array(z.any()),
    })
    .optional(),
})

export const TaskOperatorModelContext = z.object({
  taskID: Identifier.schema("task"),
  sessionID: Identifier.schema("session"),
  agent: z.string(),
  model: z.object({
    providerID: z.string(),
    modelID: z.string(),
  }),
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
  kind: z.enum(["resolve_blocker", "retry", "replan", "observe", "review_acceptance", "message"]),
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

// ---------------------------------------------------------------------------
// MiniWorkflow — workflow state projected to TaskBoard
// ---------------------------------------------------------------------------

export const TaskBoardWorkflowPhase = z.object({
  id: z.string(),
  label: z.string(),
  sessionKind: z.string(),
})

export const TaskBoardWorkflowStep = z.object({
  id: z.string(),
  label: z.string(),
  tool: z.string(),
  scope: z.enum(["task", "goal"]),
  skippable: z.boolean(),
  status: z.enum(["pending", "running", "completed", "skipped", "failed"]),
  /** Sub-phase definitions for steps that decompose a single tool-call
   *  into multiple internal phases (e.g. pipeline.build → plan / build /
   *  evaluate). Absent for steps that map 1:1 to a tool call. Per-goal
   *  phase status is delivered on the TaskBoardGoalWorkflowStep rows. */
  phases: TaskBoardWorkflowPhase.array().optional(),
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
  status: z.enum(["pending", "passed", "failed"]),
})

export const TaskBoardArchitect = z.object({
  summary: z.string(),
  contractCount: z.number(),
  categories: z.array(z.string()),
  decisions: z
    .array(
      z.object({
        key: z.string(),
        value: z.string(),
        reason: z.string(),
        goalID: z.string().nullable(),
      }),
    )
    .optional(),
})

export const TaskBoardGoalStepPayload = z.object({
  planNodes: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        brief: z.string(),
        orderIndex: z.number(),
        fileActions: z
          .array(
            z.object({
              path: z.string(),
              intent: z.string(),
            }),
          )
          .optional(),
        verificationCommands: z
          .array(
            z.object({
              command: z.string(),
              purpose: z.string(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
  /** The build worker session ID (SessionTable kind="build") — the LLM
   *  session that actually wrote code for this goal. Used by the overlay
   *  to surface a "jump to build session" affordance in the sidebar.
   *  Distinct from the managed-executor provider session ref, which lives
   *  on session.metadata.executor (executor/session-ref.ts). */
  buildSessionID: z.string().optional(),
  commitRef: z.string().optional(),
  changedFiles: z.array(z.string()).optional(),
  /** Per-file diff stats sourced from the goal_run acceptance row. Carries
   *  additions/deletions/status so the overlay's ChangesPanel renders
   *  +N/-N immediately from the board payload — no second `goal-run/<id>/acceptance`
   *  fetch needed (rule 22: single source for the per-file numbers).
   *  Sibling to `changedFiles`; one row per file in the same order. */
  changedFileDiffs: z
    .array(
      z.object({
        file: z.string(),
        additions: z.number(),
        deletions: z.number(),
        status: z.enum(["added", "deleted", "modified"]),
      }),
    )
    .optional(),
  diffStats: z
    .object({
      files: z.number().optional(),
      additions: z.number().optional(),
      deletions: z.number().optional(),
    })
    .optional(),
  checks: z
    .array(
      z.object({
        name: z.string(),
        status: z.string(),
        evidence: z.string().optional(),
        family: z.string().optional(),
      }),
    )
    .optional(),
  evalSummary: z.string().optional(),
  verdict: z.string().optional(),
})

export const TaskBoardGoalWorkflowStep = z.object({
  stepID: z.string(),
  label: z.string(),
  status: z.enum(["pending", "running", "completed", "skipped", "failed"]),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  /** Human-readable summary: "5 steps", "12 files", "3/4 checks" */
  summary: z.string().optional(),
  payload: TaskBoardGoalStepPayload.optional(),
  /** Per-phase status for steps that declare phases. Key = phase.id (as
   *  declared in the workflow step definition). Overlay uses this to
   *  render phase rows inside the step card and drive the per-phase
   *  terminal status on each nested session's card.
   *
   *  Absent when the step has no phases, or when no goal_run data is
   *  available yet. */
  phases: z
    .record(
      z.string(),
      z.object({
        status: z.enum(["pending", "running", "completed", "skipped", "failed"]),
        startedAt: z.number().optional(),
        completedAt: z.number().optional(),
      }),
    )
    .optional(),
})

export const TaskBoardGoalContract = z.object({
  key: z.string(),
  value: z.string(),
  reason: z.string().optional(),
})

export const TaskBoardGoalWorkflow = z.object({
  goalID: z.string(),
  goalTitle: z.string(),
  /** Authoritative goal summary written by the Architect: a 1–2 sentence
   *  execution directive for this goal. Surfaces inside the goal card
   *  header so operators see what the goal is about without opening the
   *  acceptance_specs drawer. May be longer than the title but stays
   *  single-paragraph — it is NOT the full user request, only this
   *  goal's slice of it. */
  goalObjective: z.string().optional(),
  goalStatus: z.string(),
  /** Decomposition-time position (0-based). Stable across goal removals so
   *  the overlay can display "#N" that matches the requirements breakdown
   *  operators see during planning — NOT the live array index. */
  orderIndex: z.number().int(),
  /** Per-goal worktree directory (absolute path) — set by the dispatcher
   *  when the goal first starts, reused across retries until the terminal
   *  cleanup. Surfaced here so operators can find the worktree from the
   *  overlay debug-copy flow without joining engine_goal in SQLite. */
  workspaceDir: z.string().optional(),
  /** Branch currently checked out inside `workspaceDir`. */
  workspaceBranch: z.string().optional(),
  /** Per-goal implementation version counter. Visible label uses retryCount + 1 as Vn. */
  retryCount: z.number().int(),
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
  snapshotVersion: z.string().min(1),
  task: Task,
  spec: SpecSnapshot.optional(),
  plan: PlanVersion.optional(),
  run: Run.optional(),
  acceptance: Acceptance.optional(),
  candidateAcceptance: Acceptance.optional(),
  acceptedAcceptance: Acceptance.optional(),
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
  /** Active workflow state (from task.workflow_state + WorkflowRegistry) */
  workflow: TaskBoardWorkflow.optional(),
  /** Structured requirements from Requirements Agent output */
  requirements: TaskBoardRequirement.array().optional(),
  /** Architect Agent consensus summary */
  architect: TaskBoardArchitect.optional(),
  /** Per-goal workflow groups with step-level progress */
  goalWorkflows: TaskBoardGoalWorkflow.array().optional(),
  /** Task-level rollup of every quality criterion that touched this task —
   *  per-goal evaluator outcomes, integrity acceptance review, and external
   *  quality gates (e.g. visual-diff). Persisted in engine_task.criteria_results
   *  and exposed here so acceptance and contract-audit readers use the same
   *  source. */
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
  active_sessions: ActiveSession.array(),
  pending_interactions: z.number().int(),
  pending_interaction_items: Interaction.array(),
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
  emittedAt: z.number().int().positive(),
  timestamp: z.number(),
  sequence: z.number().int().nonnegative().optional(),
  live_sequence: z.number().int().positive().optional(),
  live_epoch: z.number().int().positive().optional(),
  summary: z.string(),
  payload: z.record(z.string(), z.any()),
  notify: BusEvent.NotifyDescriptorSchema.optional(),
})

export const TaskConversationPhaseLocation = z.object({
  stepID: z.string(),
  phaseID: z.string(),
})

export const TaskConversationSessionView = z.object({
  sessionID: z.string(),
  stage: z.string(),
  parentSessionID: z.string().optional(),
  goalID: z.string().optional(),
  messageIDs: z.array(z.string()),
  lastDisplayMessageID: z.string().optional(),
  firstMessageTime: z.number(),
  lastMessageTime: z.number(),
  placement: z.enum(["top_level", "goal_phase", "hidden", "filtered"]),
  phase: TaskConversationPhaseLocation.optional(),
})

export const TaskConversationMessageView = z.object({
  messageID: z.string(),
  sessionID: z.string(),
  stage: z.string(),
  parentSessionID: z.string().optional(),
  goalID: z.string().optional(),
  time: z.number(),
  placement: z.enum(["top_level", "goal_phase", "hidden", "filtered"]),
  phase: TaskConversationPhaseLocation.optional(),
})

export const TaskConversationView = z.object({
  topLevelSessionIDs: z.array(z.string()),
  sessions: TaskConversationSessionView.array(),
  messages: TaskConversationMessageView.array(),
})

export const TaskConversationEventReplay = z.object({
  cursor: z.number().int().nonnegative(),
  latestSequence: z.number().int().nonnegative(),
  complete: z.boolean(),
  limit: z.number().int().positive(),
  sinceTimestamp: z.number().nullable().optional(),
})

export const TaskConversationHistoryState = z.object({
  oldestTimestamp: z.number().nullable(),
  oldestMessageID: z.string().nullable().optional(),
  hasMore: z.boolean(),
  limit: z.number().int().positive(),
})

export const TaskConversationHydration = z.object({
  lastSequence: z.number().int().nonnegative(),
  messageWatermark: z.number().nonnegative(),
  board: TaskBoard,
  transcript: z.array(z.any()),
  timeline: z.array(z.any()),
  events: TaskEvent.array(),
  eventReplay: TaskConversationEventReplay,
  history: TaskConversationHistoryState.optional(),
  agentView: TaskConversationView.optional(),
  view: TaskConversationView,
})

export const SessionBoardEnvelope = z.object({
  kind: z.literal("session"),
  sessionID: z.string(),
  status: z.string(),
  title: z.string().nullable().optional(),
  directory: z.string().nullable().optional(),
})

export const SessionEvent = z.object({
  event_id: z.string(),
  session_id: z.string(),
  type: z.string(),
  emittedAt: z.number().int().positive(),
  timestamp: z.number(),
  sequence: z.number().int().nonnegative().optional(),
  summary: z.string(),
  payload: z.record(z.string(), z.any()),
  notify: BusEvent.NotifyDescriptorSchema.optional(),
})

export const SessionConversationHydration = z.object({
  board: SessionBoardEnvelope,
  transcript: z.array(z.any()),
  timeline: z.array(z.any()),
  events: SessionEvent.array(),
  history: TaskConversationHistoryState.optional(),
  agentView: TaskConversationView.optional(),
  view: TaskConversationView,
})

export const TaskConversationEventPage = z.object({
  events: TaskEvent.array(),
  eventReplay: TaskConversationEventReplay,
})

export const TaskConversationHistoryPage = z.object({
  transcript: z.array(z.any()),
  timeline: z.array(z.any()),
  events: TaskEvent.array(),
  view: TaskConversationView,
  history: TaskConversationHistoryState,
})

export const AgentSessionAttachmentInput = z.object({
  mime: z.string(),
  url: z.string(),
  filename: z.string().optional(),
})

export const AgentSessionReplyInput = z.object({
  message: z.string().trim().min(1),
  attachments: AgentSessionAttachmentInput.array().default([]),
})

export const AgentSessionReplyResult = z.object({
  task_id: Identifier.schema("task"),
  session_id: Identifier.schema("session"),
  message_id: Identifier.schema("message"),
})

export const AgentSessionCancelResult = z.object({
  task_id: Identifier.schema("task"),
  session_id: Identifier.schema("session"),
  cancelled: z.literal(true),
})

/** AgentTrace event surfaced to the overlay debug panel. Shape mirrors what
 *  the trace JSONL writer persists; payload is open-ended (`record<string, any>`)
 *  because llm_request / agent_report / helper_llm_call carry different
 *  fields and the UI renders them with kind-aware components. */
export const TraceEvent = z.object({
  ts: z.number(),
  kind: z.string(),
  sessionID: z.string().optional(),
  parentSessionID: z.string().optional(),
  taskID: z.string().optional(),
  agentName: z.string().optional(),
  agentMode: z.string().optional(),
  payload: z.record(z.string(), z.any()).optional(),
})

export const TraceEventList = z.object({
  ok: z.literal(true),
  events: TraceEvent.array(),
  /** Resolved trace directory the server reads from. Surfaced so the overlay's
   *  empty state can show the operator WHICH directory was scanned — the
   *  "events:[]" failure mode otherwise hides a path mismatch (e.g. overlay
   *  bound to project root while agents wrote traces in a benchmark temp dir
   *  via OPENCORVUS_AGENT_TRACE_DIR override). */
  traceDir: z.string(),
  /** Whether AgentTrace.isEnabled() returned true. False = no traces are
   *  being written regardless of dir resolution; OPENCORVUS_AGENT_TRACE=0
   *  was set on the server process. */
  enabled: z.boolean(),
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
  acceptance_focus_score: z.number(),
})

export type AgentStageType = "assistant" | "requirements" | "spec" | "goal" | "architect" | "evaluator" | "acceptance"

export const ReviewStreamPhase = z.enum(["integrity", "acceptance"])
export const ReviewStreamStep = z.enum(["manifest", "runtime", "visual", "specialist", "agent", "post_repair"])

export const Event = {
  TaskCreated: BusEvent.define(
    "task.created",
    z.object({ taskID: Identifier.schema("task"), status: Task.shape.status, summary: z.string() }),
    { tier: 3 },
  ),
  TaskUpdated: BusEvent.define(
    "task.updated",
    z.object({ taskID: Identifier.schema("task"), status: Task.shape.status, summary: z.string() }),
    { tier: 3 },
  ),
  /** Terminal task transition events. Emitted alongside TaskUpdated when the
   *  derived status (`deriveTaskStatus`) crosses from non-terminal to one of
   *  the three terminal verbs. Consumers that surface OS-level "task
   *  succeeded / failed / cancelled" toasts (overlay, channel-runtime) read
   *  these instead of re-deriving from `task.updated.status` to avoid every
   *  consumer reimplementing the transition predicate (rule 8: single source). */
  TaskCompleted: BusEvent.define(
    "task.completed",
    z.object({ taskID: Identifier.schema("task"), status: Task.shape.status, summary: z.string() }),
    { tier: 2 },
  ),
  TaskFailed: BusEvent.define(
    "task.failed",
    z.object({
      taskID: Identifier.schema("task"),
      status: Task.shape.status,
      summary: z.string(),
      error: z.string().optional(),
    }),
    { tier: 1, badge: true },
  ),
  TaskCancelled: BusEvent.define(
    "task.cancelled",
    z.object({ taskID: Identifier.schema("task"), status: Task.shape.status, summary: z.string() }),
    { tier: 2 },
  ),
  SpecCreated: BusEvent.define(
    "spec.created",
    z.object({ taskID: Identifier.schema("task"), specID: Identifier.schema("spec"), summary: z.string() }),
  ),
  SpecUpdated: BusEvent.define(
    "spec.updated",
    z.object({
      taskID: Identifier.schema("task"),
      specID: Identifier.schema("spec"),
      status: z.string(),
      summary: z.string(),
    }),
  ),
  SpecApproved: BusEvent.define(
    "spec.approved",
    z.object({ taskID: Identifier.schema("task"), specID: Identifier.schema("spec"), summary: z.string() }),
  ),
  PlanCreated: BusEvent.define(
    "plan.created",
    z.object({ taskID: Identifier.schema("task"), planID: Identifier.schema("plan"), summary: z.string() }),
    { tier: 3 },
  ),
  PlanActivated: BusEvent.define(
    "plan.activated",
    z.object({ taskID: Identifier.schema("task"), planID: Identifier.schema("plan"), summary: z.string() }),
    { tier: 2 },
  ),
  GoalProgress: BusEvent.define(
    "goal.progress",
    z.object({ taskID: Identifier.schema("task"), goalRunID: z.string(), summary: z.string() }),
    { tier: 3 },
  ),
  GoalRunUpdated: BusEvent.define(
    "goal_run.updated",
    z.object({
      taskID: Identifier.schema("task"),
      goalRunID: Identifier.schema("goal_run"),
      goalID: Identifier.schema("goal"),
      status: z.string(),
      previousStatus: z.string(),
      summary: z.string(),
    }),
    { tier: 3 },
  ),
  GoalPassed: BusEvent.define(
    "goal.passed",
    z.object({ taskID: Identifier.schema("task"), goalID: Identifier.schema("goal"), summary: z.string() }),
    { tier: 2 },
  ),
  GoalFailed: BusEvent.define(
    "goal.failed",
    z.object({ taskID: Identifier.schema("task"), goalID: Identifier.schema("goal"), summary: z.string() }),
    { tier: 1 },
  ),
  /** User rewound the task timeline to a specific anchor event. Events
   *  with time_created > cursorTime are filtered from UI-facing queries.
   *  Overlay subscribers reload their filtered view on receipt. */
  TaskRewound: BusEvent.define(
    "task.rewound",
    z.object({
      taskID: Identifier.schema("task"),
      cursorTime: z.number().int().nonnegative(),
      anchorEventID: z.string().optional(),
      reason: z.string().optional(),
      rewindCount: z.number().int().nonnegative(),
      resetWorktree: z.boolean(),
      anchorKind: z.enum(["cursorTime", "message"]),
    }),
  ),
  MilestoneActivated: BusEvent.define(
    "milestone.activated",
    z.object({ taskID: Identifier.schema("task"), milestoneID: z.string(), summary: z.string() }),
  ),
  MilestonePassed: BusEvent.define(
    "milestone.passed",
    z.object({ taskID: Identifier.schema("task"), milestoneID: z.string(), summary: z.string() }),
  ),
  MilestoneFailed: BusEvent.define(
    "milestone.failed",
    z.object({ taskID: Identifier.schema("task"), milestoneID: z.string(), summary: z.string() }),
  ),
  RunCreated: BusEvent.define(
    "run.created",
    z.object({
      taskID: Identifier.schema("task"),
      runID: Identifier.schema("run"),
      status: Run.shape.status,
      summary: z.string(),
    }),
    { tier: 3 },
  ),
  RunUpdated: BusEvent.define(
    "run.updated",
    z.object({
      taskID: Identifier.schema("task"),
      runID: Identifier.schema("run"),
      status: Run.shape.status,
      summary: z.string(),
    }),
    { tier: 3 },
  ),
  InteractionRequested: BusEvent.define(
    "interaction.requested",
    z.object({
      taskID: Identifier.schema("task"),
      runID: Identifier.schema("run").optional(),
      interactionID: Identifier.schema("interaction"),
      requestType: Interaction.shape.type,
      summary: z.string(),
    }),
    { tier: 1, badge: true },
  ),
  InteractionResolved: BusEvent.define(
    "interaction.resolved",
    z.object({
      taskID: Identifier.schema("task"),
      runID: Identifier.schema("run").optional(),
      interactionID: Identifier.schema("interaction"),
      status: Interaction.shape.status,
      summary: z.string(),
    }),
  ),
  AcceptanceReady: BusEvent.define(
    "acceptance.ready",
    z.object({
      taskID: Identifier.schema("task"),
      runID: Identifier.schema("run"),
      acceptanceID: Identifier.schema("acceptance"),
      summary: z.string(),
    }),
  ),
  EvaluationCompleted: BusEvent.define(
    "evaluation.completed",
    z.object({
      taskID: Identifier.schema("task"),
      runID: Identifier.schema("run"),
      evaluationID: z.string(),
      status: Evaluation.shape.status,
      verdict: Evaluation.shape.verdict,
      summary: z.string(),
    }),
    (payload) =>
      payload.verdict === "rejected"
        ? { tier: 1, badge: true }
        : payload.verdict === "accepted"
          ? { tier: 2 }
          : undefined,
  ),
  TaskMessageRecorded: BusEvent.define(
    "task.message",
    z.object({
      taskID: Identifier.schema("task"),
      kind: TaskMessageResult.shape.kind,
      source: z.string(),
      target: TaskMessageTarget.optional(),
      text: z.string(),
      summary: z.string(),
      messageID: Identifier.schema("message").optional(),
    }),
    { tier: 3 },
  ),
  RunProgress: BusEvent.define(
    "run.progress",
    z.object({
      taskID: Identifier.schema("task"),
      runID: Identifier.schema("run"),
      type: z.string(),
      summary: z.string(),
      payload: z.record(z.string(), z.any()).optional(),
    }),
    { tier: 3 },
  ),
  RunOutput: BusEvent.define(
    "run.output",
    z.object({
      taskID: Identifier.schema("task"),
      runID: Identifier.schema("run"),
      type: z.string(),
      text: z.string(),
    }),
    { tier: 3 },
  ),
  MessageInjected: BusEvent.define(
    "message.injected",
    z.object({
      taskID: Identifier.schema("task"),
      runID: Identifier.schema("run"),
      text: z.string(),
      summary: z.string(),
    }),
  ),
  AgentCoordinationRequested: BusEvent.define(
    "agent.coordination.requested",
    z.object({
      taskID: Identifier.schema("task"),
      requestID: Identifier.schema("artifact"),
      sessionID: Identifier.schema("session"),
      agent: z.string(),
      blocking: z.boolean(),
      severity: z.enum(["info", "blocked", "failure"]),
      summary: z.string(),
    }),
    { tier: 2 },
  ),
  AgentCoordinationResponded: BusEvent.define(
    "agent.coordination.responded",
    z.object({
      taskID: Identifier.schema("task"),
      requestID: Identifier.schema("artifact"),
      responseID: Identifier.schema("artifact"),
      sessionID: Identifier.schema("session"),
      decision: z.enum(["continue", "cancel_worker", "redispatch", "fail_task", "ask_user"]),
      summary: z.string(),
    }),
    { tier: 2 },
  ),
  AgentCoordinationCancelled: BusEvent.define(
    "agent.coordination.cancelled",
    z.object({
      taskID: Identifier.schema("task"),
      requestID: Identifier.schema("artifact"),
      sessionID: Identifier.schema("session"),
      summary: z.string(),
    }),
    { tier: 3 },
  ),

  // ── MiniWorkflow events ──
  WorkflowSelected: BusEvent.define(
    "workflow.selected",
    z.object({
      taskID: Identifier.schema("task"),
      workflowID: z.string(),
      workflowName: z.string(),
      summary: z.string(),
    }),
    { tier: 2 },
  ),
  WorkflowStepUpdated: BusEvent.define(
    "workflow.step.updated",
    z.object({
      taskID: Identifier.schema("task"),
      stepID: z.string(),
      goalID: z.string().optional(),
      status: z.enum(["pending", "running", "completed", "skipped", "failed"]),
      summary: z.string(),
    }),
    { tier: 3 },
  ),
  GoalWorkflowProgress: BusEvent.define(
    "goal.workflow.progress",
    z.object({
      taskID: Identifier.schema("task"),
      goalID: Identifier.schema("goal"),
      completedSteps: z.number(),
      totalSteps: z.number(),
      currentStep: z.string().optional(),
      summary: z.string(),
    }),
    { tier: 3 },
  ),

  ReviewStreamStarted: BusEvent.define(
    "review.stream.started",
    z.object({
      taskID: Identifier.schema("task"),
      reviewID: z.string().min(1),
      phase: ReviewStreamPhase,
      sessionID: z.string().optional(),
    }),
    { tier: 3 },
  ),
  ReviewStreamProgress: BusEvent.define(
    "review.stream.progress",
    z.object({
      taskID: Identifier.schema("task"),
      reviewID: z.string().min(1),
      phase: ReviewStreamPhase,
      currentStep: ReviewStreamStep.optional(),
      activity: z.string().optional(),
      reviewerID: z.string().optional(),
      roundID: z.string().optional(),
      attempt: z.number(),
      elapsedMs: z.number(),
      summary: z.string().optional(),
    }),
    { tier: 3 },
  ),
  ReviewStreamChunk: BusEvent.define(
    "review.stream.chunk",
    z.object({
      taskID: Identifier.schema("task"),
      reviewID: z.string().min(1),
      phase: ReviewStreamPhase,
      kind: z.literal("reasoning"),
      delta: z.string(),
      attempt: z.number(),
    }),
    { tier: 3 },
  ),
  /** Integrity review verdict with the full structured result. Emitted once
   *  per reviewIntegrity() call after the LLM submits every dimension verdict
   *  and closes with submit_integrity_review.
   *  Carries the per-dimension breakdown (requirement_fidelity / technical_feasibility
   *  / hallucination / solution_quality) plus the cross-dimension union of
   *  issues / corrections / missing goals so the overlay can render a native
   *  verdict card. The runtime derives `verdict` from final acceptance plus
   *  per-dimension blockers: advisory-only concerns can still pass, while
   *  repair-bearing concerns, needs_correction dimensions, or rejected
   *  acceptance block completion. The LLM does NOT supply a top-level verdict.
   *  Issue rows carry optional `requirement_ids` and `spec_ids` so the overlay
   *  can chip-render REQ-N / acc-* references and downstream consumers can
   *  navigate from a fidelity issue to the failing REQ row or acceptance spec
   *  surfaced post-build by the Requirement Status Snapshot. */
  AcceptanceEvidenceUpdated: BusEvent.define(
    "acceptance.evidence.updated",
    z.object({
      taskID: Identifier.schema("task"),
      runID: Identifier.schema("run").optional(),
      acceptanceID: Identifier.schema("acceptance"),
      manifestID: Identifier.schema("artifact"),
      iteration: z.number(),
      status: z.enum(["passed", "failed"]),
      summary: z.string(),
      failedCheckCount: z.number(),
      failedReviewCount: z.number(),
      failureDetails: z.array(
        z.object({
          kind: z.enum(["readiness", "check", "coverage", "review"]),
          id: z.string(),
          name: z.string(),
          status: z.string().optional(),
          command: z.string().optional(),
          exitCode: z.number().optional(),
          evidence: z.string(),
        }),
      ),
    }),
    { tier: 3 },
  ),
  IntegrityReviewCompleted: BusEvent.define(
    "integrity.review.completed",
    IntegrityReviewCompletedPayloadSchema,
    /*
       *  session card — without it the card would escape to the top level,
       *  which the overlay explicitly forbids (see tree-writer card hierarchy
       *  rules). Required: every real integrity pass runs inside an agent
       *  session; emitting without sessionID is a backend bug that must be
       *  caught at the source (see integrity/team-agent.ts emitIntegrityEvent assertion).
      sessionID: z.string(),
      verdict: z.enum(["pass", "concerns", "needs_correction"]),
      summary: z.string(),
      dimensions: z.array(
        z.object({
          id: z.enum(["requirement_fidelity", "technical_feasibility", "hallucination", "solution_quality"]),
          verdict: z.enum(["pass", "concerns", "needs_correction"]),
          issueCount: z.number(),
          correctionCount: z.number(),
          graphCorrectionCount: z.number().optional(),
          missingGoalCount: z.number(),
        }),
      ),
      issues: z.array(
        z.object({
          type: z.string(),
          description: z.string(),
          requirement_ids: z.array(z.string()).optional(),
          spec_ids: z.array(z.string()).optional(),
        }),
      ),
      corrections: z.array(
        z.object({
          action: z.enum(["modify", "split", "remove"]),
          goalID: z.string(),
          reason: z.string(),
          updatesTitle: z.string().optional(),
          updatesObjective: z.string().optional(),
        }),
      ),
      graphCorrections: z
        .array(
          z.object({
            kind: z.string(),
            action: z.string(),
            reason: z.string(),
          }),
        )
        .optional(),
      missingGoals: z.array(
        z.object({
          title: z.string(),
          objective: z.string(),
          reason: z.string().optional(),
        }),
      ),
      acceptance: z.object({
        verdict: z.enum(["accepted", "rejected"]),
        summary: z.string(),
        startup_verification: z
          .object({
            attempted: z.boolean(),
            command: z.string().optional(),
            success: z.boolean(),
            output: z.string().optional(),
          })
          .optional(),
        frontend_check: z
          .object({
            attempted: z.boolean(),
            renders_correctly: z.boolean().optional(),
            issues: z.array(z.string()).optional(),
          })
          .optional(),
        deferred_checks: z.array(
          z.object({
            name: z.string(),
            result: z.enum(["passed", "failed", "skipped", "advisory_failed"]),
            evidence: z.string(),
          }),
        ),
        tool_call_evidence: z.array(
          z.object({
            tool: z.string(),
            passed: z.boolean(),
            detail: z.string(),
          }),
        ),
        rejection_details: z.array(
          z.object({
            goal_id: z.string().optional(),
            category: z.enum(["build", "test", "lint", "runtime", "quality", "startup", "visual"]),
            check_id: z.string().optional(),
            file: z.string().optional(),
            error: z.string(),
            suggestion: z.string().optional(),
            visual_spec_id: z.string().optional(),
          }),
        ),
        launch_command: z.string().optional(),
      }),
      attempts: z.number(),
    }),
    */
    (payload) => (payload.verdict === "pass" ? { tier: 2 } : { tier: 1, badge: true }),
  ),
}
