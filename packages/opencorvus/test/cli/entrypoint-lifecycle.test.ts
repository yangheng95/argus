import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import path from "path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")

function readSource(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8")
}

describe("CLI entrypoint lifecycle", () => {
  test.each([
    ["full CLI", "packages/opencorvus/src/index.ts"],
    ["overlay server", "packages/opencorvus/src/overlay-server.ts"],
  ])("%s awaits async command handlers without owning process exit", (_name, relativePath) => {
    const source = readSource(relativePath)

    expect(source).toContain("await cli.parseAsync()")
    expect(source).not.toMatch(/finally\s*\{[^}]*process\.exit\(\s*\)[^}]*\}/s)
  })
})
