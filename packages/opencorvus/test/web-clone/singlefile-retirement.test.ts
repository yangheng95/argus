import { describe, expect, test } from "bun:test"
import path from "node:path"

const packageRoot = path.resolve(import.meta.dir, "..", "..")

describe("SingleFile capture retirement", () => {
  test("does not keep the retired capture module or package dependency", async () => {
    const packageJson = await Bun.file(path.join(packageRoot, "package.json")).json()
    const dependencies = packageJson.dependencies ?? {}

    expect(dependencies["single-file-cli"]).toBeUndefined()
    expect(await Bun.file(path.join(packageRoot, "src", "web-clone", "singlefile-capture.ts")).exists()).toBe(false)
    expect(await Bun.file(path.join(packageRoot, "src", "single-file-cli.d.ts")).exists()).toBe(false)
  })
})
