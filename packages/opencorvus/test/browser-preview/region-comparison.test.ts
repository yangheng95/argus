import { afterEach, describe, expect, test } from "bun:test"
import { createServer, type Server } from "node:http"
import fs from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { Instance } from "../../src/project/instance"
import { Database } from "../../src/storage/db"
import {
  BrowserPreviewRegionComparisonResult,
  BrowserPreviewRegionBinding,
  compareBrowserPreviewRegions,
  resolveSourceReferencePath,
} from "../../src/browser-preview/region-comparison"
import { findReadableBrowserPreviewEvidenceByID, resolveRuntimeRelativePath } from "../../src/browser-preview/persist"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { persistTestBrowserPreviewTarget } from "../fixture/browser-preview"

const REGION_COMPARISON_TEST_TIMEOUT_MILLISECONDS = 60_000

function persistDesktopTargetAtWidth(input: { taskID: string; url: string; width: number; height?: number }) {
  return persistTestBrowserPreviewTarget({
    taskID: input.taskID,
    url: input.url,
    viewports: [
      {
        id: "desktop",
        labelKey: "browser_preview.viewport.desktop",
        width: input.width,
        height: input.height ?? 800,
      },
    ],
  })
}

describe("browser preview region comparison", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("resolves only canonical source reference screenshots", async () => {
    await using tmp = await tmpdir()
    const taskID = "tsk_regioncomparisonresolve"
    const sourceRoot = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID).sourcePackageAbsolute

    expect(resolveSourceReferencePath({ projectRoot: tmp.path, taskID, referenceArtifactID: "reference.png" })).toBe(
      path.join(sourceRoot, "reference.png"),
    )
    expect(() =>
      resolveSourceReferencePath({
        projectRoot: tmp.path,
        taskID,
        referenceArtifactID: "web-clone-source/reference-mobile.png",
      }),
    ).toThrow("Source reference must resolve")
    expect(() =>
      resolveSourceReferencePath({ projectRoot: tmp.path, taskID, referenceArtifactID: "../reference.png" }),
    ).toThrow("Source reference must resolve")
    expect(() =>
      resolveSourceReferencePath({ projectRoot: tmp.path, taskID, referenceArtifactID: "source.png" }),
    ).toThrow("Source reference must resolve")
  })

  test("rejects non-canonical source reference IDs at binding schema parse time", () => {
    const parsed = BrowserPreviewRegionBinding.safeParse({
      region_id: "bad-source-reference",
      viewport_id: "desktop",
      state_id: "default",
      region_scope: "page-section",
      crop_intent: "full-region",
      source: {
        reference_artifact_id: ".opencorvus/r/t/S9/qzBwOu/fd/webpage-evidence/reference.png",
        bbox: { x: 0, y: 0, width: 100, height: 80 },
        semantic_role: "bad source reference",
      },
      implementation: {
        route: "/",
        locator: { kind: "data-oc-region", value: "bad-source-reference" },
      },
    })

    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error("non-canonical source reference unexpectedly parsed")
    expect(parsed.error.issues.map((issue) => issue.path.join(".")).join("\n")).toContain(
      "source.reference_artifact_id",
    )
  })

  test("result schema accepts explicit crop intent", () => {
    const parsed = BrowserPreviewRegionComparisonResult.parse({
      status: "passed",
      manifestPath: ".opencorvus/r/t/task/fd/browser-preview/region-comparison/manifest.json",
      jobID: "job_regioncomparison",
      taskID: "tsk_regioncomparison",
      targetID: "target_regioncomparison",
      operation: "reference-comparison",
      comparison_mode: "true-size",
      artifact_note: "true-size comparison",
      evidenceIDs: {},
      regions: [
        {
          region_id: "hero",
          viewport_id: "desktop",
          state_id: "default",
          crop_intent: "full-region",
          status: "completed",
          diagnostics: [],
        },
      ],
      diagnostics: [],
    })

    expect(parsed.regions[0]?.crop_intent).toBe("full-region")
  })

  test(
    "captures local region screenshots and persists side-by-side comparison evidence",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
      await fs.mkdir(paths.sourcePackageAbsolute, { recursive: true })
      await sharp({
        create: {
          width: 800,
          height: 600,
          channels: 4,
          background: "#ffffff",
        },
      })
        .composite([
          {
            input: Buffer.from(
              `<svg width="320" height="140" xmlns="http://www.w3.org/2000/svg">
                <rect width="320" height="140" fill="#e7f5ee"/>
                <text x="24" y="52" font-family="Arial" font-size="30" fill="#123326">Economy</text>
                <text x="24" y="92" font-family="Arial" font-size="18" fill="#315a45">Inflation and growth map</text>
              </svg>`,
            ),
            left: 40,
            top: 60,
          },
        ])
        .png()
        .toFile(path.join(paths.sourcePackageAbsolute, "reference.png"))
      const server = await startPreviewServer()
      try {
        const target = await Instance.provide({
          directory: tmp.path,
          fn: () => persistDesktopTargetAtWidth({ taskID, url: server.url, width: 800 }),
        })
        const binding: BrowserPreviewRegionBinding = {
          region_id: "economy",
          viewport_id: "desktop",
          state_id: "default",
          region_scope: "page-section",
          crop_intent: "full-region",
          source: {
            reference_artifact_id: "reference.png",
            bbox: { x: 40, y: 60, width: 320, height: 140 },
            semantic_role: "economy section",
            text_anchors: ["Economy", "Inflation"],
            source_refs: ["source screenshot"],
          },
          implementation: {
            route: "/economy",
            locator: { kind: "data-oc-region", value: "economy" },
            component_files: ["src/Economy.tsx"],
          },
          acceptance_refs: ["economy parity"],
        }

        const result = await compareBrowserPreviewRegions({
          projectRoot: tmp.path,
          taskID,
          targetID: target.id,
          viewportIDs: ["desktop"],
          bindings: [binding],
          includeDiff: true,
        })

        expect(result.status).toBe("passed")
        expect(result.comparison_mode).toBe("true-size")
        expect(result.artifact_note).toContain("True-size comparison")
        expect(result.diagnostics[0]).toContain("True-size comparison")
        expect(result.regions).toHaveLength(1)
        expect(result.regions[0].crop_intent).toBe("full-region")
        expect(result.regions[0].artifact_note).toContain("True-size comparison")
        expect(result.manifestPath).toContain(".opencorvus/r/")
        expect(result.regions[0].artifacts?.side_by_side).toEndWith("side-by-side.png")
        expect(result.regions[0].implementation_bbox?.width).toBeGreaterThan(250)
        expect(await fileExists(resolveRuntimeRelativePath(tmp.path, result.regions[0].artifacts!.source_crop))).toBe(
          true,
        )
        expect(
          await fileExists(resolveRuntimeRelativePath(tmp.path, result.regions[0].artifacts!.implementation_crop)),
        ).toBe(true)
        expect(await fileExists(resolveRuntimeRelativePath(tmp.path, result.regions[0].artifacts!.side_by_side))).toBe(
          true,
        )
        expect(await fileExists(resolveRuntimeRelativePath(tmp.path, result.regions[0].artifacts!.diff!))).toBe(true)
        const evidenceID = result.evidenceIDs["desktop:default:economy"]
        expect(evidenceID).toBeTruthy()
        const evidence = await Instance.provide({
          directory: tmp.path,
          fn: () => findReadableBrowserPreviewEvidenceByID({ projectRoot: tmp.path, taskID, evidenceID }),
        })
        expect(evidence?.operationKind).toBe("reference-comparison")
        expect(evidence?.regionID).toBe("economy")
        expect(evidence?.stateID).toBe("default")
        expect(evidence?.cropIntent).toBe("full-region")
        expect(evidence?.artifactPaths?.side_by_side).toBe(result.regions[0].artifacts?.side_by_side)
      } finally {
        await server.close()
      }
    },
    { timeout: REGION_COMPARISON_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "fails visually different regions even when the implementation crop covers the source region",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
      await fs.mkdir(paths.sourcePackageAbsolute, { recursive: true })
      await sharp({
        create: {
          width: 800,
          height: 600,
          channels: 4,
          background: "#ffffff",
        },
      })
        .composite([
          {
            input: Buffer.from(
              `<svg width="280" height="110" xmlns="http://www.w3.org/2000/svg">
                <rect width="280" height="110" fill="#dcfce7"/>
                <text x="18" y="44" font-family="Arial" font-size="24" fill="#14532d">Credit Pulse</text>
                <text x="18" y="78" font-family="Arial" font-size="16" fill="#166534">Reference green</text>
              </svg>`,
            ),
            left: 40,
            top: 60,
          },
        ])
        .png()
        .toFile(path.join(paths.sourcePackageAbsolute, "reference.png"))
      const server = await startVisualMismatchPreviewServer()
      try {
        const target = await Instance.provide({
          directory: tmp.path,
          fn: () => persistDesktopTargetAtWidth({ taskID, url: server.url, width: 800 }),
        })
        const binding: BrowserPreviewRegionBinding = {
          region_id: "credit-pulse",
          viewport_id: "desktop",
          state_id: "default",
          region_scope: "card",
          crop_intent: "full-region",
          source: {
            reference_artifact_id: "reference.png",
            bbox: { x: 40, y: 60, width: 280, height: 110 },
            semantic_role: "credit pulse metric card",
            text_anchors: ["Credit Pulse", "Reference green"],
            source_refs: ["source screenshot"],
          },
          implementation: {
            route: "/mismatch",
            locator: { kind: "data-oc-region", value: "credit-pulse" },
            component_files: ["src/CreditPulse.tsx"],
          },
          acceptance_refs: ["credit pulse visual parity"],
        }

        const result = await compareBrowserPreviewRegions({
          projectRoot: tmp.path,
          taskID,
          targetID: target.id,
          viewportIDs: ["desktop"],
          bindings: [binding],
          includeDiff: true,
        })

        expect(result.status).toBe("failed")
        expect(result.regions).toHaveLength(1)
        const region = result.regions[0]
        expect(region.region_id).toBe("credit-pulse")
        expect(region.status).toBe("failed")
        expect(region.artifact_note).toContain("True-size comparison")
        expect(region.reason).toContain("visual score")
        expect(region.coverage?.implementation_covers_source).toBe(true)
        expect(region.visual?.overall_score).toBeLessThan(85)
        expect(region.visual?.pixel_diff_percent).toBeGreaterThan(50)
        expect(region.artifacts?.source_crop).toEndWith("source.png")
        expect(region.artifacts?.implementation_crop).toEndWith("implementation.png")
        expect(region.artifacts?.side_by_side).toEndWith("side-by-side.png")
        expect(region.artifacts?.diff).toEndWith("diff.png")

        const sourceCropPath = resolveRuntimeRelativePath(tmp.path, region.artifacts!.source_crop)
        const implementationCropPath = resolveRuntimeRelativePath(tmp.path, region.artifacts!.implementation_crop)
        const sideBySidePath = resolveRuntimeRelativePath(tmp.path, region.artifacts!.side_by_side)
        const diffPath = resolveRuntimeRelativePath(tmp.path, region.artifacts!.diff!)
        await expectPngDimensions(sourceCropPath, { width: 280, height: 110 })
        await expectPngDimensions(implementationCropPath, { width: 280, height: 110 })
        await expectPngDimensions(sideBySidePath, { width: 576, height: 204 })
        await expectPngDimensions(diffPath, { width: 280, height: 110 })
        await expectPngContainsColor(sourceCropPath, { red: 220, green: 252, blue: 231 })
        await expectPngContainsColor(implementationCropPath, { red: 254, green: 202, blue: 202 })
        await expectPngHasColorDiversity(diffPath)

        const evidenceID = result.evidenceIDs["desktop:default:credit-pulse"]
        expect(evidenceID).toBeTruthy()
        const evidence = await Instance.provide({
          directory: tmp.path,
          fn: () => findReadableBrowserPreviewEvidenceByID({ projectRoot: tmp.path, taskID, evidenceID }),
        })
        expect(evidence?.operationKind).toBe("reference-comparison")
        expect(evidence?.regionID).toBe("credit-pulse")
        expect(evidence?.stateID).toBe("default")
        expect(evidence?.status).toBe("failed")
        expect(evidence?.artifactPaths?.diff).toBe(region.artifacts?.diff)
      } finally {
        await server.close()
      }
    },
    { timeout: REGION_COMPARISON_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "fails implementation crops that are smaller than the source region",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
      await fs.mkdir(paths.sourcePackageAbsolute, { recursive: true })
      await sharp({
        create: {
          width: 800,
          height: 600,
          channels: 4,
          background: "#ffffff",
        },
      })
        .composite([
          {
            input: Buffer.from(
              `<svg width="320" height="140" xmlns="http://www.w3.org/2000/svg">
                <rect width="320" height="140" fill="#e0f2fe"/>
                <text x="20" y="54" font-family="Arial" font-size="26" fill="#075985">Coverage Module</text>
                <text x="20" y="94" font-family="Arial" font-size="18" fill="#0369a1">Full source region</text>
              </svg>`,
            ),
            left: 40,
            top: 60,
          },
        ])
        .png()
        .toFile(path.join(paths.sourcePackageAbsolute, "reference.png"))
      const server = await startUnderCropPreviewServer()
      try {
        const target = await Instance.provide({
          directory: tmp.path,
          fn: () => persistDesktopTargetAtWidth({ taskID, url: server.url, width: 800 }),
        })
        const binding: BrowserPreviewRegionBinding = {
          region_id: "coverage-module",
          viewport_id: "desktop",
          state_id: "default",
          region_scope: "card",
          crop_intent: "full-region",
          source: {
            reference_artifact_id: "reference.png",
            bbox: { x: 40, y: 60, width: 320, height: 140 },
            semantic_role: "coverage module card",
            text_anchors: ["Coverage Module", "Full source region"],
            source_refs: ["source screenshot"],
          },
          implementation: {
            route: "/under-crop",
            locator: { kind: "data-oc-region", value: "coverage-module" },
            component_files: ["src/CoverageModule.tsx"],
          },
          acceptance_refs: ["coverage module visual region"],
        }

        const result = await compareBrowserPreviewRegions({
          projectRoot: tmp.path,
          taskID,
          targetID: target.id,
          viewportIDs: ["desktop"],
          bindings: [binding],
          includeDiff: true,
        })

        expect(result.status).toBe("failed")
        expect(result.regions).toHaveLength(1)
        const region = result.regions[0]
        expect(region.status).toBe("failed")
        expect(region.reason).toContain("Implementation crop size does not match source region")
        expect(region.coverage).toEqual({
          source_width: 320,
          source_height: 140,
          implementation_width: 260,
          implementation_height: 90,
          implementation_covers_source: false,
          implementation_matches_source_size: false,
        })
        expect(region.artifacts?.source_crop).toEndWith("source.png")
        expect(region.artifacts?.implementation_crop).toEndWith("implementation.png")
        expect(region.artifacts?.side_by_side).toEndWith("side-by-side.png")
        expect(region.artifacts?.diff).toBeUndefined()
        const evidenceID = result.evidenceIDs["desktop:default:coverage-module"]
        expect(evidenceID).toBeTruthy()
        const evidence = await Instance.provide({
          directory: tmp.path,
          fn: () => findReadableBrowserPreviewEvidenceByID({ projectRoot: tmp.path, taskID, evidenceID }),
        })
        expect(evidence?.status).toBe("failed")
        expect(evidence?.artifactPaths?.side_by_side).toBe(region.artifacts?.side_by_side)
      } finally {
        await server.close()
      }
    },
    { timeout: REGION_COMPARISON_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "keeps source bbox true-sized when source and implementation viewport widths differ",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
      await fs.mkdir(paths.sourcePackageAbsolute, { recursive: true })
      await sharp({
        create: {
          width: 1440,
          height: 600,
          channels: 4,
          background: "#ffffff",
        },
      })
        .composite([
          {
            input: Buffer.from(
              `<svg width="320" height="140" xmlns="http://www.w3.org/2000/svg">
                <rect width="320" height="140" fill="#e7f5ee"/>
                <text x="24" y="52" font-family="Arial" font-size="30" fill="#123326">Economy</text>
                <text x="24" y="92" font-family="Arial" font-size="18" fill="#315a45">Inflation and growth map</text>
              </svg>`,
            ),
            left: 40,
            top: 60,
          },
        ])
        .png()
        .toFile(path.join(paths.sourcePackageAbsolute, "reference.png"))
      const server = await startPreviewServer()
      try {
        const target = await Instance.provide({
          directory: tmp.path,
          fn: () =>
            persistTestBrowserPreviewTarget({
              taskID,
              url: server.url,
              viewports: [{ id: "desktop", labelKey: "browser_preview.viewport.desktop", width: 1280, height: 800 }],
            }),
        })
        const binding: BrowserPreviewRegionBinding = {
          region_id: "economy-wide-reference",
          viewport_id: "desktop",
          state_id: "default",
          region_scope: "page-section",
          crop_intent: "full-region",
          source: {
            reference_artifact_id: "reference.png",
            bbox: { x: 40, y: 60, width: 320, height: 140 },
            semantic_role: "economy section",
            text_anchors: ["Economy", "Inflation"],
            source_refs: ["wide source screenshot"],
          },
          implementation: {
            route: "/economy",
            locator: { kind: "data-oc-region", value: "economy" },
            component_files: ["src/Economy.tsx"],
          },
          acceptance_refs: ["economy parity"],
        }

        const result = await compareBrowserPreviewRegions({
          projectRoot: tmp.path,
          taskID,
          targetID: target.id,
          viewportIDs: ["desktop"],
          bindings: [binding],
          includeDiff: true,
        })

        expect(result.status).toBe("passed")
        const region = result.regions[0]
        expect(region.status).toBe("completed")
        expect(region.reason).toBeUndefined()
        expect(region.visual).toBeTruthy()
        expect(region.artifacts?.side_by_side).toEndWith("side-by-side.png")
        expect(region.artifacts?.diff).toEndWith("diff.png")
        expect(region.source_image_size).toEqual({ width: 1440, height: 600 })
        expect(region.implementation_viewport).toEqual({ width: 1280, height: 800 })
        expect(region.implementation_fullpage_size?.width).toBe(1280)
        expect(region.implementation_screenshot_path).toEndWith(".png")
        expect("normalized_source_bbox" in region).toBe(false)
        expect(region.coverage).toEqual({
          source_width: 320,
          source_height: 140,
          implementation_width: 320,
          implementation_height: 140,
          implementation_covers_source: true,
          implementation_matches_source_size: true,
        })
        await expectPngDimensions(resolveRuntimeRelativePath(tmp.path, region.artifacts!.source_crop), {
          width: 320,
          height: 140,
        })
        await expectPngDimensions(resolveRuntimeRelativePath(tmp.path, region.artifacts!.implementation_crop), {
          width: 320,
          height: 140,
        })
        await expectPngDimensions(resolveRuntimeRelativePath(tmp.path, region.artifacts!.side_by_side), {
          width: 656,
          height: 234,
        })
        const evidence = await Instance.provide({
          directory: tmp.path,
          fn: () =>
            findReadableBrowserPreviewEvidenceByID({
              projectRoot: tmp.path,
              taskID,
              evidenceID: result.evidenceIDs["desktop:default:economy-wide-reference"],
            }),
        })
        expect(evidence?.status).toBe("passed")
        expect(evidence?.artifactPaths?.side_by_side).toBe(region.artifacts?.side_by_side)
      } finally {
        await server.close()
      }
    },
    { timeout: REGION_COMPARISON_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "fails size-mismatched local crops without resizing the source crop",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
      await fs.mkdir(paths.sourcePackageAbsolute, { recursive: true })
      await sharp({
        create: {
          width: 1440,
          height: 600,
          channels: 4,
          background: "#ffffff",
        },
      })
        .composite([
          {
            input: Buffer.from(
              `<svg width="320" height="140" xmlns="http://www.w3.org/2000/svg">
                <rect width="320" height="140" fill="#e7f5ee"/>
              </svg>`,
            ),
            left: 40,
            top: 60,
          },
        ])
        .png()
        .toFile(path.join(paths.sourcePackageAbsolute, "reference.png"))
      const server = await startSizeMismatchedPlainPreviewServer()
      try {
        const target = await Instance.provide({
          directory: tmp.path,
          fn: () =>
            persistTestBrowserPreviewTarget({
              taskID,
              url: server.url,
              viewports: [{ id: "desktop", labelKey: "browser_preview.viewport.desktop", width: 1280, height: 800 }],
            }),
        })
        const binding: BrowserPreviewRegionBinding = {
          region_id: "economy-size-mismatch",
          viewport_id: "desktop",
          state_id: "default",
          region_scope: "page-section",
          crop_intent: "full-region",
          source: {
            reference_artifact_id: "reference.png",
            bbox: { x: 40, y: 60, width: 320, height: 140 },
            semantic_role: "plain size-mismatched source section",
            text_anchors: [],
            source_refs: ["wide source screenshot"],
          },
          implementation: {
            route: "/size-mismatch",
            locator: { kind: "data-oc-region", value: "economy-size-mismatch" },
            component_files: ["src/EconomySizeMismatch.tsx"],
          },
          acceptance_refs: ["true-size source visual parity"],
        }

        const result = await compareBrowserPreviewRegions({
          projectRoot: tmp.path,
          taskID,
          targetID: target.id,
          viewportIDs: ["desktop"],
          bindings: [binding],
          includeDiff: true,
        })

        expect(result.status).toBe("failed")
        const region = result.regions[0]
        expect(region.status).toBe("failed")
        expect(region.reason).toContain("Implementation crop size does not match source region")
        expect(region.visual?.dimensions_match).toBe(false)
        expect(region.visual?.overall_score).toBe(0)
        expect(region.artifacts?.source_crop).toEndWith("source.png")
        expect("normalized_source_crop" in region.artifacts!).toBe(false)
        expect(region.artifacts?.implementation_crop).toEndWith("implementation.png")
        expect(region.artifacts?.side_by_side).toEndWith("side-by-side.png")
        expect(region.artifacts?.diff).toBeUndefined()
        expect(region.coverage).toEqual({
          source_width: 320,
          source_height: 140,
          implementation_width: 285,
          implementation_height: 125,
          implementation_covers_source: false,
          implementation_matches_source_size: false,
        })

        await expectPngDimensions(resolveRuntimeRelativePath(tmp.path, region.artifacts!.source_crop), {
          width: 320,
          height: 140,
        })
        await expectPngDimensions(resolveRuntimeRelativePath(tmp.path, region.artifacts!.implementation_crop), {
          width: 285,
          height: 125,
        })
        await expectPngDimensions(resolveRuntimeRelativePath(tmp.path, region.artifacts!.side_by_side), {
          width: 621,
          height: 234,
        })
      } finally {
        await server.close()
      }
    },
    { timeout: REGION_COMPARISON_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "keeps multiple same-route visual region evidence independent",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
      await fs.mkdir(paths.sourcePackageAbsolute, { recursive: true })
      await sharp({
        create: {
          width: 800,
          height: 600,
          channels: 4,
          background: "#ffffff",
        },
      })
        .composite([
          {
            input: Buffer.from(
              `<svg width="280" height="110" xmlns="http://www.w3.org/2000/svg">
                <rect width="280" height="110" fill="#dcfce7"/>
                <text x="18" y="44" font-family="Arial" font-size="24" fill="#14532d">Labor Market</text>
                <text x="18" y="78" font-family="Arial" font-size="16" fill="#166534">Payroll growth</text>
              </svg>`,
            ),
            left: 40,
            top: 60,
          },
          {
            input: Buffer.from(
              `<svg width="280" height="110" xmlns="http://www.w3.org/2000/svg">
                <rect width="280" height="110" fill="#ede9fe"/>
                <text x="18" y="44" font-family="Arial" font-size="24" fill="#4c1d95">Trade Flow</text>
                <text x="18" y="78" font-family="Arial" font-size="16" fill="#5b21b6">Export balance</text>
              </svg>`,
            ),
            left: 40,
            top: 200,
          },
        ])
        .png()
        .toFile(path.join(paths.sourcePackageAbsolute, "reference.png"))
      const server = await startMultiRegionPreviewServer()
      try {
        const target = await Instance.provide({
          directory: tmp.path,
          fn: () => persistDesktopTargetAtWidth({ taskID, url: server.url, width: 800 }),
        })
        const bindings: BrowserPreviewRegionBinding[] = [
          {
            region_id: "labor-card",
            viewport_id: "desktop",
            region_scope: "card",
            crop_intent: "full-region",
            source: {
              reference_artifact_id: "reference.png",
              bbox: { x: 40, y: 60, width: 280, height: 110 },
              semantic_role: "labor market metric card",
              text_anchors: ["Labor Market", "Payroll growth"],
              source_refs: ["source screenshot labor"],
            },
            implementation: {
              route: "/dashboard",
              locator: { kind: "data-oc-region", value: "labor-card" },
              component_files: ["src/LaborCard.tsx"],
            },
            acceptance_refs: ["labor visual parity"],
          },
          {
            region_id: "trade-card",
            viewport_id: "desktop",
            region_scope: "card",
            crop_intent: "full-region",
            source: {
              reference_artifact_id: "reference.png",
              bbox: { x: 40, y: 200, width: 280, height: 110 },
              semantic_role: "trade flow metric card",
              text_anchors: ["Trade Flow", "Export balance"],
              source_refs: ["source screenshot trade"],
            },
            implementation: {
              route: "/dashboard",
              locator: { kind: "data-oc-region", value: "trade-card" },
              component_files: ["src/TradeCard.tsx"],
            },
            acceptance_refs: ["trade visual parity"],
          },
        ]

        const result = await compareBrowserPreviewRegions({
          projectRoot: tmp.path,
          taskID,
          targetID: target.id,
          viewportIDs: ["desktop"],
          bindings,
          includeDiff: true,
        })

        expect(result.status).toBe("passed")
        expect(result.regions).toHaveLength(2)
        const labor = result.regions.find((region) => region.region_id === "labor-card")
        const trade = result.regions.find((region) => region.region_id === "trade-card")
        expect(labor).toBeTruthy()
        expect(trade).toBeTruthy()
        expect(result.evidenceIDs["desktop:default:labor-card"]).toBeTruthy()
        expect(result.evidenceIDs["desktop:default:trade-card"]).toBeTruthy()
        expect(result.evidenceIDs["desktop:default:labor-card"]).not.toBe(
          result.evidenceIDs["desktop:default:trade-card"],
        )
        expect(labor!.artifacts?.source_crop).not.toBe(trade!.artifacts?.source_crop)
        expect(labor!.artifacts?.implementation_crop).not.toBe(trade!.artifacts?.implementation_crop)
        expect(labor!.artifacts?.side_by_side).not.toBe(trade!.artifacts?.side_by_side)
        expect(labor!.artifacts?.diff).not.toBe(trade!.artifacts?.diff)

        const laborSourceCrop = resolveRuntimeRelativePath(tmp.path, labor!.artifacts!.source_crop)
        const laborImplementationCrop = resolveRuntimeRelativePath(tmp.path, labor!.artifacts!.implementation_crop)
        const laborSideBySide = resolveRuntimeRelativePath(tmp.path, labor!.artifacts!.side_by_side)
        const tradeSourceCrop = resolveRuntimeRelativePath(tmp.path, trade!.artifacts!.source_crop)
        const tradeImplementationCrop = resolveRuntimeRelativePath(tmp.path, trade!.artifacts!.implementation_crop)
        const tradeSideBySide = resolveRuntimeRelativePath(tmp.path, trade!.artifacts!.side_by_side)

        await expectPngDimensions(laborSourceCrop, { width: 280, height: 110 })
        await expectPngDimensions(laborImplementationCrop, { width: 280, height: 110 })
        await expectPngDimensions(laborSideBySide, { width: 576, height: 204 })
        await expectPngContainsColor(laborSourceCrop, { red: 220, green: 252, blue: 231 })
        await expectPngContainsColor(laborImplementationCrop, { red: 220, green: 252, blue: 231 })
        await expectPngDimensions(tradeSourceCrop, { width: 280, height: 110 })
        await expectPngDimensions(tradeImplementationCrop, { width: 280, height: 110 })
        await expectPngDimensions(tradeSideBySide, { width: 576, height: 204 })
        await expectPngContainsColor(tradeSourceCrop, { red: 237, green: 233, blue: 254 })
        await expectPngContainsColor(tradeImplementationCrop, { red: 237, green: 233, blue: 254 })

        const laborEvidence = await Instance.provide({
          directory: tmp.path,
          fn: () =>
            findReadableBrowserPreviewEvidenceByID({
              projectRoot: tmp.path,
              taskID,
              evidenceID: result.evidenceIDs["desktop:default:labor-card"],
            }),
        })
        const tradeEvidence = await Instance.provide({
          directory: tmp.path,
          fn: () =>
            findReadableBrowserPreviewEvidenceByID({
              projectRoot: tmp.path,
              taskID,
              evidenceID: result.evidenceIDs["desktop:default:trade-card"],
            }),
        })
        expect(laborEvidence?.operationKind).toBe("reference-comparison")
        expect(laborEvidence?.regionID).toBe("labor-card")
        expect(laborEvidence?.stateID).toBe("default")
        expect(laborEvidence?.artifactPaths?.side_by_side).toBe(labor!.artifacts?.side_by_side)
        expect(tradeEvidence?.operationKind).toBe("reference-comparison")
        expect(tradeEvidence?.regionID).toBe("trade-card")
        expect(tradeEvidence?.stateID).toBe("default")
        expect(tradeEvidence?.artifactPaths?.side_by_side).toBe(trade!.artifacts?.side_by_side)
      } finally {
        await server.close()
      }
    },
    { timeout: REGION_COMPARISON_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "keeps the same visual region independent across interaction states",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
      await fs.mkdir(paths.sourcePackageAbsolute, { recursive: true })
      await sharp({
        create: {
          width: 800,
          height: 600,
          channels: 4,
          background: "#ffffff",
        },
      })
        .composite([
          {
            input: Buffer.from(
              `<svg width="280" height="100" xmlns="http://www.w3.org/2000/svg">
                <rect width="280" height="100" fill="#fef3c7"/>
                <text x="18" y="40" font-family="Arial" font-size="23" fill="#78350f">Summary</text>
                <text x="18" y="70" font-family="Arial" font-size="15" fill="#92400e">Compact state</text>
              </svg>`,
            ),
            left: 40,
            top: 60,
          },
          {
            input: Buffer.from(
              `<svg width="280" height="160" xmlns="http://www.w3.org/2000/svg">
                <rect width="280" height="160" fill="#cffafe"/>
                <text x="18" y="44" font-family="Arial" font-size="23" fill="#155e75">Summary</text>
                <text x="18" y="76" font-family="Arial" font-size="15" fill="#0e7490">Expanded state</text>
                <text x="18" y="116" font-family="Arial" font-size="15" fill="#0e7490">Details visible</text>
              </svg>`,
            ),
            left: 40,
            top: 210,
          },
        ])
        .png()
        .toFile(path.join(paths.sourcePackageAbsolute, "reference.png"))
      const server = await startStatefulRegionPreviewServer()
      try {
        const target = await Instance.provide({
          directory: tmp.path,
          fn: () => persistDesktopTargetAtWidth({ taskID, url: server.url, width: 800 }),
        })
        const bindings: BrowserPreviewRegionBinding[] = [
          {
            region_id: "summary-card",
            viewport_id: "desktop",
            state_id: "compact",
            region_scope: "card",
            crop_intent: "full-region",
            source: {
              reference_artifact_id: "reference.png",
              bbox: { x: 40, y: 60, width: 280, height: 100 },
              semantic_role: "summary card compact state",
              text_anchors: ["Summary", "Compact state"],
              source_refs: ["source screenshot compact"],
            },
            implementation: {
              route: "/summary?state=compact",
              locator: { kind: "data-oc-region", value: "summary-card" },
              component_files: ["src/SummaryCard.tsx"],
            },
            acceptance_refs: ["summary compact visual parity"],
          },
          {
            region_id: "summary-card",
            viewport_id: "desktop",
            state_id: "expanded",
            region_scope: "card",
            crop_intent: "full-region",
            source: {
              reference_artifact_id: "reference.png",
              bbox: { x: 40, y: 210, width: 280, height: 160 },
              semantic_role: "summary card expanded state",
              text_anchors: ["Summary", "Expanded state", "Details visible"],
              source_refs: ["source screenshot expanded"],
            },
            implementation: {
              route: "/summary?state=expanded",
              locator: { kind: "data-oc-region", value: "summary-card" },
              component_files: ["src/SummaryCard.tsx"],
            },
            acceptance_refs: ["summary expanded visual parity"],
          },
        ]

        const result = await compareBrowserPreviewRegions({
          projectRoot: tmp.path,
          taskID,
          targetID: target.id,
          viewportIDs: ["desktop"],
          bindings,
          includeDiff: true,
        })

        expect(result.status).toBe("passed")
        expect(result.regions).toHaveLength(2)
        const compact = result.regions.find(
          (region) => region.region_id === "summary-card" && region.state_id === "compact",
        )
        const expanded = result.regions.find(
          (region) => region.region_id === "summary-card" && region.state_id === "expanded",
        )
        expect(compact).toBeTruthy()
        expect(expanded).toBeTruthy()
        expect(result.evidenceIDs["desktop:compact:summary-card"]).toBeTruthy()
        expect(result.evidenceIDs["desktop:expanded:summary-card"]).toBeTruthy()
        expect(result.evidenceIDs["desktop:compact:summary-card"]).not.toBe(
          result.evidenceIDs["desktop:expanded:summary-card"],
        )
        expect(compact!.artifacts?.source_crop).not.toBe(expanded!.artifacts?.source_crop)
        expect(compact!.artifacts?.implementation_crop).not.toBe(expanded!.artifacts?.implementation_crop)
        expect(compact!.artifacts?.side_by_side).not.toBe(expanded!.artifacts?.side_by_side)

        const compactSourceCrop = resolveRuntimeRelativePath(tmp.path, compact!.artifacts!.source_crop)
        const compactImplementationCrop = resolveRuntimeRelativePath(tmp.path, compact!.artifacts!.implementation_crop)
        const compactSideBySide = resolveRuntimeRelativePath(tmp.path, compact!.artifacts!.side_by_side)
        const expandedSourceCrop = resolveRuntimeRelativePath(tmp.path, expanded!.artifacts!.source_crop)
        const expandedImplementationCrop = resolveRuntimeRelativePath(
          tmp.path,
          expanded!.artifacts!.implementation_crop,
        )
        const expandedSideBySide = resolveRuntimeRelativePath(tmp.path, expanded!.artifacts!.side_by_side)

        await expectPngDimensions(compactSourceCrop, { width: 280, height: 100 })
        await expectPngDimensions(compactImplementationCrop, { width: 280, height: 100 })
        await expectPngDimensions(compactSideBySide, { width: 576, height: 194 })
        await expectPngContainsColor(compactSourceCrop, { red: 254, green: 243, blue: 199 })
        await expectPngContainsColor(compactImplementationCrop, { red: 254, green: 243, blue: 199 })
        await expectPngDimensions(expandedSourceCrop, { width: 280, height: 160 })
        await expectPngDimensions(expandedImplementationCrop, { width: 280, height: 160 })
        await expectPngDimensions(expandedSideBySide, { width: 576, height: 254 })
        await expectPngContainsColor(expandedSourceCrop, { red: 207, green: 250, blue: 254 })
        await expectPngContainsColor(expandedImplementationCrop, { red: 207, green: 250, blue: 254 })

        const compactEvidence = await Instance.provide({
          directory: tmp.path,
          fn: () =>
            findReadableBrowserPreviewEvidenceByID({
              projectRoot: tmp.path,
              taskID,
              evidenceID: result.evidenceIDs["desktop:compact:summary-card"],
            }),
        })
        const expandedEvidence = await Instance.provide({
          directory: tmp.path,
          fn: () =>
            findReadableBrowserPreviewEvidenceByID({
              projectRoot: tmp.path,
              taskID,
              evidenceID: result.evidenceIDs["desktop:expanded:summary-card"],
            }),
        })
        expect(compactEvidence?.operationKind).toBe("reference-comparison")
        expect(compactEvidence?.regionID).toBe("summary-card")
        expect(compactEvidence?.stateID).toBe("compact")
        expect(compactEvidence?.artifactPaths?.side_by_side).toBe(compact!.artifacts?.side_by_side)
        expect(expandedEvidence?.operationKind).toBe("reference-comparison")
        expect(expandedEvidence?.regionID).toBe("summary-card")
        expect(expandedEvidence?.stateID).toBe("expanded")
        expect(expandedEvidence?.artifactPaths?.side_by_side).toBe(expanded!.artifacts?.side_by_side)
      } finally {
        await server.close()
      }
    },
    { timeout: REGION_COMPARISON_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "crops below-fold implementation regions from full-page comparison screenshots",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
      await fs.mkdir(paths.sourcePackageAbsolute, { recursive: true })
      await sharp({
        create: {
          width: 800,
          height: 1200,
          channels: 4,
          background: "#ffffff",
        },
      })
        .composite([
          {
            input: Buffer.from(
              `<svg width="320" height="140" xmlns="http://www.w3.org/2000/svg">
                <rect width="320" height="140" fill="#dbeafe"/>
                <text x="24" y="56" font-family="Arial" font-size="28" fill="#1e3a8a">Below Fold</text>
                <text x="24" y="96" font-family="Arial" font-size="18" fill="#1d4ed8">Full-page crop</text>
              </svg>`,
            ),
            left: 40,
            top: 900,
          },
        ])
        .png()
        .toFile(path.join(paths.sourcePackageAbsolute, "reference.png"))
      const server = await startBelowFoldPreviewServer()
      try {
        const target = await Instance.provide({
          directory: tmp.path,
          fn: () => persistDesktopTargetAtWidth({ taskID, url: server.url, width: 800 }),
        })
        const binding: BrowserPreviewRegionBinding = {
          region_id: "below-fold",
          viewport_id: "desktop",
          region_scope: "page-section",
          crop_intent: "full-region",
          source: {
            reference_artifact_id: "reference.png",
            bbox: { x: 40, y: 900, width: 320, height: 140 },
            semantic_role: "below fold section",
            text_anchors: ["Below Fold", "Full-page crop"],
            source_refs: ["source screenshot"],
          },
          implementation: {
            route: "/below-fold",
            locator: { kind: "data-oc-region", value: "below-fold" },
            component_files: ["src/BelowFold.tsx"],
          },
          acceptance_refs: ["below fold parity"],
        }

        const result = await compareBrowserPreviewRegions({
          projectRoot: tmp.path,
          taskID,
          targetID: target.id,
          viewportIDs: ["desktop"],
          bindings: [binding],
          includeDiff: true,
        })

        expect(result.status).toBe("passed")
        expect(result.regions).toHaveLength(1)
        const region = result.regions[0]
        expect(region.implementation_bbox?.y).toBeGreaterThan(800)
        expect(region.artifacts?.source_crop).toEndWith("source.png")
        expect(region.artifacts?.implementation_crop).toEndWith("implementation.png")
        expect(region.artifacts?.side_by_side).toEndWith("side-by-side.png")
        expect(region.artifacts?.diff).toEndWith("diff.png")
        const implementationCropPath = resolveRuntimeRelativePath(tmp.path, region.artifacts!.implementation_crop)
        const sideBySidePath = resolveRuntimeRelativePath(tmp.path, region.artifacts!.side_by_side)
        await expectPngDimensions(implementationCropPath, { width: 320, height: 140 })
        await expectPngDimensions(sideBySidePath, { width: 656, height: 234 })
        await expectPngHasColorDiversity(implementationCropPath)
        await expectPngHasColorDiversity(sideBySidePath)
      } finally {
        await server.close()
      }
    },
    { timeout: REGION_COMPARISON_TEST_TIMEOUT_MILLISECONDS },
  )

  test("rejects mobile source reference artifacts for clone region comparisons", () => {
    const parsed = BrowserPreviewRegionBinding.safeParse({
      region_id: "mobile-module",
      viewport_id: "mobile",
      region_scope: "page-section",
      crop_intent: "full-region",
      source: {
        reference_artifact_id: "reference-mobile.png",
        bbox: { x: 24, y: 36, width: 300, height: 128 },
        semantic_role: "mobile module section",
        text_anchors: ["Mobile Module", "Reference mobile"],
        source_refs: ["mobile source screenshot"],
      },
      implementation: {
        route: "/mobile",
        locator: { kind: "data-oc-region", value: "mobile-module" },
        component_files: ["src/MobileModule.tsx"],
      },
      acceptance_refs: ["mobile reference parity"],
    })

    expect(parsed.success).toBe(false)
  })

  test("delegates runtime capture to browser evidence runner instead of owning a sidecar", async () => {
    const source = await fs.readFile(
      path.resolve(import.meta.dir, "../../src/browser-preview/region-comparison.ts"),
      "utf8",
    )
    const inputType = source.match(/type BrowserPreviewRegionComparisonInput = \{[\s\S]*?\n\}/)?.[0] ?? ""

    expect(inputType).not.toContain("url:")
    expect(source).toContain('import { runBrowserPreviewRegionComparisonCapture } from "./evidence-runner"')
    expect(source).toContain("runBrowserPreviewRegionComparisonCapture({")
    expect(source).not.toContain("runBrowserNodeSidecar")
    expect(source).not.toContain("resolveBrowserNodeSidecarRuntime")
    expect(source).not.toContain("REGION_COMPARISON_SCRIPT")
    expect(source).not.toContain("runImplementationCapture")
  })
})

async function seedTask(directory: string) {
  const taskID = `tsk_regioncomparison${Date.now()}`
  await Instance.provide({
    directory,
    fn: () => {
      Database.use((db) =>
        db
          .insert(EngineTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            title: "Region comparison task",
            request: "Compare economy region",
            source: "api",
            time_created: Date.now(),
            time_updated: Date.now(),
          })
          .run(),
      )
    },
  })
  return taskID
}

async function startPreviewServer(): Promise<{ url: string; close: () => Promise<void> }> {
  let server: Server | undefined
  server = createServer((req, res) => {
    const body = `<!doctype html>
      <html>
        <head>
          <title>Economy preview</title>
          <style>
            body { margin: 0; font-family: Arial, sans-serif; background: #f8fafc; }
            main { padding: 60px 40px; }
            [data-oc-region="economy"] {
              width: 320px;
              height: 140px;
              background: #e7f5ee;
              color: #123326;
              padding: 24px;
              box-sizing: border-box;
            }
            h1 { margin: 0 0 18px; font-size: 30px; line-height: 1; }
            p { margin: 0; font-size: 18px; color: #315a45; }
          </style>
        </head>
        <body><main><section data-oc-region="economy"><h1>Economy</h1><p>Inflation and growth map</p></section></main></body>
      </html>`
    if (req.url !== "/economy") {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("not found")
      return
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(body)
  })
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("preview test server did not bind a TCP address")
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server?.close(() => resolve())
        server = undefined
      }),
  }
}

async function startSizeMismatchedPlainPreviewServer(): Promise<{ url: string; close: () => Promise<void> }> {
  let server: Server | undefined
  server = createServer((req, res) => {
    const body = `<!doctype html>
      <html>
        <head>
          <title>Size mismatch plain preview</title>
          <style>
            body { margin: 0; background: #ffffff; }
            main { padding: 53px 36px; }
            [data-oc-region="economy-size-mismatch"] {
              width: 285px;
              height: 125px;
              background: #e7f5ee;
              box-sizing: border-box;
            }
          </style>
        </head>
        <body><main><section data-oc-region="economy-size-mismatch"></section></main></body>
      </html>`
    if (req.url !== "/size-mismatch") {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("not found")
      return
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(body)
  })
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string")
    throw new Error("size mismatch plain test server did not bind a TCP address")
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server?.close(() => resolve())
        server = undefined
      }),
  }
}

async function startBelowFoldPreviewServer(): Promise<{ url: string; close: () => Promise<void> }> {
  let server: Server | undefined
  server = createServer((req, res) => {
    const body = `<!doctype html>
      <html>
        <head>
          <title>Below fold preview</title>
          <style>
            body { margin: 0; font-family: Arial, sans-serif; background: #f8fafc; }
            main { padding: 1180px 40px 120px; }
            [data-oc-region="below-fold"] {
              width: 320px;
              height: 140px;
              background: #dbeafe;
              color: #1e3a8a;
              box-sizing: border-box;
              padding: 24px;
            }
            h1 { margin: 0 0 18px; font-size: 28px; line-height: 1; }
            p { margin: 0; font-size: 18px; color: #1d4ed8; }
          </style>
        </head>
        <body><main><section data-oc-region="below-fold"><h1>Below Fold</h1><p>Full-page crop</p></section></main></body>
      </html>`
    if (req.url !== "/below-fold") {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("not found")
      return
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(body)
  })
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string")
    throw new Error("below-fold preview test server did not bind a TCP address")
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server?.close(() => resolve())
        server = undefined
      }),
  }
}

async function startVisualMismatchPreviewServer(): Promise<{ url: string; close: () => Promise<void> }> {
  let server: Server | undefined
  server = createServer((req, res) => {
    const body = `<!doctype html>
      <html>
        <head>
          <title>Mismatch preview</title>
          <style>
            body { margin: 0; font-family: Arial, sans-serif; background: #f8fafc; }
            main { padding: 60px 40px; }
            [data-oc-region="credit-pulse"] {
              width: 280px;
              height: 110px;
              background: #fecaca;
              color: #7f1d1d;
              box-sizing: border-box;
              padding: 18px;
            }
            h2 { margin: 0 0 14px; font-size: 24px; line-height: 1; }
            p { margin: 0; font-size: 16px; color: #991b1b; }
          </style>
        </head>
        <body><main><section data-oc-region="credit-pulse"><h2>Credit Pulse</h2><p>Implementation red</p></section></main></body>
      </html>`
    if (req.url !== "/mismatch") {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("not found")
      return
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(body)
  })
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string")
    throw new Error("mismatch preview test server did not bind a TCP address")
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server?.close(() => resolve())
        server = undefined
      }),
  }
}

async function startUnderCropPreviewServer(): Promise<{ url: string; close: () => Promise<void> }> {
  let server: Server | undefined
  server = createServer((req, res) => {
    const body = `<!doctype html>
      <html>
        <head>
          <title>Under crop preview</title>
          <style>
            body { margin: 0; font-family: Arial, sans-serif; background: #f8fafc; }
            main { padding: 60px 40px; }
            [data-oc-region="coverage-module"] {
              width: 260px;
              height: 90px;
              background: #e0f2fe;
              color: #075985;
              box-sizing: border-box;
              padding: 16px;
              overflow: hidden;
            }
            h2 { margin: 0 0 10px; font-size: 22px; line-height: 1; }
            p { margin: 0; font-size: 16px; color: #0369a1; }
          </style>
        </head>
        <body><main><section data-oc-region="coverage-module"><h2>Coverage Module</h2><p>Full source region</p></section></main></body>
      </html>`
    if (req.url !== "/under-crop") {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("not found")
      return
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(body)
  })
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string")
    throw new Error("under-crop preview test server did not bind a TCP address")
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server?.close(() => resolve())
        server = undefined
      }),
  }
}

async function startMultiRegionPreviewServer(): Promise<{ url: string; close: () => Promise<void> }> {
  let server: Server | undefined
  server = createServer((req, res) => {
    const body = `<!doctype html>
      <html>
        <head>
          <title>Multi region preview</title>
          <style>
            body { margin: 0; font-family: Arial, sans-serif; background: #f8fafc; }
            main { padding: 60px 40px; display: flex; flex-direction: column; gap: 30px; }
            [data-oc-region] {
              width: 280px;
              height: 110px;
              box-sizing: border-box;
              padding: 18px;
            }
            [data-oc-region="labor-card"] { background: #dcfce7; color: #14532d; }
            [data-oc-region="trade-card"] { background: #ede9fe; color: #4c1d95; }
            h2 { margin: 0 0 14px; font-size: 24px; line-height: 1; }
            p { margin: 0; font-size: 16px; }
          </style>
        </head>
        <body>
          <main>
            <section data-oc-region="labor-card"><h2>Labor Market</h2><p>Payroll growth</p></section>
            <section data-oc-region="trade-card"><h2>Trade Flow</h2><p>Export balance</p></section>
          </main>
        </body>
      </html>`
    if (req.url !== "/dashboard") {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("not found")
      return
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(body)
  })
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string")
    throw new Error("multi-region preview test server did not bind a TCP address")
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server?.close(() => resolve())
        server = undefined
      }),
  }
}

async function startStatefulRegionPreviewServer(): Promise<{ url: string; close: () => Promise<void> }> {
  let server: Server | undefined
  server = createServer((req, res) => {
    const state = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("state")
    const compact = state === "compact"
    const expanded = state === "expanded"
    if (!compact && !expanded) {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("not found")
      return
    }
    const body = `<!doctype html>
      <html>
        <head>
          <title>Stateful region preview</title>
          <style>
            body { margin: 0; font-family: Arial, sans-serif; background: #f8fafc; }
            main { padding: 60px 40px; }
            [data-oc-region="summary-card"] {
              width: 280px;
              height: ${compact ? 100 : 160}px;
              background: ${compact ? "#fef3c7" : "#cffafe"};
              color: ${compact ? "#78350f" : "#155e75"};
              box-sizing: border-box;
              padding: 18px;
            }
            h2 { margin: 0 0 12px; font-size: 23px; line-height: 1; }
            p { margin: 0 0 20px; font-size: 15px; color: ${compact ? "#92400e" : "#0e7490"}; }
          </style>
        </head>
        <body>
          <main>
            <section data-oc-region="summary-card">
              <h2>Summary</h2>
              <p>${compact ? "Compact state" : "Expanded state"}</p>
              ${expanded ? "<p>Details visible</p>" : ""}
            </section>
          </main>
        </body>
      </html>`
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(body)
  })
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string")
    throw new Error("stateful preview test server did not bind a TCP address")
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server?.close(() => resolve())
        server = undefined
      }),
  }
}

async function startMobilePreviewServer(): Promise<{ url: string; close: () => Promise<void> }> {
  let server: Server | undefined
  server = createServer((req, res) => {
    const body = `<!doctype html>
      <html>
        <head>
          <title>Mobile preview</title>
          <style>
            body { margin: 0; font-family: Arial, sans-serif; background: #fff7ed; }
            main { padding: 36px 24px; }
            [data-oc-region="mobile-module"] {
              width: 300px;
              height: 128px;
              background: #fee2e2;
              color: #7f1d1d;
              box-sizing: border-box;
              padding: 18px;
            }
            h1 { margin: 0 0 14px; font-size: 26px; line-height: 1; }
            p { margin: 0; font-size: 18px; color: #991b1b; }
          </style>
        </head>
        <body><main><section data-oc-region="mobile-module"><h1>Mobile Module</h1><p>Reference mobile</p></section></main></body>
      </html>`
    if (req.url !== "/mobile") {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("not found")
      return
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(body)
  })
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("mobile preview test server did not bind a TCP address")
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server?.close(() => resolve())
        server = undefined
      }),
  }
}

async function fileExists(input: string): Promise<boolean> {
  try {
    await fs.access(input)
    return true
  } catch {
    return false
  }
}

async function expectPngDimensions(input: string, expected: { width: number; height: number }): Promise<void> {
  const metadata = await sharp(input).metadata()
  expect(metadata.format).toBe("png")
  expect({ width: metadata.width, height: metadata.height }).toEqual(expected)
}

async function expectPngHasColorDiversity(input: string): Promise<void> {
  const stats = await sharp(input).stats()
  expect(stats.channels.some((channel) => channel.min !== channel.max)).toBe(true)
}

async function expectPngContainsColor(
  input: string,
  expected: { red: number; green: number; blue: number },
): Promise<void> {
  const { data, info } = await sharp(input).raw().toBuffer({ resolveWithObject: true })
  let matchingPixels = 0
  for (let index = 0; index < data.length; index += info.channels) {
    const red = data[index] ?? 0
    const green = data[index + 1] ?? 0
    const blue = data[index + 2] ?? 0
    if (
      Math.abs(red - expected.red) <= 3 &&
      Math.abs(green - expected.green) <= 3 &&
      Math.abs(blue - expected.blue) <= 3
    ) {
      matchingPixels += 1
    }
  }
  expect(matchingPixels).toBeGreaterThan(5_000)
}
