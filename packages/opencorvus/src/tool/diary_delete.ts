import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./diary_delete.txt"
import { Diary } from "@/diary/diary"

export const DiaryDeleteTool = Tool.define("diary_delete", {
  description: DESCRIPTION,
  parameters: z.object({
    id: z.string().describe("ID of the diary entry to delete"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "diary_delete",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    const success = Diary.remove(params.id)

    return {
      title: success ? `Deleted diary entry: ${params.id}` : "Diary entry not found",
      output: success 
        ? `Successfully deleted diary entry with ID ${params.id}`
        : `Diary entry with ID ${params.id} not found`,
      metadata: {
        id: params.id,
        deleted: success,
      },
    }
  },
})
