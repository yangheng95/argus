import z from "zod"
import { NamedError } from "@opencorvus-ai/util/error"

export const TaskGlobalProjectBindingError = NamedError.create(
  "TaskGlobalProjectBindingError",
  z.object({
    message: z.string(),
    taskID: z.string().optional(),
    projectID: z.string(),
  }),
)
