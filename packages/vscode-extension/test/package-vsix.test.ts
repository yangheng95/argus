import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { checkVsixSize, readPackageMeta, resolveSourceDist, vsixFilename } from "../script/package-vsix"

describe("resolveSourceDist", () => {
  test("maps each supported VS Code target to the matching opencorvus dist directory", () => {
    const root = "/tmp/repo"
    expect(resolveSourceDist({ target: "win32-x64", monorepoRoot: root })).toEqual({
      sourceDir: path.join(root, "packages", "opencorvus", "dist", "opencorvus-windows-x64"),
      binaryName: "opencorvus.exe",
      binaryPath: path.join(root, "packages", "opencorvus", "dist", "opencorvus-windows-x64", "opencorvus.exe"),
    })
    expect(resolveSourceDist({ target: "darwin-arm64", monorepoRoot: root })).toEqual({
      sourceDir: path.join(root, "packages", "opencorvus", "dist", "opencorvus-darwin-arm64"),
      binaryName: "opencorvus",
      binaryPath: path.join(root, "packages", "opencorvus", "dist", "opencorvus-darwin-arm64", "opencorvus"),
    })
    expect(resolveSourceDist({ target: "linux-x64", monorepoRoot: root }).binaryName).toBe("opencorvus")
    expect(resolveSourceDist({ target: "linux-arm64", monorepoRoot: root }).binaryName).toBe("opencorvus")
  })

  test("throws for unsupported / unknown VS Code targets", () => {
    // win32-arm64 is intentionally absent until build.yml grows a
    // windows-arm runner — guard against silent fallbacks.
    expect(() => resolveSourceDist({ target: "win32-arm64", monorepoRoot: "/tmp" })).toThrow(/win32-arm64/)
    expect(() => resolveSourceDist({ target: "freebsd-x64", monorepoRoot: "/tmp" })).toThrow(/unsupported/i)
    expect(() => resolveSourceDist({ target: "", monorepoRoot: "/tmp" })).toThrow()
  })
})

describe("vsixFilename", () => {
  test("includes target so multi-target packaging never overwrites itself", () => {
    expect(
      vsixFilename({
        target: "linux-x64",
        version: "1.2.3",
        publisher: "yangheng95",
        name: "opencorvus",
      }),
    ).toBe("yangheng95.opencorvus-1.2.3-linux-x64.vsix")
  })
})

describe("checkVsixSize", () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "opencorvus-vsix-size-"))
  })

  afterEach(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true })
    } catch {}
  })

  test("passes for small VSIX", () => {
    const file = path.join(tmp, "small.vsix")
    fs.writeFileSync(file, Buffer.alloc(1024))
    expect(() => checkVsixSize(file, 2048)).not.toThrow()
  })

  test("hard-fails when the VSIX is over the cap", () => {
    const file = path.join(tmp, "big.vsix")
    fs.writeFileSync(file, Buffer.alloc(4096))
    expect(() => checkVsixSize(file, 2048)).toThrow(/exceeds size guard/)
  })
})

describe("readPackageMeta", () => {
  let extensionRoot: string

  beforeEach(() => {
    extensionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencorvus-pkg-meta-"))
  })

  afterEach(() => {
    try {
      fs.rmSync(extensionRoot, { recursive: true, force: true })
    } catch {}
  })

  test("strips workspace scope from name so VSIX filename matches marketplace shape", () => {
    fs.writeFileSync(
      path.join(extensionRoot, "package.json"),
      JSON.stringify({
        name: "@opencorvus-ai/vscode-extension",
        version: "0.0.1",
        publisher: "yangheng95",
      }),
    )
    expect(readPackageMeta(extensionRoot)).toEqual({
      version: "0.0.1",
      publisher: "yangheng95",
      name: "vscode-extension",
    })
  })

  test("throws when name/version/publisher are missing", () => {
    fs.writeFileSync(path.join(extensionRoot, "package.json"), JSON.stringify({ name: "x" }))
    expect(() => readPackageMeta(extensionRoot)).toThrow(/missing version/)
  })
})
