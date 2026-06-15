import { getServerUrl } from "../services/api"
import type { MissionRecord } from "../services/mission"
import type { BoardSource } from "../store/board"
import type { CardTreeStore } from "../store/card-tree"

/** Format a millisecond timestamp for copyable debug blobs. */
export function formatDebugTime(ms: unknown): string {
  const n = typeof ms === "number" ? ms : Number(ms)
  if (!Number.isFinite(n) || n <= 0) return "-"
  return new Date(n)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, "Z")
}

function debugGoalBoardFiles(gw: any): string {
  const steps = Array.isArray(gw?.steps) ? gw.steps : []
  let changedFiles = 0
  let changedFileDiffs = 0
  const commitRefs = new Set<string>()
  let statFiles: number | undefined
  let additions: number | undefined
  let deletions: number | undefined
  for (const step of steps) {
    const payload = step?.payload
    if (!payload || typeof payload !== "object") continue
    if (Array.isArray(payload.changedFiles)) changedFiles += payload.changedFiles.length
    if (Array.isArray(payload.changedFileDiffs)) changedFileDiffs += payload.changedFileDiffs.length
    if (typeof payload.commitRef === "string" && payload.commitRef.trim()) commitRefs.add(payload.commitRef.trim())
    const stats = payload.diffStats
    if (stats && typeof stats === "object") {
      if (typeof stats.files === "number") statFiles = (statFiles ?? 0) + stats.files
      if (typeof stats.additions === "number") additions = (additions ?? 0) + stats.additions
      if (typeof stats.deletions === "number") deletions = (deletions ?? 0) + stats.deletions
    }
  }
  const statText = statFiles === undefined ? "-" : `${statFiles} files, +${additions ?? 0}/-${deletions ?? 0}`
  return `changedFiles=${changedFiles}; changedFileDiffs=${changedFileDiffs}; commits=${commitRefs.size ? Array.from(commitRefs).join(",") : "none"}; diffStats=${statText}`
}

export function buildTaskDebugBlob(board: any): string {
  const task = board?.task
  const id = typeof task?.id === "string" ? task.id : ""
  if (!id) return ""
  const taskDirectory = String(task?.directory ?? "-")
  const serverUrl = getServerUrl()
  const goalWorkflows: any[] = Array.isArray(board?.goalWorkflows) ? board.goalWorkflows : []
  const lines: string[] = []
  const push = (...l: string[]) => lines.push(...l)

  push(
    `# Task Debug Info (double-click 任务 → clipboard)`,
    `# Generated: ${formatDebugTime(Date.now())}`,
    ``,
    `task.id:        ${id}`,
    `task.title:     ${String(task?.title ?? "-")}`,
    `task.status:    ${String(task?.status ?? "-")}`,
    `task.directory: ${taskDirectory}`,
    `server.url:     ${serverUrl}`,
    `task.session:   ${String(task?.sessionID ?? "-")}`,
    `task.run.id:    ${String(task?.activeRunID ?? "-")}`,
    `task.time.created: ${formatDebugTime(task?.time?.created)}`,
    `task.time.updated: ${formatDebugTime(task?.time?.updated ?? task?.time?.created)}`,
    ``,
    `Goals (${goalWorkflows.length}):`,
  )
  if (goalWorkflows.length === 0) {
    push(`  (none - task has not produced goals yet)`)
  } else {
    for (const gw of goalWorkflows) {
      const gid = String(gw?.goalID ?? "?")
      const n = typeof gw?.orderIndex === "number" ? gw.orderIndex + 1 : "?"
      push(
        `  #${n}  ${gid}  ${String(gw?.goalStatus ?? "?")}  ${String(gw?.goalTitle ?? "").slice(0, 80)}`,
        `      retry:     ${gw?.retryCount ?? 0}`,
        `      workspace: ${String(gw?.workspaceDir ?? "-")}`,
        `      branch:    ${String(gw?.workspaceBranch ?? "-")}`,
        `      files:     ${debugGoalBoardFiles(gw)}`,
      )
    }
  }
  return lines.join("\n")
}

export function buildMissionDebugBlob(mission: MissionRecord): string {
  const lines: string[] = []
  const push = (...l: string[]) => lines.push(...l)
  const taskStats = mission.taskStats
  const tasks = Array.isArray(mission.tasks) ? mission.tasks : []
  push(
    `# Mission Debug Info (double-click mission → clipboard)`,
    `# Generated: ${formatDebugTime(Date.now())}`,
    ``,
    `mission.id:        ${mission.missionID}`,
    `mission.title:     ${mission.title || "-"}`,
    `mission.directory: ${mission.directory || "-"}`,
    `server.url:        ${getServerUrl()}`,
    `mission.session:   ${mission.sessionID}`,
    `mission.time.created: ${formatDebugTime(mission.created)}`,
    `mission.time.updated: ${formatDebugTime(mission.updated)}`,
    ``,
    `Task counts:`,
    `  total:     ${taskStats.total}`,
    `  queued:    ${taskStats.queued}`,
    `  active:    ${taskStats.active}`,
    `  completed: ${taskStats.completed}`,
    `  failed:    ${taskStats.failed}`,
    `  cancelled: ${taskStats.cancelled}`,
    ``,
    `Tasks (${tasks.length}):`,
  )
  if (tasks.length === 0) {
    push(`  (none)`)
  } else {
    for (const task of tasks) {
      push(
        `  ${task.id}  ${task.status}/${task.executionStatus}  ${task.title || "-"}`,
        `      directory: ${task.directory || mission.directory || "-"}`,
        `      updated:   ${formatDebugTime(task.updated)}`,
      )
    }
  }
  return lines.join("\n")
}

export function buildChatDebugBlob(board: any, source: BoardSource | null, cardTree: CardTreeStore): string {
  if (source?.kind !== "session") return ""
  const boardSessionID = typeof board?.sessionID === "string" ? board.sessionID : ""
  const sessionID = boardSessionID || source.id
  if (!sessionID) return ""
  const cards = Object.values(cardTree.cards)
  const counts = cards.reduce(
    (acc, card) => {
      acc.total += 1
      acc[card.kind] = (acc[card.kind] ?? 0) + 1
      return acc
    },
    { total: 0 } as Record<string, number>,
  )
  return [
    `# Chat Debug Info (double-click chat → clipboard)`,
    `# Generated: ${formatDebugTime(Date.now())}`,
    ``,
    `chat.session:   ${sessionID}`,
    `chat.title:     ${String(board?.title ?? "-")}`,
    `chat.status:    ${String(board?.status ?? "-")}`,
    `chat.directory: ${String(board?.directory ?? "-")}`,
    `server.url:     ${getServerUrl()}`,
    `selected.source: ${source.kind}:${source.id}`,
    ``,
    `Cards:`,
    `  top.level: ${cardTree.order.length}`,
    `  total:     ${counts.total}`,
    `  agents:    ${counts.agent ?? 0}`,
    `  messages:  ${counts.message ?? 0}`,
    `  tools:     ${counts.tool ?? 0}`,
    `  steps:     ${counts.step ?? 0}`,
    `  phases:    ${counts.phase ?? 0}`,
  ].join("\n")
}

export async function writeDebugClipboard(text: string): Promise<void> {
  if (!text) throw new Error("debug clipboard text is empty")
  if (!navigator.clipboard?.writeText) throw new Error("navigator.clipboard.writeText is unavailable")
  await navigator.clipboard.writeText(text)
}
