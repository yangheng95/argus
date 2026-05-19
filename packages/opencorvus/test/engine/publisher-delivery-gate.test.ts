import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "node:fs/promises"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { Publisher } from "../../src/engine/publisher"
import { EngineGit } from "../../src/engine/git"
import type { DeliveryRow, RunRow, TaskRow } from "../../src/engine/store"

describe("Publisher delivery export", () => {
  test("publisher does not run a second declared-files acceptance check", async () => {
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

      expect(result.status).toBe("delivered")
      expect(result.summary).toContain("Delivery finalized")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("exports declared ignored files once delivery round anchors them", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "oc-publisher-ignored-"))
    try {
      await fs.writeFile(path.join(dir, "file.txt"), "initial\n")
      await fs.writeFile(path.join(dir, ".gitignore"), "dist/\n")
      await $`git init`.cwd(dir).quiet()
      await $`git add file.txt .gitignore`.cwd(dir).quiet()
      await $`git -c user.name=test -c user.email=test@example.com commit -m init`.cwd(dir).quiet()
      const baseline = (await $`git rev-parse HEAD`.cwd(dir).quiet().text()).trim()
      await fs.mkdir(path.join(dir, "dist"), { recursive: true })
      await fs.writeFile(path.join(dir, "dist", "index.html"), "<main>calculator</main>\n")

      const result = await Instance.provide({
        directory: dir,
        fn: async () => {
          const task = taskRow({ baseline })
          await EngineGit.commitDeliveryRound({
            task,
            iteration: 0,
            verdict: { verdict: "accepted", summary: "accepted", rejection_count: 0 },
            declaredChangedFiles: ["dist/index.html"],
          })
          return Publisher.deliver({
            task,
            run: runRow(),
            delivery: deliveryRow({ changedFiles: ["dist/index.html"] }),
          })
        },
      })

      expect(result.status).toBe("delivered")
      const patch = result.artifacts.find((item) => item.label === "delivery.patch")?.payload.patch
      expect(String(patch)).toContain("dist/index.html")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("fails publish when baseline commit is missing", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "oc-publisher-no-baseline-"))
    try {
      await fs.writeFile(path.join(dir, "file.txt"), "initial\n")
      await $`git init`.cwd(dir).quiet()
      const result = await Instance.provide({
        directory: dir,
        fn: () => Publisher.deliver({
          task: taskRow({ baseline: "" }),
          run: runRow(),
          delivery: deliveryRow(),
        }),
      })

      expect(result.status).toBe("failed")
      expect(result.publish.adapters.find((item) => item.id === "workspace_export")?.detail)
        .toContain("baseline.commit")
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

function deliveryRow(input?: { changedFiles?: string[] }): DeliveryRow {
  const now = Date.now()
  const changedFiles = input?.changedFiles ?? ["file.txt"]
  return {
    id: "dlv_publish_gate",
    task_id: "tsk_publish_gate",
    run_id: "run_publish_gate",
    goal_run_id: null,
    status: "candidate",
    summary: "Declared changes",
    result: {
      summary: "Declared changes",
      changed_files: changedFiles,
      diffs: changedFiles.map((file) => ({ file })),
    },
    time_created: now,
    time_updated: now,
  }
}
