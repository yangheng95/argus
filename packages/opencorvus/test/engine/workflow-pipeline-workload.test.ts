import { describe, expect, test } from "bun:test"
import { WorkflowRegistry } from "../../src/engine/workflow"

describe("pipeline workflow wires the workload_analysis step", () => {
  const pipeline = WorkflowRegistry.builtIn.pipeline

  test("workload_analysis is a task-scoped, skippable step that runs after architect", () => {
    const wl = pipeline.steps.find((s) => s.id === "workload_analysis")
    expect(wl).toBeDefined()
    expect(wl!.tool).toBe("workload_analysis")
    expect(wl!.scope).toBe("task")
    expect(wl!.skippable).toBe(true)
    expect(wl!.after).toContain("architect")
  })

  test("ordering is architect -> workload_analysis -> build", () => {
    const ids = pipeline.steps.map((s) => s.id)
    expect(ids.indexOf("architect")).toBeLessThan(ids.indexOf("workload_analysis"))
    expect(ids.indexOf("workload_analysis")).toBeLessThan(ids.indexOf("build"))
  })

  test("build advisory-depends on workload_analysis", () => {
    const build = pipeline.steps.find((s) => s.id === "build")
    expect(build).toBeDefined()
    expect(build!.after).toContain("workload_analysis")
  })
})
