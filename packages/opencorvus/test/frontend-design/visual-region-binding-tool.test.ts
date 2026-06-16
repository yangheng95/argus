import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import sharp from "sharp"

import {
  materializeVisualRegionBindingPackage,
  materializeVisualRegionCoordinateAtlas,
} from "../../src/frontend-design/visual-region-binding-tool"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("frontend-design VisualRegionBinding materializer", () => {
  afterEach(async () => {
    await resetDatabase()
    await Instance.disposeAll()
  })

  test("writes visible coordinate atlas bands before bbox authoring", async () => {
    await using tmp = await tmpdir()
    const taskID = "tsk_visualregionatlas"

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
        await fs.mkdir(paths.webpageEvidenceAbsolute, { recursive: true })
        const sourcePng = path.join(paths.webpageEvidenceAbsolute, "desktop-reference-full.png")
        await sharp({
          create: {
            width: 320,
            height: 260,
            channels: 4,
            background: "#ffffff",
          },
        })
          .composite([
            {
              input: Buffer.from(
                `<svg width="280" height="90" xmlns="http://www.w3.org/2000/svg">
                  <rect width="280" height="90" fill="#d7f1e5"/>
                  <text x="12" y="52" font-family="Arial" font-size="28" fill="#0b4d35">Hero</text>
                </svg>`,
              ),
              left: 20,
              top: 30,
            },
            {
              input: Buffer.from(
                `<svg width="280" height="80" xmlns="http://www.w3.org/2000/svg">
                  <rect width="280" height="80" fill="#e9ecff"/>
                  <text x="12" y="48" font-family="Arial" font-size="24" fill="#24318f">Table</text>
                </svg>`,
              ),
              left: 20,
              top: 150,
            },
          ])
          .png()
          .toFile(sourcePng)

        const result = await materializeVisualRegionCoordinateAtlas({
          taskID,
          sourceImagePath: sourcePng,
          atlasName: "world-economy-atlas",
          bandHeight: 120,
          gridStep: 40,
        })

        expect(result.manifestPath).toContain("/fd/visual-region-atlases/world-economy-atlas/manifest.json")
        expect(result.sourceImageDimensions).toEqual({ width: 320, height: 260 })
        expect(result.bandHeight).toBe(120)
        expect(result.gridStep).toBe(40)
        expect(result.atlasImages.map((image) => image.filename)).toEqual([
          "overview__src320x260.png",
          "band-01__src320x260__y0-h120.png",
          "band-02__src320x260__y120-h120.png",
          "band-03__src320x260__y240-h20.png",
        ])

        const overview = await sharp(result.atlasImages[0]!.absolutePath).metadata()
        const firstBand = await sharp(result.atlasImages[1]!.absolutePath).metadata()
        const manifest = JSON.parse(await fs.readFile(path.join(tmp.path, result.manifestPath), "utf8"))
        expect(overview.format).toBe("png")
        expect(firstBand.width).toBe(320)
        expect(firstBand.height).toBe(120)
        expect(manifest.purpose).toBe("visual-region-coordinate-atlas")
        expect(manifest.atlas_images).toHaveLength(4)
        expect(manifest.atlas_images[1]).toMatchObject({
          kind: "band",
          filename: "band-01__src320x260__y0-h120.png",
          y: 0,
          height: 120,
        })
      },
    })
  })

  test("writes real PNG source crops and a durable binding manifest", async () => {
    await using tmp = await tmpdir()
    const taskID = "tsk_visualregionbinding"

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
        await fs.mkdir(paths.webpageEvidenceAbsolute, { recursive: true })
        const sourcePng = path.join(paths.webpageEvidenceAbsolute, "desktop-reference-full.png")
        await sharp({
          create: {
            width: 400,
            height: 260,
            channels: 4,
            background: "#ffffff",
          },
        })
          .composite([
            {
              input: Buffer.from(
                `<svg width="180" height="70" xmlns="http://www.w3.org/2000/svg">
                  <rect width="180" height="70" fill="#d7f1e5"/>
                  <text x="12" y="42" font-family="Arial" font-size="28" fill="#0b4d35">Header</text>
                </svg>`,
              ),
              left: 20,
              top: 30,
            },
            {
              input: Buffer.from(
                `<svg width="150" height="90" xmlns="http://www.w3.org/2000/svg">
                  <rect width="150" height="90" fill="#e9ecff"/>
                  <text x="12" y="52" font-family="Arial" font-size="24" fill="#24318f">Chart</text>
                </svg>`,
              ),
              left: 220,
              top: 120,
            },
          ])
          .png()
          .toFile(sourcePng)

        const result = await materializeVisualRegionBindingPackage({
          taskID,
          sourceImagePath: sourcePng,
          manifestPath: "docs/visual-region-binding.json",
          regions: [
            {
              region_id: "header",
              source_bbox: { x: 20, y: 30, width: 180, height: 70 },
              viewport: "desktop",
              region_scope: "global-header",
              target_route: "/markets/world-economy/",
              implementation_locator: "[data-region='header']",
              component_files: ["src/components/Header.tsx"],
            },
            {
              region_id: "chart",
              source_bbox: { x: 220, y: 120, width: 150, height: 90 },
              viewport: "desktop",
              region_scope: "macro-chart",
              target_route: "/markets/world-economy/",
              implementation_locator: "[data-region='chart']",
              component_files: ["src/components/MacroChart.tsx"],
            },
          ],
        })

        expect(result.manifestPath).toBe("docs/visual-region-binding.json")
        expect(result.regions).toHaveLength(2)
        expect(result.sourceImageDimensions).toEqual({ width: 400, height: 260 })
        expect(result.regions[0]?.source_crop_filename).toBe("01-header__src400x260__x20-y30-w180-h70.png")
        expect(result.regions[1]?.source_crop_filename).toBe("02-chart__src400x260__x220-y120-w150-h90.png")
        expect(result.regions[0]?.source_reference_artifact.endsWith("01-header__src400x260__x20-y30-w180-h70.png")).toBe(
          true,
        )
        expect(result.regions[1]?.source_reference_artifact.endsWith("02-chart__src400x260__x220-y120-w150-h90.png")).toBe(
          true,
        )
        expect(result.bboxOverlayArtifact.endsWith("bbox-overlay__src400x260.png")).toBe(true)
        expect(result.contactSheetArtifact.endsWith("region-contact-sheet__src400x260.png")).toBe(true)

        const manifest = JSON.parse(await fs.readFile(path.join(tmp.path, result.manifestPath), "utf8"))
        expect(manifest.purpose).toBe("visual-region-binding-package")
        expect(manifest.source_image_dimensions).toEqual({ width: 400, height: 260 })
        expect(manifest.bbox_overlay_artifact).toBe(result.bboxOverlayArtifact)
        expect(manifest.contact_sheet_artifact).toBe(result.contactSheetArtifact)
        expect(manifest.regions[0]).toMatchObject({
          region_id: "header",
          source_crop_filename: "01-header__src400x260__x20-y30-w180-h70.png",
          viewport: "desktop",
          region_scope: "global-header",
          target_route: "/markets/world-economy/",
          implementation_locator: "[data-region='header']",
          component_files: ["src/components/Header.tsx"],
          source_bbox: { x: 20, y: 30, width: 180, height: 70 },
        })

        const firstCrop = await sharp(path.join(tmp.path, result.regions[0]!.source_reference_artifact)).metadata()
        const secondCrop = await sharp(path.join(tmp.path, result.regions[1]!.source_reference_artifact)).metadata()
        const overlay = await sharp(path.join(tmp.path, result.bboxOverlayArtifact)).metadata()
        const contactSheet = await sharp(path.join(tmp.path, result.contactSheetArtifact)).metadata()
        expect(firstCrop.format).toBe("png")
        expect(firstCrop.width).toBe(180)
        expect(firstCrop.height).toBe(70)
        expect(secondCrop.format).toBe("png")
        expect(secondCrop.width).toBe(150)
        expect(secondCrop.height).toBe(90)
        expect(overlay.format).toBe("png")
        expect(overlay.width).toBe(400)
        expect(overlay.height).toBe(260)
        expect(contactSheet.format).toBe("png")
      },
    })
  })

  test("rejects missing task scope and out-of-bounds boxes", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sourcePng = path.join(tmp.path, "reference.png")
        await sharp({
          create: { width: 100, height: 100, channels: 4, background: "#ffffff" },
        })
          .png()
          .toFile(sourcePng)

        const input = {
          sourceImagePath: sourcePng,
          regions: [
            {
              region_id: "bad",
              source_bbox: { x: 80, y: 80, width: 30, height: 30 },
              viewport: "desktop",
              region_scope: "bad",
              target_route: "/",
              implementation_locator: "[data-region='bad']",
              component_files: ["src/Bad.tsx"],
            },
          ],
        }

        await expect(materializeVisualRegionBindingPackage(input)).rejects.toThrow("requires a task-scoped")
        await expect(materializeVisualRegionBindingPackage({ ...input, taskID: "tsk_badbox" })).rejects.toThrow(
          "exceeds source image bounds",
        )
      },
    })
  })

  test("rejects external paths, duplicate binding keys, and non-json manifests", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sourcePng = path.join(tmp.path, "reference.png")
        await sharp({
          create: { width: 120, height: 120, channels: 4, background: "#ffffff" },
        })
          .png()
          .toFile(sourcePng)

        const regions = [
          {
            region_id: "dup",
            source_bbox: { x: 0, y: 0, width: 20, height: 20 },
            viewport: "desktop",
            region_scope: "header",
            target_route: "/",
            implementation_locator: "[data-region='dup']",
            component_files: ["src/Dup.tsx"],
          },
          {
            region_id: "dup",
            source_bbox: { x: 30, y: 30, width: 20, height: 20 },
            viewport: "desktop",
            region_scope: "header-repeat",
            target_route: "/",
            implementation_locator: "[data-region='dup2']",
            component_files: ["src/Dup2.tsx"],
          },
        ]

        await expect(
          materializeVisualRegionBindingPackage({
            taskID: "tsk_duplicate",
            sourceImagePath: sourcePng,
            regions,
          }),
        ).rejects.toThrow("Duplicate VisualRegionBinding region")

        await expect(
          materializeVisualRegionBindingPackage({
            taskID: "tsk_badmanifest",
            sourceImagePath: sourcePng,
            manifestPath: "docs/visual-region-binding.txt",
            regions: regions.slice(0, 1),
          }),
        ).rejects.toThrow("manifestPath must be a JSON file")

        const outsidePath = path.join(os.tmpdir(), `opencorvus-outside-${Date.now()}.png`)
        await fs.copyFile(sourcePng, outsidePath)
        try {
          await expect(
            materializeVisualRegionBindingPackage({
              taskID: "tsk_external",
              sourceImagePath: outsidePath,
              regions: regions.slice(0, 1),
            }),
          ).rejects.toThrow("sourceImagePath must stay inside the current project directory")
        } finally {
          await fs.rm(outsidePath, { force: true })
        }
      },
    })
  })
})
