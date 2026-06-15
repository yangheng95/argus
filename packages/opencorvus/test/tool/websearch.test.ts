import { describe, expect, test } from "bun:test"
import { WebSearchTool } from "../../src/tool/websearch"

describe("websearch tool", () => {
  test("prioritizes live crawl and rejects fallback mode", async () => {
    const tool = await WebSearchTool.init()

    expect(tool.parameters.parse({ query: "solid js docs" }).livecrawl).toBe("preferred")
    expect(() => tool.parameters.parse({ query: "solid js docs", livecrawl: "fallback" })).toThrow()
  })
})
