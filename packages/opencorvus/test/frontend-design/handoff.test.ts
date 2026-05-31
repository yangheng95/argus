import { afterEach, beforeEach, expect, test } from "bun:test"
import { createDecisionLog } from "../../src/decision-log"
import { renderFrontendDesignHandoffReference } from "../../src/frontend-design/handoff"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
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
    db.insert(ProjectTable).values({
      id: projectID,
      worktree: tmp.path,
      name: "handoff test",
      sandboxes: "[]",
      time_created: now,
      time_updated: now,
    }).run(),
  )
  Database.use((db) =>
    db.insert(EngineTaskTable).values({
      id: taskID,
      project_id: projectID,
      source: "test",
      title: "handoff test",
      request: "clone a reference page",
      priority: "normal",
      time_created: now,
      time_updated: now,
      time_started: now,
    }).run(),
  )
})

afterEach(async () => {
  await resetDatabase()
  await tmp?.[Symbol.asyncDispose]?.()
})

test("frontend-design handoff points to source files and keeps excerpts bounded", async () => {
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const longSpec = "A".repeat(2_000)
      const log = createDecisionLog(taskID)
      log.append({
        phase: "frontend_design",
        key: "visual_consistency_contract",
        value: longSpec,
        reason: "mirror-derived visual contract",
      })
      log.append({
        phase: "frontend_design",
        key: "quality_project_contract",
        value: "Build semantic React source; raw baseline is not deliverable.",
        reason: "maintainable target",
      })
      log.append({
        phase: "frontend_design",
        key: "frontend_project",
        value: "status: created\nrole: visual_baseline_input\nproject_root: frontend-design-skeleton",
        reason: "baseline role",
      })
      log.append({
        phase: "frontend_design",
        key: "evidence_source_manifest",
        value: "mirror/reference.png\nmirror/page-ir.xml",
        reason: "source manifest",
      })

      const handoff = renderFrontendDesignHandoffReference(taskID, { valueCap: 120 })

      expect(handoff).toContain(`.opencorvus/runtime/tasks/${taskID}/frontend-design/frontend-template.md`)
      expect(handoff).toContain(`.opencorvus/runtime/tasks/${taskID}/frontend-design/evidence-source-manifest.md`)
      expect(handoff).toContain("do not run mirror tools outside frontend_design")
      expect(handoff).toContain("visual_consistency_contract")
      expect(handoff).toContain("quality_project_contract")
      expect(handoff).toContain("frontend_project")
      expect(handoff).toContain("visual_baseline_input")
      expect(handoff).toContain("[+")
      expect(handoff.length).toBeLessThan(1_600)
    },
  })
})
