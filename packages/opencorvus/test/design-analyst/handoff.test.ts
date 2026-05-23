import { afterEach, beforeEach, expect, test } from "bun:test"
import { createDecisionLog } from "../../src/decision-log"
import { renderDesignAnalysisHandoffReference } from "../../src/design-analyst/handoff"
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

test("design-analysis handoff points to source files and keeps excerpts bounded", async () => {
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const longSpec = "A".repeat(2_000)
      const log = createDecisionLog(taskID)
      log.append({
        phase: "design_analysis",
        key: "visual_consistency_spec",
        value: longSpec,
        reason: "mirror-derived visual contract",
      })
      log.append({
        phase: "design_analysis",
        key: "evidence_source_manifest",
        value: "mirror/reference.png\nmirror/page-ir.xml",
        reason: "source manifest",
      })

      const handoff = renderDesignAnalysisHandoffReference(taskID, { valueCap: 120 })

      expect(handoff).toContain(`.opencorvus/runtime/tasks/${taskID}/design-analysis/prd-spec.md`)
      expect(handoff).toContain(`.opencorvus/runtime/tasks/${taskID}/design-analysis/evidence-source-manifest.md`)
      expect(handoff).toContain("do not run mirror tools outside design_analysis")
      expect(handoff).toContain("visual_consistency_spec")
      expect(handoff).toContain("[+")
      expect(handoff.length).toBeLessThan(1_200)
    },
  })
})
