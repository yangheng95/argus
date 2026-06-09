import { afterEach, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

let runnerImpl: ((input: any) => Promise<any>) | undefined

mock.module("@/agent/runner", () => ({
  AgentRunError: class AgentRunError extends Error {},
  buildHardErrorFromFinalMessage: () => null,
  buildUnsatisfiedTerminalToolError: () => new Error("terminal tool unsatisfied"),
  classifyAttemptOutcome: () => ({ status: "ok" }),
  extractInformationMissingBlock: () => undefined,
  messageHasInformationMissing: () => false,
  promptToolSwitchesForAgentRun: () => "",
  shouldFailUnreadableBuildReference: () => false,
  terminalToolMissingErrorFor: () => new Error("terminal tool missing"),
  toolErrorPartsFromFinalMessage: () => [],
  runAgentSession: (input: any) => {
    if (!runnerImpl) throw new Error("runAgentSession mock not configured")
    return runnerImpl(input)
  },
  runAgentSessionWithRetry: () => {
    throw new Error("runAgentSessionWithRetry should not be called by FrontendDesignAgent")
  },
}))

afterEach(async () => {
  runnerImpl = undefined
  mock.restore()
  await resetDatabase()
  await Instance.disposeAll()
})

test("FrontendDesignAgent.analyze persists process and iteration artifacts from agent-owned tools", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const now = Date.now()
      const rootSession = await Session.create({ kind: "root", title: "Frontend design process root" })
      Database.use((db) => {
        db.insert(EngineTaskTable)
          .values({
            id: "tsk_analyze_process",
            project_id: Instance.project.id,
            session_id: rootSession.id,
            source: "test",
            title: "Analyze process trace",
            request: "Refine the captured web-clone-source into maintainable source.",
            priority: "normal",
            time_created: now,
            time_updated: now,
            time_started: now,
          })
          .run()
      })

      const { FrontendDesignAgent } = await import("../../src/frontend-design/agent")

      runnerImpl = async (input: any) => {
        expect(input.terminalTool?.toolName).toBe("submit_frontend_template")
        expect(input.toolKit.tools.record_frontend_region_selection).toBeDefined()
        expect(input.toolKit.tools.record_frontend_replacement_result).toBeDefined()

        await input.toolKit.tools.record_frontend_region_selection.execute({
          regionComponentName: "HeroRegion",
          regionFilePath: "src/components/source-dom/HeroRegion.tsx",
          replacementPlanFile: "src/data/sourceDomReplacementPlan.ts",
          iterationStateFile: "src/data/sourceDomIterationState.ts",
          recommendedComponentName: "HeroSection",
          replacementKind: "card_collection_component",
          reason: "nextSourceDomReplacement selected HeroRegion.",
        })
        await input.toolKit.tools.record_frontend_replacement_result.execute({
          regionComponentName: "HeroRegion",
          replacementStatus: "completed",
          replacementComponentName: "HeroSection",
          filesChanged: ["src/components/semantic/HeroSection.tsx"],
          dataModules: ["src/data/heroData.ts"],
          styleModules: ["src/styles.css"],
          removedGeneratedBoundaries: ["src/components/source-dom/HeroRegion.tsx"],
          visualEvidence: ["acceptance/hero-webpage-evaluate.json"],
          auditEvidence: ["acceptance/web-clone-source-maintainable-audit.json"],
          remainingSourceDebt: [],
          nextRegionComponentName: "FooterRegion",
        })
        await input.toolKit.tools.submit_frontend_template.execute({
          design_system: "source-region clone",
          tech_stack: ["React", "Vite"],
          final_acceptance_mode: "maintainable_replacement_required",
          frontend_template: "Use the frontend-design-skeleton source project as the implementation target.",
          fillable_modules: "HeroSection owns the replaced HeroRegion vertical slice.",
          component_inventory: "HeroSection semantic component.",
          component_reuse_plan: [
            {
              family_id: "hero-section",
              name: "HeroSection",
              observed_surface: "HeroRegion",
              source_refs: ["src/data/sourceDomReplacementPlan.ts"],
              implementation_strategy: "project_specific_component",
              reuse_source: "project-owned semantic component",
              mature_library_candidates: [],
              props_states: "hero data fixture",
              replacement_boundary: "src/components/source-dom/HeroRegion.tsx",
              parity_guard: "webpage_evaluate plus source audit",
              project_specific_reason: "Simple page-specific layout; no mature library domain.",
            },
          ],
          baseline_replacement_plan: [
            {
              boundary_id: "HeroRegion",
              source_region: "src/components/source-dom/HeroRegion.tsx",
              action: "replace_generated_baseline",
              component_family_id: "hero-section",
              replacement_strategy: "project_specific_component",
              reuse_source: "HeroSection",
              mature_library_candidates: [],
              deletion_rule: "Remove source-dom HeroRegion after parity evidence.",
              source_refs: ["src/data/sourceDomReplacementPlan.ts"],
              parity_guard: "webpage_evaluate plus source audit",
              project_specific_reason: "Simple page-specific layout.",
            },
          ],
          material_inventory: "reference.png, sourceDomReplacementPlan.ts, heroData.ts",
          visual_consistency_contract: "Maintain source screenshot parity for the replaced hero region.",
          ui_data_contract: "Local hero data fixture.",
          template_iteration_notes: ["Checked source-region process evidence."],
          completeness_review: "HeroRegion replacement evidence is recorded; downstream benchmark consumes artifacts.",
          reference_artifacts: ["src/data/sourceDomReplacementPlan.ts"],
          open_questions: [],
          frontend_project: {
            status: "created",
            role: "implementation_target",
            project_root: ".opencorvus/runtime/tasks/tsk_analyze_process/frontend-design/frontend-design-skeleton",
            source_package: ".opencorvus/runtime/tasks/tsk_analyze_process/frontend-design/web-clone-source",
            entrypoints: ["src/main.tsx", "src/App.tsx"],
            generation_tool: "create_frontend_skeleton_project",
            notes: ["HeroRegion replacement completed."],
          },
        })

        return {
          collector: input.toolKit.getCollector(),
          session: { id: "ses_frontend_design_process" },
        }
      }

      const result = await FrontendDesignAgent.analyze({
        title: "Analyze process trace",
        request: "Refine the captured web-clone-source into maintainable source.",
        taskID: "tsk_analyze_process",
      })

      expect(result.processTrace.events.map((event) => event.name)).toContain("frontend_design_region_selection")
      expect(result.processTrace.events.map((event) => event.name)).toContain("frontend_design_replacement_result")
      expect(result.processTraceArtifact).toBeDefined()
      expect(result.iterationStateArtifact).toBeDefined()
      const processTrace = JSON.parse(await fs.readFile(result.processTraceArtifact!, "utf8"))
      const iterationState = JSON.parse(await fs.readFile(result.iterationStateArtifact!, "utf8"))
      expect(processTrace.events.map((event: any) => event.name)).toContain("frontend_design_replacement_result")
      expect(iterationState.completedReplacements[0].regionComponentName).toBe("HeroRegion")
      expect(result.report.detail).toContain("Process trace artifact:")
      expect(result.report.detail).toContain("Iteration state artifact:")
    },
  })
})

test("FrontendDesignAgent.analyze persists process artifacts before failed finalization", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const now = Date.now()
      const taskID = "tsk_analyze_process_failure"
      const rootSession = await Session.create({ kind: "root", title: "Frontend design process failure root" })
      Database.use((db) => {
        db.insert(EngineTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            session_id: rootSession.id,
            source: "test",
            title: "Analyze process trace failure",
            request: "Refine the captured web-clone-source into maintainable source.",
            priority: "normal",
            time_created: now,
            time_updated: now,
            time_started: now,
          })
          .run()
      })

      const { FrontendDesignAgent } = await import("../../src/frontend-design/agent")

      runnerImpl = async (input: any) => {
        await input.toolKit.tools.record_frontend_region_selection.execute({
          regionComponentName: "FooterRegion",
          regionFilePath: "src/components/source-dom/FooterRegion.tsx",
          replacementPlanFile: "src/data/sourceDomReplacementPlan.ts",
          iterationStateFile: "src/data/sourceDomIterationState.ts",
          recommendedComponentName: "FooterNavigation",
          replacementKind: "navigation_or_footer_component",
          reason: "nextSourceDomReplacement selected FooterRegion.",
        })
        await input.toolKit.tools.record_frontend_replacement_result.execute({
          regionComponentName: "FooterRegion",
          replacementStatus: "completed",
          replacementComponentName: "FooterNavigation",
          filesChanged: ["src/components/semantic/FooterNavigation.tsx"],
          dataModules: ["src/data/footerData.ts"],
          styleModules: ["src/styles.css"],
          removedGeneratedBoundaries: ["src/components/source-dom/FooterRegion.tsx"],
          visualEvidence: ["acceptance/footer-webpage-evaluate.json"],
          auditEvidence: ["acceptance/web-clone-source-maintainable-audit.json"],
          remainingSourceDebt: [],
        })
        throw new Error("simulated frontend-design timeout after tools")
      }

      await expect(
        FrontendDesignAgent.analyze({
          title: "Analyze process trace failure",
          request: "Refine the captured web-clone-source into maintainable source.",
          taskID,
        }),
      ).rejects.toThrow("simulated frontend-design timeout after tools")

      const artifactDir = path.join(tmp.path, ".opencorvus", "runtime", "tasks", taskID, "frontend-design")
      const processTrace = await readJsonEventually(path.join(artifactDir, "frontend-design-process-trace.json"))
      const iterationState = await readJsonEventually(path.join(artifactDir, "frontend-design-iteration-state.json"))
      expect(processTrace.events.map((event: any) => event.name)).toContain("frontend_design_replacement_result")
      expect(iterationState.completedReplacements[0].regionComponentName).toBe("FooterRegion")
    },
  })
})

async function readJsonEventually(file: string): Promise<any> {
  let lastError: unknown
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      return JSON.parse(await fs.readFile(file, "utf8"))
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  throw lastError
}
