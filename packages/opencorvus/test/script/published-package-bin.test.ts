import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  isPublishedCliBinaryPackageName,
  resolveInstalledBinaryPath,
  resolvePublishedBinaryDescriptor,
} from "../../script/published-package-bin.mjs"

const packageRoot = path.resolve(import.meta.dir, "../..")

async function readStream(stream: ReadableStream<Uint8Array> | null) {
  if (!stream) return ""
  return await new Response(stream).text()
}

async function run(command: string[]) {
  const proc = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([readStream(proc.stdout), readStream(proc.stderr), proc.exited])
  return { stdout, stderr, exitCode }
}

describe("published package bin", () => {
  test("wrapper package installs and runs the platform binary", async () => {
    const node = Bun.which("node")
    expect(node).toBeTruthy()

    const wrapperRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "opencorvus-published-bin-"))
    try {
      await fsp.writeFile(
        path.join(wrapperRoot, "package.json"),
        JSON.stringify({ name: "opencorvus-ai", type: "module" }),
      )
      await fsp.mkdir(path.join(wrapperRoot, "script"), { recursive: true })
      await fsp.mkdir(path.join(wrapperRoot, "bin"), { recursive: true })
      await fsp.copyFile(path.join(packageRoot, "bin", "opencorvus"), path.join(wrapperRoot, "bin", "opencorvus"))
      await fsp.copyFile(
        path.join(packageRoot, "script", "postinstall.mjs"),
        path.join(wrapperRoot, "script", "postinstall.mjs"),
      )
      await fsp.copyFile(
        path.join(packageRoot, "script", "published-package-bin.mjs"),
        path.join(wrapperRoot, "script", "published-package-bin.mjs"),
      )

      const descriptor = resolvePublishedBinaryDescriptor()
      const binaryPackageDir = path.join(wrapperRoot, "node_modules", descriptor.binaryPackageName)
      await fsp.mkdir(binaryPackageDir, { recursive: true })
      await fsp.writeFile(
        path.join(binaryPackageDir, "package.json"),
        JSON.stringify({ name: descriptor.binaryPackageName, version: "0.0.0" }),
      )
      await fsp.copyFile(process.execPath, path.join(binaryPackageDir, descriptor.sourceBinaryName))
      if (process.platform !== "win32") await fsp.chmod(path.join(binaryPackageDir, descriptor.sourceBinaryName), 0o755)

      const install = await run([node!, path.join(wrapperRoot, "script", "postinstall.mjs")])
      expect(`${install.stdout}\n${install.stderr}`).toContain("opencorvus binary installed")
      expect(install.exitCode).toBe(0)
      expect(fs.existsSync(resolveInstalledBinaryPath(wrapperRoot))).toBe(true)

      const smoke = await run([node!, path.join(wrapperRoot, "bin", "opencorvus"), "--version"])
      expect(`${smoke.stdout}\n${smoke.stderr}`).not.toContain("Failed to launch opencorvus binary")
      expect(smoke.exitCode).toBe(0)
    } finally {
      await fsp.rm(wrapperRoot, { recursive: true, force: true })
    }
  })

  test("publish script ships the wrapper bin and shared postinstall helper without runtime fallback", async () => {
    const source = await Bun.file(path.join(packageRoot, "script", "publish.ts")).text()
    const packageJson = (await Bun.file(path.join(packageRoot, "package.json")).json()) as {
      bin?: Record<string, string>
    }

    expect(fs.existsSync(path.join(packageRoot, "bin", "opencorvus"))).toBe(true)
    expect(packageJson.bin?.opencorvus).toBe("./bin/opencorvus")
    expect(fs.existsSync(path.join(packageRoot, packageJson.bin!.opencorvus))).toBe(true)
    expect(source).toContain("cp -r ./bin ./dist/${pkg.name}/bin")
    expect(source).toContain("cp ./script/postinstall.mjs ./dist/${pkg.name}/script/postinstall.mjs")
    expect(source).toContain(
      "cp ./script/published-package-bin.mjs ./dist/${pkg.name}/script/published-package-bin.mjs",
    )
    expect(source).toContain("isPublishedCliBinaryPackageName(binaryPkg.name)")
    expect(source).toContain('type: "module"')
    expect(source).toContain('postinstall: "node ./script/postinstall.mjs"')
    expect(source).not.toContain("|| node")
    expect(source).not.toContain("bun ./postinstall.mjs")
  })

  test("binary package filter excludes overlay-server artifacts from npm optional dependencies", () => {
    expect(isPublishedCliBinaryPackageName("opencorvus-linux-x64")).toBe(true)
    expect(isPublishedCliBinaryPackageName("opencorvus-linux-x64-baseline-musl")).toBe(true)
    expect(isPublishedCliBinaryPackageName("opencorvus-darwin-arm64")).toBe(true)
    expect(isPublishedCliBinaryPackageName("opencorvus-windows-x64-baseline")).toBe(true)
    expect(isPublishedCliBinaryPackageName("opencorvus-overlay-server-windows-x64")).toBe(false)
    expect(isPublishedCliBinaryPackageName("opencorvus-overlay-server-linux-x64-baseline")).toBe(false)
  })
})
