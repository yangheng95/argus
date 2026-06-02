import { describe, expect, test } from "bun:test"
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

  test("browser MCP node sidecar keeps Playwright as packaged node modules", () => {
    expect(artifactBrowserMcpNodeExternalModules()).toContain("playwright")
    expect(artifactBrowserMcpNodeExternalModules()).toContain("playwright-core")
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
    expect(
      artifactHostCanProvideNodeRuntime(
        { os: "win32", arch: "x64" },
        { platform: "win32", arch: "x64" },
      ),
    ).toBe(true)
  })
})
