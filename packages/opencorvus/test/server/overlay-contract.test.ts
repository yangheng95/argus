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
import { TaskBoardGoalWorkflow } from "../../src/engine/model"
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

        for (const expected of [
          "build",
          "general",
          "explore",
          "compaction",
          "title",
          "summary",
          "orchestrator",
          "requirements",
          "architect",
          "frontend-design",
          "visual-qa",
          "integrity",
        ]) {
          expect(names).toContain(expected)
        }
      },
    })
  })

  test("Agent.list surfaces stage agents and user-facing agents", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agents = await Agent.list()

        for (const stageName of [
          "orchestrator",
          "requirements",
          "architect",
          "frontend-design",
          "visual-qa",
          "integrity",
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

        // pipeline workflow — has goal-scope build, integrity review, then optional fact-check.
        const pipeline = list.find((w) => w.id === "pipeline")!
        expect(pipeline.goalLoopStepIDs).toContain("build")
        const buildStep = pipeline.steps.find((s) => s.id === "build")
        expect(buildStep?.scope).toBe("goal")
        expect(pipeline.steps.slice(-2).map((s) => s.id)).toEqual(["integrity", "fact_check"])
        expect(pipeline.steps.some((s) => s.id === "deliver")).toBe(false)
      },
    })
  })

  test("EngineConfig defaults workflow to pipeline (board default path)", async () => {
    expect(EngineConfig.getDefaults().default_workflow).toBe("pipeline")
  })

  test("TaskBoardGoalWorkflow schema includes overlay-consumed goal run and acceptance fields", () => {
    const workflow = TaskBoardGoalWorkflow.parse({
      goalID: "goal_schema_contract",
      goalRunID: "goal_run_schema_contract",
      orderKey: "v1:0000000000001000:0000000000000060:0000000000000000:board_goal:goal_schema_contract",
      goalTitle: "Schema contract goal",
      goalStatus: "pending",
      orderIndex: 0,
      retryCount: 0,
      priority: "blocking",
      steps: [
        {
          stepID: "build",
          orderKey: "v1:0000000000001001:0000000000000061:0000000000000000:board_step:goal_schema_contract-build",
          label: "Build",
          status: "pending",
        },
      ],
      acceptanceSpecs: [
        {
          id: "acc_schema_contract",
          source_requirement_id: "REQ-1",
          goal_id: "goal_schema_contract",
          title: "Schema exposes acceptance specs",
          scorers: [
            {
              type: "llm_judge",
              name: "contract",
              criteria: "Verify that overlay-visible acceptance specs remain available on the task board.",
            },
          ],
          severity: "essential",
        },
      ],
    })

    expect(workflow.goalRunID).toBe("goal_run_schema_contract")
    expect(workflow.acceptanceSpecs?.[0]?.id).toBe("acc_schema_contract")
  })
})
