import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createDecisionLog } from "../../src/decision-log"
import { TaskContext } from "../../src/task-context"
import { Database } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

/**
 * Regression for scheduler fix regression contract P4 (commit
 * e87333dbb) + audit §11.3 / L3 + L7. Bench tsk_dde13a67c001sbz6y2Qe0at8Fc:
 *   line 1082  intent-analysis session aborted (reason=aborted)
 *   line 1729  frontend_design no visual input materialized — aborting
 *
 * Both abort paths in orchestrator/tools.ts pre-fix only logged a stderr
 * WARN; downstream stage agents (architect / build / requirements) saw
 * `task.design_specs=undefined` and an empty intent classification with
 * NO explanation. P4 adds decision_log writers on three abort paths:
 *
 *   1. frontend_design pre-agent guard (no visual input provided)
 *   2. frontend_design post-materialization guard (all sources failed)
 *   3. analyze_intent catch (IntentAnalysisAgent threw)
 *
 * The success paths already write decision_log; this test exercises the
 * read/write contract — that the abort entries SHOWS UP in:
 *   - TaskContext.snapshot (orchestrator wake context)
 *   - phasePromptSection("frontend_design" / "intent_analysis")
 *     (used by upstream-context.ts when building prompts for architect /
 *     build / acceptance sub-agents).
 *
 * The orchestrator/tools.ts abort writers themselves are simple
 * `decisionLog.append({...})` calls; this test asserts that pattern
 * is correctly wired to the readers.
 */

describe("P4 abort decision-log writers — read/write contract", () => {
  let tmp: Awaited<ReturnType<typeof tmpdir>>
  let projectID = ""
  let taskID = ""

  function seed() {
    const now = Date.now()
    Database.use((db) =>
      db
        .insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "P4 abort writers test",
          sandboxes: "[]",
          time_created: now,
          time_updated: now,
        })
        .run(),
    )
    Database.use((db) =>
      db
        .insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          title: "P4 abort writers",
          request: "test request",
          priority: "normal",
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run(),
    )
  }

  beforeEach(async () => {
    await resetDatabase()
    tmp = await tmpdir()
    const stamp = Date.now().toString(16)
    projectID = `project_p4_${stamp}`
    taskID = `tsk_${stamp}p4`
    seed()
  })

  afterEach(async () => {
    await resetDatabase()
    await tmp?.[Symbol.asyncDispose]?.()
  })

  test("frontend_design abort_no_visual_input entry surfaces in TaskContext + phase section", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const log = createDecisionLog(taskID)
        // Mirrors orchestrator/tools.ts pre-agent guard write.
        log.append({
          phase: "frontend_design",
          key: "abort_no_visual_input",
          value:
            "frontend_design aborted before agent call: caller provided no visual reference (no attachments, no url, no figma_url, no materials).",
          reason: "no_visual_input_provided",
        })

        // Read side 1: TaskContext.snapshot (orchestrator wake context).
        const snapshot = TaskContext.snapshot(taskID)
        expect(snapshot).toContain("frontend_design")
        expect(snapshot).toContain("abort_no_visual_input")
        expect(snapshot).toContain("no visual reference")

        // Read side 2: phasePromptSection (upstream-context.ts injects
        // this into architect / build / acceptance prompts).
        const section = log.phasePromptSection("frontend_design", "Frontend Design Summary")
        expect(section).toContain("Frontend Design Summary")
        expect(section).toContain("abort_no_visual_input")
        expect(section).toContain("no visual reference")
      },
    })
  })

  test("frontend_design abort_materialization_failed entry surfaces in TaskContext + phase section", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const log = createDecisionLog(taskID)
        // Mirrors orchestrator/tools.ts post-materialization abort write.
        log.append({
          phase: "frontend_design",
          key: "abort_materialization_failed",
          value:
            "frontend_design aborted before agent call: all 1 provided visual source(s) (live=1, figma=0, materials=0) failed to materialize.",
          reason: "materialization_failed_all_sources",
        })

        const snapshot = TaskContext.snapshot(taskID)
        expect(snapshot).toContain("abort_materialization_failed")
        expect(snapshot).toContain("failed to materialize")

        const section = log.phasePromptSection("frontend_design", "Frontend Design Summary")
        expect(section).toContain("abort_materialization_failed")
        expect(section).toContain("materialize")
      },
    })
  })

  test("analyze_intent abort_intent_analysis_failed entry surfaces in TaskContext (rule 4 systemic — same shape as design abort)", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const log = createDecisionLog(taskID)
        // Mirrors orchestrator/tools.ts analyze_intent catch block write.
        log.append({
          phase: "intent_analysis",
          key: "abort_intent_analysis_failed",
          value: "Intent analysis aborted: simulated provider timeout — connection lost to alibaba-coding-plan",
          reason: "intent_analysis_threw",
        })

        const snapshot = TaskContext.snapshot(taskID)
        expect(snapshot).toContain("intent_analysis")
        expect(snapshot).toContain("abort_intent_analysis_failed")
        expect(snapshot).toContain("simulated provider timeout")
      },
    })
  })

  test("negative case: when no abort happens, no spurious abort text in TaskContext", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Only a normal intent_analysis success entry — no abort writers.
        const log = createDecisionLog(taskID)
        log.append({
          phase: "intent_analysis",
          key: "intent_summary",
          value: "feature / medium / confidence=0.85. Add a notes panel.",
          reason: "Intent classification.",
        })

        const snapshot = TaskContext.snapshot(taskID)
        expect(snapshot).not.toContain("abort_intent_analysis_failed")
        expect(snapshot).not.toContain("abort_no_visual_input")
        expect(snapshot).not.toContain("abort_materialization_failed")
        // Normal success entry IS present (rule 36 sanity).
        expect(snapshot).toContain("intent_summary")
      },
    })
  })

  test("intent_clarified_user_request is projected as a first-class TaskContext section", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const log = createDecisionLog(taskID)
        log.append({
          phase: "intent_analysis",
          key: "intent_clarified_user_request",
          value: [
            "# Original user request",
            "",
            "Pixel-copy TradingView while strictly using AInvest design system.",
            "",
            "# Clarifying answers",
            "",
            "1. Which visual policy governs this clone?",
            "   answer: AInvest system (Recommended), Preserve layout parity, not brand colors.",
          ].join("\n"),
          reason: "Clarified user request for downstream stages.",
        })

        const snapshot = TaskContext.snapshot(taskID)
        expect(snapshot).toContain("### Clarified Request")
        expect(snapshot).toContain("Use this clarified request for downstream scope decisions")
        expect(snapshot).toContain("AInvest system (Recommended)")
        expect(snapshot).toContain("Pixel-copy TradingView")
      },
    })
  })
})
