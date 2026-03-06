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

const Interaction = z.object({
  id: z.string(),
  taskID: z.string(),
  runID: z.string(),
  sessionID: z.string().optional(),
  externalID: z.string(),
  type: z.enum(["permission", "question"]),
  status: z.string(),
  title: z.string(),
  body: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(),
  response: z.record(z.string(), z.unknown()).optional(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
    resolved: z.number().optional(),
  }),
})

const Artifact = z.object({
  id: z.string(),
  taskID: z.string(),
  runID: z.string(),
  deliveryID: z.string().optional(),
  kind: z.string(),
  label: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
  }),
})

const Delivery = z.object({
  id: z.string(),
  taskID: z.string(),
  runID: z.string(),
  status: z.string(),
  summary: z.string(),
  result: z.object({
    summary: z.string(),
    changedFiles: z.array(z.string()),
    diffs: z.array(z.record(z.string(), z.unknown())),
  }),
  time: z.object({
    created: z.number(),
    updated: z.number(),
  }),
})

const Evaluation = z.object({
  id: z.string(),
  taskID: z.string(),
  runID: z.string(),
  deliveryID: z.string().optional(),
  status: z.string(),
  verdict: z.string(),
  summary: z.string(),
  checks: z.array(
    z.object({
      name: z.string(),
      status: z.string(),
      evidence: z.string().optional(),
    }),
  ),
  time: z.object({
    created: z.number(),
    updated: z.number(),
    completed: z.number().optional(),
  }),
})

const ProgressSnapshot = z.object({
  id: z.string(),
  taskID: z.string(),
  status: z.string(),
  summary: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
  }),
})

export const TaskBoard = z.object({
  task: Task,
  plan: Plan.optional(),
  run: Run.optional(),
  delivery: Delivery.optional(),
  evaluation: Evaluation.optional(),
  interactions: Interaction.array(),
  artifacts: Artifact.array(),
  snapshots: ProgressSnapshot.array(),
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

export const ProjectInfo = z.object({
  id: z.string(),
  worktree: z.string(),
  name: z.string().optional(),
})
export type ProjectInfoItem = z.infer<typeof ProjectInfo>

export const ProjectTaskSummary = z.object({
  task: Task,
  plan: Plan.optional(),
  run: Run.optional(),
  evaluation: Evaluation.optional(),
  pending_interactions: z.number().int(),
  updated_at: z.number(),
})

export const ProjectBoard = z.object({
  project: z.object({
    id: z.string(),
    name: z.string().optional(),
    worktree: z.string(),
  }),
  summary: z.object({
    total_tasks: z.number().int(),
    open_tasks: z.number().int(),
    running_tasks: z.number().int(),
    blocked_tasks: z.number().int(),
    completed_tasks: z.number().int(),
    failed_tasks: z.number().int(),
    cancelled_tasks: z.number().int(),
    median_completion_ms: z.number().int().optional(),
  }),
  tasks: ProjectTaskSummary.array(),
})
export type ProjectBoardInfo = z.infer<typeof ProjectBoard>

export const CreateTaskRequest = z.object({
  directory: z.string(),
  title: z.string().optional(),
  request: z.string().trim().min(1),
  priority: z.enum(["high", "normal", "low"]).optional(),
  requestID: z.string().optional(),
  mirror_to_slack: z.boolean().optional(),
  slack_channel: z.string().optional(),
})

export const CreateTaskResult = z.object({
  task_id: z.string(),
})

export const ReplyInteractionInput = z.object({
  interaction_id: z.string(),
  directory: z.string(),
  reply: z.enum(["once", "always"]).optional(),
  message: z.string().optional(),
  answers: z.array(z.array(z.string())).optional(),
})

export const RejectInteractionInput = z.object({
  interaction_id: z.string(),
  directory: z.string(),
  message: z.string().optional(),
})

export const SessionMessage = z.object({
  info: z.object({
    id: z.string(),
    role: z.string(),
    sessionID: z.string(),
    parentID: z.string().optional(),
    time: z
      .object({
        created: z.number(),
        completed: z.number().optional(),
      })
      .optional(),
  }),
  parts: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
    }).passthrough(),
  ),
})

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

export async function getProjects() {
  const response = await fetch(endpoint("project"), {
    headers: auth(),
  })
  if (!response.ok) throw new Error(`Failed to load projects (${response.status})`)
  return ProjectInfo.array().parse(await response.json())
}

export async function getProjectBoard(directory?: string) {
  const response = await fetch(endpoint("tasks", directory), {
    headers: auth(),
  })
  if (!response.ok) throw new Error(`Failed to load project tasks (${response.status})`)
  return ProjectBoard.parse(await response.json())
}

export async function createTask(input: z.infer<typeof CreateTaskRequest>) {
  const body = CreateTaskRequest.parse(input)
  const slackChannel = body.slack_channel || process.env.SLACK_CHANNEL_ID || undefined
  const response = await fetch(endpoint("task", body.directory), {
    method: "POST",
    headers: (() => {
      const headers = auth()
      headers.set("content-type", "application/json")
      headers.set("accept", "application/json")
      return headers
    })(),
    body: JSON.stringify({
      source: "console",
      title: body.title,
      request: body.request,
      priority: body.priority,
      requestID: body.requestID,
      channelBinding: body.mirror_to_slack && slackChannel
        ? {
            platform: "slack",
            channel: slackChannel,
            thread: "pending",
          }
        : undefined,
    }),
  })
  if (!response.ok) throw new Error(`Failed to create task (${response.status})`)
  return CreateTaskResult.parse(await response.json())
}

export async function replyInteraction(input: z.infer<typeof ReplyInteractionInput>) {
  const body = ReplyInteractionInput.parse(input)
  const response = await fetch(endpoint(`interaction/${body.interaction_id}/reply`, body.directory), {
    method: "POST",
    headers: (() => {
      const headers = auth()
      headers.set("content-type", "application/json")
      headers.set("accept", "application/json")
      return headers
    })(),
    body: JSON.stringify({
      reply: body.reply,
      message: body.message,
      answers: body.answers,
    }),
  })
  if (!response.ok) throw new Error(`Failed to reply interaction (${response.status})`)
  return response.json()
}

export async function rejectInteraction(input: z.infer<typeof RejectInteractionInput>) {
  const body = RejectInteractionInput.parse(input)
  const response = await fetch(endpoint(`interaction/${body.interaction_id}/reject`, body.directory), {
    method: "POST",
    headers: (() => {
      const headers = auth()
      headers.set("content-type", "application/json")
      headers.set("accept", "application/json")
      return headers
    })(),
    body: JSON.stringify({
      message: body.message,
    }),
  })
  if (!response.ok) throw new Error(`Failed to reject interaction (${response.status})`)
  return response.json()
}

export async function getTaskSession(taskID: string, directory?: string) {
  const taskHeaders = auth()
  taskHeaders.set("accept", "application/json")
  const taskResponse = await fetch(endpoint(`task/${taskID}`, directory), {
    headers: taskHeaders,
  })
  if (!taskResponse.ok) throw new Error(`Failed to load task (${taskResponse.status})`)
  const task = Task.parse(await taskResponse.json())
  if (!task.sessionID) return []
  const response = await fetch(endpoint(`session/${task.sessionID}/message`, directory), {
    headers: taskHeaders,
  })
  if (!response.ok) throw new Error(`Failed to load session messages (${response.status})`)
  return SessionMessage.array().parse(await response.json())
}

export const queryTaskBoard = query(async (taskID: string, directory?: string) => {
  "use server"
  return getTaskBoard(taskID, directory)
}, "orchestrator.task.board")
