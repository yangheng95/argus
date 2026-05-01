import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "node:fs/promises"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { Publisher } from "../../src/engine/publisher"
import type { DeliveryRow, RunRow, TaskRow } from "../../src/engine/store"

describe("Publisher delivery gate", () => {
  test("fails publish when delivery declares changed files but exported patch is empty", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "oc-publisher-gate-"))
    try {
      await fs.writeFile(path.join(dir, "file.txt"), "initial\n")
      await $`git init`.cwd(dir).quiet()
      await $`git add file.txt`.cwd(dir).quiet()
      await $`git -c user.name=test -c user.email=test@example.com commit -m init`.cwd(dir).quiet()
      const baseline = (await $`git rev-parse HEAD`.cwd(dir).quiet().text()).trim()

      const result = await Instance.provide({
        directory: dir,
        fn: () => Publisher.deliver({
          task: taskRow({ baseline }),
          run: runRow(),
          delivery: deliveryRow(),
        }),
      })

      expect(result.status).toBe("failed")
      expect(result.summary).toContain("did not include 1 declared file")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

function taskRow(input: { baseline: string }): TaskRow {
  const now = Date.now()
  return {
    id: "tsk_publish_gate",
    project_id: "project_publish_gate",
    source: "test",
    title: "Publisher gate test",
    request: "Publish a delivery with declared changed files",
    kind: "workflow",
    priority: "normal",
    status: "active",
    error: null,
    criteria_results: [],
    metadata: { git: { baseline: { commit: input.baseline } } },
    attachments: [],
    system_artifacts: [],
    design_specs: [],
    session_id: null,
    active_plan_version_id: null,
    queue_order: 0,
    budget: null,
    time_created: now,
    time_updated: now,
    time_started: now,
    time_completed: null,
  } as TaskRow
}

function runRow(): RunRow {
  const now = Date.now()
  return {
    id: "run_publish_gate",
    task_id: "tsk_publish_gate",
    plan_version_id: null,
    status: "running",
    phase: "deliver",
    summary: null,
    error: null,
    time_created: now,
    time_updated: now,
    time_started: now,
    time_completed: null,
  } as RunRow
}

function deliveryRow(): DeliveryRow {
  const now = Date.now()
  return {
    id: "dlv_publish_gate",
    task_id: "tsk_publish_gate",
    run_id: "run_publish_gate",
    goal_run_id: null,
    status: "candidate",
    summary: "Declared changes",
    result: {
      summary: "Declared changes",
      changed_files: ["file.txt"],
      diffs: [{ file: "file.txt" }],
    },
    time_created: now,
    time_updated: now,
  }
}
