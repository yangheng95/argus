import { OrchestratorRuntime } from "./runtime"
import { hooks } from "./state"
import { requireTask } from "./store"
import { WorkbenchService } from "@/workbench/service"

export async function getBrief(input: { taskID: string; runID?: string }) {
  if (input.runID) {
    await OrchestratorRuntime.syncRun(input.runID, hooks()).catch(() => undefined)
  } else {
    await OrchestratorRuntime.syncTask(input.taskID, hooks()).catch(() => undefined)
  }
  const task = requireTask(input.taskID)
  return WorkbenchService.compileBrief({
    taskID: task.id,
    runID: input.runID ?? task.active_run_id ?? undefined,
    planVersionID: task.active_plan_version_id ?? undefined,
    sessionID: task.session_id ?? undefined,
  })
}

export async function getBoard(taskID: string, input?: { sync?: boolean }) {
  if (input?.sync !== false) {
    await OrchestratorRuntime.syncTask(taskID, hooks()).catch(() => undefined)
  }
  return WorkbenchService.compileBoard({ taskID })
}

export async function getBoardTag(taskID: string, input?: { sync?: boolean }) {
  if (input?.sync !== false) {
    await OrchestratorRuntime.syncTask(taskID, hooks()).catch(() => undefined)
  }
  return WorkbenchService.boardTag({ taskID })
}
