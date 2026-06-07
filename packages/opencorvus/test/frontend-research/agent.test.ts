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
    expect(config.delegation).toContain("Do not create the frontend implementation template")
  })

  test("core prompt requires prepared screenshot evidence and report implementation guidance", async () => {
    const prompt = await Bun.file(new URL("../../src/prompt/core/frontend-research-core.txt", import.meta.url)).text()

    expect(prompt).toContain("When prepared webpage evidence names a visual reference image and required evidence id")
    expect(prompt).toContain("register that screenshot as primary evidence")
    expect(prompt).toContain("Use an empty array only when no screenshot/rendered visual capture exists")
    expect(prompt).toContain("never create placeholder evidence")
    expect(prompt).toContain("Evidence index `bundle_ref` values are optional")
    expect(prompt).toContain("Build the brief with small registration tools")
    expect(prompt).toContain("downstream implementation must inspect and reference that image while writing code")
    expect(prompt).toContain("do not let build infer visual layout from prose alone")
    expect(prompt).toContain("source IR/style-profile/style-tokens/reference screenshot evidence")
    expect(prompt).toContain("For visual-token work packets")
    expect(prompt).toContain("color roles, typography scale, spacing/density, radii/borders/shadows")
    expect(prompt).toContain("Do not synthesize a final token catalog")
    expect(prompt).toContain("raw DOM replay, iframe preview, or screenshot-only HTML")
  })
})
