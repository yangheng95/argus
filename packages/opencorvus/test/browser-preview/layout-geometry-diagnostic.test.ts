import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import {
  BrowserPreviewLayoutGeometryDiagnosticRequest,
  computeSourceDelta,
  diagnoseBrowserPreviewLayoutGeometry,
  summarizeWidthBehavior,
  type BrowserPreviewLayoutGeometrySample,
} from "../../src/browser-preview/layout-geometry-diagnostic"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import {
  findReadableBrowserPreviewEvidenceByID,
  latestBrowserPreviewEvidenceIDs,
  persistBrowserPreviewEvidence,
} from "../../src/browser-preview/persist"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
  await Instance.disposeAll()
})

describe("browser preview layout geometry diagnostic", () => {
  test("request schema rejects raw URL inputs", () => {
    const parsed = BrowserPreviewLayoutGeometryDiagnosticRequest.safeParse({
      targetID: "art_previewtarget",
      viewportID: "desktop",
      route: "/",
      url: "http://127.0.0.1:5173/",
      regions: [
        {
          regionID: "hero",
          locator: { kind: "data-oc-region", value: "hero" },
        },
      ],
    })

    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error("raw URL unexpectedly parsed")
    expect(JSON.stringify(parsed.error.issues)).toContain("url")
  })

  test("computes source deltas and explicit desktop width behavior", () => {
    expect(
      computeSourceDelta(
        { x: 20, y: 30, width: 200, height: 100 },
        { x: 32, y: 24, width: 240, height: 90 },
      ),
    ).toEqual({
      sizeDelta: { width: 40, height: -10 },
      edgeDelta: { left: 12, right: 52, top: -6, bottom: -16 },
      scale: { x: 1.2, y: 0.9, uniformDelta: 0.3 },
      centerDelta: { x: 32, y: -11 },
    })

    const samples: BrowserPreviewLayoutGeometrySample[] = [
      sample("desktop", true, 1440, 64, 200, 1176),
      sample("desktop-wide", false, 1680, 80, 280, 1320),
    ]

    expect(summarizeWidthBehavior(samples)).toEqual([
      {
        regionID: "hero",
        fromSampleID: "desktop",
        toSampleID: "desktop-wide",
        viewportWidthDelta: 240,
        borderBoxWidthDelta: 80,
        viewportWidthRatio: 1.167,
        borderBoxWidthRatio: 1.4,
        leftEdgeDelta: 16,
        rightEdgeDelta: 144,
      },
    ])
  })

  test("persists layout-geometry evidence without becoming latest preview-capture evidence", async () => {
    await using tmp = await tmpdir()
    const taskID = "tsk_layout_geometry"
    const targetID = "art_preview_target"
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        seedTask(taskID)
        const captureID = "art_preview_capture"
        const captureDir = ProjectRuntimePaths.browserPreviewJobRoot(tmp.path, taskID, captureID)
        await fs.mkdir(captureDir, { recursive: true })
        const screenshotPath = path.join(captureDir, "desktop.png")
        await fs.writeFile(screenshotPath, "preview-capture")
        const previewEvidenceID = persistBrowserPreviewEvidence({
          projectRoot: tmp.path,
          taskID,
          targetID,
          viewportID: "desktop",
          operationKind: "preview-capture",
          manifestPath: path.join(captureDir, "manifest.json"),
          artifactPaths: { screenshot: screenshotPath },
          status: "passed",
          summary: "preview capture",
          capture: { path: screenshotPath },
          diagnostics: [],
          now: 10,
        })

        const result = await diagnoseBrowserPreviewLayoutGeometry({
          projectRoot: tmp.path,
          taskID,
          targetID,
          viewportID: "desktop",
          route: "/",
          regions: [{ regionID: "hero", locator: { kind: "data-oc-region", value: "hero" } }],
          widthSamples: [],
          captureForTest: async () => ({
            diagnostics: [],
            samples: [sample("desktop", true, 1440, 64, 200, 1176)],
          }),
        })

        const geometryEvidence = await findReadableBrowserPreviewEvidenceByID({
          projectRoot: tmp.path,
          taskID,
          evidenceID: result.evidenceID,
        })
        expect(geometryEvidence?.operationKind).toBe("layout-geometry")
        expect(geometryEvidence?.artifactPaths?.manifest).toBe(
          ProjectRuntimePaths.browserPreviewJobRelative(taskID, result.jobID, "layout-geometry.json").replaceAll(
            "\\",
            "/",
          ),
        )

        const latest = await latestBrowserPreviewEvidenceIDs({
          projectRoot: tmp.path,
          taskID,
          targetID,
        })
        expect(latest.desktop).toBe(previewEvidenceID)
      },
    })
  })
})

function seedTask(taskID: string): void {
  Database.use((db) =>
    db
      .insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: Instance.project.id,
        title: "Layout geometry task",
        request: "Layout geometry task",
        source: "api",
        time_created: Date.now(),
        time_updated: Date.now(),
      })
      .run(),
  )
}

function sample(
  sampleID: string,
  primary: boolean,
  viewportWidth: number,
  boxX: number,
  boxWidth: number,
  viewportRight: number,
): BrowserPreviewLayoutGeometrySample {
  return {
    sampleID,
    primary,
    viewport: { width: viewportWidth, height: 800 },
    page: {
      url: "http://127.0.0.1:5173/",
      title: "Preview",
      viewport: { width: viewportWidth, height: 800 },
      scroll: { x: 0, y: 0 },
      root: {
        clientWidth: viewportWidth,
        scrollWidth: viewportWidth,
        offsetWidth: viewportWidth,
        clientHeight: 800,
        scrollHeight: 800,
        offsetHeight: 800,
      },
      body: {
        clientWidth: viewportWidth,
        scrollWidth: viewportWidth,
        offsetWidth: viewportWidth,
        clientHeight: 800,
        scrollHeight: 800,
        offsetHeight: 800,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
      },
      overflow: { horizontal: false, vertical: false, overflowX: 0, overflowY: 0 },
    },
    regions: [
      {
        regionID: "hero",
        status: "captured",
        locator: { kind: "data-oc-region", value: "hero" },
        sourceRefs: [],
        borderBox: { x: boxX, y: 32, width: boxWidth, height: 100 },
        edgeOffsets: {
          viewportLeft: boxX,
          viewportRight,
          viewportTop: 32,
          viewportBottom: 668,
          pageLeft: boxX,
          pageRight: viewportRight,
          pageTop: 32,
          pageBottom: 668,
        },
      },
    ],
  }
}
