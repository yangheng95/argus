import { describe, expect, test } from "bun:test"
import { shouldPersistExecutorEvent, shouldPublishExecutorProgress } from "../../src/orchestrator/runtime"

describe("orchestrator executor event filtering", () => {
  test("drops high-volume noise from persistence", () => {
    expect(shouldPersistExecutorEvent("message.part.delta")).toBe(false)
    expect(shouldPersistExecutorEvent("protocol.raw")).toBe(false)
    expect(shouldPersistExecutorEvent("usage.updated")).toBe(false)
    expect(shouldPersistExecutorEvent("executor.status")).toBe(false)

    expect(shouldPersistExecutorEvent("tool.call")).toBe(true)
    expect(shouldPersistExecutorEvent("tool.result")).toBe(true)
    expect(shouldPersistExecutorEvent("approval.request")).toBe(true)
    expect(shouldPersistExecutorEvent("session.error")).toBe(true)
    expect(shouldPersistExecutorEvent("session.idle")).toBe(true)
  })

  test("suppresses noisy progress events while keeping meaningful progress", () => {
    expect(shouldPublishExecutorProgress("protocol.raw")).toBe(false)
    expect(shouldPublishExecutorProgress("usage.updated")).toBe(false)
    expect(shouldPublishExecutorProgress("executor.status")).toBe(false)

    expect(shouldPublishExecutorProgress("tool.call")).toBe(true)
    expect(shouldPublishExecutorProgress("tool.result")).toBe(true)
    expect(shouldPublishExecutorProgress("plan.delta")).toBe(true)
    expect(shouldPublishExecutorProgress("session.error")).toBe(true)
  })
})
