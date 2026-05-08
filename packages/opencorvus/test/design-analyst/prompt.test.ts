import { describe, expect, test } from "bun:test"
import { DesignAnalystTestHooks } from "../../src/design-analyst/agent"

describe("design-analyst prompt assembly", () => {
  test("live URL tasks do not inline system URL screenshots", async () => {
    const parts = await DesignAnalystTestHooks.buildPromptParts({
      title: "AMD replica",
      request: "复刻 https://chart.ainvest.com/NASDAQ-AMD/",
      attachments: [
        {
          sha: "abc",
          url: "/attachment/project/abc.png",
          mime: "image/png",
          size: 220_000,
          filename: "url-chart_ainvest_com.png",
          intent: "visual_reference",
          source: "url-screenshot",
        },
      ],
    })

    expect(parts).toHaveLength(1)
    expect(parts[0]?.type).toBe("text")
    expect(parts[0]?.text).toContain("stored for provenance but are not inlined")
    expect(parts[0]?.text).toContain("Use the mirror webpage pipeline first")
    expect(parts[0]?.text).not.toContain("[inlined as file part]")
  })
})
