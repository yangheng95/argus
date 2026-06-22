import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, readFile } from "node:fs/promises"
import net from "node:net"
import os from "node:os"
import path from "node:path"

const packageRoot = path.resolve(import.meta.dir, "../..")
const overlayRoot = path.resolve(packageRoot, "../overlay")

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

type OverlayAssetRefs = {
  scripts: string[]
  styles: string[]
}

function overlayAssetRefs(html: string): OverlayAssetRefs {
  const scripts = Array.from(
    new Set(Array.from(html.matchAll(/\bsrc=["'](?:\.?\/)?(assets\/[^"']+\.js)["']/g), (match) => match[1])),
  ).sort()
  const styles = Array.from(
    new Set(Array.from(html.matchAll(/\bhref=["'](?:\.?\/)?(assets\/[^"']+\.css)["']/g), (match) => match[1])),
  ).sort()
  if (scripts.length === 0) throw new Error(`overlay index has no script asset reference: ${html.slice(0, 240)}`)
  if (styles.length === 0) throw new Error(`overlay index has no stylesheet asset reference: ${html.slice(0, 240)}`)
  return {
    scripts,
    styles,
  }
}

async function currentDistAssetRefs(): Promise<OverlayAssetRefs> {
  return overlayAssetRefs(await readFile(path.join(overlayRoot, "dist-vite", "index.html"), "utf8"))
}

async function buildPackagedOverlayServerArtifact() {
  const uiProc = Bun.spawn(["bun", "run", "build:vite"], {
    cwd: overlayRoot,
    env: {
      ...process.env,
      OPENCORVUS_DISABLE_MODELS_FETCH: "true",
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [uiStdout, uiStderr, uiExitCode] = await Promise.all([
    collect(uiProc.stdout),
    collect(uiProc.stderr),
    uiProc.exited,
  ])
  if (uiExitCode !== 0) {
    throw new Error(`overlay UI build failed with exit ${uiExitCode}\n${uiStdout}\n${uiStderr}`)
  }

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

  test("compiled overlay-server artifact starts and serves health plus embedded UI", async () => {
    const buildOutput = await buildPackagedOverlayServerArtifact()
    expect(buildOutput).not.toContain("B:/~BUN/root")
    expect(buildOutput).not.toContain("Cannot find module")
    expect(buildOutput).not.toContain("Cannot find package")
    expect(buildOutput).not.toContain("@parcel/watcher/wrapper")
    expect(buildOutput).not.toContain("ERR_MODULE_NOT_FOUND")
    expect(buildOutput).toContain("Embedded overlay UI files:")
    const expectedAssetRefs = await currentDistAssetRefs()

    const name = `opencorvus-overlay-server-${overlayPlatform()}-${overlayArch()}`
    const artifactDir = path.resolve(packageRoot, "dist", name)
    const executable = path.join(artifactDir, process.platform === "win32" ? "opencorvus.exe" : "opencorvus")
    expect(existsSync(executable)).toBe(true)
    expect(existsSync(path.join(artifactDir, "ui"))).toBe(false)
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

    let healthStatus: number | undefined
    let healthBody:
      | {
          healthy: boolean
          paths: { database: string; data: string; home: string }
        }
      | undefined
    let uiStatus: number | undefined
    let uiContentType: string | null | undefined
    let uiHtml = ""
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) break
      try {
        const healthResponse = await fetch(`http://127.0.0.1:${port}/global/health`)
        const uiResponse = await fetch(`http://127.0.0.1:${port}/ui/index.html`)
        const [healthText, indexHtml] = await Promise.all([healthResponse.text(), uiResponse.text()])

        healthStatus = healthResponse.status
        uiStatus = uiResponse.status
        uiContentType = uiResponse.headers.get("content-type")
        uiHtml = indexHtml
        if (healthResponse.ok) {
          healthBody = JSON.parse(healthText) as {
            healthy: boolean
            paths: { database: string; data: string; home: string }
          }
        }
        if (healthResponse.ok && uiResponse.ok) break
      } catch {
        await Bun.sleep(250)
      }
    }

    expect(healthStatus).toBe(200)
    expect(healthBody).toBeDefined()
    const body = healthBody!
    expect(body.healthy).toBe(true)
    expect(path.isAbsolute(body.paths.database)).toBe(true)
    expect(path.isAbsolute(body.paths.data)).toBe(true)
    expect(path.isAbsolute(body.paths.home)).toBe(true)

    expect(uiStatus).toBe(200)
    expect(uiContentType).toContain("text/html")
    expect(uiHtml).toContain('data-page="overlay"')
    expect(overlayAssetRefs(uiHtml)).toEqual(expectedAssetRefs)

    for (const script of expectedAssetRefs.scripts) {
      const assetResponse = await fetch(`http://127.0.0.1:${port}/ui/${script}`)
      expect(assetResponse.status).toBe(200)
      expect(assetResponse.headers.get("content-type")).toContain("application/javascript")
      const assetText = await assetResponse.text()
      expect(assetText.length).toBeGreaterThan(0)
      expect(assetText).not.toContain('data-page="overlay"')
      expect(assetText).not.toContain('"/assets/opencorvus-logo')
      const brandLogo = assetText.match(/\bopencorvus-logo-dark-[A-Za-z0-9_-]+\.svg\b/)?.[0]
      expect(brandLogo).toBeDefined()
      const logoResponse = await fetch(`http://127.0.0.1:${port}/ui/assets/${brandLogo}`)
      expect(logoResponse.status).toBe(200)
      expect(logoResponse.headers.get("content-type")).toContain("image/svg+xml")
      expect((await logoResponse.text()).length).toBeGreaterThan(0)
    }

    for (const style of expectedAssetRefs.styles) {
      const assetResponse = await fetch(`http://127.0.0.1:${port}/ui/${style}`)
      expect(assetResponse.status).toBe(200)
      expect(assetResponse.headers.get("content-type")).toContain("text/css")
      const assetText = await assetResponse.text()
      expect(assetText.length).toBeGreaterThan(0)
      expect(assetText).not.toContain('data-page="overlay"')
    }

    proc.kill()
    const [stdout, stderr] = await Promise.all([collect(proc.stdout), collect(proc.stderr)])
    const output = `${stdout}\n${stderr}`

    expect(output).not.toContain("B:/~BUN/root")
    expect(output).not.toContain("Cannot find module")
    expect(output).not.toContain("Cannot find package")
    expect(output).not.toContain("@parcel/watcher/wrapper")
    expect(output).not.toContain("ERR_MODULE_NOT_FOUND")
  }, 180_000)
})
