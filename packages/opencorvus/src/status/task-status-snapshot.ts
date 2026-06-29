import z from "zod"
import { TaskBoard } from "@/engine/model"

export const StatusSnapshotState = z.enum(["success", "failed", "running"])

export const StatusProgress = z.object({
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  percent: z.number().min(0).max(100),
})

const WorkflowStepRawStatus = z.enum(["pending", "running", "completed", "skipped", "failed", "aborted"])
type StepStatus = z.infer<typeof WorkflowStepRawStatus>

export const TaskStatusWorkflowStep = z.object({
  id: z.string(),
  label: z.string(),
  scope: z.enum(["task", "goal"]),
  tool: z.string(),
  status: StatusSnapshotState,
  rawStatus: WorkflowStepRawStatus,
})

export const TaskStatusGoalStep = z.object({
  stepID: z.string(),
  label: z.string(),
  status: StatusSnapshotState,
  rawStatus: WorkflowStepRawStatus,
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  summary: z.string().optional(),
  phases: z
    .array(
      z.object({
        phaseID: z.string(),
        status: StatusSnapshotState,
        rawStatus: WorkflowStepRawStatus,
        startedAt: z.number().optional(),
        completedAt: z.number().optional(),
      }),
    )
    .optional(),
})

export const TaskStatusGoalDetail = z.object({
  goalID: z.string(),
  title: z.string(),
  objective: z.string().optional(),
  status: StatusSnapshotState,
  rawStatus: z.string(),
  orderIndex: z.number().int(),
  priority: z.enum(["blocking", "advisory"]),
  progress: StatusProgress,
  steps: TaskStatusGoalStep.array(),
})

export const TaskStatusDetail = z.object({
  taskID: z.string(),
  title: z.string(),
  status: StatusSnapshotState,
  lifecycleStatus: z.enum(["queued", "active", "completed", "failed", "cancelled"]),
  source: z.string(),
  priority: z.enum(["critical", "high", "normal", "low"]),
  directory: z.string().optional(),
  error: z.string().optional(),
  progress: StatusProgress,
  workflow: z
    .object({
      id: z.string(),
      name: z.string(),
      steps: TaskStatusWorkflowStep.array(),
    })
    .optional(),
  goals: TaskStatusGoalDetail.array(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
    started: z.number().optional(),
    completed: z.number().optional(),
  }),
})

export const MissionTaskCounts = z.object({
  total: z.number().int().nonnegative(),
  success: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
})

export const MissionStatusSnapshot = z.object({
  missionID: z.string(),
  sessionID: z.string(),
  title: z.string(),
  directory: z.string(),
  status: StatusSnapshotState,
  taskCounts: MissionTaskCounts,
  progress: StatusProgress,
  tasks: TaskStatusDetail.array(),
  generatedAt: z.number(),
})

export type StatusSnapshotState = z.infer<typeof StatusSnapshotState>
export type TaskStatusDetail = z.infer<typeof TaskStatusDetail>
export type MissionStatusSnapshot = z.infer<typeof MissionStatusSnapshot>

type ProgressInput = Array<{ rawStatus: StepStatus }>

const TaskStatusBoardProjection = z
  .object({
    task: TaskBoard.shape.task,
    workflow: TaskBoard.shape.workflow.optional(),
    goalWorkflows: TaskBoard.shape.goalWorkflows.optional(),
  })
  .passthrough()

function statusFromWorkflowStep(rawStatus: StepStatus): StatusSnapshotState {
  if (rawStatus === "failed" || rawStatus === "aborted") return "failed"
  if (rawStatus === "completed" || rawStatus === "skipped") return "success"
  return "running"
}

export function statusFromTaskLifecycle(
  rawStatus: "queued" | "active" | "completed" | "failed" | "cancelled",
): StatusSnapshotState {
  if (rawStatus === "completed") return "success"
  if (rawStatus === "failed" || rawStatus === "cancelled") return "failed"
  return "running"
}

function progressFromSteps(
  steps: ProgressInput,
  lifecycleStatus?: StatusSnapshotState,
): z.infer<typeof StatusProgress> {
  if (steps.length === 0) {
    const completed = lifecycleStatus === "success" ? 1 : 0
    const failed = lifecycleStatus === "failed" ? 1 : 0
    const running = lifecycleStatus === "running" ? 1 : 0
    return StatusProgress.parse({
      total: 1,
      completed,
      failed,
      running,
      pending: 0,
      percent: completed === 1 ? 100 : 0,
    })
  }

  const stats = steps.reduce(
    (acc, step) => {
      if (step.rawStatus === "completed" || step.rawStatus === "skipped") acc.completed += 1
      else if (step.rawStatus === "failed" || step.rawStatus === "aborted") acc.failed += 1
      else if (step.rawStatus === "running") acc.running += 1
      else acc.pending += 1
      return acc
    },
    { completed: 0, failed: 0, running: 0, pending: 0 },
  )
  return StatusProgress.parse({
    total: steps.length,
    ...stats,
    percent: Math.round((stats.completed / steps.length) * 100),
  })
}

function progressFromSnapshotStates(states: StatusSnapshotState[]): z.infer<typeof StatusProgress> {
  const stats = states.reduce(
    (acc, status) => {
      if (status === "success") acc.completed += 1
      else if (status === "failed") acc.failed += 1
      else acc.running += 1
      return acc
    },
    { completed: 0, failed: 0, running: 0, pending: 0 },
  )
  return StatusProgress.parse({
    total: states.length,
    ...stats,
    percent: states.length === 0 ? 0 : Math.round((stats.completed / states.length) * 100),
  })
}

function statusFromProgress(progress: z.infer<typeof StatusProgress>, lifecycleStatus?: StatusSnapshotState) {
  if (progress.failed > 0) return "failed"
  if (progress.completed === progress.total) return "success"
  return lifecycleStatus ?? "running"
}

function goalStatusFromRaw(rawStatus: string, progress: z.infer<typeof StatusProgress>): StatusSnapshotState {
  if (rawStatus === "passed" || rawStatus === "completed") return "success"
  if (rawStatus === "failed" || progress.failed > 0) return "failed"
  if (progress.completed === progress.total) return "success"
  return "running"
}

export function taskStatusDetailFromBoard(input: unknown): TaskStatusDetail {
  const board = TaskStatusBoardProjection.parse(input)
  const workflowSteps =
    board.workflow?.steps.map((step) => {
      const rawStatus = WorkflowStepRawStatus.parse(step.status)
      return TaskStatusWorkflowStep.parse({
        id: step.id,
        label: step.label,
        scope: step.scope,
        tool: step.tool,
        status: statusFromWorkflowStep(rawStatus),
        rawStatus,
      })
    }) ?? []

  const goals = (board.goalWorkflows ?? []).map((goal) => {
    const steps = goal.steps.map((step) => {
      const rawStatus = WorkflowStepRawStatus.parse(step.status)
      return TaskStatusGoalStep.parse({
        stepID: step.stepID,
        label: step.label,
        status: statusFromWorkflowStep(rawStatus),
        rawStatus,
        startedAt: step.startedAt,
        completedAt: step.completedAt,
        summary: step.summary,
        phases: step.phases
          ? Object.entries(step.phases).map(([phaseID, phase]) => {
              const phaseRawStatus = WorkflowStepRawStatus.parse(phase.status)
              return {
                phaseID,
                status: statusFromWorkflowStep(phaseRawStatus),
                rawStatus: phaseRawStatus,
                startedAt: phase.startedAt,
                completedAt: phase.completedAt,
              }
            })
          : undefined,
      })
    })
    const progress = progressFromSteps(steps)
    return TaskStatusGoalDetail.parse({
      goalID: goal.goalID,
      title: goal.goalTitle,
      objective: goal.goalObjective,
      status: goalStatusFromRaw(goal.goalStatus, progress),
      rawStatus: goal.goalStatus,
      orderIndex: goal.orderIndex,
      priority: goal.priority,
      progress,
      steps,
    })
  })

  const lifecycleStatus = statusFromTaskLifecycle(board.task.status)
  const taskStepInputs = [
    ...workflowSteps.map((step) => ({ rawStatus: step.rawStatus })),
    ...goals.flatMap((goal) => goal.steps.map((step) => ({ rawStatus: step.rawStatus }))),
  ]
  const progress = progressFromSteps(taskStepInputs, lifecycleStatus)
  return TaskStatusDetail.parse({
    taskID: board.task.id,
    title: board.task.title,
    status: statusFromProgress(progress, lifecycleStatus),
    lifecycleStatus: board.task.status,
    source: board.task.source,
    priority: board.task.priority,
    directory: board.task.directory,
    error: board.task.error,
    progress,
    workflow: board.workflow
      ? {
          id: board.workflow.id,
          name: board.workflow.name,
          steps: workflowSteps,
        }
      : undefined,
    goals,
    time: board.task.time,
  })
}

export function missionStatusSnapshot(input: {
  missionID: string
  sessionID: string
  title: string
  directory: string
  tasks: TaskStatusDetail[]
  generatedAt?: number
}): MissionStatusSnapshot {
  const taskCounts = input.tasks.reduce(
    (counts, task) => {
      counts.total += 1
      counts[task.status] += 1
      return counts
    },
    { total: 0, success: 0, failed: 0, running: 0 },
  )
  const progress = progressFromSnapshotStates(input.tasks.map((task) => task.status))
  const status: StatusSnapshotState =
    taskCounts.failed > 0
      ? "failed"
      : taskCounts.total > 0 && taskCounts.success === taskCounts.total
        ? "success"
        : "running"

  return MissionStatusSnapshot.parse({
    missionID: input.missionID,
    sessionID: input.sessionID,
    title: input.title,
    directory: input.directory,
    status,
    taskCounts,
    progress,
    tasks: input.tasks,
    generatedAt: input.generatedAt ?? Date.now(),
  })
}
