import { describe, expect, test } from "bun:test"
import path from "node:path"
import {
  assertLinuxX64Host,
  linuxBinaryBuildEnv,
  parsePackageLinuxBinaryArgs,
  resolveLinuxBinaryArtifacts,
} from "../../../../script/package-linux-binary"

describe("package-linux-binary", () => {
  test("copies only the bare Linux ELF outputs into dist/bin", () => {
    const artifacts = resolveLinuxBinaryArtifacts("/repo")
    expect(artifacts.map((artifact) => artifact.source)).toEqual([
      path.join("/repo", "packages", "opencorvus", "dist", "opencorvus-linux-x64", "opencorvus"),
      path.join("/repo", "packages", "opencorvus", "dist", "opencorvus-linux-x64-baseline", "opencorvus"),
    ])
    expect(artifacts.map((artifact) => artifact.output)).toEqual([
      path.join("/repo", "packages", "opencorvus", "dist", "bin", "opencorvus-linux-x64"),
      path.join("/repo", "packages", "opencorvus", "dist", "bin", "opencorvus-linux-x64-baseline"),
    ])
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

  test("parses the skip-build CLI option", () => {
    expect(parsePackageLinuxBinaryArgs([])).toEqual({ skipBuild: false })
    expect(parsePackageLinuxBinaryArgs(["--skip-build"])).toEqual({ skipBuild: true })
  })

  test("requires a Linux x64 build host", () => {
    expect(() => assertLinuxX64Host("linux", "x64")).not.toThrow()
    expect(() => assertLinuxX64Host("win32", "x64")).toThrow(/linux-x64/)
    expect(() => assertLinuxX64Host("linux", "arm64")).toThrow(/linux-x64/)
  })
})
