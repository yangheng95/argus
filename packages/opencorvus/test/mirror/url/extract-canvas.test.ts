import { describe, expect, test } from "bun:test"
import { createServer, type Server } from "node:http"
import { AddressInfo } from "node:net"

import { extractPage } from "../../../src/mirror/url/extract"
import { tmpdir } from "../../fixture/fixture"

async function serveHtml(html: string): Promise<{ url: string; server: Server }> {
  return new Promise((ok, fail) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html", Connection: "close" })
      res.end(html)
    })
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo | null
      if (addr && typeof addr === "object") {
        ok({ url: `http://127.0.0.1:${addr.port}/`, server })
      } else {
        server.close()
        fail(new Error("server address unavailable"))
      }
    })
    server.on("error", fail)
  })
}

describe("extractPage canvas assets", () => {
  test(
    "captures visible canvas as a categorized mirror image asset",
    async () => {
      await using tmp = await tmpdir()
      const { url, server } = await serveHtml(`<!doctype html>
        <html>
          <head>
            <title>Canvas Chart</title>
            <style>body { margin: 0 } canvas { width: 320px; height: 160px; }</style>
          </head>
          <body>
            <canvas id="chart" width="320" height="160"></canvas>
            <script>
              const ctx = document.getElementById("chart").getContext("2d");
              ctx.fillStyle = "#ffffff";
              ctx.fillRect(0, 0, 320, 160);
              ctx.fillStyle = "#00a86b";
              ctx.fillRect(40, 20, 16, 120);
            </script>
          </body>
        </html>`)
      try {
        const result = await extractPage({ url, noScreenshots: true, waitMs: 0, outputDir: tmp.path })
        const canvas = result.tree.find((el) => el.tag === "canvas")

        expect(canvas?.imageSrc).toBe("images/canvas/canvas-0.png")
        expect(canvas?.imageAlt).toBe("canvas capture")
        expect(result.assets.images.some((image) => image.src === canvas?.imageSrc)).toBe(true)
        expect(JSON.stringify(result)).not.toContain("data:image/png;base64")
        expect(await Bun.file(`${tmp.path}/images/canvas/canvas-0.png`).exists()).toBe(true)
      } finally {
        server.close()
      }
    },
    90_000,
  )
})
