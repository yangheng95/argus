import { describe, expect, test } from "bun:test"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const acpCommandPath = path.join(repoRoot, "packages/opencorvus/src/cli/cmd/acp.ts")

describe("opencorvus acp --cwd", () => {
  test("passes the explicit cwd option into bootstrap", async () => {
    const text = await Bun.file(acpCommandPath).text()

    expect(text).toContain('import path from "node:path"')
    expect(text).toContain("const cwd = path.resolve(args.cwd as string)")
    expect(text).toContain("await bootstrap(cwd, async () =>")
    expect(text).not.toContain("await bootstrap(process.cwd(), async () =>")
  })
})
