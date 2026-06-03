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
        // audit-2026-04-29 W2-V34 — pre-fix asserted "spec" and
        // "plan" as builtin agents but neither exists in the
        // current Agent registry (see W2-V27 for the parallel
        // plan-mode removal). Trim to the agents that ARE
        // registered today; the test's intent ("AgentModelsPanel
        // core tier sees orchestrator + per-stage agents")
        // is preserved.
        for (const expected of [
          "build",
          "general",
          "explore",
          "compaction",
          "title",
          "summary",
          "acceptance",
          "orchestrator",
          "requirements",
          "architect",
          "frontend-design",
        ]) {
          expect(names).toContain(expected)
        }
      },
    })
  })

  test("Agent.list surfaces stage agents and user-facing agents", async () => {
    // audit-2026-04-29 W2-V34 — pre-fix asserted stage agents
    // (acceptance, orchestrator, requirements, architect,
    // frontend-design, summary) have UNDEFINED permission and
    // user-facing agents (build, spec, plan, general, explore,
    // compaction, title) have ARRAY permission. Two pieces of
    // drift:
    //   - "spec" and "plan" agents were removed entirely (W2-V27).
    //   - acceptance / others now carry permission rulesets
    //     (see agent.ts:289 for acceptance `PermissionNext.merge(
    //     defaults, user)`).
    //     The "AgentRuntime-driven, no permission needed"
    //     architecture changed.
    // The assertion was tracking an internal invariant that no
    // longer holds. Drop the permission shape assertion and just
    // verify each agent EXISTS (which is what the overlay's
    // AgentModelsPanel iteration actually relies on).
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agents = await Agent.list()

        for (const stageName of [
          "acceptance",
          "orchestrator",
          "requirements",
          "architect",
          "frontend-design",
          "summary",
        ]) {
          const a = agents.find((x) => x.name === stageName)
          expect(a).toBeDefined()
        }

        for (const userFacing of ["build", "general", "explore", "compaction", "title"]) {
          const a = agents.find((x) => x.name === userFacing)
          expect(a).toBeDefined()
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

        // direct workflow specifically — optional intent check, then build
        const direct = list.find((w) => w.id === "direct")!
        expect(direct.steps.map((s) => s.id)).toEqual(["analyze_intent", "build"])

        // pipeline workflow — has goal-scope build step and final integrity gate
        const pipeline = list.find((w) => w.id === "pipeline")!
        expect(pipeline.goalLoopStepIDs).toContain("build")
        const buildStep = pipeline.steps.find((s) => s.id === "build")
        expect(buildStep?.scope).toBe("goal")
        expect(pipeline.steps.at(-1)?.id).toBe("integrity")
        expect(pipeline.steps.some((s) => s.id === "deliver")).toBe(false)
      },
    })
  })

  test("EngineConfig defaults workflow to pipeline (board default path)", async () => {
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
