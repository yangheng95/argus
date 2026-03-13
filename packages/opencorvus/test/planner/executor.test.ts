import { afterEach, beforeEach, expect, test } from "bun:test"
import { ExecutorRegistry } from "../../src/executor/registry"
import { ExecutorPlanner } from "../../src/planner/executor"

beforeEach(() => {
  delete process.env.OPENCORVUS_SPEC_TIMEOUT_MS
  delete process.env.OPENCORVUS_PLANNER_TIMEOUT_MS
})

afterEach(() => {
  ExecutorRegistry.reset()
  delete process.env.OPENCORVUS_SPEC_TIMEOUT_MS
  delete process.env.OPENCORVUS_PLANNER_TIMEOUT_MS
})

function register() {
  ExecutorRegistry.register("codex", {
    capabilities() {
      return {
        submit: true,
        status: true,
        abort: true,
        delivery: true,
        resume: true,
        events: true,
      }
    },
    planningCapabilities() {
      return {
        spec: true,
        plan: true,
      }
    },
    async generatePlanning() {
      return await new Promise<never>(() => {})
    },
    async submit() {
      throw new Error("not used")
    },
    async status() {
      throw new Error("not used")
    },
    async abort() {
      return true
    },
    async delivery() {
      throw new Error("not used")
    },
    async resume() {
      throw new Error("not used")
    },
    async *events() {},
  })
}

test("executor-native spec generation times out", async () => {
  process.env.OPENCORVUS_SPEC_TIMEOUT_MS = "20"
  register()

  await expect(
    ExecutorPlanner.spec({
      executor: "codex",
      title: "Spec timeout",
      request: "Implement the feature.",
    }),
  ).rejects.toThrow("spec executor-native planning timed out after 20ms")
})

test("executor-native plan generation times out", async () => {
  process.env.OPENCORVUS_PLANNER_TIMEOUT_MS = "20"
  register()

  await expect(
    ExecutorPlanner.plan({
      executor: "codex",
      title: "Plan timeout",
      request: "Implement the feature.",
      spec: {
        summary: "Spec",
        content: "# Scope\n\nBuild the feature",
        goals: [],
        assumptions: [],
        risks: [],
        clarifications: [],
      },
    }),
  ).rejects.toThrow("plan executor-native planning timed out after 20ms")
})
