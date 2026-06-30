import { describe, expect, test } from "bun:test"
import { FrontendResearchTestHooks } from "../../src/frontend-research/agent"

describe("frontend-research agent", () => {
  test("prepares source URL evidence before publishing investigation work packets", () => {
    const config = FrontendResearchTestHooks.frontendResearchSessionConfig()

    expect(config.prepareWebpageEvidence).toBe("always-for-source-url")
    expect(config.bundlePathKind).toBe("frontend-research")
    expect(config.retrievalTools).toBe("none")
    expect(config).not.toHaveProperty("includeRetrievalTools")
    expect(config).not.toHaveProperty("createAdditionalTools")
    expect(config.delegation).toContain("publish webpage investigation work packets")
    expect(config.delegation).toContain("host prepares source URL evidence before your session")
    expect(config.delegation).toContain("Requirements-Agent Handoff")
    expect(config.delegation).toContain("page interface verification and API adaptation documentation")
    expect(config.delegation).toContain("Do not create the frontend implementation template")
  })

  test("core prompt requires prepared screenshot evidence and report implementation guidance", async () => {
    const prompt = await Bun.file(new URL("../../src/prompt/core/frontend-research-core.txt", import.meta.url)).text()

    expect(prompt).toContain("When prepared webpage evidence names a visual reference image and required evidence id")
    expect(prompt).toContain("register that screenshot as primary evidence")
    expect(prompt).toContain("Use an empty array only when no screenshot/rendered visual capture exists")
    expect(prompt).toContain("never create placeholder evidence")
    expect(prompt).toContain("Evidence index `bundle_ref` values are optional")
    expect(prompt).toContain("Build the brief with small `update_*` tools")
    expect(prompt).toContain("downstream implementation must inspect and reference that image while writing code")
    expect(prompt).toContain("do not let frontend_design or build infer visual layout from prose alone")
    expect(prompt).toContain("source IR/style-profile/style-tokens/reference screenshot evidence")
    expect(prompt).toContain("Page Skeleton Blueprint")
    expect(prompt).toContain("visible regions in source order")
    expect(prompt).toContain("region count")
    expect(prompt).toContain("major content sections")
    expect(prompt).toContain("component-kind hypotheses")
    expect(prompt).toContain("data/content anchors")
    expect(prompt).toContain("interaction states")
    expect(prompt).toContain("source evidence ids")
    expect(prompt).toContain("fidelity risks")
    expect(prompt).toContain("frontend_design page information-architecture input")
    expect(prompt).toContain("do not let frontend_design or build infer visual layout from prose alone")
    expect(prompt).toContain("For visual-token work packets")
    expect(prompt).toContain("color roles, typography scale, spacing/density, radii/borders/shadows")
    expect(prompt).toContain("Do not synthesize a final token catalog")
    expect(prompt).toContain("raw DOM replay, iframe preview, or screenshot-only HTML")
    expect(prompt).toContain("Requirements-Agent Handoff")
    expect(prompt).toContain("page API verification scope")
    expect(prompt).toContain("expected persisted API adaptation document")
    expect(prompt).toContain(
      "do not invent endpoints, payloads, live market feeds, or backend obligations from visual labels alone",
    )
  })

  test("runResearchSession forwards continuation into the shared agent runner", async () => {
    const source = await Bun.file(new URL("../../src/research/agent.ts", import.meta.url)).text()
    const runAgentSessionCall = source.slice(source.indexOf("const out = await runAgentSession"))

    expect(source).toContain("await outputToolKit.replayUpdateToolCalls")
    expect(source).toContain("const reportWebpageEvidenceProgress")
    expect(source).toContain('SessionStatus.set(session.id, { type: "streaming" })')
    expect(runAgentSessionCall).toContain("continuation: input.continuation")
    expect(runAgentSessionCall).toContain("shouldExposeOnlyTerminalTool: () => outputToolKit.isReadyToSubmit()")
  })

  test("orchestrator forwards frontend research host-evidence progress to workflow progress", async () => {
    const source = await Bun.file(new URL("../../src/orchestrator/tools.ts", import.meta.url)).text()

    expect(source).toContain('onStatus: (summary) => trackStepProgress("frontend_research", summary)')
  })
})
