import { mkdirSync, appendFileSync } from "fs"
import { join } from "path"
import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"

const LOGGED_TYPES = new Set([
  "orchestrator.task.created",
  "orchestrator.task.updated",
  "orchestrator.spec.created",
  "orchestrator.spec.updated",
  "orchestrator.plan.created",
  "orchestrator.plan.activated",
  "orchestrator.run.created",
  "orchestrator.run.updated",
  "orchestrator.run.progress",
  "orchestrator.run.output",
  "orchestrator.agent.updated",
  "orchestrator.interaction.requested",
  "orchestrator.interaction.resolved",
  "orchestrator.delivery.ready",
  "orchestrator.evaluation.completed",
])

export namespace OrchestratorEventLog {
  const log = Log.create({ service: "orchestrator.event-log" })
  const tasks = new Map<string, { logPath: string; startAt: number }>()

  export function init() {
    Bus.subscribeAll((event: any) => {
      const type = event?.type as string | undefined
      if (!type || !LOGGED_TYPES.has(type)) return
      const props = event.properties ?? {}
      const taskID = String(props.taskID ?? props.task_id ?? "")
      if (!taskID) return

      if (!tasks.has(taskID)) {
        try {
          const logsDir = join(Instance.directory, ".opencorvus", "logs")
          mkdirSync(logsDir, { recursive: true })
          const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")
          const logPath = join(logsDir, `${taskID}_${ts}.events.ndjson`)
          tasks.set(taskID, { logPath, startAt: Date.now() })
          log.info("task log started", { taskID, logPath })
        } catch (e) {
          log.warn("failed to init task log", { error: String(e) })
          return
        }
      }

      const task = tasks.get(taskID)!
      const entry = {
        at: new Date().toISOString(),
        elapsed_ms: Date.now() - task.startAt,
        type,
        taskID,
        runID: String(props.runID ?? props.run_id ?? ""),
        stage: String(props.stage ?? ""),
        kind: String(props.kind ?? ""),
        status: String(props.status ?? ""),
        toolName: String(props.toolName ?? ""),
        summary: String(props.summary ?? ""),
        text: String(props.text ?? ""),
        progressType: String(props.progressType ?? props.progress_type ?? props.type ?? ""),
        goalRunID: String(props.goalRunID ?? props.goal_run_id ?? ""),
      }
      try {
        appendFileSync(task.logPath, JSON.stringify(entry) + "\n", "utf-8")
      } catch (e) {
        log.warn("failed to write event log entry", { taskID, error: String(e) })
      }
    })
  }
}
