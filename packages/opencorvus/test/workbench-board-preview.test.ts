import { describe, expect, test } from "bun:test"

describe("workbench board delivery preview projection", () => {
  test("board delivery exposes previewUrl from the delivery evidence manifest", async () => {
    const source = await Bun.file(new URL("../src/workbench/board.ts", import.meta.url)).text()

    expect(source).toContain("const previewUrl = firstDeliveryPreviewUrl(manifest)")
    expect(source).toContain("latestDeliveryPreviewSession(row.id)")
    expect(source).toContain('eq(EngineArtifactTable.kind, "delivery_preview")')
    expect(source).toContain("previewSession,")
    expect(source).toContain("previewUrl,")
    expect(source).toContain("manifest?.runtimeFlows.find")
  })
})
