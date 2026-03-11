import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./diary_read.txt"
import { Diary } from "@/diary/diary"

export const DiaryReadTool = Tool.define("diary_read", {
  description: DESCRIPTION,
  parameters: z.object({
    id: z.string().describe("ID of the diary entry to read"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "diary_read",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    const entry = Diary.read(params.id)

    return {
      title: entry ? `Read diary entry: ${entry.title}` : "Diary entry not found",
      output: entry ? JSON.stringify(entry, null, 2) : `Diary entry with ID ${params.id} not found`,
      metadata: {
        id: params.id,
        entry,
      },
    }
  },
})
