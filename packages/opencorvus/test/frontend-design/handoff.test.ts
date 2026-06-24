import { afterEach, beforeEach, expect, test } from "bun:test"
import { createDecisionLog } from "../../src/decision-log"
import { renderFrontendDesignHandoffReference } from "../../src/frontend-design/handoff"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { ProjectTable } from "../../src/project/project.sql"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

let tmp: Awaited<ReturnType<typeof tmpdir>>
let taskID = ""
let projectID = ""

beforeEach(async () => {
  await resetDatabase()
  tmp = await tmpdir()
  const stamp = Date.now().toString(16)
  taskID = `tsk_handoff_${stamp}`
  projectID = `project_handoff_${stamp}`
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(ProjectTable)
      .values({
        id: projectID,
        worktree: tmp.path,
        name: "handoff test",
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
        title: "handoff test",
        request: "clone a reference page",
        priority: "normal",
        time_created: now,
        time_updated: now,
        time_started: now,
      })
      .run(),
  )
})

afterEach(async () => {
  await resetDatabase()
  await tmp?.[Symbol.asyncDispose]?.()
})

test("frontend-design handoff is empty before canonical decision-log entries exist", async () => {
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect(renderFrontendDesignHandoffReference(taskID)).toBe("")
      expect(renderFrontendDesignHandoffReference(taskID, { includeExcerpts: false })).toBe("")
      expect(renderFrontendDesignHandoffReference(taskID, { pathMode: "absolute" })).toBe("")
    },
  })
})

test("frontend-design handoff stays empty when only reference artifacts exist", async () => {
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      createDecisionLog(taskID).append({
        phase: "frontend_design",
        key: "reference_artifacts",
        value: "visual-html-skeleton/screenshots/desktop.png",
        reason: "visual qa reference artifact only",
      })

      expect(renderFrontendDesignHandoffReference(taskID)).toBe("")
      expect(renderFrontendDesignHandoffReference(taskID, { includeExcerpts: false })).toBe("")
      expect(renderFrontendDesignHandoffReference(taskID, { pathMode: "absolute" })).toBe("")
    },
  })
})

test("frontend-design handoff points to source files and keeps excerpts bounded", async () => {
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const longSpec = "A".repeat(2_000)
      const log = createDecisionLog(taskID)
      log.append({
        phase: "frontend_design",
        key: "public_report",
        value:
          "## Quality Project Contract\nBuild semantic React source from the source skeleton and preserved CSS sidecars.",
        reason: "public terminal report",
      })
      log.append({
        phase: "frontend_design",
        key: "visual_consistency_contract",
        value: longSpec,
        reason: "webpage-evidence-derived visual contract",
      })
      log.append({
        phase: "frontend_design",
        key: "quality_project_contract",
        value: "Source-region traceable refactor: every component maps back to captured source nodes and screenshots.",
        reason: "maintainable target",
      })
      log.append({
        phase: "frontend_design",
        key: "final_acceptance_mode",
        value: "maintainable_replacement_required",
        reason: "maintainable mode",
      })
      log.append({
        phase: "frontend_design",
        key: "frontend_project",
        value:
          "status: created\nrole: source_baseline_input\nproject_root: frontend-design-skeleton\nacceptance_root: .",
        reason: "source skeleton role",
      })
      log.append({
        phase: "frontend_design",
        key: "evidence_source_manifest",
        value: "webpage-evidence/reference.png\nwebpage-evidence/page.ir.json",
        reason: "source manifest",
      })

      const handoff = renderFrontendDesignHandoffReference(taskID, { valueCap: 120 })

      expect(handoff).toContain("Frontend Design Public Report")
      expect(handoff).toContain("frontend_design public report")
      const paths = ProjectRuntimePaths.frontendDesignPaths("", taskID)
      expect(handoff).toContain(paths.templateRelative)
      expect(handoff).toContain(paths.manifestRelative)
      expect(handoff).toContain("do not run webpage evidence tools outside frontend_design")
      expect(handoff).toContain("public_report")
      expect(handoff).toContain("visual_consistency_contract")
      expect(handoff).toContain("quality_project_contract")
      expect(handoff).toContain("frontend_project")
      expect(handoff).toContain("source_baseline_input")
      expect(handoff).toContain("Source-Region Refactor Guidance")
      expect(handoff).toContain("rawproject evidence")
      expect(handoff).toContain("source data extraction")
      expect(handoff).toContain("rendered screenshot review evidence")
      expect(handoff).toContain("source-evidence review facts")
      expect(handoff).toContain("Do not change other agent prompts or communication paths")
      expect(handoff).toContain(
        "do not delete `web-clone-source/` content until source-derived style evidence and styling obligations have been migrated",
      )
      expect(handoff).not.toContain("freehand")
      expect(handoff).not.toContain("greenfield")
      expect(handoff).not.toContain("100/100")
      expect(handoff).not.toContain("overallScore >=80/100")
      expect(handoff).toContain("[+")
      expect(handoff.length).toBeLessThan(3_400)
    },
  })
})
