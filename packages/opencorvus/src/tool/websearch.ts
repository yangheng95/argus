import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./websearch.txt"
import { exaMcpCall } from "./exa-mcp"

const DEFAULT_NUM_RESULTS = 8

export const WebSearchTool = Tool.define("websearch", async () => {
  return {
    get description() {
      return DESCRIPTION.replace("{{year}}", new Date().getFullYear().toString())
    },
    parameters: z.object({
      query: z.string().describe("Websearch query"),
      numResults: z.number().optional().describe("Number of search results to return"),
      livecrawl: z
        .enum(["fallback", "preferred"])
        .default("fallback")
        .describe(
          "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling",
        ),
      type: z
        .enum(["auto", "fast", "deep"])
        .optional()
        .describe("Search type - 'auto': balanced search, 'fast': quick results, 'deep': comprehensive search"),
      contextMaxCharacters: z.number().optional().describe("Maximum characters for context string optimized for LLMs"),
    }),
    async execute(params, ctx) {
      await ctx.ask({
        permission: "websearch",
        patterns: [params.query],
        always: ["*"],
        metadata: {
          query: params.query,
          numResults: params.numResults,
          livecrawl: params.livecrawl,
          type: params.type,
          contextMaxCharacters: params.contextMaxCharacters,
        },
      })

      const text = await exaMcpCall({
        name: "web_search_exa",
        arguments: {
          query: params.query,
          type: params.type || "auto",
          numResults: params.numResults || DEFAULT_NUM_RESULTS,
          livecrawl: params.livecrawl,
          contextMaxCharacters: params.contextMaxCharacters,
        },
        timeoutMs: 25000,
        signal: ctx.abort,
        label: "Web search",
      })

      return {
        output: text ?? "No search results found. Please try a different query.",
        title: `Web search: ${params.query}`,
        metadata: {},
      }
    },
  }
})
