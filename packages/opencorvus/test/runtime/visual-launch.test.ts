import { afterEach, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { renderPage } from "../../src/runtime/visual-page"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

test("runtime render rejects local files instead of starting a server", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-url-only-render-"))
  tempDirs.push(dir)
  const htmlPath = path.join(dir, "index.html")
  await fs.writeFile(htmlPath, "<!doctype html><html><body><main>local file</main></body></html>")

  await expect(
    renderPage({
      rendered: htmlPath,
      outDir: dir,
      viewport: { width: 320, height: 240 },
      settleMs: 0,
    }),
  ).rejects.toThrow("URL-only")
})

test("runtime visual render source has no package-manager or static-server path", async () => {
  const source = await fs.readFile(path.resolve(import.meta.dir, "../../src/runtime/visual-page.ts"), "utf8")

  expect(source).not.toContain("BUN_BINARY")
  expect(source).not.toContain("bun install")
  expect(source).not.toContain("bun run")
  expect(source).not.toContain("startStaticServer")
  expect(source).not.toContain("resolveProjectLaunchScript")
  expect(source).not.toContain("headless: true")
})
