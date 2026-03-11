import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./diary_create.txt"
import { Diary } from "@/diary/diary"

export const DiaryCreateTool = Tool.define("diary_create", {
  description: DESCRIPTION,
  parameters: z.object({
    date: z.string().describe("Date of the diary entry in YYYY-MM-DD format"),
    title: z.string().describe("Title of the diary entry"),
    content: z.string().describe("Content of the diary entry"),
    mood: z.string().optional().describe("Mood of the diary entry"),
    image_paths: z.array(z.string()).optional().describe("Array of image paths"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "diary_create",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    const entry = Diary.create({
      date: params.date,
      title: params.title,
      content: params.content,
      mood: params.mood,
      image_paths: params.image_paths,
    })

    return {
      title: `Created diary entry: ${entry.title}`,
      output: JSON.stringify(entry, null, 2),
      metadata: {
        entry,
      },
    }
  },
})
