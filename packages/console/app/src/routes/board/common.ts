import { query } from "@solidjs/router"
import z from "zod"

export const BoardCard = z.object({
  id: z.string(),
  kind: z.enum(["goal", "interaction", "preference", "note", "run", "plan_hint"]),
  title: z.string(),
  detail: z.string().optional(),
  status: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const BoardLane = z.object({
  id: z.string(),
  title: z.string(),
  cards: BoardCard.array(),
})

const Task = z.object({
  id: z.string(),
  projectID: z.string(),
  sessionID: z.string().optional(),
  activePlanVersionID: z.string().optional(),
  activeRunID: z.string().optional(),
  source: z.string(),
  title: z.string(),
  request: z.string(),
  status: z.string(),
  priority: z.string(),
  blockingReason: z.string().optional(),
  error: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
    started: z.number().optional(),
    completed: z.number().optional(),
  }),
})

const Plan = z.object({
  id: z.string(),
  taskID: z.string(),
  version: z.number(),
  status: z.string(),
  summary: z.string(),
  prompt: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
  }),
})

const Run = z.object({
  id: z.string(),
  taskID: z.string(),
  planVersionID: z.string().optional(),
  sessionID: z.string().optional(),
  executor: z.string(),
  status: z.string(),
  phase: z.string(),
  blockingReason: z.string().optional(),
  error: z.string().optional(),
  retryCount: z.number(),
  executorRef: z
    .object({
      sessionID: z.string().optional(),
      queueTaskID: z.string().optional(),
    })
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
    started: z.number().optional(),
    completed: z.number().optional(),
  }),
})

export const TaskBoard = z.object({
  task: Task,
  plan: Plan.optional(),
  run: Run.optional(),
  brief: z.object({
    content: z.string(),
    updated_at: z.number(),
  }),
  lanes: BoardLane.array(),
})
export type TaskBoardInfo = z.infer<typeof TaskBoard>

export const TaskMessageInput = z.object({
  text: z.string().trim().min(1),
  source: z.string().optional(),
  user_id: z.string().optional(),
})

export const TaskMessageResult = z.object({
  kind: z.enum(["preference", "goal", "plan", "note"]),
  message: z.string(),
  should_resume: z.boolean(),
})
export type TaskMessageInfo = z.infer<typeof TaskMessageResult>

function upstream() {
  const value = process.env.OPENCORVUS_BOARD_URL ?? process.env.OPENCORVUS_SERVER_URL ?? "http://127.0.0.1:7878"
  return value.endsWith("/") ? value : `${value}/`
}

function auth() {
  const headers = new Headers()
  const password = process.env.OPENCORVUS_SERVER_PASSWORD
  if (!password) return headers
  const username = process.env.OPENCORVUS_SERVER_USERNAME ?? "opencorvus"
  headers.set("authorization", `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`)
  return headers
}

function endpoint(path: string, directory?: string) {
  const url = new URL(path.replace(/^\/+/, ""), upstream())
  if (directory) url.searchParams.set("directory", directory)
  return url
}

export async function getTaskBoard(taskID: string, directory?: string) {
  const headers = auth()
  headers.set("accept", "application/json")
  const response = await fetch(endpoint(`task/${taskID}/board`, directory), {
    headers,
  })
  if (!response.ok) throw new Error(`Failed to load task board (${response.status})`)
  return TaskBoard.parse(await response.json())
}

export async function postTaskMessage(taskID: string, input: z.infer<typeof TaskMessageInput>, directory?: string) {
  const headers = auth()
  headers.set("accept", "application/json")
  headers.set("content-type", "application/json")
  const response = await fetch(endpoint(`task/${taskID}/message`, directory), {
    method: "POST",
    headers,
    body: JSON.stringify(TaskMessageInput.parse(input)),
  })
  if (!response.ok) throw new Error(`Failed to submit task message (${response.status})`)
  return TaskMessageResult.parse(await response.json())
}

export const queryTaskBoard = query(async (taskID: string, directory?: string) => {
  "use server"
  return getTaskBoard(taskID, directory)
}, "orchestrator.task.board")
