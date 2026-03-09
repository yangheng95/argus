import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { readSpec, specFile } from "../../src/orchestrator/spec"

describe("orchestrator spec helpers", () => {
  test("does not fall back to the latest spec when task metadata points to a missing file", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const dir = path.join(tmp.path, ".opencorvus", "specs")
        const file = path.join(dir, "latest.md")
        await fs.mkdir(dir, { recursive: true })
        await Bun.write(file, "# Latest\n\nGlobal spec")

        expect(readSpec({ file: path.join(dir, "missing.md") })).toBeUndefined()
        expect(specFile({ file: path.join(dir, "missing.md") })).toBeUndefined()
        expect(readSpec()?.file).toBe(file)
      },
    })
  })
})
