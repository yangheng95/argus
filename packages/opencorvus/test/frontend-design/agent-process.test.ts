import { afterEach, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
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
      const continuation = {
        sessionID: "ses_frontend_design_existing",
        artifactID: "artifact_frontend_design_continuation",
        reason: "continue frontend-design finalizer miss",
        kind: "protocol-finalizer-miss" as const,
        finalizerName: "submit_frontend_template",
      }

      runnerImpl = async (input: any) => {
        expect(input.continuation).toEqual(continuation)
        expect(input.terminalTool?.toolName).toBe("submit_frontend_template")
        expect(input.toolKit.tools.record_frontend_region_selection).toBeDefined()
        expect(input.toolKit.tools.record_frontend_replacement_result).toBeDefined()
        expect(input.toolKit.tools.create_visual_region_coordinate_atlas).toBeDefined()
        expect(input.toolKit.tools.create_visual_region_binding_package).toBeDefined()

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
          visualEvidence: ["acceptance/hero-preview-screenshot.json"],
          auditEvidence: ["acceptance/web-clone-source-maintainable-audit.json"],
          remainingSourceDebt: [],
          nextRegionComponentName: "FooterRegion",
        })
        await input.toolKit.tools.update_frontend_basics.execute({
          design_system: "source-region clone",
          tech_stack: ["React", "Vite"],
          final_acceptance_mode: "maintainable_replacement_required",
        })
        await input.toolKit.tools.update_frontend_text.execute({
          section: "frontend_template",
          content: "Use the frontend-design-skeleton source project as the implementation target.",
        })
        await input.toolKit.tools.update_frontend_text.execute({
          section: "fillable_modules",
          content: "HeroSection owns the replaced HeroRegion vertical slice.",
        })
        await input.toolKit.tools.update_frontend_text.execute({
          section: "component_inventory",
          content: "HeroSection semantic component.",
        })
        await input.toolKit.tools.update_frontend_component_reuse.execute({
          family_id: "hero-section",
          name: "HeroSection",
          observed_surface: "HeroRegion",
          source_refs: ["src/data/sourceDomReplacementPlan.ts"],
          implementation_strategy: "project_specific_component",
          reuse_source: "project-owned semantic component",
          mature_library_candidates: [],
          props_states: "hero data fixture",
          replacement_boundary: "src/components/source-dom/HeroRegion.tsx",
          parity_guard: "task-scoped preview screenshot inspection plus source audit",
          project_specific_reason: "Simple page-specific layout; no mature library domain.",
        })
        await input.toolKit.tools.update_frontend_baseline.execute({
          boundary_id: "HeroRegion",
          source_region: "src/components/source-dom/HeroRegion.tsx",
          action: "replace_generated_baseline",
          component_family_id: "hero-section",
          replacement_strategy: "project_specific_component",
          reuse_source: "HeroSection",
          mature_library_candidates: [],
          deletion_rule: "Remove source-dom HeroRegion after parity evidence.",
          source_refs: ["src/data/sourceDomReplacementPlan.ts"],
          parity_guard: "task-scoped preview screenshot inspection plus source audit",
          project_specific_reason: "Simple page-specific layout.",
        })
        await input.toolKit.tools.update_frontend_text.execute({
          section: "material_inventory",
          content: "reference.png, sourceDomReplacementPlan.ts, heroData.ts",
        })
        await input.toolKit.tools.update_frontend_material.execute({
          title: "Hero source materials",
          detail: "Use reference pixels, replacement-plan rows, and hero data for visual restoration.",
          source_refs: ["reference.png", "sourceDomReplacementPlan.ts", "heroData.ts"],
        })
        await input.toolKit.tools.update_frontend_text.execute({
          section: "visual_consistency_contract",
          content: "Maintain source screenshot parity for the replaced hero region.",
        })
        await input.toolKit.tools.update_frontend_text.execute({
          section: "ui_data_contract",
          content: "Local hero data fixture.",
        })
        for (const phase of [
          "evidence_lock",
          "implementation_scaffold",
          "data_component_transcription",
          "runtime_visual_verification",
          "source_quality_cleanup",
        ] as const) {
          await input.toolKit.tools.update_frontend_phase.execute({
            id: `phase-${phase}`,
            phase,
            title: phase,
            deliverable: `Recorded ${phase} outcome for the source-region clone.`,
            source_refs: ["src/data/sourceDomReplacementPlan.ts"],
            acceptance: `${phase} evidence is present in the handoff.`,
          })
        }
        await input.toolKit.tools.update_frontend_iteration_note.execute({
          value: "Checked source-region process evidence.",
        })
        await input.toolKit.tools.update_frontend_text.execute({
          section: "completeness_review",
          content: "HeroRegion replacement evidence is recorded; downstream benchmark consumes artifacts.",
        })
        await input.toolKit.tools.update_frontend_reference.execute({
          value: "src/data/sourceDomReplacementPlan.ts",
        })
        await input.toolKit.tools.update_frontend_project.execute({
          status: "created",
          role: "implementation_target",
          project_root: ProjectRuntimePaths.frontendDesignPaths("", "tsk_analyze_process").skeletonProjectRelative,
          source_package: ProjectRuntimePaths.frontendDesignPaths("", "tsk_analyze_process").sourcePackageRelative,
          entrypoints: ["src/main.tsx", "src/App.tsx"],
          generation_tool: "create_frontend_skeleton_project",
          notes: ["HeroRegion replacement completed."],
        })
        await input.toolKit.tools.submit_frontend_template.execute({ final: true })

        return {
          collector: input.toolKit.getCollector(),
          session: { id: "ses_frontend_design_process" },
        }
      }

      const result = await FrontendDesignAgent.analyze({
        title: "Analyze process trace",
        request: "Refine the captured web-clone-source into maintainable source.",
        taskID: "tsk_analyze_process",
        continuation,
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
          visualEvidence: ["acceptance/footer-preview-screenshot.json"],
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

      const artifactDir = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID).templateAbsolute
      const artifactRoot = path.dirname(artifactDir)
      const processTrace = await readJsonEventually(path.join(artifactRoot, "frontend-design-process-trace.json"))
      const iterationState = await readJsonEventually(path.join(artifactRoot, "frontend-design-iteration-state.json"))
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
