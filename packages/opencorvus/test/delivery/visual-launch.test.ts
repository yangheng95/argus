import { afterEach, expect, test } from "bun:test"
import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  announcedLocalUrlFromOutput,
  cleanupIsolatedRenderWorkspace,
  createIsolatedRenderWorkspace,
  resolveProjectLaunchScript,
} from "../../src/delivery/checks/visual"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

async function fixture(scripts: Record<string, string>, files: Record<string, string> = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-visual-launch-"))
  tempDirs.push(dir)
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ scripts }, null, 2),
  )
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(dir, ...rel.split("/"))
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, text)
  }
  return dir
}

test("preview launch schedules build when compiled output is absent", async () => {
  const dir = await fixture({
    build: "vite build",
    preview: "vite preview --host 127.0.0.1",
  })

  await expect(resolveProjectLaunchScript(dir)).resolves.toEqual({
    script: "preview",
    command: "vite preview --host 127.0.0.1",
    buildScript: "build",
  })
})

test("preview launch rebuilds in the isolated render workspace even when dist index already exists", async () => {
  const dir = await fixture(
    {
      build: "vite build",
      preview: "vite preview --host 127.0.0.1",
    },
    {
      "dist/index.html": "<div id=\"root\">built</div>",
    },
  )

  await expect(resolveProjectLaunchScript(dir)).resolves.toEqual({
    script: "preview",
    command: "vite preview --host 127.0.0.1",
    buildScript: "build",
  })
})

test("isolated render workspace copies project files without mutating source scratch dirs", async () => {
  const dir = await fixture(
    {
      build: "vite build",
      preview: "vite preview --host 127.0.0.1",
    },
    {
      "src/main.ts": "console.log('render')\n",
      ".opencorvus/cache.txt": "internal scratch\n",
      "node_modules/pkg/index.js": "module.exports = 1\n",
      "dist/index.html": "<div>built</div>",
    },
  )

  const isolated = await createIsolatedRenderWorkspace(dir)
  tempDirs.push(path.dirname(isolated.directory))

  await expect(fs.readFile(path.join(isolated.directory, "src", "main.ts"), "utf8")).resolves.toContain("render")
  await expect(fs.readFile(path.join(isolated.directory, "dist", "index.html"), "utf8")).resolves.toContain("built")
  await expect(fs.access(path.join(isolated.directory, ".opencorvus", "cache.txt"))).rejects.toThrow()
  await expect(fs.access(path.join(isolated.directory, "node_modules", "pkg", "index.js"))).rejects.toThrow()

  await isolated.cleanup()
  await expect(fs.access(isolated.directory)).rejects.toThrow()
  await expect(fs.readFile(path.join(dir, ".opencorvus", "cache.txt"), "utf8")).resolves.toContain("internal scratch")
})

test("announcedLocalUrlFromOutput parses ANSI-colored vite preview port", () => {
  const output = [
    "$ vite preview",
    "Port 4179 is in use, trying another one...",
    "\x1b[32m➜\x1b[39m \x1b[1mLocal\x1b[22m: \x1b[36mhttp://localhost:\x1b[1m4180\x1b[22m/\x1b[39m",
  ].join("\n")

  expect(announcedLocalUrlFromOutput(output)).toBe("http://localhost:4180")
})

test("announcedLocalUrlFromOutput refuses localhost URLs without an explicit port", () => {
  expect(announcedLocalUrlFromOutput("Local: http://localhost/")).toBeUndefined()
})

test("announcedLocalUrlFromOutput only normalizes wildcard host", () => {
  expect(announcedLocalUrlFromOutput("Local: http://0.0.0.0:4180/")).toBe("http://127.0.0.1:4180")
  expect(announcedLocalUrlFromOutput("Local: http://127.0.0.1:4180/")).toBe("http://127.0.0.1:4180")
})

test("isolated render cleanup kills Windows processes referencing the workspace", async () => {
  if (process.platform !== "win32") return

  const scratchRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-render-cleanup-"))
  const workspace = path.join(scratchRoot, "workspace")
  tempDirs.push(scratchRoot)
  await fs.mkdir(workspace, { recursive: true })
  const scriptPath = path.join(workspace, "hold.ts")
  await fs.writeFile(scriptPath, "setInterval(() => {}, 1000)\n")

  const child = spawn("bun", [scriptPath], {
    cwd: workspace,
    stdio: "ignore",
    shell: true,
  })
  try {
    await waitForProcessStart(child)
    await cleanupIsolatedRenderWorkspace(scratchRoot)
    await expect(fs.access(scratchRoot)).rejects.toThrow()
  } finally {
    child.kill("SIGKILL")
  }
})

function waitForProcessStart(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 500)
    child.once("error", (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.once("exit", (code) => {
      clearTimeout(timer)
      reject(new Error(`process exited before cleanup test could run: ${code}`))
    })
  })
}
