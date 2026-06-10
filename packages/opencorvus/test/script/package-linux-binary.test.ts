import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  assertLinuxX64Host,
  discoverOverlayUiSourceFiles,
  linuxBinaryBuildEnv,
  parsePackageLinuxBinaryArgs,
  renderEmbeddedOverlayUiModule,
  resolveEmbeddedOverlayUiModulePath,
  resolveLinuxBinaryArtifacts,
  resolveLegacyLooseBinaryDir,
  resolveObsoleteLinuxBinarySidecarUiDirs,
  resolveOverlayDistDir,
} from "../../../../script/package-linux-binary"

describe("package-linux-binary", () => {
  test("copies Linux ELF outputs into single-binary bundle directories", () => {
    const artifacts = resolveLinuxBinaryArtifacts("/repo")
    expect(artifacts.map((artifact) => artifact.source)).toEqual([
      path.join("/repo", "packages", "opencorvus", "dist", "opencorvus-overlay-server-linux-x64", "opencorvus"),
      path.join(
        "/repo",
        "packages",
        "opencorvus",
        "dist",
        "opencorvus-overlay-server-linux-x64-baseline",
        "opencorvus",
      ),
    ])
    expect(artifacts.map((artifact) => artifact.output)).toEqual([
      path.join("/repo", "packages", "opencorvus", "dist", "binary", "opencorvus-linux-x64", "opencorvus"),
      path.join("/repo", "packages", "opencorvus", "dist", "binary", "opencorvus-linux-x64-baseline", "opencorvus"),
    ])
    expect(artifacts.map((artifact) => artifact.bundleDir)).toEqual([
      path.join("/repo", "packages", "opencorvus", "dist", "binary", "opencorvus-linux-x64"),
      path.join("/repo", "packages", "opencorvus", "dist", "binary", "opencorvus-linux-x64-baseline"),
    ])
  })

  test("uses an embedded UI source module and removes obsolete sidecar UI directories", () => {
    expect(resolveOverlayDistDir("/repo")).toBe(path.join("/repo", "packages", "overlay", "dist-vite"))
    expect(resolveEmbeddedOverlayUiModulePath("/repo")).toBe(
      path.join("/repo", "packages", "opencorvus", "src", "server", "overlay-ui-embedded.generated.ts"),
    )
    expect(resolveObsoleteLinuxBinarySidecarUiDirs("/repo")).toEqual([
      path.join("/repo", "packages", "opencorvus", "dist", "binary", "opencorvus-linux-x64", "ui"),
      path.join("/repo", "packages", "opencorvus", "dist", "binary", "opencorvus-linux-x64-baseline", "ui"),
    ])
    expect(resolveLegacyLooseBinaryDir("/repo")).toBe(path.join("/repo", "packages", "opencorvus", "dist", "bin"))
  })

  test("renders a Bun file-embedding module for overlay UI assets", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencorvus-package-linux-"))
    try {
      const distDir = resolveOverlayDistDir(repoRoot)
      await fs.promises.mkdir(path.join(distDir, "assets"), { recursive: true })
      await fs.promises.writeFile(path.join(distDir, "index.html"), "<!doctype html>")
      await fs.promises.writeFile(path.join(distDir, "assets", "app.js"), "console.log('ok')")

      const files = await discoverOverlayUiSourceFiles(repoRoot)
      expect(files.map((file) => file.path)).toEqual(["/assets/app.js", "/index.html"])

      const moduleSource = renderEmbeddedOverlayUiModule(resolveEmbeddedOverlayUiModulePath(repoRoot), files)
      expect(moduleSource).toContain(
        'import file0 from "../../../overlay/dist-vite/assets/app.js" with { type: "file" }',
      )
      expect(moduleSource).toContain('import file1 from "../../../overlay/dist-vite/index.html" with { type: "file" }')
      expect(moduleSource).toContain('{ path: "/assets/app.js", file: file0 }')
      expect(moduleSource).toContain('{ path: "/index.html", file: file1 }')
    } finally {
      await fs.promises.rm(repoRoot, { recursive: true, force: true })
    }
  })

  test("sets build metadata without requiring git in WSL staging copies", () => {
    expect(linuxBinaryBuildEnv({}, "0.0.1")).toMatchObject({
      OPENCORVUS_VERSION: "0.0.1",
      OPENCORVUS_CHANNEL: "local",
      OPENCORVUS_DISABLE_MODELS_FETCH: "true",
    })
    expect(
      linuxBinaryBuildEnv(
        {
          OPENCORVUS_VERSION: "1.2.3",
          OPENCORVUS_CHANNEL: "nightly",
          OPENCORVUS_DISABLE_MODELS_FETCH: "false",
        },
        "0.0.1",
      ),
    ).toMatchObject({
      OPENCORVUS_VERSION: "1.2.3",
      OPENCORVUS_CHANNEL: "nightly",
      OPENCORVUS_DISABLE_MODELS_FETCH: "false",
    })
  })

  test("builds the overlay-server flavor so the Linux binary starts the UI server by default", async () => {
    const source = await Bun.file(path.resolve(import.meta.dir, "../../../../script/package-linux-binary.ts")).text()

    expect(source).toContain("script/build.ts --overlay-server --single --baseline")
    expect(source).toContain("opencorvus-overlay-server-")
  })

  test("parses the skip-build CLI option", () => {
    expect(parsePackageLinuxBinaryArgs([])).toEqual({ skipBuild: false, skipUi: false })
    expect(parsePackageLinuxBinaryArgs(["--skip-build"])).toEqual({ skipBuild: true, skipUi: false })
    expect(parsePackageLinuxBinaryArgs(["--skip-ui"])).toEqual({ skipBuild: false, skipUi: true })
  })

  test("requires a Linux x64 build host", () => {
    expect(() => assertLinuxX64Host("linux", "x64")).not.toThrow()
    expect(() => assertLinuxX64Host("win32", "x64")).toThrow(/linux-x64/)
    expect(() => assertLinuxX64Host("linux", "arm64")).toThrow(/linux-x64/)
  })
})
