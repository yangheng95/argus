import { describe, expect, test } from "bun:test"
import path from "node:path"

const authSourcePath = path.resolve(import.meta.dir, "../../src/cli/cmd/auth.ts")
const authSource = await Bun.file(authSourcePath).text()

describe("auth command model catalog", () => {
  test("auth login does not refresh models.dev implicitly", () => {
    expect(authSource).not.toContain("ModelsDev.refresh()")
    expect(authSource).toContain("await ModelsDev.get()")
  })
})
