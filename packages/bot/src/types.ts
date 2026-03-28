import type { Event } from "@opencorvus-ai/sdk/v2"
import type { BotAdapter } from "./adapter"

export interface TaskReportProperties {
  sessionID: string
  status: "progress" | "need_input" | "done" | "failed"
  summary: string
  question?: string
  next_plan?: string
  artifacts?: string[]
  error?: string
}

export interface Job {
  jobID: string
  sessionID: string
  turn: number
  status: "running" | "waiting_user"
  lastReport?: TaskReportProperties
  startedAt: number
  lastActivityAt: number
  channel: string
  thread: string
  adapter: BotAdapter
  platform: string
}

export interface SessionEntry {
  sessionId: string
  adapter: BotAdapter
  channel: string
  thread: string
}

export type ScreenAttachment = { type?: string; mime?: string; url?: string; filename?: string }
export type SessionMessagePart = { id?: string; state?: { attachments?: ScreenAttachment[] } }
export type PermissionAsked = {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
}
export const controlPlatforms = [
  "slack",
  "telegram",
  "discord",
  "feishu",
  "whatsapp",
  "googlechat",
  "msteams",
  "line",
  "matrix",
  "mattermost",
  "signal",
  "wecom",
  "dingtalk",
] as const
export type ControlPlatform = (typeof controlPlatforms)[number]
export type ChannelAttachment = {
  mime: string
  url: string
  filename?: string
}
export type ChannelResult = {
  kind: "panel_response" | "created" | "message" | "interaction" | "progress" | "task_list" | "cancelled"
  message: string
  task_id?: string
  attachments?: ChannelAttachment[]
}
export type EventPermissionAsked = Extract<Event, { type: "permission.asked" }>
export type EventSessionIdle = Extract<Event, { type: "session.idle" }>
export type EventSessionError = Extract<Event, { type: "session.error" }>
export type EventSessionStatus = Extract<Event, { type: "session.status" }>
export type EventMessageUpdated = Extract<Event, { type: "message.updated" }>
export type EventMessagePartUpdated = Extract<Event, { type: "message.part.updated" }>
export type EventOrchestratorEvaluationCompleted = Extract<Event, { type: "orchestrator.evaluation.completed" }>
export const MIRROR_PREFIX = "[opencorvus-mirror]"
export type PendingTask = {
  taskId: string
  touch: number
}

export function imageAttachment(input: ChannelAttachment) {
  if (!input.mime.startsWith("image/")) return
  const match = input.url.match(/^data:[^;]+;base64,(.+)$/)
  if (!match) return
  const buffer = Buffer.from(match[1], "base64")
  const fallback = input.mime === "image/png" ? "opencorvus-gui.png" : "opencorvus-gui.jpg"
  return {
    buffer,
    filename: input.filename ?? fallback,
  }
}

export function sameEntry(left: SessionEntry, right: SessionEntry) {
  return left.adapter.platform === right.adapter.platform &&
    left.channel === right.channel &&
    left.thread === right.thread
}
