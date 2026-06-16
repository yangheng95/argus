import { describe, expect, test } from "bun:test"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { runtimePackageRequireForExecPath } from "../../src/runtime/package-require"

describe("runtime package resolver", () => {
  test("development Bun runtime resolves from source modules", () => {
    const runtimeRequire = runtimePackageRequireForExecPath(process.execPath)
    expect(runtimeRequire.resolve("sharp/package.json")).toContain(`sharp`)
  })

  test("packaged runtime requires a colocated package.json", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "opencorvus-runtime-require-"))
    const executable = path.join(dir, process.platform === "win32" ? "opencorvus.exe" : "opencorvus")
    await writeFile(executable, "")

    expect(() => runtimePackageRequireForExecPath(executable)).toThrow(
      /Packaged runtime is incomplete: missing .*package\.json/,
    )
  })

  test("packaged runtime resolves only from the colocated bundle directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "opencorvus-runtime-require-"))
    const executable = path.join(dir, process.platform === "win32" ? "opencorvus.exe" : "opencorvus")
    const packageJson = path.join(dir, "package.json")
    await writeFile(executable, "")
    await writeFile(packageJson, JSON.stringify({ type: "commonjs" }))

    const runtimeRequire = runtimePackageRequireForExecPath(executable)
    expect(() => runtimeRequire("sharp")).toThrow()
  })
})
