import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { packagedRipgrepRuntimePaths, resolveRipgrepRuntime, ripgrepExecutableName } from "../../src/runtime/ripgrep"

async function writeExecutable(file: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, "")
  if (process.platform !== "win32") await fs.chmod(file, 0o755)
}

describe("ripgrep runtime resolver", () => {
  test("computes packaged ripgrep paths from the executable directory", () => {
    const execPath = path.join("C:", "OpenCorvus", "opencorvus.exe")
    expect(
      packagedRipgrepRuntimePaths({
        execPath,
        platform: "win32",
      }),
    ).toEqual({
      executable: path.join("C:", "OpenCorvus", "bin", "rg.exe"),
    })
  })

  test("prefers packaged ripgrep over PATH for packaged executables", async () => {
    await using tmp = await tmpdir()
    const packaged = path.join(tmp.path, "bundle", "bin", ripgrepExecutableName(process.platform))
    const system = path.join(tmp.path, "system", ripgrepExecutableName(process.platform))
    await writeExecutable(packaged)
    await writeExecutable(system)

    const runtime = await resolveRipgrepRuntime({
      execPath: path.join(tmp.path, "bundle", process.platform === "win32" ? "opencorvus.exe" : "opencorvus"),
      env: {
        PATH: path.dirname(system),
        PATHEXT: ".EXE",
      },
    })

    expect(runtime).toEqual({ filepath: packaged, packaged: true })
  })

  test("rejects packaged executables without packaged ripgrep even when PATH has rg", async () => {
    await using tmp = await tmpdir()
    const system = path.join(tmp.path, "system", ripgrepExecutableName(process.platform))
    await writeExecutable(system)

    await expect(
      resolveRipgrepRuntime({
        execPath: path.join(tmp.path, "bundle", process.platform === "win32" ? "opencorvus.exe" : "opencorvus"),
        env: {
          PATH: path.dirname(system),
          PATHEXT: ".EXE",
        },
      }),
    ).rejects.toThrow("Packaged ripgrep runtime is missing")
  })

  test("uses PATH only for Bun source runtime", async () => {
    await using tmp = await tmpdir()
    const bunPath = path.join(tmp.path, process.platform === "win32" ? "bun.exe" : "bun")
    const adjacent = path.join(tmp.path, "bin", ripgrepExecutableName(process.platform))
    const source = path.join(tmp.path, "source", ripgrepExecutableName(process.platform))
    await writeExecutable(adjacent)
    await writeExecutable(source)

    const runtime = await resolveRipgrepRuntime({
      execPath: bunPath,
      env: {
        PATH: path.dirname(source),
        PATHEXT: ".EXE",
      },
    })

    expect(runtime.packaged).toBe(false)
    expect(runtime.filepath.toLowerCase()).toBe(source.toLowerCase())
  })
})
