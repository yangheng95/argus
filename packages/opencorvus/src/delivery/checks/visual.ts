/**
 * Visual similarity evaluator — puppeteer screenshot + SSIM gate.
 *
 * The same logic that ships in `script/benchmark/visual-diff.ts` (which is
 * now a thin CLI wrapper) lives here as a library so the per-goal evaluator
 * can run it inside the orchestrator. Every fig2code-style task that lists a
 * visual reference automatically gets a structural-similarity check without
 * any external pipeline tooling.
 *
 * Behaviour matches the CLI (single source of truth for thresholds and the
 * SSIM map analysis):
 *   - Render the target HTML/URL with puppeteer at the reference's natural
 *     viewport (or a caller-supplied size).
 *   - Compare against the reference PNG using SSIM. Fail when either
 *     `mean SSIM < threshold` OR the worst-5% window SSIM (`p5`) drops below
 *     `worstThreshold` — protects against partial structural collapse that
 *     a generous mean would hide.
 *   - No fallback: missing browser, missing reference, or size-mismatched
 *     images all produce explicit failures.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import http from "node:http"
import path from "node:path"
import { Shell } from "@/shell/shell"
import { Log } from "@/util/log"
import puppeteer, { type Page } from "puppeteer-core"
import { PNG } from "pngjs"
import ssim from "ssim.js"

const log = Log.create({ service: "delivery.visual" })
const RENDER_COMMAND_OUTPUT_TAIL_BYTES = 2_000

export interface VisualDiffOptions {
  /** Either an absolute file path to an html file, or http(s)/file URL. */
  rendered: string
  /** Absolute path to the reference PNG. */
  reference: string
  /** Force a specific puppeteer viewport. Defaults to the reference image's
   *  native pixel size, which is the common case for fig2code. */
  viewport?: { width: number; height: number }
  /** Mean SSIM floor. Default 0.85. */
  threshold?: number
  /** Worst-5%-window SSIM floor. Default 0.55. */
  worstThreshold?: number
  /** Directory to write `rendered.png` and `diff.json`. Created if absent. */
  outDir: string
  /** Optional override for the chrome/edge executable. */
  browserExecutable?: string
}

export interface VisualDiffReport {
  passed: boolean
  /** "ok" if both gates passed, otherwise a categorical reason. */
  reason: "ok" | "size_mismatch" | "below_mean" | "below_worst" | "below_both"
  mssim: number
  threshold: number
  worstThreshold: number
  distribution: { min: number; p1: number; p5: number; p25: number; mean: number }
  gate: { meanPassed: boolean; worstPassed: boolean }
  viewport: { width: number; height: number }
  rendered: { path: string; width: number; height: number }
  reference: { path: string; width: number; height: number }
  ssimPerformanceMs: unknown
}

const DEFAULT_BROWSER_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]

export async function findBrowserExecutable(override?: string): Promise<string> {
  if (override) {
    await fs.access(override).catch(() => {
      throw new Error(`browserExecutable not found: ${override}`)
    })
    return override
  }
  for (const bin of DEFAULT_BROWSER_CANDIDATES) {
    try {
      await fs.access(bin)
      return bin
    } catch {}
  }
  throw new Error(
    "No Chrome/Edge executable found. Install one or pass `browserExecutable` explicitly.",
  )
}

function toFileUrl(p: string): string {
  const abs = path.resolve(p).replace(/\\/g, "/")
  return `file:///${abs.replace(/^\/+/, "")}`
}

/**
 * Spawn a minimal static HTTP server rooted at `rootDir` and resolve when it
 * is listening. Returns `{ url, close }` so callers can hand `url` to
 * puppeteer and tear the server down in a finally block.
 *
 * Why an HTTP server at all: Vite / CRA / Next build outputs reference
 * scripts as ES modules (`<script type="module" src="/assets/…js">`).
 * Browsers refuse to resolve those imports over `file://` (CORS + opaque
 * module loader behaviour), so the rendered page is blank. A localhost
 * static server gives puppeteer a real origin, matches how users preview
 * the build (`vite preview`, `serve`), and keeps SSIM honest.
 */
/**
 * Look upward from `startDir` for a package.json. Returns the directory that
 * contains it (the project root), or undefined if none is found before the
 * filesystem root. Needed because the rendered file path typically sits one
 * level deep (e.g. `project/dist/index.html`) — the scripts live at the
 * project root.
 */
async function findProjectRoot(startDir: string): Promise<string | undefined> {
  let current = path.resolve(startDir)
  while (true) {
    try {
      const stat = await fs.stat(path.join(current, "package.json"))
      if (stat.isFile()) return current
    } catch {}
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

/**
 * Prefer a project-owned launch script (`server`, `start`, `preview`, `dev`)
 * over the static-file fallback when the delivered app ships both a frontend
 * and a backend — typically an Express/Hono server that serves the built dist
 * AND answers `/api/*` fetches. Static-only serving leaves the frontend
 * stuck on loading states (bench7 rendered a sidebar but "Loading usage
 * data…" froze the main panel).
 *
 * Resolution order mirrors "what a user would actually run to preview":
 *   1. `server` — convention in benchmark PRDs for a backend that also hosts
 *      the built SPA on a single port.
 *   2. `start` — traditional Node entry that boots the production server.
 *   3. `preview` — Vite's "serve built output" script when the app is
 *      frontend-only AND a `bun run build` has produced `dist/`.
 *   4. `dev` — last-resort full-stack runner. Most full-stack benchmark
 *      deliverables (vite frontend on :3000 + backend on :3001 with a
 *      vite proxy) only declare `dev` because that's the script a developer
 *      runs. The earlier exclusion was rooted in SSIM determinism concerns
 *      that no longer apply: the delivery agent now scores via vision
 *      comparison (renderPage) rather than pixel-perfect SSIM, so HMR
 *      reflows between paints are tolerable.
 */
interface ProjectLaunchScript {
  script: string
  command: string
  buildScript?: string
}

export async function resolveProjectLaunchScript(projectRoot: string): Promise<ProjectLaunchScript | undefined> {
  let pkg: { scripts?: Record<string, string> }
  try {
    pkg = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8"))
  } catch {
    return undefined
  }
  const scripts = pkg.scripts ?? {}
  const buildCommand = scripts.build
  const canBuild = typeof buildCommand === "string" && buildCommand.trim().length > 0
  for (const name of ["server", "start", "preview", "dev"] as const) {
    const command = scripts[name]
    if (typeof command === "string" && command.trim().length > 0) {
      return {
        script: name,
        command,
        buildScript: name !== "dev" && canBuild ? "build" : undefined,
      }
    }
  }
  return undefined
}

const RENDER_WORKSPACE_EXCLUDED_NAMES = new Set([
  ".git",
  ".opencorvus",
  "node_modules",
])

export async function createIsolatedRenderWorkspace(
  projectRoot: string,
): Promise<{ directory: string; cleanup: () => Promise<void> }> {
  const scratchParent = path.join(projectRoot, ".opencorvus", "delivery-render-workspaces")
  await fs.mkdir(scratchParent, { recursive: true })
  const scratchRoot = await fs.mkdtemp(path.join(scratchParent, `${randomUUID()}-`))
  const directory = path.join(scratchRoot, "workspace")
  try {
    await copyTreeIntoRenderWorkspace(projectRoot, directory, projectRoot)
  } catch (err) {
    await cleanupIsolatedRenderWorkspace(scratchRoot)
    throw err
  }
  return {
    directory,
    cleanup: () => cleanupIsolatedRenderWorkspace(scratchRoot),
  }
}

export async function cleanupIsolatedRenderWorkspace(scratchRoot: string): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await fs.rm(scratchRoot, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 200,
      })
      return
    } catch (err) {
      lastError = err
      if (process.platform === "win32" && isWindowsLockedPathError(err)) {
        await killWindowsProcessesReferencingPath(scratchRoot)
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
    }
  }
  log.warn("delivery render workspace cleanup failed", {
    scratchRoot,
    err: lastError,
  })
}

function isWindowsLockedPathError(err: unknown): boolean {
  const lockedPathCodes = new Set(["EACCES", "EBUSY", "EPERM"])
  return typeof err === "object"
    && err !== null
    && "code" in err
    && lockedPathCodes.has(String((err as { code?: unknown }).code))
}

async function killWindowsProcessesReferencingPath(targetDir: string): Promise<void> {
  const target = path.resolve(targetDir).toLowerCase()
  const targetBase64 = Buffer.from(target, "utf8").toString("base64")
  const script = [
    `$needle = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${targetBase64}'))`,
    "$own = $PID",
    "Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $own -and $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($needle) } | ForEach-Object { & taskkill.exe /PID ([string]$_.ProcessId) /F /T | Out-Null }",
  ].join("\n")
  const encoded = Buffer.from(script, "utf16le").toString("base64")
  await new Promise<void>((resolve) => {
    const proc = spawn("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      encoded,
    ], {
      stdio: "ignore",
      windowsHide: true,
    })
    const timer = setTimeout(() => {
      proc.kill("SIGKILL")
      resolve()
    }, 5_000)
    proc.once("exit", () => {
      clearTimeout(timer)
      resolve()
    })
    proc.once("error", () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

async function copyTreeIntoRenderWorkspace(source: string, destination: string, sourceRoot: string): Promise<void> {
  if (!shouldCopyIntoRenderWorkspace(sourceRoot, source)) return
  const stat = await fs.lstat(source)
  if (stat.isDirectory()) {
    await fs.mkdir(destination, { recursive: true })
    const entries = await fs.readdir(source)
    for (const entry of entries) {
      await copyTreeIntoRenderWorkspace(
        path.join(source, entry),
        path.join(destination, entry),
        sourceRoot,
      )
    }
    return
  }
  if (stat.isSymbolicLink()) {
    const target = await fs.readlink(source)
    await fs.symlink(target, destination)
    return
  }
  if (stat.isFile()) {
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.copyFile(source, destination)
  }
}

function shouldCopyIntoRenderWorkspace(sourceRoot: string, candidate: string) {
  const relative = path.relative(sourceRoot, candidate)
  if (!relative) return true
  return relative.split(path.sep).every((part) => !RENDER_WORKSPACE_EXCLUDED_NAMES.has(part))
}

const ANSI_ESCAPE_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g
const ANNOUNCED_LOCAL_URL_PATTERN = /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{1,5})\/?/i

export function announcedLocalUrlFromOutput(output: string): string | undefined {
  const plain = output.replace(ANSI_ESCAPE_PATTERN, "")
  const match = plain.match(ANNOUNCED_LOCAL_URL_PATTERN)
  if (!match) return undefined
  const host = match[1]?.toLowerCase()
  const port = Number(match[2])
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) return undefined
  const connectHost = host === "0.0.0.0" ? "127.0.0.1" : host
  return `http://${connectHost}:${port}`
}

export function renderWorkspaceCommandFailureMessage(input: {
  command: string
  projectRoot: string
  status?: number | null
  error?: Error
  stdout?: Buffer | string | null
  stderr?: Buffer | string | null
}) {
  const status = input.status === undefined || input.status === null
    ? "spawn_error"
    : `exit code=${input.status}`
  const outputTail = renderCommandOutputTail(input)
  return `${input.command} pre-launch failed (${status}) in isolated render workspace for ${input.projectRoot}: ${outputTail}`
}

function renderCommandOutputTail(input: {
  error?: Error
  stdout?: Buffer | string | null
  stderr?: Buffer | string | null
}) {
  const stdout = bufferText(input.stdout)
  const stderr = bufferText(input.stderr)
  const sections = [
    stdout ? `stdout:\n${stdout.slice(-RENDER_COMMAND_OUTPUT_TAIL_BYTES)}` : "",
    stderr ? `stderr:\n${stderr.slice(-RENDER_COMMAND_OUTPUT_TAIL_BYTES)}` : "",
  ].filter(Boolean)
  const text = sections.join("\n\n").trim()
  const tail = text.length > 0 ? text : "<no output>"
  return input.error ? `error: ${input.error.message}\n${tail}` : tail
}

function bufferText(value: Buffer | string | null | undefined) {
  if (!value) return ""
  return typeof value === "string" ? value : value.toString()
}

/**
 * Spawn `bun run <script>` from `projectRoot`, then poll every 500ms up to
 * `timeoutMs` for an HTTP listener on the returned URL candidates (app
 * server typically picks 3000/3001/8000/5173). Returns `{ url, close }` when
 * the first successful GET lands; otherwise throws so the caller can fall
 * back to the static server.
 *
 * Spawned process gets its own process group (detached: true on POSIX,
 * shell: false everywhere) so `close()` can kill the whole tree including
 * child Node/Bun workers — otherwise a bare `child.kill()` leaves orphans
 * holding the port on retries.
 */
async function startProjectServer(
  projectRoot: string,
  script: ProjectLaunchScript,
  opts: { timeoutMs?: number } = {},
): Promise<{ url: string; close: () => Promise<void> }> {
  const timeoutMs = opts.timeoutMs ?? 90_000
  const isolated = await createIsolatedRenderWorkspace(projectRoot)
  const launchRoot = isolated.directory

  // Render launches run from an isolated copy of the merged primary tree.
  // Build agents publish only tracked files back to primary, so dependencies
  // and compiled output are absent in the copy by design. Install/build here
  // to make preview/start faithful without mutating the primary worktree.
  const hasPackageJson = existsSync(`${launchRoot}/package.json`)
  const hasNodeModules = existsSync(`${launchRoot}/node_modules`)
  if (hasPackageJson && !hasNodeModules) {
    const install = spawnSync("bun", ["install"], {
      cwd: launchRoot,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      timeout: 180_000,
    })
    if (install.error) {
      await isolated.cleanup()
      throw new Error(renderWorkspaceCommandFailureMessage({
        command: "bun install",
        projectRoot,
        error: install.error,
        stdout: install.stdout,
        stderr: install.stderr,
      }))
    }
    if (install.status !== 0) {
      await isolated.cleanup()
      throw new Error(renderWorkspaceCommandFailureMessage({
        command: "bun install",
        projectRoot,
        status: install.status,
        stdout: install.stdout,
        stderr: install.stderr,
      }))
    }
  }
  if (script.buildScript) {
    // `vite preview` serves compiled output; in the cold merged worktree that
    // output is not tracked, so delivery must materialize it before launch.
    const build = spawnSync("bun", ["run", script.buildScript], {
      cwd: launchRoot,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      timeout: 180_000,
    })
    if (build.error) {
      await isolated.cleanup()
      throw new Error(
        `bun run ${script.buildScript} pre-launch failed in isolated render workspace for ${projectRoot}: ${build.error.message}`,
      )
    }
    if (build.status !== 0) {
      await isolated.cleanup()
      const output = `${build.stdout?.toString() ?? ""}${build.stderr?.toString() ?? ""}`.slice(-1200) || "<no output>"
      throw new Error(
        `bun run ${script.buildScript} pre-launch exited code=${build.status} in isolated render workspace for ${projectRoot}: ${output}`,
      )
    }
  }

  // Run via `bun run`; inherits PATH so npx/vite/tsx on the project lockfile resolve.
  const child: ChildProcess = spawn("bun", ["run", script.script], {
    cwd: launchRoot,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
    detached: process.platform !== "win32",
  })
  const captured: string[] = []
  // Parse spawned launch script's stdout for the bound URL it advertises
  // (vite/CRA/Next/Hono all print "Local:   http://localhost:NNNN/" on
  // startup). Polling a hardcoded port list returned ANY responding port —
  // including the developer's own dev server on 5173 — and the harness
  // ended up screenshotting the wrong app entirely (rule 25: no hardcoded
  // resource lists). Capturing the launch script's own URL announcement
  // is the only honest way to identify "the port THIS process bound".
  let detectedUrl: string | undefined
  const onChunk = (chunk: Buffer) => {
    const text = chunk.toString("utf8")
    captured.push(text)
    if (!detectedUrl) {
      // Vite colorizes the port itself (`localhost:\x1b[1m4180`), and
      // stdout may split the URL across chunks. Parse the recent captured
      // window after stripping terminal control codes; never infer port 80.
      detectedUrl = announcedLocalUrlFromOutput(captured.join("").slice(-4_000))
    }
  }
  child.stdout?.on("data", onChunk)
  child.stderr?.on("data", onChunk)
  let exited = false
  const closed = new Promise<void>((resolve) => child.once("exit", () => {
    exited = true
    resolve()
  }))

  let cleaned = false
  const cleanupLaunchRoot = async () => {
    if (cleaned) return
    cleaned = true
    await isolated.cleanup()
  }
  const close = async () => {
    if (child.exitCode !== null) {
      await cleanupLaunchRoot()
      return
    }
    try {
      await Shell.killTree(child, { exited: () => exited })
      const raced = await Promise.race([
        closed,
        new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 2_000)),
      ])
      if (raced === "timeout") await Shell.killTree(child, { exited: () => exited })
    } catch {
      /* ignore */
    }
    await closed.catch(() => {})
    await cleanupLaunchRoot()
  }

  const deadline = Date.now() + timeoutMs
  try {
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        const tail = captured.join("").slice(-800)
        throw new Error(
          `project server exited early (code=${child.exitCode}): ${tail || "<no output>"}`,
        )
      }
      if (detectedUrl) {
        // URL announced; verify it actually accepts HTTP before returning so
        // we don't hand puppeteer a port that hasn't bound yet (vite often
        // prints "Local:" a few hundred ms before the listener is live).
        const ok = await probeHttp(detectedUrl)
        if (ok) return { url: detectedUrl, close }
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    const tail = captured.join("").slice(-800)
    throw new Error(
      detectedUrl
        ? `project server announced ${detectedUrl} but did not accept HTTP within ${timeoutMs}ms. Last output: ${tail || "<no output>"}`
        : `project server did not announce a localhost URL on stdout within ${timeoutMs}ms. Last output: ${tail || "<no output>"}`,
    )
  } catch (err) {
    await close()
    throw err
  }
}

function probeHttp(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 1_000 }, (res) => {
      res.resume()
      resolve(res.statusCode !== undefined)
    })
    req.on("error", () => resolve(false))
    req.on("timeout", () => {
      req.destroy()
      resolve(false)
    })
  })
}

function startStaticServer(rootDir: string): Promise<{ url: string; close: () => Promise<void> }> {
  const resolvedRoot = path.resolve(rootDir)
  const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".map": "application/json; charset=utf-8",
  }
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqPath = decodeURIComponent((req.url || "/").split("?")[0])
      const safePath = path.posix.normalize(reqPath).replace(/^\/+/, "")
      const absPath = path.join(resolvedRoot, safePath)
      // Path traversal guard — `..` segments after normalize would escape
      // the root; refuse rather than reading arbitrary files.
      if (!absPath.startsWith(resolvedRoot)) {
        res.writeHead(403).end("forbidden")
        return
      }
      ;(async () => {
        let targetPath = absPath
        try {
          const stat = await fs.stat(targetPath)
          if (stat.isDirectory()) targetPath = path.join(targetPath, "index.html")
        } catch {
          res.writeHead(404).end("not found")
          return
        }
        try {
          const body = await fs.readFile(targetPath)
          const ext = path.extname(targetPath).toLowerCase()
          res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" })
          res.end(body)
        } catch {
          res.writeHead(404).end("not found")
        }
      })()
    })
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      if (!addr || typeof addr === "string") {
        reject(new Error("static server bound to non-TCP address"))
        return
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done())
          }),
      })
    })
  })
}

async function decodePNG(filePath: string): Promise<PNG> {
  const buf = await fs.readFile(filePath)
  return new Promise<PNG>((resolve, reject) => {
    const png = new PNG()
    png.parse(buf, (err, parsed) => (err ? reject(err) : resolve(parsed)))
  })
}

const DISCOVERY_SKIP_DIRS = new Set([
  ".git",
  // `.opencorvus` covers both our scratch (attachments, visual-diff) AND
  // goal worktrees (now at `<primary>/.opencorvus/worktrees/`). One entry
  // replaces the prior pair of `.opencorvus` + `.opencorvus-worktrees`.
  ".opencorvus",
  "node_modules",
  "references",
  "visual-diff-out",
  // `dist` / `build` / `.next` are the compiled outputs — those are what we
  // actually want to screenshot for Vite / CRA / Next projects. Keeping them
  // in the skip list caused findRenderedIndex to pick up the pre-build
  // source stub (Vite's `<script type="module" src="/src/main.tsx">` shell),
  // which puppeteer renders as a blank page when loaded via file://.
  // Scoring from a blank render produced false "visual diff failed" rejects
  // even when the built app was correct (bench7 usage-replica-vague).
  ".turbo",
  "coverage",
])

/**
 * Build output directories we actively PREFER over any source `index.html`.
 * A project that has shipped a Vite/CRA/Next build emits a self-contained
 * `dist/index.html` (or equivalent) with inlined hashed asset URLs — that's
 * the artifact users see, and therefore the one SSIM must score against.
 */
const PREFERRED_DIST_DIRS = ["dist", "build", ".next/static", "out"]

/**
 * Walk a directory and find the `index.html` to screenshot. Preference order:
 *  1. A PREFERRED_DIST_DIRS match (`dist/index.html`, `build/index.html`, …) —
 *     that's the compiled, self-contained build artifact that matches what
 *     users actually see. Source-tree `index.html` for Vite/CRA/Next is a
 *     stub that imports `/src/main.tsx`, which puppeteer can't resolve over
 *     file://; scoring against it produced a blank render.
 *  2. Most-recent `index.html` anywhere else, tie-broken by shallowest depth.
 *
 * Returns undefined only when neither category yields a candidate. Callers
 * should surface "no index.html found" rather than fall back silently.
 */
export async function findRenderedIndex(rootDir: string): Promise<string | undefined> {
  const candidates: Array<{ path: string; depth: number; mtime: number; preferred: boolean }> = []
  async function walk(current: string, depth: number, insidePreferred: boolean) {
    let entries: import("node:fs").Dirent[] = []
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (DISCOVERY_SKIP_DIRS.has(entry.name)) continue
        // Hidden dirs are generally tooling artifacts (.git, .opencorvus, …).
        // One exception: `.next` is Next.js's build output and is PREFERRED.
        if (entry.name.startsWith(".") && !PREFERRED_DIST_DIRS.some((p) => p === entry.name || p.startsWith(`${entry.name}/`))) continue
        const childPath = path.join(current, entry.name)
        const isPreferredHere = insidePreferred || PREFERRED_DIST_DIRS.includes(entry.name)
        await walk(childPath, depth + 1, isPreferredHere)
        continue
      }
      if (entry.name.toLowerCase() === "index.html") {
        const abs = path.join(current, entry.name)
        const stat = await fs.stat(abs).catch(() => null)
        candidates.push({
          path: abs,
          depth,
          mtime: stat?.mtimeMs ?? 0,
          preferred: insidePreferred,
        })
      }
    }
  }
  await walk(rootDir, 0, false)
  if (candidates.length === 0) return undefined
  // Preferred (under dist/build/...) wins over any source tree match, then
  // freshest mtime, then shallowest, then stable path sort for determinism.
  candidates.sort(
    (a, b) =>
      Number(b.preferred) - Number(a.preferred) ||
      b.mtime - a.mtime ||
      a.depth - b.depth ||
      a.path.localeCompare(b.path),
  )
  return candidates[0].path
}

/** Pure-render API — renders an HTML/URL target into `<outDir>/rendered.png`
 *  and returns the absolute path. No SSIM / no comparison. The delivery
 *  pipeline uses this to hand the LLM a screenshot of the actual built
 *  artifact; the LLM then compares it against the reference image via its
 *  vision capability (far more actionable than a single SSIM number).
 *
 *  `referenceForViewport` lets callers match the reference image's native
 *  size when known — otherwise callers must supply an explicit `viewport`.
 *  One of the two MUST be provided; this helper throws otherwise so we
 *  don't silently render at an arbitrary default. */
export async function renderPage(opts: {
  rendered: string
  outDir: string
  viewport?: { width: number; height: number }
  referenceForViewport?: string
  browserExecutable?: string
  /** Override puppeteer page.goto navigation timeout. Default: 90_000ms. */
  navigationTimeoutMs?: number
  /** Run a generic user-interaction probe in the same browser page after first paint. */
  probeInteractions?: boolean
}): Promise<{
  renderedPath: string
  viewport: { width: number; height: number }
  size: { width: number; height: number }
  /** DOM 实证指标：P1-A runtime-evidence 用来甄别「仅文本脚手架」类交付，
   *  与 screenshot 同一轮 render 采集，避免下游再开一次 puppeteer（rule 22）。 */
  dom: {
    textLength: number
    nodeCount: number
    hasBodyChildren: boolean
    /** React 根「<div id=\"root\"></div>」空壳（未 hydrate / hydrate 了空 App）。 */
    isEmptyRootShell: boolean
  }
  interaction?: RuntimeInteractionProbe
}> {
  let viewport = opts.viewport
  if (!viewport) {
    if (!opts.referenceForViewport) {
      throw new Error("renderPage: one of `viewport` or `referenceForViewport` is required")
    }
    await fs.access(opts.referenceForViewport).catch(() => {
      throw new Error(`renderPage: reference image not found: ${opts.referenceForViewport}`)
    })
    const refImg = await decodePNG(opts.referenceForViewport)
    viewport = { width: refImg.width, height: refImg.height }
  }
  await fs.mkdir(opts.outDir, { recursive: true })

  const executablePath = await findBrowserExecutable(opts.browserExecutable)
  // Decide how to serve the rendered target:
  //   - http(s) / existing file:// URL → use as-is
  //   - local file path → spawn a static HTTP server rooted at the file's
  //     parent directory. `file://` breaks ES-module script tags that Vite /
  //     CRA / Next builds emit, which made pre-dist index.html render blank.
  let staticServer: { url: string; close: () => Promise<void> } | undefined
  let target: string
  if (/^https?:\/\//i.test(opts.rendered) || /^file:\/\//i.test(opts.rendered)) {
    target = opts.rendered
  } else {
    const absFile = path.resolve(opts.rendered)
    const serveRoot = path.dirname(absFile)
    // Delivered apps often ship a backend (Express/bun) that serves both the
    // built SPA *and* its own `/api/*` endpoints. A static file server would
    // 404 every data fetch and leave the UI stuck on loading states — use
    // the project's own launch script when one is declared.
    //
    // No silent static fallback when a launch script is declared but fails
    // (rule 1): a failure means the merged worktree's build/server is
    // genuinely broken — surfacing the spawn error gives the delivery agent
    // an actionable signal ("server exited code=1, missing module foo")
    // instead of silently rendering an unbuilt index.html that puppeteer
    // hangs on. The static server is only used when the project does not
    // declare any of `server` / `start` / `preview`.
    const projectRoot = await findProjectRoot(serveRoot)
    const launchScript = projectRoot ? await resolveProjectLaunchScript(projectRoot) : undefined
    if (projectRoot && launchScript) {
      staticServer = await startProjectServer(projectRoot, launchScript)
      target = `${staticServer.url}/`
    } else {
      staticServer = await startStaticServer(serveRoot)
      const fileName = path.basename(absFile)
      target = fileName.toLowerCase() === "index.html"
        ? `${staticServer.url}/`
        : `${staticServer.url}/${encodeURIComponent(fileName)}`
    }
  }

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  })
  const renderedPath = path.join(opts.outDir, "rendered.png")
  let dom: {
    textLength: number
    nodeCount: number
    hasBodyChildren: boolean
    isEmptyRootShell: boolean
  }
  let interaction: RuntimeInteractionProbe | undefined
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 })
    // Same reasoning as startProjectServer's 90s budget — a cold merged
    // worktree can need a non-trivial first-paint window once the server
    // accepts connections, especially when `vite preview` still triggers a
    // build on first request. Configurable via opts.navigationTimeoutMs so
    // benchmarks with slower runners can override without editing source.
    const navigationTimeoutMs = opts.navigationTimeoutMs ?? 90_000
    // `load` (window.onload) instead of `networkidle0`: most benchmark
    // deliverables run via `bun run dev` where vite keeps an HMR websocket
    // open indefinitely — networkidle0 would NEVER settle and the entire
    // navigation budget would expire even when the page rendered fine.
    // `load` fires when DOM + initial CSS/JS/fonts are loaded, which is
    // sufficient for a faithful screenshot. The settle wait below covers
    // React hydration that runs after the load event.
    await page.goto(target, { waitUntil: "load", timeout: navigationTimeoutMs })
    // React/Vue/SPA hydration often fires after `load`. Without this delay
    // the screenshot can capture the un-hydrated shell ("Loading…" / empty
    // root). 2.5s is a conservative cap — most apps hydrate in <500ms but
    // a cold first-paint with code-splitting can stretch to 1-2s.
    await new Promise((r) => setTimeout(r, 2_500))
    const collectDom = () => page.evaluate(() => {
      const body = document.body
      const text = body ? (body.innerText ?? "").trim() : ""
      const nodeCount = document.querySelectorAll("*").length
      const hasBodyChildren = !!body && body.children.length > 0
      // 检测 Vite/CRA 空壳：`<div id="root">` 是 body 的唯一非脚本子元素且其内部
      // 元素 <= 1。React SPA 渲染失败 / 未 hydrate / hydrate 了空 App 都会命中。
      const isEmptyRootShell = (() => {
        if (!body) return true
        const elementChildren = Array.from(body.children).filter(
          (c) => c.tagName !== "SCRIPT" && c.tagName !== "STYLE" && c.tagName !== "NOSCRIPT",
        )
        if (elementChildren.length !== 1) return false
        const sole = elementChildren[0] as HTMLElement
        if (sole.id !== "root" && sole.id !== "app" && sole.id !== "__next") return false
        return sole.querySelectorAll("*").length <= 1
      })()
      return {
        textLength: text.length,
        nodeCount,
        hasBodyChildren,
        isEmptyRootShell,
      }
    })
    dom = await collectDom()
    if (opts.probeInteractions) {
      interaction = await probeRuntimeInteractions(page)
      if (interaction.textChanged || interaction.htmlChanged) {
        dom = await collectDom()
      }
    }
    await page.screenshot({
      path: renderedPath,
      type: "png",
      clip: { x: 0, y: 0, width: viewport.width, height: viewport.height },
    })
  } finally {
    await browser.close()
    if (staticServer) await staticServer.close()
  }
  const rendered = await decodePNG(renderedPath)
  return {
    renderedPath,
    viewport,
    size: { width: rendered.width, height: rendered.height },
    dom,
    interaction,
  }
}

export type RuntimeInteractionProbe = {
  visibleControlCount: number
  textInputCount: number
  fileInputCount: number
  attemptedInteractionCount: number
  textChanged: boolean
  htmlChanged: boolean
  errorCount: number
  errors: string[]
}

async function probeRuntimeInteractions(page: Page): Promise<RuntimeInteractionProbe> {
  const before = await page.evaluate(() => ({
    text: document.body?.innerText ?? "",
    html: document.body?.innerHTML ?? "",
  }))
  const seen = new Set<string>()
  const errors: string[] = []
  let attempted = 0
  let visibleControlCount = 0
  let textInputCount = 0
  let fileInputCount = 0

  for (let round = 0; round < 3; round++) {
    const controls = await page.evaluate(() => {
      const state = window as unknown as { __opencorvusRuntimeProbeNext?: number }
      state.__opencorvusRuntimeProbeNext ??= 0
      const visible = (el: Element) => {
        const rect = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
      }
      const elements = Array.from(document.querySelectorAll(
        "button,a[href],input,textarea,select,[role='button'],[contenteditable='true']",
      )).filter((el) => visible(el))
      return elements.map((el) => {
        let id = el.getAttribute("data-opencorvus-runtime-probe-id")
        if (!id) {
          const next = state.__opencorvusRuntimeProbeNext ?? 0
          id = String(next)
          state.__opencorvusRuntimeProbeNext = next + 1
          el.setAttribute("data-opencorvus-runtime-probe-id", id)
        }
        const selector = `[data-opencorvus-runtime-probe-id="${id}"]`
        const isFileInput = el instanceof HTMLInputElement && (el.type || "").toLowerCase() === "file"
        const isTextInput = el instanceof HTMLTextAreaElement
          || (el instanceof HTMLInputElement
            && ["email", "password", "search", "text", "url"].includes((el.type || "text").toLowerCase()))
        return { id, selector, isTextInput, isFileInput }
      })
    })
    visibleControlCount = Math.max(visibleControlCount, controls.length)
    const roundTextInputCount = controls.filter((item) => item.isTextInput).length
    textInputCount = Math.max(textInputCount, roundTextInputCount)
    fileInputCount = Math.max(fileInputCount, controls.filter((item) => item.isFileInput).length)

    for (const item of controls.filter((control) => control.isTextInput).slice(0, 3)) {
      try {
        await page.click(item.selector, { delay: 10 })
        await page.keyboard.down("Control")
        await page.keyboard.press("KeyA")
        await page.keyboard.up("Control")
        await page.keyboard.type("opencorvus runtime probe", { delay: 5 })
        attempted++
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }

    const clickTargets = controls
      .filter((item) => !item.isFileInput && !seen.has(item.id))
      .slice(0, 5)
    if (clickTargets.length === 0 && roundTextInputCount === 0) break
    for (const item of clickTargets) {
      seen.add(item.id)
      try {
        await page.click(item.selector, { delay: 20 })
        attempted++
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_200))
  }
  await new Promise((resolve) => setTimeout(resolve, 2_000))

  const after = await page.evaluate(() => ({
    text: document.body?.innerText ?? "",
    html: document.body?.innerHTML ?? "",
  }))
  return {
    visibleControlCount,
    textInputCount,
    fileInputCount,
    attemptedInteractionCount: attempted,
    textChanged: before.text !== after.text,
    htmlChanged: before.html !== after.html,
    errorCount: errors.length,
    errors: errors.slice(0, 5),
  }
}

/** SSIM visual diff — retained for the external benchmark CLI and operator
 *  verification workflows only. The delivery pipeline no longer gates on
 *  SSIM: the LLM compares rendered vs reference via vision (see `renderPage`
 *  + delivery agent multimodal attachments), which produces actionable
 *  "header is missing N button, sidebar 20px too wide" feedback instead of
 *  a single opaque similarity number. */
export async function runVisualDiff(opts: VisualDiffOptions): Promise<VisualDiffReport> {
  const threshold = opts.threshold ?? 0.85
  const worstThreshold = opts.worstThreshold ?? 0.55
  for (const [name, value] of [["threshold", threshold], ["worstThreshold", worstThreshold]] as const) {
    if (!Number.isFinite(value) || value <= 0 || value > 1) {
      throw new Error(`runVisualDiff: invalid ${name} (expected 0..1): ${value}`)
    }
  }
  await fs.access(opts.reference).catch(() => {
    throw new Error(`runVisualDiff: reference image not found: ${opts.reference}`)
  })

  const refImgProbe = await decodePNG(opts.reference)
  const { renderedPath, viewport } = await renderPage({
    rendered: opts.rendered,
    outDir: opts.outDir,
    viewport: opts.viewport ?? { width: refImgProbe.width, height: refImgProbe.height },
    browserExecutable: opts.browserExecutable,
  })

  const rendImg = await decodePNG(renderedPath)
  const refImg = refImgProbe
  if (rendImg.width !== refImg.width || rendImg.height !== refImg.height) {
    const report: VisualDiffReport = {
      passed: false,
      reason: "size_mismatch",
      mssim: Number.NaN,
      threshold,
      worstThreshold,
      distribution: { min: Number.NaN, p1: Number.NaN, p5: Number.NaN, p25: Number.NaN, mean: Number.NaN },
      gate: { meanPassed: false, worstPassed: false },
      viewport,
      rendered: { path: renderedPath, width: rendImg.width, height: rendImg.height },
      reference: { path: path.resolve(opts.reference), width: refImg.width, height: refImg.height },
      ssimPerformanceMs: undefined,
    }
    await fs.writeFile(path.join(opts.outDir, "diff.json"), JSON.stringify(report, null, 2))
    return report
  }

  // pngjs returns `Buffer` for `data`; ssim.js types it as `Uint8ClampedArray`.
  // The bytes are bit-identical RGBA, so a structural cast is safe — no copy.
  const { mssim, ssim_map, performance } = ssim(
    { data: rendImg.data as unknown as Uint8ClampedArray, width: rendImg.width, height: rendImg.height },
    { data: refImg.data as unknown as Uint8ClampedArray, width: refImg.width, height: refImg.height },
  )
  const mapData = ssim_map?.data ? Array.from(ssim_map.data as Float32Array | number[]) : []
  mapData.sort((a, b) => a - b)
  const percentile = (p: number) =>
    mapData.length === 0 ? Number.NaN : mapData[Math.min(mapData.length - 1, Math.floor(p * mapData.length))]
  const minSSIM = mapData[0] ?? Number.NaN
  const p1 = percentile(0.01)
  const p5 = percentile(0.05)
  const p25 = percentile(0.25)

  const meanPassed = mssim >= threshold
  const worstPassed = Number.isFinite(p5) ? p5 >= worstThreshold : false
  const passed = meanPassed && worstPassed
  const reason: VisualDiffReport["reason"] = passed
    ? "ok"
    : !meanPassed && !worstPassed
      ? "below_both"
      : !meanPassed
        ? "below_mean"
        : "below_worst"

  const report: VisualDiffReport = {
    passed,
    reason,
    mssim,
    threshold,
    worstThreshold,
    distribution: { min: minSSIM, p1, p5, p25, mean: mssim },
    gate: { meanPassed, worstPassed },
    viewport,
    rendered: { path: renderedPath, width: rendImg.width, height: rendImg.height },
    reference: { path: path.resolve(opts.reference), width: refImg.width, height: refImg.height },
    ssimPerformanceMs: performance,
  }
  await fs.writeFile(path.join(opts.outDir, "diff.json"), JSON.stringify(report, null, 2))
  return report
}

/** Format a `VisualDiffReport` as a one-line evidence string suitable for
 *  CheckResult.output / EvaluationCheck.evidence. */
export function summarizeVisualReport(report: VisualDiffReport): string {
  const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(4) : "n/a")
  if (report.reason === "size_mismatch") {
    return `size mismatch — rendered=${report.rendered.width}x${report.rendered.height} reference=${report.reference.width}x${report.reference.height}`
  }
  return `mean=${fmt(report.mssim)} (≥${report.threshold}) p5=${fmt(report.distribution.p5)} (≥${report.worstThreshold}) min=${fmt(report.distribution.min)}`
}
