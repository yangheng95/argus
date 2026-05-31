import { describe, expect, test } from "bun:test"
import {
  artifactEntrypoints,
  artifactExternalModules,
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
})
