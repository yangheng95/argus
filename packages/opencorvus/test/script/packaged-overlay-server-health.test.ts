import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import net from "node:net"
import os from "node:os"
import path from "node:path"

const packageRoot = path.resolve(import.meta.dir, "../..")

function overlayPlatform() {
  if (process.platform === "win32") return "windows"
  if (process.platform === "darwin") return "darwin"
  return process.platform
}

function overlayArch() {
  if (process.arch === "x64") return "x64"
  if (process.arch === "arm64") return "arm64"
  return process.arch
}

async function freePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close()
        reject(new Error("failed to allocate TCP port"))
        return
      }
      const port = address.port
      server.close((error) => (error ? reject(error) : resolve(port)))
    })
  })
}

async function collect(stream: ReadableStream<Uint8Array> | null) {
  if (!stream) return ""
  return await new Response(stream).text()
}

async function buildPackagedOverlayServerArtifact() {
  const proc = Bun.spawn(["bun", "run", "build", "--overlay-server", "--binary-only"], {
    cwd: packageRoot,
    env: {
      ...process.env,
      OPENCORVUS_DISABLE_MODELS_FETCH: "true",
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([collect(proc.stdout), collect(proc.stderr), proc.exited])
  if (exitCode !== 0) {
    throw new Error(`overlay-server artifact build failed with exit ${exitCode}\n${stdout}\n${stderr}`)
  }
  return `${stdout}\n${stderr}`
}

describe("packaged overlay-server health", () => {
  let proc: ReturnType<typeof Bun.spawn> | undefined

  afterEach(() => {
    proc?.kill()
    proc = undefined
  })

  test("compiled overlay-server artifact starts and answers /global/health", async () => {
    const buildOutput = await buildPackagedOverlayServerArtifact()
    expect(buildOutput).not.toContain("B:/~BUN/root")
    expect(buildOutput).not.toContain("Cannot find module")
    expect(buildOutput).not.toContain("Cannot find package")
    expect(buildOutput).not.toContain("@parcel/watcher/wrapper")
    expect(buildOutput).not.toContain("ERR_MODULE_NOT_FOUND")

    const name = `opencorvus-overlay-server-${overlayPlatform()}-${overlayArch()}`
    const artifactDir = path.resolve(packageRoot, "dist", name)
    const executable = path.join(artifactDir, process.platform === "win32" ? "opencorvus.exe" : "opencorvus")
    expect(existsSync(executable)).toBe(true)
    expect(existsSync(path.join(artifactDir, "package.json"))).toBe(true)
    expect(existsSync(path.join(artifactDir, "node_modules", "sharp", "package.json"))).toBe(true)
    expect(existsSync(path.join(artifactDir, "node_modules", "@parcel", "watcher", "wrapper.js"))).toBe(true)

    const port = await freePort()
    const home = await mkdtemp(path.join(os.tmpdir(), "opencorvus-packaged-health-"))
    proc = Bun.spawn([executable, "serve", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: home,
      env: {
        ...process.env,
        OPENCORVUS_HOME: home,
        OPENCORVUS_DISABLE_MODELS_FETCH: "true",
      },
      stdout: "pipe",
      stderr: "pipe",
    })

    let response: Response | undefined
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) break
      try {
        response = await fetch(`http://127.0.0.1:${port}/global/health`)
        if (response.ok) break
      } catch {
        await Bun.sleep(250)
      }
    }

    proc.kill()
    const [stdout, stderr] = await Promise.all([collect(proc.stdout), collect(proc.stderr)])
    const output = `${stdout}\n${stderr}`

    expect(output).not.toContain("B:/~BUN/root")
    expect(output).not.toContain("Cannot find module")
    expect(output).not.toContain("Cannot find package")
    expect(output).not.toContain("@parcel/watcher/wrapper")
    expect(output).not.toContain("ERR_MODULE_NOT_FOUND")

    expect(response?.status).toBe(200)
    const body = (await response!.json()) as {
      healthy: boolean
      paths: { database: string; data: string; home: string }
    }
    expect(body.healthy).toBe(true)
    expect(path.isAbsolute(body.paths.database)).toBe(true)
    expect(path.isAbsolute(body.paths.data)).toBe(true)
    expect(path.isAbsolute(body.paths.home)).toBe(true)
  }, 180_000)
})
