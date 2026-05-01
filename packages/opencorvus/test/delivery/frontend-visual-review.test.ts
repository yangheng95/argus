import { describe, expect, test } from "bun:test"
import {
  runFrontendReview,
  runVisualRuntimeReview,
} from "../../src/delivery/specialists/frontend-visual"
import type { DeliveryRuntimeFlowResult } from "../../src/delivery/manifest"
import type { DeliverySurfaceManifest } from "../../src/delivery/surface-detector"

describe("delivery frontend and visual runtime specialist reviews", () => {
  test("frontend review is absent when frontend surface is not selected", async () => {
    const review = await runFrontendReview({
      taskID: "tsk_frontend_absent",
      runID: "run_frontend_absent",
      deliveryID: "dlv_frontend_absent",
      surfaceManifest: surfaceManifest([]),
      runtimeFlows: [],
    })

    expect(review).toBeUndefined()
  })

  test("frontend review blocks selected surfaces with no structural evidence", async () => {
    const review = await runFrontendReview({
      taskID: "tsk_frontend_missing",
      runID: "run_frontend_missing",
      deliveryID: "dlv_frontend_missing",
      surfaceManifest: surfaceManifest(["frontend"], { frontendEvidence: false }),
      runtimeFlows: [],
    })

    expect(review?.reviewer).toBe("frontend")
    expect(review?.findings[0]).toMatchObject({
      proposedSeverity: "blocking",
      category: "evidence_quality",
      claim: expect.stringContaining("without structural frontend evidence"),
    })
  })

  test("visual runtime review requires rendered browser evidence", async () => {
    const review = await runVisualRuntimeReview({
      taskID: "tsk_visual_missing",
      runID: "run_visual_missing",
      deliveryID: "dlv_visual_missing",
      surfaceManifest: surfaceManifest(["frontend", "visual_runtime"]),
      runtimeFlows: [],
    })

    expect(review?.reviewer).toBe("visual_runtime")
    expect(review?.findings[0]).toMatchObject({
      proposedSeverity: "blocking",
      category: "evidence_quality",
      claim: expect.stringContaining("no runtime flow evidence exists"),
    })
  })

  test("visual runtime review rejects passed flows without screenshot and DOM evidence", async () => {
    const review = await runVisualRuntimeReview({
      taskID: "tsk_visual_no_artifact",
      runID: "run_visual_no_artifact",
      deliveryID: "dlv_visual_no_artifact",
      surfaceManifest: surfaceManifest(["frontend", "visual_runtime"]),
      runtimeFlows: [{
        id: "runtime:web:.",
        name: "Web Runtime Render",
        status: "passed",
        evidence: ["rendered app"],
      }],
    })

    expect(review?.findings[0]).toMatchObject({
      proposedSeverity: "blocking",
      category: "evidence_quality",
      claim: expect.stringContaining("without screenshot and DOM evidence"),
    })
  })

  test("visual runtime review passes when rendered screenshot and DOM evidence exist", async () => {
    const review = await runVisualRuntimeReview({
      taskID: "tsk_visual_pass",
      runID: "run_visual_pass",
      deliveryID: "dlv_visual_pass",
      surfaceManifest: surfaceManifest(["frontend", "visual_runtime"]),
      runtimeFlows: [runtimeFlow()],
    })

    expect(review?.executionStatus).toBe("completed")
    expect(review?.findings).toEqual([])
    expect(review?.evidenceRefs).toEqual(expect.arrayContaining([
      "runtime:runtime:web:.",
      "screenshot:/tmp/rendered.png",
      "dom:runtime:web:.",
    ]))
  })
})

function surfaceManifest(
  surfaces: Array<"frontend" | "visual_runtime">,
  options: { frontendEvidence?: boolean } = {},
): DeliverySurfaceManifest {
  const includeFrontendEvidence = options.frontendEvidence ?? true
  return {
    id: "artifact_surface_frontend",
    taskId: "tsk_surface_frontend",
    deliveryId: "dlv_surface_frontend",
    projectRoot: process.cwd(),
    surfaces,
    evidence: surfaces.includes("frontend") && includeFrontendEvidence
      ? [{
          surface: "frontend",
          reason: "frontend dependency detected",
          refs: [{ kind: "dependency", ref: "react" }],
        }]
      : [],
    timeCreated: 1,
  }
}

function runtimeFlow(): DeliveryRuntimeFlowResult {
  return {
    id: "runtime:web:.",
    name: "Web Runtime Render",
    status: "passed",
    evidence: ["rendered app"],
    screenshotPath: "/tmp/rendered.png",
    dom: {
      textLength: 240,
      nodeCount: 120,
      hasBodyChildren: true,
      isEmptyRootShell: false,
    },
  }
}
