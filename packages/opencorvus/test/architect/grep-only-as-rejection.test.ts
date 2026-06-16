import { describe, expect, test } from "bun:test"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const architectPromptPath = path.join(repoRoot, "packages/opencorvus/src/prompt/core/architect-core.txt")

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

  test("core prompt forbids toolchain-only specs as acceptance", async () => {
    const prompt = await readArchitectPrompt()

    expect(prompt).toContain("meaningful feature acceptance")
    expect(prompt).toContain("Syntax checks, typecheck, lint, build success, dev-server startup")
    expect(prompt).toContain("must never be the title, sole scorer, or whole success criterion")
    expect(prompt).toContain("A shell scorer that only runs `tsc`, `typecheck`, `lint`, `build`, `npm start`, `bun dev`")
    expect(prompt).toContain("surface that as an under-specified requirement in decomposition_analysis")
  })

  test("core prompt requires script_ref scorers to reference existing scripts", async () => {
    const prompt = await readArchitectPrompt()

    expect(prompt).toContain('Use `spec.kind:"script_ref"` only for repo scripts that already exist at registration time')
    expect(prompt).toContain('For one-off checks, use `spec.kind:"shell"` with `cmd`')
    expect(prompt).toContain("do not register helper-script goals or temporary test goals to probe the schema")
  })

  test("core prompt distinguishes contract_audit from script_ref paths", async () => {
    const prompt = await readArchitectPrompt()

    expect(prompt).toContain("`contract_audit` is a scorer `type`, not a `script_ref` path")
    expect(prompt).toContain("Never write `.opencorvus/scripts/contract-audit`")
    expect(prompt).toContain('for graph-contract checks use `type:"contract_audit"` with registered contract ids')
  })
})
