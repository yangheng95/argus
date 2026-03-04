import z from "zod"
import { Tool } from "./tool"

export const InvalidTool = Tool.define("invalid", {
  description: "Do not use",
  parameters: z.object({
    tool: z.string().nullish().transform((item) => item?.trim() || "unknown"),
    error: z.string().nullish().transform((item) => item?.trim() || "unknown error"),
  }),
  async execute(params) {
    return {
      title: "Invalid Tool",
      output: `The arguments provided to the tool are invalid: ${params.error}`,
      metadata: {},
    }
  },
})
