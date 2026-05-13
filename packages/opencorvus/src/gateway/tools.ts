import z from "zod"
import { EngineService } from "@/task-api"
import { Question } from "@/question"
import { writeCwd } from "./cwd-state"

type ToolLike<P extends z.ZodType, R> = {
  parameters: P
  execute(input: z.input<P>, ctx?: unknown): Promise<R>
}

function tool<P extends z.ZodType, R>(parameters: P, execute: (input: z.output<P>) => Promise<R>): ToolLike<P, R> {
  return {
    parameters,
    async execute(input) {
      return execute(parameters.parse(input))
    },
  }
}

export function createGatewayTools(input: { sessionID: string; defaultCwd: string }) {
  return {
    enqueue_task: tool(
      z.object({
        request: z.string().min(1),
        title: z.string().optional(),
        priority: z.enum(["critical", "high", "normal", "low"]).optional(),
        queue: z.boolean().optional(),
        executor: z.enum(["mirrorcode", "codex", "claude-code"]).optional(),
      }),
      async (params) => EngineService.createTask({
        request: params.request,
        title: params.title,
        priority: params.priority,
        queue: params.queue,
        executor: params.executor,
        kind: "workflow",
        source: "gateway",
        metadata: { gateway: { sessionID: input.sessionID } },
      }),
    ),
    forward_clarification: tool(
      z.object({
        questionID: z.string().min(1),
        answers: Question.Answer.array(),
      }),
      async (params) => {
        await Question.reply({ requestID: params.questionID, answers: params.answers })
        return true
      },
    ),
    switch_cwd: tool(
      z.object({ cwd: z.string().min(1) }),
      async (params) => {
        await writeCwd({ sessionID: input.sessionID, cwd: params.cwd })
        return params.cwd
      },
    ),
    cancel_task: tool(
      z.object({ taskID: z.string().min(1) }),
      async (params) => {
        await EngineService.cancelTask(params.taskID)
        return true
      },
    ),
  }
}
