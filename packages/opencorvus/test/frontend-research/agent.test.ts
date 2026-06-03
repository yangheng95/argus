import { describe, expect, test } from "bun:test"
import { FrontendResearchTestHooks } from "../../src/frontend-research/agent"

describe("frontend-research agent", () => {
  test("publishes investigation work packets without performing deep investigation", () => {
    const config = FrontendResearchTestHooks.frontendResearchSessionConfig()

    expect(config.prepareWebpageEvidence).toBe("read-existing-for-source-url")
    expect(config.bundlePathKind).toBe("frontend-research")
    expect(config).not.toHaveProperty("includeRetrievalTools")
    expect(config).not.toHaveProperty("createAdditionalTools")
    expect(config.delegation).toContain("publish webpage investigation work packets")
    expect(config.delegation).toContain("do not perform deep source-page or artifact investigation yourself")
    expect(config.delegation).toContain("Do not create the frontend implementation template")
  })
})
