import { appStore } from "../store/app"
import { activeSessionID, activeTaskID, boardStore, rootTaskSessionID } from "../store/board"
import { settingsStore } from "../store/settings"
import { promptProfileCatalogRefreshToken, type PromptProfileCatalogScope } from "./config"
import { taskOwningDirectory } from "./task-directory"

export type PromptProfileCatalogScopeState =
  | ({ kind: "project"; directory: string } & PromptProfileCatalogScope)
  | ({ kind: "session"; directory: string } & PromptProfileCatalogScope)
  | { kind: "pending"; taskID: string; directory: string }
  | { kind: "unavailable" }

export function promptProfileCatalogDirectory(): string {
  if (!appStore.connected) return ""
  const taskID = activeTaskID()
  if (taskID) return taskOwningDirectory(taskID)
  return settingsStore.directory.trim()
}

export function promptProfileCatalogScope(): PromptProfileCatalogScopeState {
  if (!appStore.connected) return { kind: "unavailable" }
  const directory = promptProfileCatalogDirectory()
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

export function promptProfileCatalogRequestKey(): string {
  const scope = promptProfileCatalogScope()
  if (scope.kind === "unavailable") return ""
  if (scope.kind === "pending") return `prompt-profile:pending-task:${scope.taskID}:${scope.directory}`
  const catalogID = scope.kind === "session" ? `session:${scope.sessionID}` : "project"
  return `prompt-profile:catalog:${scope.directory}:${catalogID}:${promptProfileCatalogRefreshToken()}`
}
