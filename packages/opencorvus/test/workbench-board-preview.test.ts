import { describe, expect, test } from "bun:test"
import { Event } from "../src/engine/model"

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

  test("delivery preview writer emits a board-invalidating event", async () => {
    const source = await Bun.file(new URL("../src/delivery/tools.ts", import.meta.url)).text()
    const parsed = Event.DeliveryPreviewUpdated.properties.safeParse({
      taskID: "tsk_preview",
      deliveryID: "dlv_preview",
      status: "ready",
      url: "http://127.0.0.1:5282/",
      command: "pnpm run dev -- --host 127.0.0.1",
      workspaceDir: "C:\\work\\app",
    })

    expect(Event.DeliveryPreviewUpdated.type).toBe("delivery.preview.updated")
    expect(parsed.success).toBe(true)
    expect(source).toContain("EngineEvent.DeliveryPreviewUpdated")
    expect(source).toContain('{ source: "delivery.preview" }')
  })
})
