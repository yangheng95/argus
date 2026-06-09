import { describe, expect, test } from "bun:test"
import {
  BINARY_PACKAGE_MATRIX,
  parseBinaryMatrixArgs,
  skippedMatrixRows,
  supportedMatrixRows,
} from "../../../../script/package-binary-matrix"

describe("package-binary-matrix", () => {
  test("lists the supported release platforms without inventing hidden targets", () => {
    expect(BINARY_PACKAGE_MATRIX.map((row) => row.id)).toEqual([
      "linux-x64",
      "linux-arm64",
      "darwin-x64",
      "darwin-arm64",
      "windows-x64",
    ])
  })

  test("selects only Linux x64 outputs on a Linux x64 host", () => {
    expect(supportedMatrixRows({ platform: "linux", arch: "x64" }).map((row) => row.id)).toEqual(["linux-x64"])
    expect(skippedMatrixRows({ platform: "linux", arch: "x64" }).map((row) => row.id)).toEqual([
      "linux-arm64",
      "darwin-x64",
      "darwin-arm64",
      "windows-x64",
    ])
  })

  test("skips macOS targets off macOS", () => {
    const skipped = skippedMatrixRows({ platform: "linux", arch: "x64" })
    expect(skipped.find((row) => row.id === "darwin-x64")?.skipReason).toContain("macOS")
    expect(skipped.find((row) => row.id === "darwin-arm64")?.skipReason).toContain("macOS")
  })

  test("parses skip-build for matrix smoke runs", () => {
    expect(parseBinaryMatrixArgs([])).toEqual({ skipBuild: false, skipUi: false })
    expect(parseBinaryMatrixArgs(["--skip-build"])).toEqual({ skipBuild: true, skipUi: false })
    expect(parseBinaryMatrixArgs(["--skip-ui"])).toEqual({ skipBuild: false, skipUi: true })
  })
})
