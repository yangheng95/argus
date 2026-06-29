import z from "zod"

export const MISSION_BENCHMARK_TITLE = "Mission Mode Triple Loop Benchmark"

export const MISSION_BENCHMARK_STAGES = [
  {
    id: "simple_investigation",
    label: "simple investigation",
    requiredText: "Simple investigation",
  },
  {
    id: "write_project",
    label: "write project",
    requiredText: "Write project",
  },
  {
    id: "project_test",
    label: "project test",
    requiredText: "Project test",
  },
] as const

export type MissionBenchmarkTask = {
  task?: {
    id?: string
    source?: string
    status?: string
    metadata?: Record<string, unknown>
  }
  evaluation?: {
    verdict?: string
    summary?: string
  }
}

const MissionBenchmarkTaskSchema = z
  .object({
    task: z
      .object({
        id: z.string().optional(),
        source: z.string().optional(),
        status: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
      .optional(),
    evaluation: z.object({ verdict: z.string().optional(), summary: z.string().optional() }).optional(),
  })
  .passthrough()

const MissionBenchmarkBoardSchema = z.object({
  tasks: z.array(MissionBenchmarkTaskSchema),
})

export type MissionBenchmarkReportInput = {
  missionID: string
  sessionID: string
  firstWakeCreated: boolean
  secondWakeCreated?: boolean
  missionState: Record<string, string>
  missionTasks: MissionBenchmarkTask[]
  localVerify?: {
    status?: string
    exitCode?: number | null
  }
}

export type MissionBenchmarkVerdict = {
  verdict: "accepted" | "rejected"
  failures: string[]
}

export function missionTaskRows(board: unknown, missionID: string): MissionBenchmarkTask[] {
  return MissionBenchmarkBoardSchema.parse(board).tasks.filter((item) => missionTaskMatches(item, missionID))
}

export function missionTaskMatches(item: MissionBenchmarkTask, missionID: string): boolean {
  const task = item.task
  if (!task) return false
  const metadata = task.metadata ?? {}
  const mission = metadata.mission
  return (
    task.source === "mission" &&
    typeof mission === "object" &&
    mission !== null &&
    (mission as { id?: unknown }).id === missionID &&
    metadata.actor === "mission"
  )
}

export function terminalMissionTasks(tasks: MissionBenchmarkTask[]): MissionBenchmarkTask[] {
  return tasks.filter((item) => {
    const status = item.task?.status
    return status === "completed" || status === "failed" || status === "cancelled"
  })
}

export function completedMissionTaskEvaluationVerdict(item: MissionBenchmarkTask): string | undefined {
  if (item.task?.status !== "completed") return undefined
  const verdict = item.evaluation?.verdict
  return typeof verdict === "string" && verdict.trim() ? verdict.trim() : undefined
}

export function missionTasksReadyForBenchmarkEvaluation(tasks: MissionBenchmarkTask[]): boolean {
  const terminal = terminalMissionTasks(tasks)
  if (tasks.length === 0 || terminal.length !== tasks.length) return false
  return terminal.every((item) => item.task?.status !== "completed" || Boolean(completedMissionTaskEvaluationVerdict(item)))
}

export function missionStateMentionsTerminalTasks(
  state: Record<string, string>,
  tasks: MissionBenchmarkTask[],
): boolean {
  const terminal = terminalMissionTasks(tasks)
  if (terminal.length === 0) return false
  const tasksText = state["tasks.md"] ?? ""
  const handoffText = state["handoff.md"] ?? ""
  return terminal.every((item) => {
    const id = item.task?.id
    const status = item.task?.status
    if (!id || !status) return false
    return (
      tasksText.includes(id) && tasksText.includes(status) && handoffText.includes(id) && handoffText.includes(status)
    )
  })
}

export function evaluateMissionBenchmarkReport(input: MissionBenchmarkReportInput): MissionBenchmarkVerdict {
  const failures: string[] = []
  if (!input.missionID) failures.push("missionID is missing")
  if (!input.sessionID) failures.push("sessionID is missing")
  if (!input.firstWakeCreated) failures.push("first /mission/wake did not create a mission")
  if (input.secondWakeCreated !== false) failures.push("second /mission/wake did not resume the same mission")

  for (const file of ["frontier.md", "tasks.md", "handoff.md", "notes.md"]) {
    if (!input.missionState[file]?.trim()) {
      failures.push(`mission state ${file} is empty`)
    }
  }

  if (input.missionTasks.length === 0) {
    failures.push("no mission-dispatched task with source=mission and metadata.mission.id was found")
  }

  const terminal = terminalMissionTasks(input.missionTasks)
  if (terminal.length === 0) {
    failures.push("no mission-dispatched task reached a terminal state")
  }
  if (terminal.some((item) => item.task?.status !== "completed")) {
    failures.push("at least one terminal mission task failed or was cancelled")
  }
  if (terminal.some((item) => item.task?.status === "completed" && !completedMissionTaskEvaluationVerdict(item))) {
    failures.push("at least one completed mission task is missing an evaluation verdict")
  }
  if (
    terminal.some(
      (item) => completedMissionTaskEvaluationVerdict(item) && completedMissionTaskEvaluationVerdict(item) !== "accepted",
    )
  ) {
    failures.push("at least one completed mission task was not accepted by evaluation")
  }
  if (!missionStateMentionsTerminalTasks(input.missionState, input.missionTasks)) {
    failures.push("mission state does not reconcile the terminal mission task id and status")
  }

  if (!input.localVerify) {
    failures.push("local verification command did not run")
  } else if (input.localVerify.status !== "completed") {
    failures.push("local verification command did not complete")
  } else if (input.localVerify.exitCode !== 0) {
    failures.push("local verification command failed")
  }

  return {
    verdict: failures.length === 0 ? "accepted" : "rejected",
    failures,
  }
}
