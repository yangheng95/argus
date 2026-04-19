#!/usr/bin/env bun
/**
 * Self-contained rescore — given a cleaned worktree that only contains
 * `index.html` + `images/`, freshly extract the reference URL, render the
 * clone, and compute the score. Works after the webpage-clone skill has
 * deleted its intermediate artifacts.
 */
import path from "node:path"
import fs from "node:fs/promises"
import os from "node:os"
import { mkdtempSync } from "node:fs"

import { Server } from "../../src/server/server"
import { Instance } from "../../src/project/instance"
import { extractPage } from "../../src/mirror/url/extract"
import { renderFiles } from "../../src/mirror/visual/render"
import { evaluateVisual } from "../../src/mirror/visual/evaluate"

const [, , clonedDir, url] = process.argv
if (!clonedDir || !url) {
  console.error("usage: bun rescore-standalone.ts <clonedDir> <url>")
  process.exit(2)
}

Server.listen({ port: 0, hostname: "127.0.0.1" })

const refDir = mkdtempSync(path.join(os.tmpdir(), "rescore-ref-"))

await Instance.provide({
  directory: path.resolve(clonedDir),
  fn: async () => {
    console.log(`[rescore] extracting reference ${url} → ${refDir}`)
    const page = await extractPage({
      url,
      viewport: { width: 1440, height: 900 },
      waitMs: 3000,
      noScreenshots: false,
      outputDir: refDir,
    })
    const refPath = path.join(refDir, "reference.png")
    await fs.writeFile(refPath, Buffer.from(page.screenshotUrl.replace(/^data:image\/png;base64,/, ""), "base64"))

    console.log(`[rescore] rendering clone ${clonedDir}`)
    const render = await renderFiles({
      outputDir: path.resolve(clonedDir),
      viewport: { width: 1440, height: 900 },
    })

    const report = await evaluateVisual({
      originalImage: refPath,
      renderedImage: render.screenshotDataUrl,
    })

    console.log(`[rescore] score=${report.overallScore}/100  ssim=${report.ssimScore.toFixed(4)}  pixelDiff=${report.pixelDiffPercent.toFixed(2)}%`)
    process.exit(report.overallScore >= 95 ? 0 : 1)
  },
})
