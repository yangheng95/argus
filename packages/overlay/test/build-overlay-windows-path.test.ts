import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(import.meta.dir, "../script/build-overlay.ts"), "utf8")

describe("build-overlay", () => {
  test("passes the locked binary path as an argument and uses LiteralPath", () => {
    expect(source).toContain("Remove-Item -Force -LiteralPath $args[0] -ErrorAction SilentlyContinue")
    expect(source).toContain('" ${builtOverlay}`')
    expect(source).not.toContain("-Path '${builtOverlay}'")
    expect(source).not.toContain("Remove-Item -Force -Path")
  })

  test("regenerates embedded overlay UI module before SDK rebuild", () => {
    expect(source).toContain("discoverOverlayUiSourceFiles")
    expect(source).toContain("renderEmbeddedOverlayUiModule")
    expect(source).toContain("resolveEmbeddedOverlayUiModulePath")

    const viteBuildIndex = source.indexOf("bun run build:vite")
    const regenerateIndex = source.indexOf('step("Regenerate embedded overlay UI module")')
    const sdkRebuildIndex = source.indexOf('step("Rebuild SDK")')

    expect(viteBuildIndex).toBeGreaterThan(-1)
    expect(regenerateIndex).toBeGreaterThan(viteBuildIndex)
    expect(sdkRebuildIndex).toBeGreaterThan(regenerateIndex)
  })
})
