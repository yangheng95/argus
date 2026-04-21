/**
 * Overlay contract smoke test — direct invocation of the layers overlay
 * actually consumes via the HTTP API. We bypass the Hono request pipeline
 * (which needs a real server URL for plugin code) and verify the underlying
 * `Agent.list()` / `Config.get()` / config schema invariants instead.
 *
 * Specifically guards against the workflow / agent rename / permission
 * cleanup refactors silently breaking AgentModelsPanel and the config UI.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { Config } from "../../src/config/config"
import { EngineConfig } from "../../src/engine/config"
import { WorkflowRegistry } from "../../src/engine/workflow"
import { Instance } from "../../src/project/instance"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("overlay contract", () => {
  beforeEach(async () => {
    await Instance.disposeAll()
    await resetDatabase()
    Config.global.reset()
  })

  afterEach(async () => {
    Config.global.reset()
    await Instance.disposeAll()
    await resetDatabase()
  })

  test("Agent.list (GET /agent) surfaces orchestrator (not task) — overlay AgentModelsPanel core tier depends on this", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agents = await Agent.list()
        const names = agents.map((a) => a.name).sort()

        // Renamed: was "task", now "orchestrator"
        expect(names).toContain("orchestrator")
        expect(names).not.toContain("task")

        // Every agent the overlay's AgentModelsPanel iterates
        for (const expected of [
          "build",
          "spec",
          "plan",
          "general",
          "explore",
          "compaction",
          "title",
          "summary",
          "delivery",
          "orchestrator",
          "requirements",
          "architect",
          "planner",
          "design-analyst",
        ]) {
          expect(names).toContain(expected)
        }
      },
    })
  })

  test("Agent.list returns stage agents WITHOUT permission and SessionPrompt agents WITH permission", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agents = await Agent.list()

        // Stage agents (AgentRuntime-driven) — permission is now optional /
        // omitted because AgentRuntime never consults it. Overlay must not
        // crash when iterating.
        for (const stageName of [
          "delivery",
          "orchestrator",
          "requirements",
          "architect",
          "planner",
          "design-analyst",
          "summary",
        ]) {
          const a = agents.find((x) => x.name === stageName)
          expect(a).toBeDefined()
          expect(a!.permission).toBeUndefined()
        }

        // SessionPrompt-driven agents still carry permission rulesets
        for (const userFacing of ["build", "spec", "plan", "general", "explore", "compaction", "title"]) {
          const a = agents.find((x) => x.name === userFacing)
          expect(a).toBeDefined()
          expect(Array.isArray(a!.permission)).toBe(true)
        }
      },
    })
  })

  test("Workflow registry exposes only direct + pipeline (overlay reads board.workflow shape)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const list = await WorkflowRegistry.list()
        const ids = list.map((w) => w.id).sort()
        expect(ids).toEqual(["direct", "pipeline"])

        const defaultID = await WorkflowRegistry.defaultID()
        expect(defaultID).toBe("pipeline")

        // Each workflow must shape-match what overlay's WorkflowProgressBar expects
        for (const wf of list) {
          expect(typeof wf.id).toBe("string")
          expect(typeof wf.name).toBe("string")
          expect(Array.isArray(wf.steps)).toBe(true)
          expect(Array.isArray(wf.goalLoopStepIDs)).toBe(true)
          for (const step of wf.steps) {
            expect(typeof step.id).toBe("string")
            expect(typeof step.label).toBe("string")
            expect(typeof step.tool).toBe("string")
            expect(["task", "goal"]).toContain(step.scope)
          }
        }

        // direct workflow specifically — build → deliver
        const direct = list.find((w) => w.id === "direct")!
        expect(direct.steps.map((s) => s.id)).toEqual(["build", "deliver"])

        // pipeline workflow — has goal-scope build step
        const pipeline = list.find((w) => w.id === "pipeline")!
        expect(pipeline.goalLoopStepIDs).toContain("build")
        const buildStep = pipeline.steps.find((s) => s.id === "build")
        expect(buildStep?.scope).toBe("goal")
      },
    })
  })

  test("EngineConfig defaults workflow to pipeline (board fallback path)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ec = await EngineConfig.get()
        expect(ec.default_workflow).toBe("pipeline")
      },
    })
  })
})
