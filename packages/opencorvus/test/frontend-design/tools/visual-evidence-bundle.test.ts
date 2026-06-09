import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { PNG } from "pngjs"
import { tmpdir } from "../../fixture/fixture"
import { tryMaterializeVisualEvidenceBundle } from "../../../src/frontend-design/tools/visual-evidence-bundle"

test("materializes VisualEvidenceBundle from rendered, eval, and vision artifacts", async () => {
  const dir = await tmpdir()
  const referencePath = path.join(dir.path, "reference.png")
  const renderedPath = path.join(dir.path, "rendered.png")
  await fs.writeFile(referencePath, pngBytes(4, 3, [255, 255, 255, 255]))
  await fs.writeFile(renderedPath, pngBytes(4, 3, [250, 250, 250, 255]))
  await writeJson(path.join(dir.path, "render-result.json"), {
    generatedAt: "2026-06-08T00:00:00.000Z",
    url: "http://127.0.0.1:4173",
    renderedPath,
    viewport: { width: 1440, height: 900 },
    projectDirectory: dir.path,
  })
  await writeJson(path.join(dir.path, "eval-result.json"), {
    generatedAt: "2026-06-08T00:00:00.000Z",
    referencePath,
    renderedPath,
    overallScore: 73,
    passThreshold: 96,
    passed: false,
    ssimScore: 0.82,
    pixelDiffPercent: 22.36,
    dimensionsMatch: true,
  })
  await writeJson(path.join(dir.path, "vision-judge.json"), {
    generatedAt: "2026-06-08T00:00:00.000Z",
    referencePath,
    renderedPath,
    accepted: false,
    differences: [
      {
        severity: "critical",
        region: "top navigation",
        observed: "Header is stacked and oversized.",
        expected: "Header matches the dense reference navigation.",
        fix_hint: "Restore the original navigation layout.",
      },
    ],
  })

  const bundle = await tryMaterializeVisualEvidenceBundle({
    outputDir: dir.path,
    taskID: "tsk_visual_bundle",
    source: "frontend_design",
    projectDirectory: dir.path,
  })

  expect(bundle?.id).toContain("veb_frontend_design")
  expect(bundle?.taskID).toBe("tsk_visual_bundle")
  expect(bundle?.evaluation.overallScore).toBe(73)
  expect(bundle?.vision.accepted).toBe(false)
  expect(bundle?.regions).toHaveLength(1)
  expect(bundle?.regions[0].label).toBe("top navigation")
  expect(bundle?.regions[0].status).toBe("failing")
  expect(await Bun.file(path.join(dir.path, "visual-evidence-bundle.json")).exists()).toBe(true)
})

test("does not write a partial VisualEvidenceBundle when qualitative verdict is missing", async () => {
  const dir = await tmpdir()
  const referencePath = path.join(dir.path, "reference.png")
  const renderedPath = path.join(dir.path, "rendered.png")
  await fs.writeFile(referencePath, pngBytes(2, 2, [255, 255, 255, 255]))
  await fs.writeFile(renderedPath, pngBytes(2, 2, [255, 255, 255, 255]))
  await writeJson(path.join(dir.path, "render-result.json"), {
    url: "http://127.0.0.1:4173",
    renderedPath,
    viewport: { width: 1440, height: 900 },
  })
  await writeJson(path.join(dir.path, "eval-result.json"), {
    referencePath,
    renderedPath,
    overallScore: 100,
    passThreshold: 96,
    passed: true,
    ssimScore: 1,
    pixelDiffPercent: 0,
    dimensionsMatch: true,
  })

  const bundle = await tryMaterializeVisualEvidenceBundle({
    outputDir: dir.path,
    taskID: "tsk_visual_bundle_missing",
    source: "frontend_design",
  })

  expect(bundle).toBeUndefined()
  expect(await Bun.file(path.join(dir.path, "visual-evidence-bundle.json")).exists()).toBe(false)
})

async function writeJson(file: string, value: unknown) {
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8")
}

function pngBytes(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  const png = new PNG({ width, height })
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = rgba[0]
    png.data[i + 1] = rgba[1]
    png.data[i + 2] = rgba[2]
    png.data[i + 3] = rgba[3]
  }
  return PNG.sync.write(png)
}
