import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { readFileSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { tmpdir } from "node:os"
import {
  artifactBrowserMcpNodeExternalModules,
  artifactBrowserMcpNodeExecutableName,
  artifactEntrypoints,
  artifactExecutableName,
  artifactExternalModules,
  artifactHostCanProvideNodeRuntime,
  artifactPackageBaseName,
  type ArtifactNodeRuntimeTarget,
  artifactRuntimeNodeModules,
  artifactRuntimeNodeModuleNames,
  artifactSourcemap,
  parseBuildFlavor,
} from "../../script/build-artifact"
import { copyRuntimeNodeModules } from "../../script/build-runtime-node-modules"

function currentRuntimeTarget(): ArtifactNodeRuntimeTarget {
  const target: ArtifactNodeRuntimeTarget = { os: process.platform, arch: process.arch }
  if (process.platform === "linux" && process.env.OPENCORVUS_LIBC === "musl") return { ...target, abi: "musl" }
  return target
}

function currentBunCompileTarget(): string {
  const target = currentRuntimeTarget()
  return ["bun", target.os === "win32" ? "windows" : target.os, target.arch, target.abi].filter(Boolean).join("-")
}

describe("build-artifact", () => {
  test("default flavor stays on the full cli artifact name", () => {
    expect(parseBuildFlavor(["bun", "run", "build"])).toBe("cli")
    expect(artifactPackageBaseName("opencorvus", "cli")).toBe("opencorvus")
  })

  test("overlay-server flavor gets a distinct artifact name", () => {
    expect(parseBuildFlavor(["bun", "run", "build", "--overlay-server"])).toBe("overlay-server")
    expect(artifactPackageBaseName("opencorvus", "overlay-server")).toBe("opencorvus-overlay-server")
  })

  test("overlay-server build scripts do not compile a bundled TUI sibling binary", () => {
    const buildSource = readFileSync(resolve(import.meta.dir, "../../script/build.ts"), "utf8")
    const localBuildSource = readFileSync(resolve(import.meta.dir, "../../script/build.local.ts"), "utf8")
    for (const source of [buildSource, localBuildSource]) {
      expect(source).not.toContain("artifactTuiSiblingExecutableName")
      expect(source).not.toContain("opencorvus-tui.exe")
      expect(source).toContain("entrypoints: artifactEntrypoints(buildFlavor)")
      expect(source).not.toContain("@opentui")
      expect(source).not.toContain("parser.worker")
      expect(source).not.toContain("src/cli/cmd/tui/worker.ts")
    }
  })

  test("overlay-server build scripts do not package the removed coding agent TUI plugin", () => {
    const buildSource = readFileSync(resolve(import.meta.dir, "../../script/build.ts"), "utf8")
    const localBuildSource = readFileSync(resolve(import.meta.dir, "../../script/build.local.ts"), "utf8")
    const tauriBuildSource = readFileSync(resolve(import.meta.dir, "../../../overlay/src-tauri/build.rs"), "utf8")

    for (const source of [buildSource, localBuildSource]) {
      expect(source).not.toContain("buildCodingAgentTuiWorker")
      expect(source).not.toContain("requiredPluginResourcePath")
      expect(source).not.toContain("embedded-worker")
      expect(source).not.toContain("opencorvus-tui-runtime")
      expect(source).not.toContain("coding-agent-tui-worker")
      expect(source).not.toContain("@opencorvus-ai/coding-agent-tui")
      expect(source).not.toContain("@opencorvus-ai/tui-app")
      expect(source).not.toContain("src/cli/cmd/tui/embedded-worker.tsx")
    }

    expect(tauriBuildSource).toContain("collect_plugin_resource_files")
    expect(tauriBuildSource).toContain("plugin_manifest_resource_path")
    expect(tauriBuildSource).toContain("EMBEDDED_PLUGIN_RESOURCE_FILES")
  })

  test("CLI executable artifact name is platform-specific and used by build scripts", () => {
    expect(artifactExecutableName("win32")).toBe("opencorvus.exe")
    expect(artifactExecutableName("windows-x64")).toBe("opencorvus.exe")
    expect(artifactExecutableName("linux")).toBe("opencorvus")
    expect(artifactExecutableName("darwin")).toBe("opencorvus")

    const buildSource = readFileSync(resolve(import.meta.dir, "../../script/build.ts"), "utf8")
    const localBuildSource = readFileSync(resolve(import.meta.dir, "../../script/build.local.ts"), "utf8")
    for (const source of [buildSource, localBuildSource]) {
      expect(source).toContain("artifactExecutableName(item.os)")
      expect(source).not.toContain("outfile: `dist/${name}/opencorvus`")
    }
  })

  test("package-local builds overlay-server sidecars before Docker overlay packaging", () => {
    const source = readFileSync(resolve(import.meta.dir, "../../../../script/package-local.ts"), "utf8")
    expect(source.indexOf("bun run build:vite")).toBeLessThan(source.indexOf("bun run build --overlay-server --all"))
    expect(source).toContain("bun run build --overlay-server --all")
    expect(source).not.toContain("bun run build --all")
    expect(source).toContain("Docker is required for Linux overlay builds")
    expect(source).not.toContain("skipping Linux overlay builds")
  })

  test("overlay-server build embeds the current UI bundle before compiling", () => {
    const buildSource = readFileSync(resolve(import.meta.dir, "../../script/build.ts"), "utf8")
    const overlayBuildSource = readFileSync(resolve(import.meta.dir, "../../../overlay/script/build.ts"), "utf8")

    expect(buildSource).toContain("discoverOverlayUiSourceFiles")
    expect(buildSource).toContain("renderEmbeddedOverlayUiModule")
    expect(buildSource).toContain('if (buildFlavor === "overlay-server")')
    expect(buildSource).toContain("Embedded overlay UI files:")
    const writeIndex = buildSource.indexOf("const embeddedCount = await writeEmbeddedOverlayUiModuleForBuild()")
    const compileIndex = buildSource.indexOf("entrypoints: artifactEntrypoints(buildFlavor)", writeIndex)
    const resetIndex = buildSource.indexOf("await resetEmbeddedOverlayUiModuleForBuild()", compileIndex)
    expect(writeIndex).toBeGreaterThan(-1)
    expect(compileIndex).toBeGreaterThan(writeIndex)
    expect(resetIndex).toBeGreaterThan(compileIndex)
    expect(overlayBuildSource.indexOf("bun run build:vite")).toBeLessThan(
      overlayBuildSource.indexOf("bun run build --overlay-server"),
    )
  })

  test("overlay UI generated module stays empty in source form", () => {
    const generatedSource = readFileSync(
      resolve(import.meta.dir, "../../src/server/overlay-ui-embedded.generated.ts"),
      "utf8",
    )

    expect(generatedSource).toContain("export const EMBEDDED_OVERLAY_UI: readonly EmbeddedOverlayUiFile[] = []")
    expect(generatedSource).not.toContain('with { type: "file" }')
    expect(generatedSource).not.toContain("import file")
    expect(generatedSource).not.toContain("dist-vite")
  })

  test("overlay-server build emits a single payload stamp for Tauri rerun detection", () => {
    const buildSource = readFileSync(resolve(import.meta.dir, "../../script/build.ts"), "utf8")
    const tauriBuildSource = readFileSync(resolve(import.meta.dir, "../../../overlay/src-tauri/build.rs"), "utf8")

    expect(buildSource).toContain('const OVERLAY_PAYLOAD_STAMP_FILE = ".opencorvus-overlay-payload.stamp"')
    expect(buildSource).toContain("async function writeOverlayPayloadStamp")
    expect(buildSource).toContain('if (buildFlavor === "overlay-server")')
    expect(buildSource).toContain('await writeOverlayPayloadStamp(path.join(dir, "dist", name))')

    expect(tauriBuildSource).toContain('const OVERLAY_PAYLOAD_STAMP_FILE: &str = ".opencorvus-overlay-payload.stamp";')
    expect(tauriBuildSource).toContain("fn require_payload_stamp")
    expect(tauriBuildSource).toContain('println!("cargo:rerun-if-changed={}", stamp.display())')
    expect(tauriBuildSource).not.toContain("for rel in collect_payload_files(&embed_path)")
    expect(tauriBuildSource).not.toContain('println!("cargo:rerun-if-changed={}", root.join(rel).display())')
  })

  test("overlay-server flavor compiles only the overlay launcher entrypoint", () => {
    expect(artifactEntrypoints("overlay-server")).toEqual(["./src/overlay-launcher.ts"])
  })

  test("default flavor compiles only through the binary launcher", () => {
    expect(artifactEntrypoints("cli")).toEqual(["./src/launcher.ts"])
  })

  test("compiled launchers turn entrypoint import failures into nonzero process exits", () => {
    const binaryLauncherSource = readFileSync(resolve(import.meta.dir, "../../src/runtime/binary-launcher.ts"), "utf8")
    const cliLauncherSource = readFileSync(resolve(import.meta.dir, "../../src/launcher.ts"), "utf8")
    const overlayLauncherSource = readFileSync(resolve(import.meta.dir, "../../src/overlay-launcher.ts"), "utf8")

    expect(cliLauncherSource).toContain('await runCompiledBinaryEntrypoint(() => import("./index.ts"))')
    expect(overlayLauncherSource).toContain('await runCompiledBinaryEntrypoint(() => import("./overlay-server.ts"))')
    expect(binaryLauncherSource).toContain("process.exitCode = 1")
    expect(binaryLauncherSource).toContain("process.exit(1)")
    expect(binaryLauncherSource).toContain("formatEntrypointError(error)")
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

  test("packaged runtime keeps AWS credential providers as packaged node modules", () => {
    expect(artifactExternalModules()).toContain("@aws-sdk/credential-providers")
    expect(artifactRuntimeNodeModuleNames(currentRuntimeTarget())).toContain("@aws-sdk/credential-providers")
    const vendorSource = readFileSync(resolve(import.meta.dir, "../../src/provider/vendor.ts"), "utf8")
    expect(vendorSource).not.toContain('import { fromNodeProviderChain } from "@aws-sdk/credential-providers"')
    expect(vendorSource).toContain('await import("@aws-sdk/credential-providers")')
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
    const capabilitySource = readFileSync(resolve(import.meta.dir, "../../src/platform/capability.ts"), "utf8")
    const ptyHostSource = readFileSync(resolve(import.meta.dir, "../../src/pty/host.ts"), "utf8")
    const regionComparisonSource = readFileSync(
      resolve(import.meta.dir, "../../src/browser-preview/region-comparison.ts"),
      "utf8",
    )
    const visualRegionBindingToolSource = readFileSync(
      resolve(import.meta.dir, "../../src/frontend-design/visual-region-binding-tool.ts"),
      "utf8",
    )

    expect(watcherSource).not.toContain('from "@parcel/watcher/wrapper"')
    expect(watcherSource).not.toContain("@parcel/watcher-${process.platform}")
    expect(watcherSource).toContain('requireRuntimePackage<typeof import("@parcel/watcher")>("@parcel/watcher")')
    expect(screenshotSource).not.toContain('from "node-screenshots"')
    expect(screenshotSource).toContain('requireRuntimePackage<typeof import("node-screenshots")>')
    expect(capabilitySource).toContain('requireRuntimePackage("node-screenshots")')
    expect(capabilitySource).toContain('requireRuntimePackage("@parcel/watcher")')
    expect(ptyHostSource).not.toContain('from "@lydell/node-pty"')
    expect(ptyHostSource).toContain('requireRuntimePackage<typeof import("@lydell/node-pty")>')
    expect(regionComparisonSource).not.toContain('from "sharp"')
    expect(regionComparisonSource).toContain('requireRuntimePackage<typeof import("sharp")>("sharp")')
    expect(visualRegionBindingToolSource).not.toContain('from "sharp"')
    expect(visualRegionBindingToolSource).toContain('requireRuntimePackage<typeof import("sharp")>("sharp")')
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

  test("runtime node module copy keeps current-target package dependencies in the runtime node_modules root", async () => {
    const outdir = await mkdtemp(resolve(tmpdir(), "opencorvus-runtime-node-modules-"))
    try {
      const target = currentRuntimeTarget()
      const nativeRuntimeModules = artifactRuntimeNodeModules(target).filter((item) =>
        ["sharp", "@parcel/watcher", "node-screenshots"].includes(item.name),
      )
      const currentTargetNativePackages = nativeRuntimeModules.flatMap((item) => item.runtimeDependencies ?? [])
      await copyRuntimeNodeModules(target, outdir, resolve(import.meta.dir, "../../"), nativeRuntimeModules)
      expect(existsSync(resolve(outdir, "node_modules/@img/colour/package.json"))).toBe(true)
      for (const packageName of currentTargetNativePackages) {
        expect(existsSync(resolve(outdir, "node_modules", ...packageName.split("/"), "package.json"))).toBe(true)
      }
      expect(existsSync(resolve(outdir, "node_modules/@parcel/watcher/wrapper.js"))).toBe(true)
      expect(existsSync(resolve(outdir, "node_modules/detect-libc/package.json"))).toBe(true)
      expect(existsSync(resolve(outdir, "node_modules/@parcel/watcher/node_modules/detect-libc/package.json"))).toBe(
        true,
      )
      expect(existsSync(resolve(outdir, "node_modules/micromatch/package.json"))).toBe(true)
    } finally {
      await rm(outdir, { recursive: true, force: true })
    }
  })

  test("runtime node module copy flattens the AWS shared dependency graph", async () => {
    const outdir = await mkdtemp(resolve(tmpdir(), "opencorvus-aws-runtime-node-modules-"))
    try {
      await copyRuntimeNodeModules(currentRuntimeTarget(), outdir, resolve(import.meta.dir, "../../"), [
        { name: "@aws-sdk/credential-providers" },
      ])
      expect(existsSync(resolve(outdir, "node_modules/@aws-sdk/credential-providers/package.json"))).toBe(true)
      expect(existsSync(resolve(outdir, "node_modules/@smithy/property-provider/package.json"))).toBe(true)
      expect(
        existsSync(
          resolve(outdir, "node_modules/@aws-sdk/credential-providers/node_modules/@smithy/property-provider"),
        ),
      ).toBe(false)
    } finally {
      await rm(outdir, { recursive: true, force: true })
    }
  }, 60000)

  test("runtime node module copy lets parcel watcher load through its package entrypoint", async () => {
    const outdir = await mkdtemp(resolve(tmpdir(), "opencorvus-parcel-watcher-runtime-"))
    try {
      const target = currentRuntimeTarget()
      const watcherRuntimeModule = artifactRuntimeNodeModules(target).find((item) => item.name === "@parcel/watcher")
      expect(watcherRuntimeModule).toBeDefined()
      await writeFile(resolve(outdir, "package.json"), JSON.stringify({ type: "commonjs" }))
      await copyRuntimeNodeModules(target, outdir, resolve(import.meta.dir, "../../"), [watcherRuntimeModule!])

      const packageJson = resolve(outdir, "package.json")
      const script = [
        'const { createRequire } = require("node:module")',
        `const runtimeRequire = createRequire(${JSON.stringify(packageJson)})`,
        'const watcher = runtimeRequire("@parcel/watcher")',
        'if (typeof watcher.subscribe !== "function") throw new Error("missing subscribe")',
      ].join(";")
      const proc = Bun.spawn([process.execPath, "-e", script], {
        stdout: "pipe",
        stderr: "pipe",
      })
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])

      expect(`${stdout}\n${stderr}`).not.toContain("Cannot find module")
      expect(exitCode).toBe(0)
    } finally {
      await rm(outdir, { recursive: true, force: true })
    }
  })

  test("runtime node module copy lets sharp load through its package entrypoint", async () => {
    const outdir = await mkdtemp(resolve(tmpdir(), "opencorvus-sharp-runtime-"))
    try {
      const target = currentRuntimeTarget()
      const sharpRuntimeModule = artifactRuntimeNodeModules(target).find((item) => item.name === "sharp")
      expect(sharpRuntimeModule).toBeDefined()
      await writeFile(resolve(outdir, "package.json"), JSON.stringify({ type: "commonjs" }))
      await copyRuntimeNodeModules(target, outdir, resolve(import.meta.dir, "../../"), [sharpRuntimeModule!])

      const packageJson = resolve(outdir, "package.json")
      const script = [
        'const { createRequire } = require("node:module")',
        `const runtimeRequire = createRequire(${JSON.stringify(packageJson)})`,
        'const sharp = runtimeRequire("sharp")',
        'if (typeof sharp !== "function") throw new Error("missing sharp callable export")',
      ].join(";")
      const proc = Bun.spawn([process.execPath, "-e", script], {
        stdout: "pipe",
        stderr: "pipe",
      })
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])

      expect(`${stdout}\n${stderr}`).not.toContain("Cannot find module")
      expect(`${stdout}\n${stderr}`).not.toContain("Cannot find package")
      expect(exitCode).toBe(0)
    } finally {
      await rm(outdir, { recursive: true, force: true })
    }
  })

  test("runtime node module copy preserves conflicting detect-libc versions for sharp and parcel watcher", async () => {
    const outdir = await mkdtemp(resolve(tmpdir(), "opencorvus-native-conflict-runtime-"))
    try {
      const target = currentRuntimeTarget()
      const modules = artifactRuntimeNodeModules(target).filter((item) =>
        ["sharp", "@parcel/watcher"].includes(item.name),
      )
      await writeFile(resolve(outdir, "package.json"), JSON.stringify({ type: "commonjs" }))
      await copyRuntimeNodeModules(target, outdir, resolve(import.meta.dir, "../../"), modules)

      const packageJson = resolve(outdir, "package.json")
      const watcherPackageJson = resolve(outdir, "node_modules", "@parcel", "watcher", "package.json")
      const script = [
        'const { createRequire } = require("node:module")',
        `const runtimeRequire = createRequire(${JSON.stringify(packageJson)})`,
        `const watcherRequire = createRequire(${JSON.stringify(watcherPackageJson)})`,
        'const sharpDetectLibc = runtimeRequire("detect-libc/package.json")',
        'const watcherDetectLibc = watcherRequire("detect-libc/package.json")',
        'if (sharpDetectLibc.version !== "2.1.2") throw new Error(`sharp detect-libc ${sharpDetectLibc.version}`)',
        'if (watcherDetectLibc.version !== "1.0.3") throw new Error(`watcher detect-libc ${watcherDetectLibc.version}`)',
        'const sharp = runtimeRequire("sharp")',
        'const watcher = runtimeRequire("@parcel/watcher")',
        'if (typeof sharp !== "function") throw new Error("missing sharp callable export")',
        'if (typeof watcher.subscribe !== "function") throw new Error("missing watcher subscribe")',
      ].join(";")
      const proc = Bun.spawn([process.execPath, "-e", script], {
        stdout: "pipe",
        stderr: "pipe",
      })
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])

      expect(`${stdout}\n${stderr}`).not.toContain("Cannot find module")
      expect(`${stdout}\n${stderr}`).not.toContain("Cannot find package")
      expect(exitCode).toBe(0)
    } finally {
      await rm(outdir, { recursive: true, force: true })
    }
  }, 60000)

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
  }, 60000)

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

  test("overlay-server compiled binary does not include browser driver internals", async () => {
    const outdir = await mkdtemp(resolve(tmpdir(), "opencorvus-overlay-bundle-"))
    const packageRoot = resolve(import.meta.dir, "../../")
    const previousCwd = process.cwd()
    const outfile = resolve(outdir, process.platform === "win32" ? "overlay-probe.exe" : "overlay-probe")
    try {
      process.chdir(packageRoot)
      const result = await Bun.build({
        conditions: ["browser"],
        entrypoints: artifactEntrypoints("overlay-server"),
        outdir,
        target: "bun",
        tsconfig: resolve(packageRoot, "tsconfig.json"),
        external: artifactExternalModules(),
        compile: {
          autoloadBunfig: false,
          autoloadDotenv: false,
          autoloadTsconfig: true,
          autoloadPackageJson: true,
          target: currentBunCompileTarget(),
          outfile,
        },
      })
      expect(result.success).toBe(true)
      const source = readFileSync(outfile)
      expect(source.includes(Buffer.from("chromium-bidi/lib/cjs/bidiMapper/BidiMapper"))).toBe(false)
      expect(source.includes(Buffer.from("BidiOverCdp"))).toBe(false)
      expect(source.includes(Buffer.from("playwright-core/lib/server"))).toBe(false)
    } finally {
      process.chdir(previousCwd)
      await rm(outdir, { recursive: true, force: true })
    }
  }, 60000)

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
