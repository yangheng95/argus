import { describe, expect, test } from "bun:test"
import { FrontendResearchTestHooks } from "../../src/frontend-research/agent"

describe("frontend-research agent", () => {
  test("performs direct read-only investigation instead of delegating to build", () => {
    const config = FrontendResearchTestHooks.frontendResearchSessionConfig()

    expect(config.prepareWebpageEvidence).toBe("always-for-source-url")
    expect(config.bundlePathKind).toBe("frontend-research")
    expect(config).not.toHaveProperty("includeRetrievalTools")
    expect(config).not.toHaveProperty("createAdditionalTools")
    expect(config.delegation).toContain("perform read-only webpage research")
    expect(config.delegation).toContain("read-only source retrieval")
    expect(config.delegation).toContain("Do not create the frontend implementation template")
  })
})
