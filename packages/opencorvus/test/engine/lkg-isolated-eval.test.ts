import { afterEach, describe, expect, test } from "bun:test"
import { $ } from "bun"
import { PNG } from "pngjs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { evaluateLKGInIsolatedWorktree } from "../../src/acceptance/lkg-isolated-eval"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import type { TaskRow } from "../../src/engine/store"
import { Instance } from "../../src/project/instance"
import { AttachmentStore } from "../../src/storage/attachment-store"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"

afterEach(async () => {
  await resetDatabase()
})

describe("isolated acceptance LKG evaluation", () => {
  test("evaluates and rolls back only the temporary worktree, leaving primary HEAD unchanged", async () => {
    const dir = await makeGitDir()
    try {
      await Instance.provide({
        directory: dir,
        fn: async () => {
          const task = seedTask({ id: uniqueID("task_lkg_isolated_normal") })
          const previousSha = await commitFile(dir, "app.txt", "previous\n", "previous")
          const roundSha = await commitFile(dir, "app.txt", "regressed\n", "round")
          const rendered = await AttachmentStore.write(
            Instance.project.id,
            pngBuffer([0, 0, 0, 255]),
            "image/png",
            "rendered.png",
          )
          const reference = await AttachmentStore.write(
            Instance.project.id,
            pngBuffer([0, 0, 0, 255]),
            "image/png",
            "reference.png",
          )
          const inputTask = withLKG(task, previousSha, 1.1)
          const primaryBefore = await head(dir)

          const result = await evaluateLKGInIsolatedWorktree({
            task: inputTask,
            iteration: 2,
            roundCommitSha: roundSha,
            renderedRefUrl: rendered.url,
            referenceRefUrl: reference.url,
          })

          expect(result.outcome.kind).toBe("regressed")
          expect("rolledBackTo" in result.outcome ? result.outcome.rolledBackTo : "").toBe(previousSha)
          expect(result.evaluatedSha).toBe(roundSha)
          expect(result.metric.passed).toBe(false)
          expect(result.metric.gates.find((gate) => gate.name === "text_hit_ratio")?.passed).toBe(false)
          expect(result.metric.gates.find((gate) => gate.name === "text_hit_ratio")?.note).toContain(
            "missing referenceStrings/renderedText evidence",
          )
          expect(await head(dir)).toBe(primaryBefore)
          await expect(fs.stat(evalDir(dir, task.id, 2, roundSha))).rejects.toThrow()
        },
      })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("cleans up the temporary worktree when evaluation throws", async () => {
    const dir = await makeGitDir()
    try {
      await Instance.provide({
        directory: dir,
        fn: async () => {
          const task = seedTask({ id: uniqueID("task_lkg_isolated_throw") })
          await commitFile(dir, "app.txt", "previous\n", "previous")
          const roundSha = await commitFile(dir, "app.txt", "round\n", "round")

          await expect(
            evaluateLKGInIsolatedWorktree({
              task,
              iteration: 3,
              roundCommitSha: roundSha,
              renderedRefUrl: "/attachment/missing/rendered.png",
              referenceRefUrl: "/attachment/missing/reference.png",
            }),
          ).rejects.toThrow(/rendered attachment/)

          await expect(fs.stat(evalDir(dir, task.id, 3, roundSha))).rejects.toThrow()
          expect(await head(dir)).toBe(roundSha)
        },
      })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

async function makeGitDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "oc-lkg-isolated-"))
  await $`git init`.cwd(dir).quiet()
  await $`git -c user.name=test -c user.email=test@example.com commit --allow-empty -m init`.cwd(dir).quiet()
  return dir
}

async function commitFile(dir: string, file: string, content: string, message: string): Promise<string> {
  await fs.writeFile(path.join(dir, file), content)
  await $`git add ${file}`.cwd(dir).quiet()
  await $`git -c user.name=test -c user.email=test@example.com commit -m ${message}`.cwd(dir).quiet()
  return await head(dir)
}

async function head(dir: string): Promise<string> {
  return (await $`git rev-parse HEAD`.cwd(dir).quiet().text()).trim()
}

function seedTask(input: { id: string }): TaskRow {
  const now = Date.now()
  const row = {
    id: input.id,
    project_id: Instance.project.id,
    source: "test",
    title: input.id,
    request: "test isolated LKG evaluation",
    priority: "normal",
    metadata: null,
    attachments: [],
    system_artifacts: [],
    design_specs: [],
    criteria_results: [],
    time_created: now,
    time_updated: now,
    time_started: now,
  } as TaskRow
  Database.use((db) =>
    db
      .insert(EngineTaskTable)
      .values(row as any)
      .run(),
  )
  return row
}

function withLKG(task: TaskRow, bestCommitSha: string, bestScore: number): TaskRow {
  return {
    ...task,
    metadata: {
      git: {
        acceptance_lkg: {
          best_score: bestScore,
          best_commit_sha: bestCommitSha,
          best_round: 1,
          recorded_at: Date.now(),
        },
      },
    },
  } as TaskRow
}

function evalDir(root: string, taskID: string, iteration: number, roundSha: string): string {
  return path.join(root, ".opencorvus", "acceptance-eval", `${taskID}-${iteration}-${roundSha.slice(0, 12)}`)
}

function pngBuffer(rgba: [number, number, number, number]): Buffer {
  const png = new PNG({ width: 1, height: 1 })
  png.data[0] = rgba[0]
  png.data[1] = rgba[1]
  png.data[2] = rgba[2]
  png.data[3] = rgba[3]
  return PNG.sync.write(png)
}

function uniqueID(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
