import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createDecisionLog } from "../../src/decision-log"
import { FRONTEND_DESIGN_COMPLETION_KEYS } from "../../src/frontend-design/handoff"
import { describeTask, renderTaskDescription } from "../../src/engine/describe"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { ProjectTable } from "../../src/project/project.sql"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

function seedTask(label: string, projectDir: string): { taskID: string; projectID: string } {
  const now = Date.now()
  const stamp = `${now.toString(16)}_${label}`
  const projectID = `proj_desc_fd_${stamp}`
  const taskID = `tsk_desc_fd_${stamp}`

  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: projectDir,
        name: "Describe frontend design handoff test",
        sandboxes: [],
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "Frontend design wake projection",
        request: "Clone a referenced webpage",
        kind: "workflow",
        priority: "normal",
        design_specs: [],
        time_created: now,
        time_updated: now,
        time_started: now,
      })
      .run()
  })

  return { taskID, projectID }
}

describe("describe frontend_design handoff projection", () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  afterEach(async () => {
    await resetDatabase()
  })

  test("projects completed frontend_design handoff from decision log into task markdown", async () => {
    await using tmp = await tmpdir({ git: true })
    const { taskID } = seedTask("complete", tmp.path)
    const log = createDecisionLog(taskID)
    for (const key of FRONTEND_DESIGN_COMPLETION_KEYS) {
      log.append({
        phase: "frontend_design",
        key,
        value: `${key} persisted value`,
        reason: "frontend_design persisted durable handoff",
      })
    }

    const desc = await Instance.provide({
      directory: tmp.path,
      fn: () => describeTask(taskID),
    })
    const handoff = desc.frontend_design
    expect(handoff).toBeDefined()
    expect(handoff?.is_complete).toBe(true)
    expect(handoff?.has_public_report).toBe(true)
    expect(handoff?.has_evidence_source_manifest).toBe(true)
    expect(handoff?.missing_completion_keys).toEqual([])
    expect(handoff?.present_keys).toContain("frontend_template")
    expect(handoff?.present_keys).toContain("evidence_source_manifest")

    const paths = ProjectRuntimePaths.frontendDesignPaths("", taskID)
    expect(handoff?.frontend_template_path).toBe(paths.templateRelative)
    expect(handoff?.source_manifest_path).toBe(paths.manifestRelative)

    const markdown = renderTaskDescription(desc)
    expect(markdown).toContain("## Frontend Design Handoff")
    expect(markdown).toContain("- is_complete: true")
    expect(markdown).toContain("- has_public_report: true")
    expect(markdown).toContain("- has_evidence_source_manifest: true")
    expect(markdown).toContain(paths.templateRelative)
    expect(markdown).toContain(paths.manifestRelative)
    expect(markdown).toContain("- missing_completion_keys: (none)")
    expect(markdown).toContain(`- latest_updated_at: ${new Date(handoff!.latest_updated_at).toISOString()}`)
    expect(markdown).toContain("Frontend design is complete durable task-scope handoff evidence")
  })

  test("projects partial frontend_design handoff without claiming completion", async () => {
    await using tmp = await tmpdir({ git: true })
    const { taskID } = seedTask("partial", tmp.path)
    createDecisionLog(taskID).append({
      phase: "frontend_design",
      key: "public_report",
      value: "Public report exists, but template and manifest are not persisted.",
      reason: "partial frontend_design evidence",
    })

    const desc = await Instance.provide({
      directory: tmp.path,
      fn: () => describeTask(taskID),
    })
    const handoff = desc.frontend_design
    expect(handoff).toBeDefined()
    expect(handoff?.is_complete).toBe(false)
    expect(handoff?.has_public_report).toBe(true)
    expect(handoff?.has_evidence_source_manifest).toBe(false)
    expect(handoff?.missing_completion_keys).toContain("frontend_template")
    expect(handoff?.missing_completion_keys).toContain("evidence_source_manifest")

    const markdown = renderTaskDescription(desc)
    expect(markdown).toContain("## Frontend Design Handoff")
    expect(markdown).toContain("- is_complete: false")
    expect(markdown).toContain("missing_completion_keys:")
    expect(markdown).toContain("frontend_template")
    expect(markdown).toContain("evidence_source_manifest")
    expect(markdown).toContain("Frontend design is partial durable task-scope evidence")
  })
})
