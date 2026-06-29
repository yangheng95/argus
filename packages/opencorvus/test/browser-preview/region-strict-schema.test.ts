import { describe, expect, test } from "bun:test"
import {
  BrowserPreviewRegionComparisonRequest,
  type BrowserPreviewRegionBinding,
} from "../../src/browser-preview/region-comparison"

describe("browser preview region strict schemas", () => {
  test("comparison request rejects direct target URL and output directory fields", () => {
    const binding = regionBinding()

    expectParseIssue(
      BrowserPreviewRegionComparisonRequest.safeParse({
        targetID: "art_previewtarget_1",
        viewportIDs: ["desktop"],
        inlineBindings: [binding],
        url: "http://127.0.0.1:5173/",
      }),
      "url",
    )
    expectParseIssue(
      BrowserPreviewRegionComparisonRequest.safeParse({
        targetID: "art_previewtarget_1",
        viewportIDs: ["desktop"],
        inlineBindings: [
          {
            ...binding,
            source: { ...binding.source, outDir: ".opencorvus/other" },
          },
        ],
      }),
      "outDir",
    )
    expectParseIssue(
      BrowserPreviewRegionComparisonRequest.safeParse({
        targetID: "art_previewtarget_1",
        viewportIDs: ["desktop"],
        inlineBindings: [
          {
            ...binding,
            implementation: { ...binding.implementation, url: "http://127.0.0.1:5173/" },
          },
        ],
      }),
      "url",
    )
    expectParseIssue(
      BrowserPreviewRegionComparisonRequest.safeParse({
        targetID: "art_previewtarget_1",
        viewportIDs: ["desktop"],
        inlineBindings: [binding],
        output: { include_side_by_side: true, outDir: ".opencorvus/other" },
      }),
      "outDir",
    )
  })

})

function regionBinding(): BrowserPreviewRegionBinding {
  return {
    region_id: "economy",
    viewport_id: "desktop",
    state_id: "default",
    region_scope: "page-section",
    crop_intent: "full-region",
    source: {
      reference_artifact_id: "reference.png",
      bbox: { x: 0, y: 0, width: 100, height: 80 },
      semantic_role: "economy section",
      text_anchors: [],
      source_refs: [],
    },
    implementation: {
      route: "/",
      locator: { kind: "data-oc-region", value: "economy" },
      component_files: [],
    },
    acceptance_refs: [],
  }
}

function expectParseIssue(result: { success: boolean; error?: { issues: unknown[] } }, key: string): void {
  expect(result.success).toBe(false)
  expect(JSON.stringify(result.error?.issues)).toContain(key)
}
