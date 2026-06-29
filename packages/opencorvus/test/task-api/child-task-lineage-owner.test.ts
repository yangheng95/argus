import { afterEach, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { Database, eq } from "../../src/storage/db"
import { EngineService, ExternalChildTaskLineageError } from "../../src/task-api"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const REPO_ROOT = path.join(import.meta.dir, "..", "..", "..", "..")
const SRC_ROOT = path.join(REPO_ROOT, "packages/opencorvus/src")

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return listSourceFiles(full)
    if (!entry.isFile()) return []
    if (!full.endsWith(".ts") && !full.endsWith(".tsx")) return []
    if (!statSync(full).isFile()) return []
    return [full]
  })
}

describe("scheduler-owned child task lineage", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("public createTask rejects caller-supplied parent_task_id", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(
          EngineService.createTask({
            title: "Forged child task",
            request: "Try to create a child task outside the scheduler.",
            queue: true,
            metadata: { parent_task_id: "tsk_parent" },
          }),
        ).rejects.toBeInstanceOf(ExternalChildTaskLineageError)

        const tasks = Database.use((db) => db.select().from(EngineTaskTable).all())
        expect(tasks).toHaveLength(0)
      },
    })
  })

  test("scheduler child task creation writes parent_task_id internally", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await EngineService.createSchedulerChildTask({
          parentTaskID: "tsk_parent",
          title: "Scheduler child task",
          request: "Investigate packages/app/src/components/GeneratedCard.tsx because labels wrap incorrectly.",
          queue: true,
          metadata: {
            origin: "orchestrator_proposed_task",
            inheritance: "orchestrator_follow_up",
            proposal_reason: "GeneratedCard label wrapping is a separate module problem.",
          },
        })

        const task = Database.use((db) =>
          db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get(),
        )
        expect(task?.source).toBe("orchestrator:propose_task")
        expect(task?.metadata).toMatchObject({
          origin: "orchestrator_proposed_task",
          inheritance: "orchestrator_follow_up",
          parent_task_id: "tsk_parent",
        })
      },
    })
  })

  test("scheduler child task creation API is only called by orchestrator tools", () => {
    const usages = listSourceFiles(SRC_ROOT)
      .filter((file) => /\bcreateSchedulerChildTask\s*\(/.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(REPO_ROOT, file).replaceAll("\\", "/"))
      .sort()

    expect(usages).toEqual([
      "packages/opencorvus/src/orchestrator/tools.ts",
      "packages/opencorvus/src/task-api/index.ts",
    ])
  })
})
