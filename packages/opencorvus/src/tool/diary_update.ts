import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./diary_update.txt"
import { Diary } from "@/diary/diary"

export const DiaryUpdateTool = Tool.define("diary_update", {
  description: DESCRIPTION,
  parameters: z.object({
    id: z.string().describe("ID of the diary entry to update"),
    date: z.string().optional().describe("New date of the diary entry in YYYY-MM-DD format"),
    title: z.string().optional().describe("New title of the diary entry"),
    content: z.string().optional().describe("New content of the diary entry"),
    mood: z.string().optional().describe("New mood of the diary entry"),
    image_paths: z.array(z.string()).optional().describe("New array of image paths"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "diary_update",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    const { id, ...updates } = params
    const entry = Diary.update(id, updates)

    return {
      title: entry ? `Updated diary entry: ${entry.title}` : "Diary entry not found",
      output: entry ? JSON.stringify(entry, null, 2) : `Diary entry with ID ${id} not found`,
      metadata: {
        id,
        entry,
      },
    }
  },
})
