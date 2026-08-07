// API means Application Programming Interface. JSON means JavaScript Object Notation.

import { tool } from "@opencorvus-ai/plugin"
import {
  IFIND_CHANNELS,
  IFIND_MAX_RESULTS,
  searchIfind,
  serializeIfindSearchResult,
} from "../lib/mirror-watch/ifind-search"

export default tool({
  description:
    "Search the package-configured iFind endpoint once and return exact trusted-provider summary evidence without fallback, content-keyword filtering, or post-response truncation.",
  args: {
    query: tool.schema.string().trim().min(1).describe("Explicit live-research query."),
    channels: tool.schema
      .array(tool.schema.enum(IFIND_CHANNELS))
      .min(1)
      .refine((channels) => new Set(channels).size === channels.length, "iFind channels must be unique")
      .describe("Explicit iFind channels. There is no implicit default or alternate search provider."),
    size: tool.schema
      .number()
      .int()
      .min(1)
      .max(IFIND_MAX_RESULTS)
      .describe(`Requested provider result count, from 1 through ${IFIND_MAX_RESULTS}.`),
  },
  async execute(args, context) {
    const result = await searchIfind(args, { fetchImplementation: context.host.fetch, signal: context.abort })
    context.metadata({
      metadata: {
        ifind_request_id: result.request.qid,
        ifind_channels: result.request.channels,
        ifind_result_count: result.result_count,
      },
    })
    return serializeIfindSearchResult(result)
  },
})
