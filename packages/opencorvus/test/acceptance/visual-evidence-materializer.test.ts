import { createServer, type Server } from "node:http"
import fs from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"
import { afterEach, describe, expect, test } from "bun:test"
import { materializeVisualEvidenceBundleFromEvidenceRefs } from "../../src/acceptance/visual-evidence-materializer"
import { readLatestTaskVisualEvidenceBundleSync, validateVisualEvidenceBundleReferenceComparisons } from "../../src/acceptance/visual-evidence"
import { persistBrowserPreviewEvidence } from "../../src/browser-preview/persist"
import { BrowserPreviewRegionBinding } from "../../src/browser-preview/region-comparison"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { persistTestBrowserPreviewTarget } from "../fixture/browser-preview"

const TEST_TIMEOUT = 90_000

describe("visual evidence bundle materializer", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test(
    "materializes a canonical bundle from task-scoped source-binding evidence",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      await writeReferenceImage(tmp.path, taskID)
      const preview = await startMatchingPreviewServer()
      try {
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const target = await persistTestBrowserPreviewTarget({
              taskID,
              url: preview.url,
              viewports: [
                {
                  id: "desktop",
                  labelKey: "browser_preview.viewport.desktop",
                  width: 800,
                  height: 600,
                },
              ],
            })
            const binding: BrowserPreviewRegionBinding = {
              region_id: "economy-page",
              viewport_id: "desktop",
              state_id: "default",
              region_scope: "page-section",
              crop_intent: "full-region",
              source: {
                reference_artifact_id: "web-clone-source/reference.png",
                bbox: { x: 0, y: 0, width: 800, height: 600 },
                semantic_role: "economy page",
                text_anchors: ["economy"],
                source_refs: ["web-clone-source/reference.png"],
              },
              implementation: {
                route: "/economy",
                locator: { kind: "data-oc-region", value: "economy-page" },
                component_files: ["src/EconomyPanel.tsx"],
              },
              acceptance_refs: ["REQ-visual"],
            }
            const sourceBindingEvidenceID = await seedSourceBindingEvidence({
              projectRoot: tmp.path,
              taskID,
              targetID: target.id,
              binding,
            })

            const result = await materializeVisualEvidenceBundleFromEvidenceRefs({
              projectRoot: tmp.path,
              taskID,
              source: "integrity",
              evidenceRefs: [`browser_preview_evidence:${sourceBindingEvidenceID}`],
              inspectedAt: "2026-07-01T00:00:00.000Z",
            })

            if (result.status !== "materialized") throw new Error(result.issues.join("\n"))
            expect(result.status).toBe("materialized")
            expect(result.referenceComparisonEvidenceRefs).toHaveLength(1)
            expect(result.sourceBindingEvidenceRefs).toEqual([`browser_preview_evidence:${sourceBindingEvidenceID}`])
            expect(result.bundle.regions).toHaveLength(1)
            expect(result.bundle.regions[0]?.id).toBe("economy-page")
            expect(result.bundle.regions[0]?.evidenceRefs[0]).toBe(result.referenceComparisonEvidenceRefs[0])
            expect(await exists(result.bundlePath)).toBe(true)

            const latest = readLatestTaskVisualEvidenceBundleSync({ projectDir: tmp.path, taskID })
            expect(latest?.[0]?.id).toBe(result.bundle.id)
            const validation = await validateVisualEvidenceBundleReferenceComparisons({
              projectRoot: tmp.path,
              bundle: result.bundle,
              expectedTaskID: taskID,
            })
            expect(validation).toEqual({ passing: true, issues: [] })
          },
        })
      } finally {
        await preview.close()
      }
    },
    { timeout: TEST_TIMEOUT },
  )

  test("reports not_ready instead of fabricating a bundle when no browser evidence refs exist", async () => {
    await using tmp = await tmpdir({ git: true })
    const taskID = await seedTask(tmp.path)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await materializeVisualEvidenceBundleFromEvidenceRefs({
          projectRoot: tmp.path,
          taskID,
          source: "integrity",
          evidenceRefs: [],
          inspectedAt: "2026-07-01T00:00:00.000Z",
        })
        expect(result.status).toBe("not_ready")
        expect(result.issues.join("\n")).toContain("no browser_preview evidence refs")
        expect(readLatestTaskVisualEvidenceBundleSync({ projectDir: tmp.path, taskID })).toBeUndefined()
      },
    })
  })
})

async function seedTask(projectRoot: string): Promise<string> {
  const taskID = `tsk_visualbundle_${Date.now().toString(16)}`
  await Instance.provide({
    directory: projectRoot,
    fn: () => {
      Database.use((db) =>
        db
          .insert(EngineTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            title: "Visual bundle materializer task",
            request: "Clone a reference page with final visual evidence.",
            source: "test",
            time_created: Date.now(),
            time_updated: Date.now(),
          })
          .run(),
      )
    },
  })
  return taskID
}

async function writeReferenceImage(projectRoot: string, taskID: string): Promise<void> {
  const paths = ProjectRuntimePaths.frontendDesignPaths(projectRoot, taskID)
  await fs.mkdir(paths.sourcePackageAbsolute, { recursive: true })
  await sharp({
    create: {
      width: 800,
      height: 600,
      channels: 4,
      background: "#e7f5ee",
    },
  })
    .png()
    .toFile(path.join(paths.sourcePackageAbsolute, "reference.png"))
}

async function seedSourceBindingEvidence(input: {
  projectRoot: string
  taskID: string
  targetID: string
  binding: BrowserPreviewRegionBinding
}): Promise<string> {
  const jobID = "art_seed_source_binding"
  const outDir = ProjectRuntimePaths.browserPreviewJobRoot(input.projectRoot, input.taskID, jobID)
  const artifactDir = path.join(outDir, "source-binding")
  await fs.mkdir(artifactDir, { recursive: true })
  const sourceCrop = path.join(artifactDir, "source.png")
  const implementationCrop = path.join(artifactDir, "implementation.png")
  const sideBySide = path.join(artifactDir, "side-by-side.png")
  for (const filePath of [sourceCrop, implementationCrop, sideBySide]) {
    await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 4,
        background: "#e7f5ee",
      },
    })
      .png()
      .toFile(filePath)
  }
  return persistBrowserPreviewEvidence({
    projectRoot: input.projectRoot,
    taskID: input.taskID,
    targetID: input.targetID,
    viewportID: "desktop",
    operationKind: "source-binding",
    regionID: input.binding.region_id,
    stateID: input.binding.state_id,
    manifestPath: path.join(outDir, "source-binding.json"),
    artifactPaths: {
      source_crop: sourceCrop,
      implementation_crop: implementationCrop,
      side_by_side: sideBySide,
    },
    status: "passed",
    summary: "seeded source-binding evidence",
    capture: {
      status: "passed",
      binding: input.binding,
    },
    diagnostics: ["seeded source-binding evidence"],
  })
}

async function startMatchingPreviewServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    if (req.url !== "/economy") {
      res.writeHead(404)
      res.end("not found")
      return
    }
    res.writeHead(200, { "content-type": "text/html" })
    res.end(`<!doctype html>
      <html>
        <head>
          <style>
            html, body { margin: 0; width: 800px; height: 600px; background: #e7f5ee; }
            [data-oc-region="economy-page"] {
              position: absolute;
              left: 0;
              top: 0;
              width: 800px;
              height: 600px;
              background: #e7f5ee;
            }
          </style>
        </head>
        <body>
          <section data-oc-region="economy-page"></section>
        </body>
      </html>`)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Preview server did not bind a port")
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
