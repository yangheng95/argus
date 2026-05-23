import { describe, expect, test } from "bun:test"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const requirementsPromptPath = path.join(
  repoRoot,
  "packages/opencorvus/src/prompt/core/requirements-core.txt",
)

async function readRequirementsPrompt() {
  return await Bun.file(requirementsPromptPath).text()
}

describe("requirements maturity word discipline", () => {
  test("prompt requires vague maturity words to land or be clarified", async () => {
    const prompt = await readRequirementsPrompt()

    expect(prompt).toContain("Vague maturity / quality words")
    expect(prompt).toContain("成熟")
    expect(prompt).toContain("maturity_scope_pending")
    expect(prompt).toContain("Never leave a maturity word implicit")
  })

  test("prompt requires requirement acceptance and non-goal boundaries", async () => {
    const prompt = await readRequirementsPrompt()

    expect(prompt).toContain("Every `register_requirement` call MUST populate `acceptance`")
    expect(prompt).toContain("`register_requirement({ id, type, description, acceptance, non_goals })`")
    expect(prompt).toContain("`acceptance`: one sentence naming the observable success condition")
    expect(prompt).toContain("`non_goals`: one sentence naming nearby behavior")
  })
})
