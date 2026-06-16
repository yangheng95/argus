import { $ } from "bun"
import { afterEach, expect, mock, spyOn, test } from "bun:test"
import path from "node:path"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Identifier } from "../../src/id/id"
import { ProjectTable } from "../../src/project/project.sql"
import * as Queue from "../../src/engine/queue"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionTable } from "../../src/session/session.sql"
import { AttachmentStore } from "../../src/storage/attachment-store"
import { Database, eq } from "../../src/storage/db"
import { EngineService } from "../../src/task-api"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  mock.restore()
  await resetDatabase()
})

async function seedRootSession(sessionID: string) {
  const messageID = Identifier.ascending("message")
  await Session.persistMessage({
    info: {
      id: messageID,
      sessionID,
      role: "user",
      time: { created: Date.now() - 1_000 },
      agent: "orchestrator",
      model: {
        providerID: "test",
        modelID: "model",
      },
    },
    parts: [
      {
        id: Identifier.ascending("part"),
        messageID,
        sessionID,
        type: "text",
        text: "initial request",
        kind: "user_content",
      },
    ],
    touchSessionID: sessionID,
  })
}

test("operator message rebinds a legacy global task when the directory became a git project", async () => {
  await using tmp = await tmpdir({ config: { model: "test/model" } })
  await using globalStore = await tmpdir()
  let taskID = ""
  let rootSessionID = ""

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect(Instance.project.id).toBe("global")
      Database.use((db) =>
        db.update(ProjectTable).set({ worktree: globalStore.path }).where(eq(ProjectTable.id, "global")).run(),
      )
      const screenshot = await AttachmentStore.write(
        "global",
        Buffer.from("global screenshot bytes"),
        "image/png",
        "reference.png",
      )
      const root = await Session.create({ kind: "root", title: "legacy global task" })
      rootSessionID = root.id
      await seedRootSession(root.id)
      taskID = Identifier.ascending("task")
      const now = Date.now()
      Database.use((db) =>
        db
          .insert(EngineTaskTable)
          .values({
            id: taskID,
            project_id: "global",
            session_id: root.id,
            source: "test",
            title: "legacy global task",
            request: "retry",
            priority: "normal",
            kind: "workflow",
            queue_order: 0,
            system_artifacts: [{ ...screenshot, intent: "visual_reference", source: "url-screenshot" }],
            design_specs: [],
            criteria_results: [],
            time_created: now,
            time_updated: now,
            time_started: now,
          })
          .run(),
      )
    },
  })

  await $`git init`.cwd(tmp.path).quiet()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect(Instance.project.id).not.toBe("global")
      const dispatchTaskLoop = spyOn(Queue, "dispatchTaskLoop").mockResolvedValue(undefined)

      await EngineService.handleTaskMessage(taskID, {
        text: "retry after project init",
        source: "test",
      })

      const task = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
      expect(task?.project_id).toBe(Instance.project.id)
      const root = Database.use((db) =>
        db.select().from(SessionTable).where(eq(SessionTable.id, rootSessionID)).get(),
      )
      expect(root?.project_id).toBe(Instance.project.id)

      const artifacts = task?.system_artifacts ?? []
      expect(artifacts).toHaveLength(1)
      const located = AttachmentStore.nameFromUrl(artifacts[0]!.url)
      expect(located?.projectID).toBe(Instance.project.id)
      await expect(AttachmentStore.read(located!.projectID, located!.name)).resolves.toEqual(
        Buffer.from("global screenshot bytes"),
      )

      const staged = await AttachmentStore.stageToWorktree(
        Instance.project.id,
        artifacts,
        path.join(tmp.path, ".opencorvus-test-worktree"),
      )
      expect(staged).toHaveLength(1)
      expect(dispatchTaskLoop).toHaveBeenCalled()
    },
  })
})
