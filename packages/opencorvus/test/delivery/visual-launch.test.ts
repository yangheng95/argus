import { afterEach, expect, test } from "bun:test"
import fs from "node:fs/promises"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { renderPage } from "../../src/delivery/checks/visual"

const servers: http.Server[] = []
const tempDirs: string[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

test("delivery render rejects local files instead of starting a server", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-url-only-render-"))
  tempDirs.push(dir)
  const htmlPath = path.join(dir, "index.html")
  await fs.writeFile(htmlPath, "<!doctype html><html><body><main>local file</main></body></html>")

  await expect(renderPage({
    rendered: htmlPath,
    outDir: dir,
    viewport: { width: 320, height: 240 },
    settleMs: 0,
  })).rejects.toThrow("URL-only")
})

test("delivery render accepts a live http URL without package-manager launch", async () => {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-url-only-render-"))
  tempDirs.push(outDir)
  const url = await serveHtml(`
<!doctype html>
<html>
  <body>
    <main>
      <h1>Live Preview</h1>
      <section><p>Runtime capture uses the running page, keeps the real browser URL as the only source, and never starts package manager scripts.</p></section>
      <section><p>This fixture is intentionally long enough to pass the HTTP body-size integrity floor.</p></section>
    </main>
  </body>
</html>
`)

  const render = await renderPage({
    rendered: url,
    outDir,
    viewport: { width: 640, height: 480 },
    minDomDescendants: 2,
    settleMs: 0,
  })

  expect(render.capture.targetUrl).toBe(url)
  expect(render.capture.layers.http.passed).toBe(true)
  expect(await exists(render.renderedPath)).toBe(true)
})

test("delivery visual render source has no package-manager or static-server path", async () => {
  const source = await fs.readFile(path.resolve(import.meta.dir, "../../src/delivery/checks/visual.ts"), "utf8")

  expect(source).not.toContain("BUN_BINARY")
  expect(source).not.toContain("bun install")
  expect(source).not.toContain("bun run")
  expect(source).not.toContain("startStaticServer")
  expect(source).not.toContain("resolveProjectLaunchScript")
  expect(source).not.toContain("headless: true")
})

async function serveHtml(html: string): Promise<string> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(html)
  })
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("test server did not bind a TCP port")
  return `http://127.0.0.1:${address.port}/`
}

async function exists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(() => true, () => false)
}
