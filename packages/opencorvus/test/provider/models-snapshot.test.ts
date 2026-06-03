import { expect, test } from "bun:test"
import path from "path"
import { Filesystem } from "../../src/util/filesystem"

const repo = path.resolve(import.meta.dir, "../../../..")
const packageRoot = path.join(repo, "packages", "opencorvus")
const snapshotPath = path.join(packageRoot, "src", "provider", "models-snapshot.ts")

test("models snapshot is a checked-in offline provider source", async () => {
  const ignore = await Filesystem.readText(path.join(packageRoot, ".gitignore"))
  expect(ignore).not.toContain("src/provider/models-snapshot.ts")

  const snapshot = await import("../../src/provider/models-snapshot")
  expect(Object.keys(snapshot.snapshot).length).toBeGreaterThan(0)
})

test("build scripts can reuse the checked-in snapshot without registry fetch", async () => {
  for (const script of ["build.ts", "build.local.ts"]) {
    const text = await Filesystem.readText(path.join(packageRoot, "script", script))
    expect(text).toContain("OPENCORVUS_DISABLE_MODELS_FETCH")
    expect(text).toContain("readExistingModelsSnapshot")
    expect(text).toContain("modelsSnapshotPath")
  }
})
