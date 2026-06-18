import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const repo = resolve(import.meta.dir, "../../../..")

function readRepo(relativePath: string): string {
  return readFileSync(resolve(repo, relativePath), "utf8")
}

describe("SDK build format contract", () => {
  test("SDK build resolves the repository Prettier binary instead of invoking a package script", () => {
    const source = readRepo("packages/sdk/js/script/build.ts")

    expect(source).toContain('Bun.resolve("prettier/bin/prettier.cjs"')
    expect(source).toContain("bun ${prettierBin} --write src")
    expect(source).not.toContain("bun prettier --write src")
    expect(source).not.toContain("bun run prettier")
  })

  test("typecheck workflow diffs the actual generated SDK directory", () => {
    const workflow = readRepo(".github/workflows/typecheck.yml")
    const build = readRepo("packages/sdk/js/script/build.ts")

    expect(build).toContain("replaceDirectoryAfterSuccessfulBuild({")
    expect(build).toContain('stagingRelative: ".tmp-sdk-gen"')
    expect(build).toContain('targetRelative: "src/gen"')
    expect(build).not.toContain('rmWithinPackage("src/gen"')
    expect(build).not.toContain('writeFileWithRetry(path.join(dir, "src", "gen"')
    expect(workflow).toContain("bun ./packages/sdk/js/script/build.ts")
    expect(workflow).toContain("packages/sdk/js/src/gen packages/sdk/openapi.json")
    expect(workflow).not.toContain("packages/sdk/js/src/v2/gen")
  })

  test("OpenAPI generation does not import the SDK client before SDK generation", () => {
    const plugin = readRepo("packages/opencorvus/src/plugin/index.ts")

    expect(plugin).not.toContain('import { createOpenCorvusClient } from "@opencorvus-ai/sdk"')
    expect(plugin).toContain('await import("@opencorvus-ai/sdk")')
  })
})
