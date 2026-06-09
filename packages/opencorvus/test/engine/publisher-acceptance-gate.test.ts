import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "node:fs/promises"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { Publisher } from "../../src/engine/publisher"
import { EngineGit } from "../../src/engine/git"
import type { AcceptanceRow, RunRow, TaskRow } from "../../src/engine/store"

describe("Publisher acceptance export", () => {
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
        fn: () =>
          Publisher.deliver({
            task: taskRow({ baseline }),
            run: runRow(),
            acceptance: acceptanceRow(),
          }),
      })

      expect(result.status).toBe("delivered")
      expect(result.summary).toContain("Acceptance finalized")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("exports declared ignored files once acceptance round anchors them", async () => {
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
          await EngineGit.commitAcceptanceRound({
            task,
            iteration: 0,
            verdict: { verdict: "accepted", summary: "accepted", rejection_count: 0 },
            declaredChangedFiles: ["dist/index.html"],
          })
          return Publisher.deliver({
            task,
            run: runRow(),
            acceptance: acceptanceRow({ changedFiles: ["dist/index.html"] }),
          })
        },
      })

      expect(result.status).toBe("delivered")
      const patch = result.artifacts.find((item) => item.label === "acceptance.patch")?.payload.patch
      expect(String(patch)).toContain("dist/index.html")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("acceptance round does not stage host evidence input directories", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "oc-publisher-evidence-"))
    try {
      await fs.writeFile(path.join(dir, "file.txt"), "initial\n")
      await $`git init`.cwd(dir).quiet()
      await $`git add file.txt`.cwd(dir).quiet()
      await $`git -c user.name=test -c user.email=test@example.com commit -m init`.cwd(dir).quiet()
      const baseline = (await $`git rev-parse HEAD`.cwd(dir).quiet().text()).trim()
      await fs.mkdir(path.join(dir, "web-clone-source"), { recursive: true })
      await fs.writeFile(path.join(dir, "web-clone-source", "README.md"), "evidence\n")
      await fs.writeFile(path.join(dir, "app.ts"), "export const value = 1\n")

      const result = await Instance.provide({
        directory: dir,
        fn: () =>
          EngineGit.commitAcceptanceRound({
            task: taskRow({ baseline }),
            iteration: 0,
            verdict: { verdict: "accepted", summary: "accepted", rejection_count: 0 },
            declaredChangedFiles: ["app.ts", "web-clone-source/README.md"],
          }),
      })

      expect(result.mode).toBe("created_commit")
      const tracked = (await $`git ls-files`.cwd(dir).text()).trim().split(/\r?\n/).filter(Boolean)
      expect(tracked).toContain("app.ts")
      expect(tracked).not.toContain("web-clone-source/README.md")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("acceptance export filters committed host evidence input directories", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "oc-publisher-evidence-export-"))
    try {
      await fs.writeFile(path.join(dir, "file.txt"), "initial\n")
      await $`git init`.cwd(dir).quiet()
      await $`git add file.txt`.cwd(dir).quiet()
      await $`git -c user.name=test -c user.email=test@example.com commit -m init`.cwd(dir).quiet()
      const baseline = (await $`git rev-parse HEAD`.cwd(dir).quiet().text()).trim()
      await fs.mkdir(path.join(dir, "web-clone-source"), { recursive: true })
      await fs.writeFile(path.join(dir, "web-clone-source", "README.md"), "evidence\n")
      await fs.writeFile(path.join(dir, "app.ts"), "export const value = 1\n")
      await $`git add app.ts web-clone-source/README.md`.cwd(dir).quiet()
      await $`git -c user.name=test -c user.email=test@example.com commit -m "manual mixed commit"`.cwd(dir).quiet()

      const result = await Instance.provide({
        directory: dir,
        fn: () =>
          Publisher.deliver({
            task: taskRow({ baseline }),
            run: runRow(),
            acceptance: acceptanceRow({ changedFiles: ["app.ts", "web-clone-source/README.md"] }),
          }),
      })

      expect(result.status).toBe("delivered")
      const patchArtifact = result.artifacts.find((item) => item.label === "acceptance.patch")
      expect(patchArtifact?.payload.changed_files).toContain("app.ts")
      expect(patchArtifact?.payload.changed_files).not.toContain("web-clone-source/README.md")
      expect(String(patchArtifact?.payload.patch)).toContain("app.ts")
      expect(String(patchArtifact?.payload.patch)).not.toContain("web-clone-source/README.md")
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
        fn: () =>
          Publisher.deliver({
            task: taskRow({ baseline: "" }),
            run: runRow(),
            acceptance: acceptanceRow(),
          }),
      })

      expect(result.status).toBe("failed")
      expect(result.publish.adapters.find((item) => item.id === "workspace_export")?.detail).toContain(
        "baseline.commit",
      )
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
    request: "Publish a acceptance with declared changed files",
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

function acceptanceRow(input?: { changedFiles?: string[] }): AcceptanceRow {
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
