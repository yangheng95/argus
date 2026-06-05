import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const REPO_ROOT = path.resolve(import.meta.dir, "../../../..")

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, relativePath), "utf8")) as T
}

function readText(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), "utf8")
}

describe("OpenCode TUI dependency substrate", () => {
  test("uses the upstream OpenTUI and terminal host dependency versions", () => {
    const rootPackage = readJson<{
      workspaces: { catalog: Record<string, string> }
      overrides: Record<string, string>
    }>("package.json")
    const opencorvusPackage = readJson<{ dependencies: Record<string, string> }>("packages/opencorvus/package.json")
    const overlayPackage = readJson<{ dependencies: Record<string, string> }>("packages/overlay/package.json")

    expect(rootPackage.workspaces.catalog["@opentui/core"]).toBe("0.3.1")
    expect(rootPackage.workspaces.catalog["@opentui/solid"]).toBe("0.3.1")
    expect(rootPackage.workspaces.catalog["@opentui/keymap"]).toBe("0.3.1")
    expect(rootPackage.workspaces.catalog["@lydell/node-pty"]).toBe("1.2.0-beta.12")
    expect(rootPackage.overrides["@opentui/core"]).toBe("catalog:")
    expect(rootPackage.overrides["@opentui/solid"]).toBe("catalog:")
    expect(rootPackage.overrides["@opentui/keymap"]).toBe("catalog:")

    expect(opencorvusPackage.dependencies["@opentui/core"]).toBe("catalog:")
    expect(opencorvusPackage.dependencies["@opentui/solid"]).toBe("catalog:")
    expect(opencorvusPackage.dependencies["@opentui/keymap"]).toBe("catalog:")
    expect(opencorvusPackage.dependencies["@lydell/node-pty"]).toBe("catalog:")
    expect(overlayPackage.dependencies["ghostty-web"]).toBeUndefined()
  })

  test("does not keep the old OpenTUI 0.1.81 packages in the lockfile", () => {
    const lockfile = readText("bun.lock")

    expect(lockfile).toContain('"@opentui/core": "0.3.1"')
    expect(lockfile).toContain('"@opentui/solid": "0.3.1"')
    expect(lockfile).toContain('"@opentui/keymap": "0.3.1"')
    expect(lockfile).toContain('"@lydell/node-pty": "1.2.0-beta.12"')
    expect(lockfile).not.toContain('"ghostty-web": "github:anomalyco/ghostty-web#main"')
    expect(lockfile).not.toContain("@opentui/core@0.1.81")
    expect(lockfile).not.toContain("@opentui/solid@0.1.81")
  })
})
