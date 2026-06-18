import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { tryMaterializeVisualEvidenceBundle } from "../../../src/frontend-design/tools/visual-evidence-bundle"

test("webpage evidence bundle records the supplied project directory instead of stale render metadata", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-bh100-project-"))
  const evidenceDir = path.join(projectDir, "webpage-evidence")
  await fs.mkdir(evidenceDir, { recursive: true })

  const referencePath = path.join(evidenceDir, "reference.png")
  const renderedPath = path.join(evidenceDir, "rendered.png")
  await fs.writeFile(referencePath, onePixelPng())
  await fs.writeFile(renderedPath, onePixelPng())
  await writeJson(path.join(evidenceDir, "render-result.json"), {
    generatedAt: "2026-06-18T00:00:00.000Z",
    url: "http://127.0.0.1:4173",
    renderedPath,
    viewport: { width: 1440, height: 900 },
    projectDirectory: process.cwd(),
  })
  await writeJson(path.join(evidenceDir, "eval-result.json"), {
    generatedAt: "2026-06-18T00:00:00.000Z",
    referencePath,
    renderedPath,
    overallScore: 100,
    passThreshold: 85,
    passed: true,
    ssimScore: 1,
    pixelDiffPercent: 0,
    dimensionsMatch: true,
  })
  await writeJson(path.join(evidenceDir, "vision-judge.json"), {
    generatedAt: "2026-06-18T00:00:00.000Z",
    referencePath,
    renderedPath,
    accepted: true,
    differences: [],
  })

  expect(projectDir).not.toBe(process.cwd())

  await tryMaterializeVisualEvidenceBundle({
    outputDir: evidenceDir,
    taskID: "tsk_bh100",
    source: "build",
    projectDirectory: projectDir,
  })

  const bundle = JSON.parse(await fs.readFile(path.join(evidenceDir, "visual-evidence-bundle.json"), "utf8")) as {
    rendered: { projectDirectory: string }
  }
  expect(bundle.rendered.projectDirectory).toBe(projectDir)
  expect(bundle.rendered.projectDirectory).not.toBe(process.cwd())
})

async function writeJson(file: string, value: unknown) {
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8")
}

function onePixelPng(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64",
  )
}
