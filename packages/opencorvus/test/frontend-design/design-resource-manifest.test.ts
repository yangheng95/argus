import { beforeEach, expect, test } from "bun:test"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import {
  createDesignResourceManifest,
  designResourceManifestFileRefs,
  frontendDesignMaterialMime,
  recordDesignResourceManifest,
} from "../../src/frontend-design/design-resource-manifest"
import { ProjectTable } from "../../src/project/project.sql"
import { Database, eq } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"

beforeEach(async () => {
  await resetDatabase()
})

test("frontend design material MIME classification supports HTML and rejects unknown design blobs", () => {
  expect(frontendDesignMaterialMime("product-page.html")).toBe("text/html")
  expect(frontendDesignMaterialMime("tokens.json")).toBe("application/json")
  expect(frontendDesignMaterialMime("style-guide.css")).toBe("text/css")
  expect(() => frontendDesignMaterialMime("wireframe.sketch")).toThrow(
    "unsupported frontend_design material extension '.sketch'",
  )
})

test("design resource manifest indexes Figma, HTML, and webpage evidence through one artifact payload", () => {
  const taskID = "tsk_design_resource_manifest"
  const now = 1000
  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: "project_design_resource_manifest",
        worktree: process.cwd(),
        name: "design resource manifest",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: "project_design_resource_manifest",
        source: "test",
        title: "design resource manifest",
        request: "index design resources",
        priority: "normal",
        time_created: now,
        time_updated: now,
      })
      .run()
  })

  const manifest = createDesignResourceManifest({
    taskID,
    now,
    webpageEvidenceArtifacts: ["webpage-evidence/sourceProjectManifest.json"],
    resources: [
      {
        sha: "a".repeat(64),
        url: "attachment://figma-frame.png",
        mime: "image/png",
        size: 12,
        filename: "figma-frame.png",
        intent: "visual_reference",
        source: "figma-mcp",
      },
      {
        sha: "b".repeat(64),
        url: "attachment://figma-variable-defs.md",
        mime: "text/markdown",
        size: 120,
        filename: "figma-variable-defs.md",
        intent: "design_reference",
        source: "figma-mcp",
      },
      {
        sha: "c".repeat(64),
        url: "attachment://reference.html",
        mime: "text/html",
        size: 240,
        filename: "reference.html",
        intent: "visual_reference",
        source: "material",
      },
      {
        sha: "d".repeat(64),
        url: "attachment://operator-reference.png",
        mime: "image/png",
        size: 32,
        filename: "operator-reference.png",
        intent: "visual_reference",
        source: "user",
      },
    ],
  })

  expect(manifest.entries.map((entry) => entry.kind)).toEqual(["figma_screenshot", "figma_variables", "html", "image"])
  expect(manifest.entries[0]?.origin).toBe("figma_mcp")
  expect(manifest.entries[1]?.intent).toBe("design_tokens")
  expect(manifest.entries[2]?.origin).toBe("material")
  expect(manifest.entries[2]?.size).toBe(240)
  expect(manifest.entries[3]?.origin).toBe("attachment")
  expect(manifest.entries.every((entry) => entry.artifact_paths.includes("webpage-evidence/sourceProjectManifest.json")))
    .toBe(true)
  expect(designResourceManifestFileRefs(manifest).map((entry) => entry.source)).toEqual([
    "figma-mcp",
    "figma-mcp",
    "material",
    "design-resource-manifest",
  ])
  expect(designResourceManifestFileRefs(manifest)[2]).toMatchObject({
    url: "attachment://reference.html",
    mime: "text/html",
    size: 240,
    filename: "reference.html",
    intent: "visual_reference",
  })

  const artifactID = recordDesignResourceManifest({ taskID, manifest, now: 1001 })
  const row = Database.use((db) =>
    db.select().from(EngineArtifactTable).where(eq(EngineArtifactTable.id, artifactID)).get(),
  )
  expect(row?.kind).toBe("design_resource_manifest")
  expect((row?.payload as any).entries).toHaveLength(4)
})

test("design resource manifest rejects unsupported resource MIME instead of indexing it loosely", () => {
  expect(() =>
    createDesignResourceManifest({
      taskID: "tsk_bad_design_resource",
      resources: [
        {
          sha: "d".repeat(64),
          url: "attachment://unknown.bin",
          mime: "application/octet-stream",
          size: 20,
          filename: "unknown.bin",
          intent: "visual_reference",
          source: "material",
        },
      ],
    }),
  ).toThrow("unsupported design resource mime 'application/octet-stream'")
})

test("design resource manifest rejects unsupported explicit intents instead of remapping them", () => {
  expect(() =>
    createDesignResourceManifest({
      taskID: "tsk_bad_design_intent",
      resources: [
        {
          sha: "e".repeat(64),
          url: "attachment://reference.html",
          mime: "text/html",
          size: 20,
          filename: "reference.html",
          intent: "loose_reference",
          source: "material",
        },
      ],
    }),
  ).toThrow("unsupported design resource intent 'loose_reference'")
})

test("design resource manifest rejects unsupported resource sources instead of treating them as attachments", () => {
  expect(() =>
    createDesignResourceManifest({
      taskID: "tsk_bad_design_source",
      resources: [
        {
          sha: "f".repeat(64),
          url: "attachment://reference.html",
          mime: "text/html",
          size: 20,
          filename: "reference.html",
          intent: "visual_reference",
          source: "loose-source",
        },
      ],
    }),
  ).toThrow("unsupported design resource source 'loose-source'")
})
