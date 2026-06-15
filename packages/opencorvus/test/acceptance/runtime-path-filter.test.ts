import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { detectAcceptanceSurfaces } from "../../src/acceptance/surface-detector"
import { discoverPackageRoot } from "../../src/acceptance/checks/discovery"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("acceptance runtime path filtering", () => {
  test("package-root discovery ignores runtime-only changed files", async () => {
    await using tmp = await tmpdir()
    await fs.writeFile(path.join(tmp.path, "package.json"), JSON.stringify({ type: "module" }))
    await fs.mkdir(path.join(tmp.path, ".opencorvus", "runtime", "nested"), { recursive: true })
    await fs.writeFile(
      path.join(tmp.path, ".opencorvus", "runtime", "nested", "package.json"),
      JSON.stringify({ type: "module" }),
    )

    const root = await Instance.provide({
      directory: tmp.path,
      fn: () => discoverPackageRoot([".opencorvus/runtime/nested/package.json"]),
    })

    expect(root).toBe(tmp.path)
  })

  test("surface detection ignores runtime-only frontend-looking files", async () => {
    await using tmp = await tmpdir()
    await fs.writeFile(path.join(tmp.path, "package.json"), JSON.stringify({ type: "module" }))

    const manifest = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        detectAcceptanceSurfaces({
          changedFiles: [".opencorvus/runtime/tasks/tsk/frontend-design/visual-html-skeleton/src/App.tsx"],
        }),
    })

    expect(manifest.surfaces).not.toContain("frontend")
    expect(JSON.stringify(manifest.evidence)).not.toContain(".opencorvus/runtime")
  })
})
