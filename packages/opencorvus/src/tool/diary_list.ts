import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./diary_list.txt"
import { Diary } from "@/diary/diary"

export const DiaryListTool = Tool.define("diary_list", {
  description: DESCRIPTION,
  parameters: z.object({
    limit: z.number().optional().default(100).describe("Maximum number of entries to return"),
    offset: z.number().optional().default(0).describe("Number of entries to skip"),
    sortBy: z.enum(["date", "time_created", "time_updated"]).optional().default("date").describe("Field to sort by"),
    sortOrder: z.enum(["asc", "desc"]).optional().default("desc").describe("Sort order"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "diary_list",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    const entries = Diary.list({
      limit: params.limit,
      offset: params.offset,
      sortBy: params.sortBy,
      sortOrder: params.sortOrder,
    })

    return {
      title: `Listed ${entries.length} diary entries`,
      output: JSON.stringify(entries, null, 2),
      metadata: {
        entries,
        count: entries.length,
      },
    }
  },
})
