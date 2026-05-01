import { afterEach, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createIsolatedRenderWorkspace, resolveProjectLaunchScript } from "../../src/delivery/checks/visual"

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
