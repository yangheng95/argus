import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")

describe("product documentation single source", () => {
  test("legacy product docs tree is not restored", () => {
    expect(fs.existsSync(path.join(repoRoot, "docs", "product"))).toBe(false)
  })

  test("canonical website docs tree exists", () => {
    expect(fs.existsSync(path.join(repoRoot, "packages/web/src/content/docs/index.mdx"))).toBe(true)
    expect(fs.existsSync(path.join(repoRoot, "packages/web/src/content/docs/zh-cn/index.mdx"))).toBe(true)
  })
})
