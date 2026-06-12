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
})
