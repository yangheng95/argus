import { describe, expect, test } from "bun:test"
import path from "node:path"

const packageRoot = path.resolve(import.meta.dir, "..", "..")
const captureSourcePath = path.join(packageRoot, "src", "web-clone", "singlefile-capture.ts")

describe("singlefile capture packaging contract", () => {
  test("does not depend on an external node_modules bin shim", async () => {
    const source = await Bun.file(captureSourcePath).text()

    expect(source).toContain('from "single-file-cli/single-file-cli-api.js"')
    expect(source).not.toContain("node_modules")
    expect(source).not.toContain(".bin")
    expect(source).not.toContain("Bun.spawn")
    expect(source).not.toContain("resolveSingleFileExecutable")
  })

  test("uses the published SingleFile API entrypoint", async () => {
    const api = await import("single-file-cli/single-file-cli-api.js")

    expect(typeof api.initialize).toBe("function")
  })
})
