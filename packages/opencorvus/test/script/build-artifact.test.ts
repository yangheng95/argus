import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { resolve } from "node:path"
import { tmpdir } from "node:os"
import {
  artifactBrowserMcpNodeExternalModules,
  artifactBrowserMcpNodeExecutableName,
  artifactEntrypoints,
  artifactExternalModules,
  artifactHostCanProvideNodeRuntime,
  artifactPackageBaseName,
  artifactSourcemap,
  parseBuildFlavor,
} from "../../script/build-artifact"

describe("build-artifact", () => {
  test("default flavor stays on the full cli artifact name", () => {
    expect(parseBuildFlavor(["bun", "run", "build"])).toBe("cli")
    expect(artifactPackageBaseName("opencorvus", "cli")).toBe("opencorvus")
  })

  test("overlay-server flavor gets a distinct artifact name", () => {
    expect(parseBuildFlavor(["bun", "run", "build", "--overlay-server"])).toBe("overlay-server")
    expect(artifactPackageBaseName("opencorvus", "overlay-server")).toBe("opencorvus-overlay-server")
  })

  test("overlay-server flavor compiles only the serve entrypoint", () => {
    expect(artifactEntrypoints("overlay-server", "parser.worker.js", "./src/cli/cmd/tui/worker.ts")).toEqual([
      "./src/overlay-server.ts",
    ])
  })

  test("release artifacts never emit sourcemaps", () => {
    expect(artifactSourcemap()).toBe("none")
  })

  test("optional Playwright Electron module is externalized", () => {
    expect(artifactExternalModules()).toContain("electron")
  })

  test("packaged browser runtime keeps Playwright as packaged node modules", () => {
    expect(artifactExternalModules()).toContain("playwright")
    expect(artifactExternalModules()).toContain("playwright-core")
    expect(artifactExternalModules()).toContain("chromium-bidi")
    expect(artifactBrowserMcpNodeExternalModules()).toContain("playwright")
    expect(artifactBrowserMcpNodeExternalModules()).toContain("playwright-core")
    expect(artifactBrowserMcpNodeExternalModules()).toContain("chromium-bidi")
  })

  test("overlay browser automation modules do not statically import browser drivers", () => {
    const files = [
      "src/runtime/visual-page.ts",
      "src/acceptance/checks/walkthrough/run.ts",
      "src/mcp/browser/guard.ts",
      "src/mcp/browser/perf.ts",
      "src/mcp/browser/sessions.ts",
      "src/mcp/browser/tools.ts",
      "src/mirror/url/extract.ts",
    ]
    for (const file of files) {
      const source = readFileSync(resolve(import.meta.dir, "../../", file), "utf8")
      expect(source).not.toMatch(/\bfrom\s+["']playwright["']/)
      expect(source).not.toMatch(/\bfrom\s+["']puppeteer-core["']/)
    }
  })

  test("overlay-server bundle does not include browser driver internals", async () => {
    const outdir = await mkdtemp(resolve(tmpdir(), "opencorvus-overlay-bundle-"))
    try {
      const result = await Bun.build({
        entrypoints: [resolve(import.meta.dir, "../../src/overlay-server.ts")],
        outdir,
        target: "bun",
        external: artifactExternalModules(),
      })
      expect(result.success).toBe(true)
      const source = readFileSync(resolve(outdir, "overlay-server.js"), "utf8")
      expect(source).not.toContain("chromium-bidi/lib/cjs/bidiMapper/BidiMapper")
      expect(source).not.toContain("BidiOverCdp")
      expect(source).not.toContain("playwright-core/lib/server")
    } finally {
      await rm(outdir, { recursive: true, force: true })
    }
  })

  test("browser MCP node runtime executable name is platform specific", () => {
    expect(artifactBrowserMcpNodeExecutableName("win32")).toBe("node.exe")
    expect(artifactBrowserMcpNodeExecutableName("linux")).toBe("node")
    expect(artifactBrowserMcpNodeExecutableName("darwin")).toBe("node")
  })

  test("browser MCP node runtime host must match linux libc", () => {
    expect(
      artifactHostCanProvideNodeRuntime(
        { os: "linux", arch: "x64", abi: "musl" },
        { platform: "linux", arch: "x64", linuxLibc: "musl" },
      ),
    ).toBe(true)
    expect(
      artifactHostCanProvideNodeRuntime(
        { os: "linux", arch: "x64", abi: "musl" },
        { platform: "linux", arch: "x64", linuxLibc: "glibc" },
      ),
    ).toBe(false)
    expect(
      artifactHostCanProvideNodeRuntime(
        { os: "linux", arch: "x64" },
        { platform: "linux", arch: "x64", linuxLibc: "glibc" },
      ),
    ).toBe(true)
    expect(artifactHostCanProvideNodeRuntime({ os: "win32", arch: "x64" }, { platform: "win32", arch: "x64" })).toBe(
      true,
    )
  })
})
