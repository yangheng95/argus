import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
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
  artifactRuntimeNodeModules,
  artifactRuntimeNodeModuleNames,
  artifactSourcemap,
  artifactTuiSiblingExecutableName,
  parseBuildFlavor,
} from "../../script/build-artifact"
import { copyRuntimeNodeModules } from "../../script/build-runtime-node-modules"

describe("build-artifact", () => {
  test("default flavor stays on the full cli artifact name", () => {
    expect(parseBuildFlavor(["bun", "run", "build"])).toBe("cli")
    expect(artifactPackageBaseName("opencorvus", "cli")).toBe("opencorvus")
  })

  test("overlay-server flavor gets a distinct artifact name", () => {
    expect(parseBuildFlavor(["bun", "run", "build", "--overlay-server"])).toBe("overlay-server")
    expect(artifactPackageBaseName("opencorvus", "overlay-server")).toBe("opencorvus-overlay-server")
  })

  test("overlay-server flavor names the bundled full TUI sibling binary", () => {
    expect(artifactTuiSiblingExecutableName("win32")).toBe("opencorvus-tui.exe")
    expect(artifactTuiSiblingExecutableName("linux")).toBe("opencorvus-tui")
  })

  test("overlay-server build scripts compile the full TUI sibling binary", () => {
    const buildSource = readFileSync(resolve(import.meta.dir, "../../script/build.ts"), "utf8")
    const localBuildSource = readFileSync(resolve(import.meta.dir, "../../script/build.local.ts"), "utf8")
    for (const source of [buildSource, localBuildSource]) {
      expect(source).toContain('if (buildFlavor === "overlay-server")')
      expect(source).toContain('artifactTuiSiblingExecutableName(item.os).replace(/\\.exe$/, "")')
      expect(source).toContain('entrypoints: artifactEntrypoints("cli", parserWorker, workerPath)')
    }
  })

  test("overlay-server flavor compiles only the launcher entrypoint", () => {
    expect(artifactEntrypoints("overlay-server", "parser.worker.js", "./src/cli/cmd/tui/worker.ts")).toEqual([
      "./src/overlay-launcher.ts",
    ])
  })

  test("default flavor compiles through the binary launcher", () => {
    expect(artifactEntrypoints("cli", "parser.worker.js", "./src/cli/cmd/tui/worker.ts")).toEqual([
      "./src/launcher.ts",
      "parser.worker.js",
      "./src/cli/cmd/tui/worker.ts",
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

  test("packaged runtime keeps native Node packages as packaged node modules", () => {
    expect(artifactExternalModules()).toContain("sharp")
    expect(artifactExternalModules()).toContain("@parcel/watcher")
    expect(artifactExternalModules()).toContain("@parcel/watcher/wrapper")
    expect(artifactExternalModules()).toContain("@lydell/node-pty")
    expect(artifactExternalModules()).toContain("node-screenshots")
  })

  test("packaged native modules load through runtime package resolver", () => {
    const watcherSource = readFileSync(resolve(import.meta.dir, "../../src/file/watcher.ts"), "utf8")
    const screenshotSource = readFileSync(resolve(import.meta.dir, "../../src/gui/screenshot.ts"), "utf8")
    const buildScreenshotSource = readFileSync(resolve(import.meta.dir, "../../src/build/screenshot-tool.ts"), "utf8")
    const capabilitySource = readFileSync(resolve(import.meta.dir, "../../src/platform/capability.ts"), "utf8")
    const tuiHostSource = readFileSync(resolve(import.meta.dir, "../../src/tui/host.ts"), "utf8")

    expect(watcherSource).not.toContain('from "@parcel/watcher/wrapper"')
    expect(watcherSource).toContain("requireRuntimePackage<typeof import(\"@parcel/watcher/wrapper\")>")
    expect(screenshotSource).not.toContain('from "node-screenshots"')
    expect(screenshotSource).toContain('requireRuntimePackage<typeof import("node-screenshots")>')
    expect(buildScreenshotSource).not.toContain('from "sharp"')
    expect(buildScreenshotSource).toContain('requireRuntimePackage<typeof import("sharp")>')
    expect(capabilitySource).toContain('requireRuntimePackage("node-screenshots")')
    expect(tuiHostSource).not.toContain('from "@lydell/node-pty"')
    expect(tuiHostSource).toContain('requireRuntimePackage<typeof import("@lydell/node-pty")>')
  })

  test("runtime node module set includes win32 x64 native packages only for win32 x64", () => {
    const packages = artifactRuntimeNodeModuleNames({ os: "win32", arch: "x64" })
    expect(packages).toContain("@lydell/node-pty")
    expect(packages).toContain("@lydell/node-pty-win32-x64")
    expect(packages).toContain("sharp")
    expect(packages).toContain("@img/sharp-win32-x64")
    expect(packages).toContain("@parcel/watcher-win32-x64")
    expect(packages).toContain("node-screenshots-win32-x64-msvc")
    expect(packages).not.toContain("@img/sharp-linux-x64")
    expect(packages).not.toContain("@img/sharp-libvips-linux-x64")
    expect(packages).not.toContain("node-screenshots-linux-x64-gnu")
  })

  test("runtime node module set includes linux glibc native packages", () => {
    const packages = artifactRuntimeNodeModuleNames({ os: "linux", arch: "x64" })
    expect(packages).toContain("@img/sharp-linux-x64")
    expect(packages).toContain("@img/sharp-libvips-linux-x64")
    expect(packages).toContain("@parcel/watcher-linux-x64-glibc")
    expect(packages).toContain("node-screenshots-linux-x64-gnu")
    expect(packages).not.toContain("@img/sharp-linuxmusl-x64")
    expect(packages).not.toContain("node-screenshots-linux-x64-musl")
  })

  test("runtime node module set includes linux musl native packages", () => {
    const packages = artifactRuntimeNodeModuleNames({ os: "linux", arch: "x64", abi: "musl" })
    expect(packages).toContain("@img/sharp-linuxmusl-x64")
    expect(packages).toContain("@img/sharp-libvips-linuxmusl-x64")
    expect(packages).toContain("@parcel/watcher-linux-x64-musl")
    expect(packages).toContain("node-screenshots-linux-x64-musl")
    expect(packages).not.toContain("@img/sharp-linux-x64")
    expect(packages).not.toContain("node-screenshots-linux-x64-gnu")
  })

  test("runtime node module set does not invent unsupported linux arm64 musl screenshots package", () => {
    const packages = artifactRuntimeNodeModuleNames({ os: "linux", arch: "arm64", abi: "musl" })
    expect(packages).toContain("@img/sharp-linuxmusl-arm64")
    expect(packages).toContain("@img/sharp-libvips-linuxmusl-arm64")
    expect(packages).toContain("@parcel/watcher-linux-arm64-musl")
    expect(packages).not.toContain("node-screenshots-linux-arm64-musl")
  })

  test("runtime node module copy keeps package-owner dependencies nested", async () => {
    const outdir = await mkdtemp(resolve(tmpdir(), "opencorvus-runtime-node-modules-"))
    try {
      const target = { os: "win32", arch: "x64" } as const
      const nativeRuntimeModules = artifactRuntimeNodeModules(target).filter((item) =>
        ["sharp", "@parcel/watcher", "node-screenshots"].includes(item.name),
      )
      await copyRuntimeNodeModules(target, outdir, resolve(import.meta.dir, "../../"), nativeRuntimeModules)
      expect(existsSync(resolve(outdir, "node_modules/sharp/node_modules/@img/colour/package.json"))).toBe(true)
      expect(existsSync(resolve(outdir, "node_modules/sharp/node_modules/@img/sharp-win32-x64/package.json"))).toBe(
        true,
      )
      expect(existsSync(resolve(outdir, "node_modules/@parcel/watcher/wrapper.js"))).toBe(true)
      expect(
        existsSync(
          resolve(outdir, "node_modules/@parcel/watcher/node_modules/@parcel/watcher-win32-x64/package.json"),
        ),
      ).toBe(true)
      expect(existsSync(resolve(outdir, "node_modules/@parcel/watcher/node_modules/micromatch/package.json"))).toBe(
        true,
      )
      expect(
        existsSync(
          resolve(outdir, "node_modules/node-screenshots/node_modules/node-screenshots-win32-x64-msvc/package.json"),
        ),
      ).toBe(true)
    } finally {
      await rm(outdir, { recursive: true, force: true })
    }
  })

  test("runtime node module copy resolves packaged Playwright modules from opencorvus", async () => {
    const outdir = await mkdtemp(resolve(tmpdir(), "opencorvus-playwright-runtime-node-modules-"))
    try {
      const target = { os: "win32", arch: "x64" } as const
      await copyRuntimeNodeModules(target, outdir, resolve(import.meta.dir, "../../"), [
        { name: "playwright" },
        { name: "playwright-core" },
        { name: "chromium-bidi" },
      ])
      expect(existsSync(resolve(outdir, "node_modules/playwright/package.json"))).toBe(true)
      expect(existsSync(resolve(outdir, "node_modules/playwright-core/package.json"))).toBe(true)
      expect(existsSync(resolve(outdir, "node_modules/chromium-bidi/package.json"))).toBe(true)
    } finally {
      await rm(outdir, { recursive: true, force: true })
    }
  })

  test("overlay browser automation modules do not statically import browser drivers", () => {
    const files = [
      "src/runtime/visual-page.ts",
      "src/acceptance/checks/walkthrough/run.ts",
      "src/mcp/browser/guard.ts",
      "src/mcp/browser/perf.ts",
      "src/mcp/browser/sessions.ts",
      "src/mcp/browser/tools.ts",
      "src/browser/webpage/extract.ts",
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
