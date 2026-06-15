import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"

describe("opencorvus package test entry", () => {
  test("runs release asset regression tests in the default package suite", () => {
    const packageJsonPath = path.resolve(import.meta.dir, "../..", "package.json")
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
      scripts?: Record<string, string>
    }

    const testScript = packageJson.scripts?.test ?? ""
    const args = testScript.split(/\s+/)
    expect(args).toContain("test/script/check-release-assets.test.ts")
    expect(args).toContain("test/script/package-test-entry.test.ts")
  })
})
