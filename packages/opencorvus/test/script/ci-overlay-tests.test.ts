import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const repo = resolve(import.meta.dir, "../../../..")

function readRepo(relativePath: string): string {
  return readFileSync(resolve(repo, relativePath), "utf8")
}

describe("required CI overlay test coverage", () => {
  test("test workflow runs overlay unit and Node-owned browser tests before required passes", () => {
    const workflow = readRepo(".github/workflows/test.yml")

    expect(workflow).toContain("overlay-unit:")
    expect(workflow).toContain("working-directory: packages/overlay")
    expect(workflow).toContain("run: bun run test")

    expect(workflow).toContain("overlay-browser:")
    expect(workflow).toContain("OPENCORVUS_BROWSER_EXECUTABLE: /usr/bin/chromium")
    expect(workflow).toContain("run: bun run test:browser")

    const requiredBlock = /required:[\s\S]*?steps:/.exec(workflow)?.[0] ?? ""
    expect(requiredBlock).toContain("- overlay-unit")
    expect(requiredBlock).toContain("- overlay-browser")

    expect(workflow).toContain("test \"${{ needs['overlay-unit'].result }}\" = \"success\"")
    expect(workflow).toContain("test \"${{ needs['overlay-browser'].result }}\" = \"success\"")
  })
})
