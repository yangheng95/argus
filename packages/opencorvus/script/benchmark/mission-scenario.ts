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

export const DEFAULT_MISSION_VERIFY_CMD = "bun test"

export const DEFAULT_MISSION_BENCHMARK_REQUEST = [
  "Run a focused Mission-mode benchmark in this scratch workspace.",
  "",
  "You are the Mission coordinator. Do not edit files yourself and do not run shell commands yourself.",
  "Use mission_state for durable state and dispatch one OpenCorvus task with panel.create_task.",
  "The dispatched task must execute this three-stage loop:",
  "",
  "1. Simple investigation: inspect the current scratch project structure and record what already exists.",
  "2. Write project: create a minimal TypeScript utility project that exposes word and character metrics.",
  "3. Project test: add Bun tests for the utility and run the project test command.",
  "",
  "The dispatched task acceptance criteria are:",
  "- Only create or modify package.json, tsconfig.json, src/text-metrics.ts, and src/text-metrics.test.ts unless the executor proves another file is strictly required.",
  "- src/text-metrics.ts exports countWords(input: string): number and countCharacters(input: string): number.",
  "- src/text-metrics.test.ts covers empty strings, whitespace, punctuation, and multibyte text.",
  "- package.json contains a test script that runs Bun tests.",
  "- The executor runs bun test and reports the result.",
  "",
  "After the task reaches a terminal state, the next Mission wake must use panel.query_task, update tasks.md, update frontier.md, and write handoff.md with the remaining status.",
].join("\n")

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
  const tasks = Array.isArray((board as { tasks?: unknown[] } | null)?.tasks)
    ? (board as { tasks: MissionBenchmarkTask[] }).tasks
    : []
  return tasks.filter((item) => missionTaskMatches(item, missionID))
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
  if (terminal.some((item) => item.evaluation?.verdict && item.evaluation.verdict !== "accepted")) {
    failures.push("at least one completed mission task was not accepted by evaluation")
  }
  if (!missionStateMentionsTerminalTasks(input.missionState, input.missionTasks)) {
    failures.push("mission state does not reconcile the terminal mission task id and status")
  }

  if (input.localVerify?.status === "completed" && input.localVerify.exitCode !== 0) {
    failures.push("local verification command failed")
  }

  return {
    verdict: failures.length === 0 ? "accepted" : "rejected",
    failures,
  }
}
