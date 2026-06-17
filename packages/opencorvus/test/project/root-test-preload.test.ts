import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"

describe("root test preload", () => {
  test("recreates its per-process temp root before exporting database paths", async () => {
    const source = await fs.readFile(path.resolve(import.meta.dir, "../../../../test-preload.ts"), "utf8")
    const rmIndex = source.indexOf("await fs.rm(opencorvusTestRoot")
    const mkdirIndex = source.indexOf("await fs.mkdir(opencorvusTestRoot")
    const homeIndex = source.indexOf('process.env["OPENCORVUS_HOME"]')

    expect(rmIndex).toBeGreaterThan(-1)
    expect(mkdirIndex).toBeGreaterThan(rmIndex)
    expect(homeIndex).toBeGreaterThan(mkdirIndex)
  })
})
