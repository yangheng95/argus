import { describe, expect, test } from "bun:test"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const srcDir = path.join(repoRoot, "packages/opencorvus/src")

async function readSrc(relativePath: string): Promise<string> {
  return await Bun.file(path.join(srcDir, relativePath)).text()
}

describe("final system prompt audit", () => {
  test("webpage clone routing text names frontend_research before frontend_design when the page skeleton is missing", async () => {
    const general = await readSrc("agent/prompt/general.txt")
    const explore = await readSrc("agent/prompt/explore.txt")
    const intent = await readSrc("prompt/core/intent-analysis-core.txt")
    const frontendDesign = await readSrc("prompt/core/frontend-design-core.txt")

    expect(general).not.toContain("caller should dispatch `frontend_design`")
    expect(explore).not.toContain("caller can dispatch `frontend_design`")
    expect(general).toContain("`frontend_research` first when a source-backed Page Skeleton Blueprint is missing")
    expect(explore).toContain("`frontend_research` first when a source-backed Page Skeleton Blueprint is missing")

    expect(intent).not.toContain("Frontend Design owns visual frontend template synthesis and webpage evidence.")
    expect(intent).toContain("Frontend Research owns source-page investigation and Page Skeleton Blueprint evidence")

    expect(frontendDesign).not.toContain("may acquire missing frontend_design webpage evidence")
    expect(frontendDesign).toContain("the orchestrator must run frontend_research first")
  })

  test("prompt text does not name retired acceptance as a downstream agent role", async () => {
    const build = await readSrc("prompt/core/build-core.txt")
    const frontendDesign = await readSrc("prompt/core/frontend-design-core.txt")

    expect(build).not.toContain("acceptance review, integrity review")
    expect(build).toContain("visual QA review, integrity review")

    expect(frontendDesign).not.toContain("acceptance can implement and verify")
    expect(frontendDesign).toContain("build, visual_qa, and integrity can implement, review, and verify")
  })

  test("orchestrator dynamic system context uses review terminology instead of retired acceptance-agent wording", async () => {
    const source = await readSrc("orchestrator/agent.ts")

    expect(source).not.toContain('ctx.push("## Acceptance Trajectory")')
    expect(source).not.toContain('ctx.push("### Latest acceptance-agent feedback")')
    expect(source).not.toContain("latest acceptance feedback above")
    expect(source).toContain('ctx.push("## Iteration Trajectory")')
    expect(source).toContain('ctx.push("### Latest review feedback")')
    expect(source).toContain("latest review feedback above")
  })

  test("interactive agent identity text is concise and objective", async () => {
    const coding = await readSrc("agent/prompt/coding.txt")
    const genericSystem = await readSrc("session/prompt/system.txt")

    expect(coding).not.toContain("best coding agent on the planet")
    expect(genericSystem).not.toContain("best coding agent on the planet")
    expect(coding.startsWith("You are the `coding` agent")).toBe(true)
    expect(genericSystem.startsWith("You are OpenCorvus.")).toBe(true)
  })
})
