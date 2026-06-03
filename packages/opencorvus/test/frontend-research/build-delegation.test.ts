import { describe, expect, test } from "bun:test"
import { FrontendResearchTestHooks } from "../../src/frontend-research/agent"
import { createFrontendResearchBuildDelegationTools } from "../../src/frontend-research/build-delegation"

function callTool(tools: Record<string, any>, name: string, input: unknown): Promise<string> {
  return tools[name].execute!(input as any, {} as any)
}

describe("frontend-research build delegation", () => {
  test("does not prepare webpage evidence before delegating investigation to build", () => {
    const config = FrontendResearchTestHooks.frontendResearchSessionConfig()

    expect(config.prepareWebpageEvidence).toBe("none")
    expect(config.includeRetrievalTools).toBe(false)
    expect(config.createAdditionalTools).toBeTypeOf("function")
  })

  test("delegates no-change deep research packets to build", async () => {
    let captured: any
    const tools = createFrontendResearchBuildDelegationTools({
      title: "Clone the source page",
      request: "Research https://example.com and prepare implementation evidence.",
      sourceUrls: ["https://example.com"],
      focus: "desktop and mobile layout",
      reason: "Requirements need page evidence.",
      task: { id: "tsk_frontend_research_delegate", executor: "opencorvus" } as any,
      getParentSessionID: () => "ses_frontend_research",
      webpagePrdEvidence: {
        url: "https://example.com",
        status: "generated",
        mirrorRelative: ".opencorvus/runtime/tasks/tsk/mirror",
        sourcePackageRelative: ".opencorvus/runtime/tasks/tsk/web-clone-source",
        referenceImageRelative: ".opencorvus/runtime/tasks/tsk/web-clone-source/reference.png",
        artifacts: [".opencorvus/runtime/tasks/tsk/web-clone-source/source-ir/layout-map.json"],
        excerpts: [
          {
            label: "Layout map",
            relativePath: ".opencorvus/runtime/tasks/tsk/web-clone-source/source-ir/layout-map.json",
            excerpt: "{\"regions\":[\"hero\"]}",
            originalChars: 20,
            clipped: false,
          },
        ],
      },
      runBuild: async (input: any) => {
        captured = input
        return {
          result: {
            status: "passed",
            summary: "## Hero\nEvidence-backed hero findings.",
            files_changed: [],
            tests: [{ name: "inspected prepared evidence", passed: true, detail: "layout-map.json" }],
            fact_check_items: [],
          },
          sessionID: "ses_build_deep_research",
          mergeBackStatus: "not_invoked",
        } as any
      },
    })

    const result = await callTool(tools, "delegate_deep_research_to_build", {
      title: "Hero research",
      objective: "Identify hero content, layout, and interaction states.",
      source_urls: ["https://example.com"],
      focus: "hero",
      expected_output: "Return functional surfaces, visual layout, style signals, and risks.",
    })

    expect(captured.parentSessionID).toBe("ses_frontend_research")
    expect(captured.target.kind).toBe("request")
    expect(captured.target.text).toContain("no-change research packet")
    expect(captured.target.text).toContain("bounded no-change research packet")
    expect(captured.target.text).toContain("Do not edit, create, commit, or merge project files")
    expect(captured.target.text).toContain("Do not crawl the full site")
    expect(captured.target.text).toContain("## Investigation Budget")
    expect(captured.target.text).toContain("run at most three focused read-only checks")
    expect(captured.target.text).toContain("Call `report_build_result` immediately after the bounded checks")
    expect(captured.target.text).toContain("Put the full evidence-backed research report in `summary`")
    expect(captured.target.text).toContain("# Prepared Webpage PRD Evidence")
    expect(captured.target.text).toContain("Hero research")
    expect(result).toContain("build_session: ses_build_deep_research")
    expect(result).toContain("Evidence-backed hero findings")
    expect(result).toContain("inspected prepared evidence: passed")
  })
})
