import { describe, expect, test } from "bun:test"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const architectPromptPath = path.join(
  repoRoot,
  "packages/opencorvus/src/prompt/core/architect-core.txt",
)

async function readArchitectPrompt() {
  return await Bun.file(architectPromptPath).text()
}

describe("architect grep-only acceptance spec discipline", () => {
  test("core prompt forbids grep-only specs for behavioral requirements", async () => {
    const prompt = await readArchitectPrompt()

    expect(prompt).toContain("file-existence grep")
    expect(prompt).toContain("grep -r 'Foo' src/ -l")
    expect(prompt).toContain("For REQs that name behavior")
    expect(prompt).toContain("runtime-bearing scorer")
    expect(prompt).toContain("Existence greps under behavior REQs are a hard decomposition defect")
  })

  test("core prompt requires acceptance specs to anchor to REQ acceptance text", async () => {
    const prompt = await readArchitectPrompt()

    expect(prompt).toContain("Every REQ-N whose `acceptance` text exists")
    expect(prompt).toContain("`scorers[*].name` or `title` references that acceptance phrase")
    expect(prompt).toContain("surface that as a decomposition concern instead of filling the gap with a grep")
  })
})
