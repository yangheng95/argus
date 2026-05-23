import { describe, expect, test } from "bun:test"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const teamCorePath = path.join(
  repoRoot,
  "packages/opencorvus/src/prompt/core/integrity-team-core.txt",
)

async function readTeamCore() {
  return await Bun.file(teamCorePath).text()
}

describe("integrity finding traceability discipline", () => {
  test("team core requires every finding to trace to REQ, AS, or literal user quote", async () => {
    const prompt = await readTeamCore()

    expect(prompt).toContain("Every finding MUST carry at least one of")
    expect(prompt).toContain("`requirementIDs`: REQ-N this finding violates")
    expect(prompt).toContain("`specIDs`: AcceptanceSpec ids this finding violates")
    expect(prompt).toContain("`userRequestQuotes`: literal substring(s) of the original user request")
    expect(prompt).toContain("empty `requirementIDs`, empty `specIDs`, AND no `userRequestQuotes`")
    expect(prompt).toContain("is out of scope and MUST be dropped")
  })

  test("team core collapses unbounded maturity adjectives into one extraction concern", async () => {
    const prompt = await readTeamCore()

    expect(prompt).toContain("\"Maturity\", \"polished\", \"production-ready\"")
    expect(prompt).toContain("NOT a license to invent new dimensions")
    expect(prompt).toContain("single requirements-extraction concern")
    expect(prompt).toContain("do not generate a parade of blockers")
  })
})
