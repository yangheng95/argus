import { appStore } from "../store/app"
import { activeSessionID, activeTaskID, boardStore, rootTaskSessionID } from "../store/board"
import { settingsStore } from "../store/settings"
import { expertSquadCatalogRefreshToken, type ExpertSquadCatalogScope } from "./expert-squad"
import { taskOwningDirectory } from "./task-directory"

export type ExpertSquadCatalogScopeState =
  | ({ kind: "project"; directory: string } & ExpertSquadCatalogScope)
  | ({ kind: "session"; directory: string } & ExpertSquadCatalogScope)
  | { kind: "pending"; taskID: string; directory: string }
  | { kind: "unavailable" }

export function expertSquadCatalogDirectory(): string {
  if (!appStore.connected) return ""
  const taskID = activeTaskID()
  if (taskID) return taskOwningDirectory(taskID)
  return settingsStore.directory.trim()
}

export function expertSquadCatalogScope(): ExpertSquadCatalogScopeState {
  if (!appStore.connected) return { kind: "unavailable" }
  const directory = expertSquadCatalogDirectory()
  if (!directory) return { kind: "unavailable" }
  const taskID = activeTaskID()
  if (taskID) {
    if (boardStore.taskSwitching) return { kind: "pending", taskID, directory }
    const sessionID = rootTaskSessionID().trim()
    return sessionID ? { kind: "session", sessionID, directory } : { kind: "pending", taskID, directory }
  }
  const sessionID = activeSessionID().trim()
  return sessionID ? { kind: "session", sessionID, directory } : { kind: "project", directory }
}

export function expertSquadCatalogRequestKey(): string {
  const scope = expertSquadCatalogScope()
  if (scope.kind === "unavailable") return ""
  if (scope.kind === "pending") return `expert-squad:pending-task:${scope.taskID}:${scope.directory}`
  const catalogID = scope.kind === "session" ? `session:${scope.sessionID}` : "project"
  return `expert-squad:catalog:${scope.directory}:${catalogID}:${expertSquadCatalogRefreshToken()}`
}
