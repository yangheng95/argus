import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Database } from "../../src/storage/db"
import { persistBrowserPreviewEvidence, persistBrowserPreviewTarget } from "../../src/browser-preview/persist"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import {
  makeReferenceComparisonEvidenceFailedResult,
  validateBuildReferenceComparisonEvidenceReport,
} from "../../src/build/agent"
import { BuildResultSchema } from "../../src/build/types"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
})

function passedBuildResult(overrides: Record<string, unknown> = {}) {
  return {
    status: "passed" as const,
    summary: "Implemented the reference surface.",
    files_changed: [],
    tests: [{ name: "manual screenshot review", passed: true, detail: "Standalone screenshot looked acceptable." }],
    fact_check_items: [],
    ...overrides,
  }
}

async function seedReferenceComparisonEvidence(input: {
  projectDirectory: string
  taskID: string
  regionID?: string
  viewportID?: string
  operationKind?: "preview-capture" | "reference-comparison" | "source-binding"
  status?: "passed" | "failed"
}): Promise<string> {
  return Instance.provide({
    directory: input.projectDirectory,
    fn: async () => {
      Database.use((db) =>
        db
          .insert(EngineTaskTable)
          .values({
            id: input.taskID,
            project_id: Instance.project.id,
            title: "Build reference comparison report",
            request: "Verify reference parity",
            source: "test",
            time_created: Date.now(),
            time_updated: Date.now(),
          })
          .run(),
      )
      const artifactDir = ProjectRuntimePaths.taskAbsolute(
        input.projectDirectory,
        input.taskID,
        "bp",
        "build-reference-comparison",
      )
      await fs.mkdir(artifactDir, { recursive: true })
      for (const file of ["source.png", "implementation.png", "side-by-side.png"]) {
        await fs.writeFile(path.join(artifactDir, file), `png:${file}`)
      }
      const target = await persistBrowserPreviewTarget({
        taskID: input.taskID,
        url: "http://127.0.0.1:4173/",
      })
      return persistBrowserPreviewEvidence({
        projectRoot: input.projectDirectory,
        taskID: input.taskID,
        targetID: target.id,
        viewportID: input.viewportID ?? "desktop",
        operationKind: input.operationKind ?? "reference-comparison",
        regionID: input.regionID ?? "region_header",
        status: input.status ?? "passed",
        summary: input.status === "failed" ? "Evidence failed." : "Evidence passed.",
        artifactPaths: {
          source_crop: path.join(artifactDir, "source.png"),
          implementation_crop: path.join(artifactDir, "implementation.png"),
          side_by_side: path.join(artifactDir, "side-by-side.png"),
        },
        diagnostics: [],
      })
    },
  })
}

describe("Build reference-comparison terminal report validation", () => {
  test("does not require browser-preview refs for non-reference builds", async () => {
    const issue = await validateBuildReferenceComparisonEvidenceReport({
      result: passedBuildResult(),
      referenceParity: { required: false },
    })

    expect(issue).toBeUndefined()
  })

  test("rejects screenshot-only passed reports when reference parity is required", async () => {
    const issue = await validateBuildReferenceComparisonEvidenceReport({
      result: passedBuildResult(),
      referenceParity: { required: true },
      taskID: "tsk_build_reference_missing_refs",
      projectRoot: "C:\\project",
    })

    expect(issue).toContain("reference_comparison_evidence_refs")
    expect(issue).toContain("standalone screenshots")
  })

  test("rejects fake browser-preview evidence refs before treating them as proof", async () => {
    const issue = await validateBuildReferenceComparisonEvidenceReport({
      result: passedBuildResult({
        reference_comparison_evidence_refs: ["art_not_a_real_evidence_row"],
      }),
      referenceParity: { required: true },
      taskID: "tsk_build_reference_fake_ref",
      projectRoot: "C:\\project",
    })

    expect(issue).toContain("unreadable or missing browser_preview_evidence")
  })

  test.each([
    ["preview-capture" as const, "preview-capture"],
    ["source-binding" as const, "source-binding"],
  ])("rejects %s evidence refs as final reference-comparison proof", async (operationKind, expected) => {
    await using tmp = await tmpdir({ git: true })
    const taskID = `tsk_build_reference_wrong_kind_${operationKind}`
    const evidenceID = await seedReferenceComparisonEvidence({
      projectDirectory: tmp.path,
      taskID,
      operationKind,
      regionID: "region_header",
      viewportID: "desktop",
    })

    const issue = await validateBuildReferenceComparisonEvidenceReport({
      result: passedBuildResult({
        reference_comparison_evidence_refs: [`browser_preview_evidence:${evidenceID}`],
      }),
      referenceParity: { required: true, regions: ["region_header@desktop"] },
      taskID,
      projectRoot: tmp.path,
    })

    expect(issue).toContain(`is ${expected}, not reference-comparison`)
  })

  test("rejects failed reference-comparison evidence refs", async () => {
    await using tmp = await tmpdir({ git: true })
    const taskID = "tsk_build_reference_failed_ref"
    const evidenceID = await seedReferenceComparisonEvidence({
      projectDirectory: tmp.path,
      taskID,
      operationKind: "reference-comparison",
      status: "failed",
      regionID: "region_header",
      viewportID: "desktop",
    })

    const issue = await validateBuildReferenceComparisonEvidenceReport({
      result: passedBuildResult({
        reference_comparison_evidence_refs: [`browser_preview_evidence:${evidenceID}`],
      }),
      referenceParity: { required: true, regions: ["region_header@desktop"] },
      taskID,
      projectRoot: tmp.path,
    })

    expect(issue).toContain("status is failed, not passed")
  })

  test("accepts readable passed browser_preview_compare_regions evidence for required regions", async () => {
    await using tmp = await tmpdir({ git: true })
    const taskID = "tsk_build_reference_valid_refs"
    const evidenceID = await seedReferenceComparisonEvidence({
      projectDirectory: tmp.path,
      taskID,
      regionID: "region_header",
      viewportID: "desktop",
    })

    const issue = await validateBuildReferenceComparisonEvidenceReport({
      result: passedBuildResult({
        reference_comparison_evidence_refs: [`browser_preview_evidence:${evidenceID}`],
      }),
      referenceParity: { required: true, regions: ["region_header@desktop"] },
      taskID,
      projectRoot: tmp.path,
    })

    expect(issue).toBeUndefined()
  })

  test("external executor reference-evidence rejection is converted to a schema-valid failed result", () => {
    const result = makeReferenceComparisonEvidenceFailedResult({
      result: passedBuildResult({
        reference_comparison_evidence_refs: ["browser_preview_evidence:art_missing"],
      }),
      issue: "reference_comparison_evidence_refs contains unreadable or missing browser_preview_evidence: art_missing",
    })

    expect(result.status).toBe("failed")
    expect(result.error).toContain("unreadable or missing browser_preview_evidence")
    expect(BuildResultSchema.safeParse(result).success).toBe(true)
  })
})
