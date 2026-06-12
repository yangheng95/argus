import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  archiveBinaryArtifact,
  assertLinuxX64Host,
  copyBinaryArtifact,
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
    expect(artifacts.map((artifact) => artifact.sourceBundleDir)).toEqual([
      path.join("/repo", "packages", "opencorvus", "dist", "opencorvus-overlay-server-linux-x64"),
      path.join("/repo", "packages", "opencorvus", "dist", "opencorvus-overlay-server-linux-x64-baseline"),
    ])
    expect(artifacts.map((artifact) => artifact.output)).toEqual([
      path.join("/repo", "packages", "opencorvus", "dist", "binary", "opencorvus-linux-x64", "opencorvus"),
      path.join("/repo", "packages", "opencorvus", "dist", "binary", "opencorvus-linux-x64-baseline", "opencorvus"),
    ])
    expect(artifacts.map((artifact) => artifact.bundleDir)).toEqual([
      path.join("/repo", "packages", "opencorvus", "dist", "binary", "opencorvus-linux-x64"),
      path.join("/repo", "packages", "opencorvus", "dist", "binary", "opencorvus-linux-x64-baseline"),
    ])
    expect(artifacts.map((artifact) => artifact.archive)).toEqual([
      path.join(
        "/repo",
        "packages",
        "opencorvus",
        "dist",
        "binary",
        "opencorvus-linux-x64",
        "opencorvus-bundle.tar.gz",
      ),
      path.join(
        "/repo",
        "packages",
        "opencorvus",
        "dist",
        "binary",
        "opencorvus-linux-x64-baseline",
        "opencorvus-bundle.tar.gz",
      ),
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

  test("copies browser MCP node runtime into the final Linux bundle", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencorvus-package-linux-runtime-"))
    try {
      const artifact = resolveLinuxBinaryArtifacts(repoRoot)[0]
      await fs.promises.mkdir(path.join(artifact.sourceBundleDir, "browser-mcp-node", "node_modules", "playwright"), {
        recursive: true,
      })
      await fs.promises.mkdir(path.join(artifact.sourceBundleDir, "ui"), { recursive: true })
      await fs.promises.writeFile(artifact.source, "")
      await fs.promises.writeFile(path.join(artifact.sourceBundleDir, "browser-mcp-node", "node"), "")
      await fs.promises.writeFile(path.join(artifact.sourceBundleDir, "browser-mcp-node", "browser.mjs"), "")
      await fs.promises.writeFile(
        path.join(artifact.sourceBundleDir, "browser-mcp-node", "node_modules", "playwright", "package.json"),
        "{}",
      )
      await fs.promises.writeFile(path.join(artifact.sourceBundleDir, "ui", "index.html"), "")

      await copyBinaryArtifact(artifact)

      expect(fs.existsSync(artifact.output)).toBe(true)
      expect(fs.existsSync(path.join(artifact.bundleDir, "browser-mcp-node", "node"))).toBe(true)
      expect(fs.existsSync(path.join(artifact.bundleDir, "browser-mcp-node", "browser.mjs"))).toBe(true)
      expect(
        fs.existsSync(path.join(artifact.bundleDir, "browser-mcp-node", "node_modules", "playwright", "package.json")),
      ).toBe(true)
    } finally {
      await fs.promises.rm(repoRoot, { recursive: true, force: true })
    }
  })

  test("archives the final Linux bundle as one Docker context file", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencorvus-package-linux-archive-"))
    try {
      const artifact = resolveLinuxBinaryArtifacts(repoRoot)[0]
      await fs.promises.mkdir(path.join(artifact.bundleDir, "browser-mcp-node"), { recursive: true })
      await fs.promises.writeFile(artifact.output, "binary")
      await fs.promises.writeFile(path.join(artifact.bundleDir, "browser-mcp-node", "browser.mjs"), "browser")

      await archiveBinaryArtifact(artifact)

      expect(fs.existsSync(artifact.archive)).toBe(true)
      expect(fs.statSync(artifact.archive).size).toBeGreaterThan(0)
    } finally {
      await fs.promises.rm(repoRoot, { recursive: true, force: true })
    }
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

  test("container image packages the current Linux binary bundle with Node and Git", async () => {
    const dockerfile = await Bun.file(path.resolve(import.meta.dir, "../../Dockerfile")).text()
    const dockerignore = await Bun.file(path.resolve(import.meta.dir, "../../../../.dockerignore")).text()
    const entrypoint = await Bun.file(
      path.resolve(import.meta.dir, "../../../../script/opencorvus-container-entrypoint.sh"),
    ).text()

    expect(dockerfile).toContain("ARG OPENCORVUS_BINARY_NAME=opencorvus-linux-x64")
    expect(dockerfile).toContain(
      "COPY packages/opencorvus/dist/binary/${OPENCORVUS_BINARY_NAME}/opencorvus-bundle.tar.gz",
    )
    expect(dockerfile).toContain("COPY script/opencorvus-container-entrypoint.sh")
    expect(dockerfile).toContain("FROM debian:bookworm-slim")
    expect(dockerfile).toContain("chromium")
    expect(dockerfile).toContain("git")
    expect(dockerfile).toContain("libgcc-s1")
    expect(dockerfile).toContain("libstdc++6")
    expect(dockerfile).toContain("nodejs")
    expect(dockerfile).toContain("npm")
    expect(dockerfile).toContain("test -x /opt/opencorvus/browser-mcp-node/node")
    expect(dockerfile).toContain("test -f /opt/opencorvus/browser-mcp-node/browser.mjs")
    expect(dockerfile).not.toContain("test -f /opt/opencorvus/browser-mcp-node/stdio.mjs")
    expect(dockerfile).not.toContain("test -f /opt/opencorvus/browser-mcp-node/http.mjs")
    expect(dockerfile).toContain("test -f /opt/opencorvus/browser-mcp-node/node_modules/playwright/index.js")
    expect(dockerfile).toContain("chromium --version")
    expect(dockerfile).toContain('ENTRYPOINT ["/usr/local/bin/opencorvus-container-entrypoint"]')
    expect(dockerfile).not.toContain("dist/opencorvus-linux-x64-baseline-musl")
    expect(dockerignore).toContain("!packages/opencorvus/dist/binary/opencorvus-linux-x64/opencorvus-bundle.tar.gz")
    expect(dockerignore).toContain(
      "!packages/opencorvus/dist/binary/opencorvus-linux-x64-baseline/opencorvus-bundle.tar.gz",
    )
    expect(dockerignore).toContain("!script/opencorvus-container-entrypoint.sh")
    expect(entrypoint).toContain('OPENCORVUS_BIN="${OPENCORVUS_BIN:-/opt/opencorvus/opencorvus}"')
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
