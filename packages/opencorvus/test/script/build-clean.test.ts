import { describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { cleanBuildDist } from "../../script/build-clean"

describe("build dist cleanup", () => {
  test("preserves packaged Linux binary artifacts while removing build outputs", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencorvus-build-clean-"))
    const dist = path.join(root, "dist")
    const binary = path.join(dist, "binary", "opencorvus-linux-x64", "opencorvus")
    const buildOutput = path.join(dist, "opencorvus-linux-x64", "opencorvus")
    const looseFile = path.join(dist, "manifest.json")

    fs.mkdirSync(path.dirname(binary), { recursive: true })
    fs.mkdirSync(path.dirname(buildOutput), { recursive: true })
    fs.writeFileSync(binary, "linux package")
    fs.writeFileSync(buildOutput, "build output")
    fs.writeFileSync(looseFile, "{}")

    try {
      await cleanBuildDist(dist)

      expect(fs.existsSync(binary)).toBe(true)
      expect(fs.existsSync(buildOutput)).toBe(false)
      expect(fs.existsSync(looseFile)).toBe(false)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
