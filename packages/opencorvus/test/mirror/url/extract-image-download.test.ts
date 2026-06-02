import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { MirrorUrlExtractTestHooks } from "../../../src/mirror/url/extract"

describe("mirror URL image downloads", () => {
  let server: ReturnType<typeof Bun.serve>
  let baseUrl = ""

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === "/ok.svg") {
          return new Response("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"></svg>", {
            headers: { "content-type": "image/svg+xml" },
          })
        }
        return new Response("broken", { status: 500 })
      },
    })
    baseUrl = `http://127.0.0.1:${server.port}`
  })

  afterAll(() => {
    server.stop(true)
  })

  test("keeps successful assets and records failed asset evidence", async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "mirror-image-download-"))
    try {
      const result = await MirrorUrlExtractTestHooks.nodeDownloadImages(
        [`${baseUrl}/ok.svg`, `${baseUrl}/missing.svg`],
        outputDir,
        undefined,
        undefined,
      )

      expect(Object.keys(result.imageMap)).toEqual([`${baseUrl}/ok.svg`])
      expect(result.imageMap[`${baseUrl}/ok.svg`]).toBe("images/img-0.svg")
      expect(result.failures).toEqual([{ src: `${baseUrl}/missing.svg`, reason: "HTTP 500" }])
      expect(await fs.stat(path.join(outputDir, "images", "img-0.svg"))).toBeTruthy()
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true })
    }
  })
})
