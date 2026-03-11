import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./diary_search.txt"
import { Diary } from "@/diary/diary"

export const DiarySearchTool = Tool.define("diary_search", {
  description: DESCRIPTION,
  parameters: z.object({
    dateFrom: z.string().optional().describe("Start date for search range in YYYY-MM-DD format"),
    dateTo: z.string().optional().describe("End date for search range in YYYY-MM-DD format"),
    title: z.string().optional().describe("Keyword to search in title and content"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "diary_search",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    const entries = Diary.search({
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      title: params.title,
    })

    return {
      title: `Found ${entries.length} diary entries`,
      output: JSON.stringify(entries, null, 2),
      metadata: {
        entries,
        count: entries.length,
      },
    }
  },
})
