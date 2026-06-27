import { afterEach, expect, test } from "bun:test"
import { EngineInteractionRequestTable } from "../../src/engine/engine.sql"
import { TaskBoard } from "../../src/engine/model"
import { Identifier } from "../../src/id/id"
import { Server } from "../../src/server/server"
import { Database } from "../../src/storage/db"
import { timelineOrderKey } from "../../src/timeline/order"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { cardTreeStore } from "../../../overlay/src/store/card-tree"
import { setBoardData, setBoardStore } from "../../../overlay/src/store/board"
import { resetWriter } from "../../../overlay/src/services/tree-writer"
import { installRealOverlayI18n } from "../../../overlay/test/fixtures/i18n"

installRealOverlayI18n()

afterEach(async () => {
  resetWriter()
  setBoardStore({
    board: null,
    selectedSource: null,
    snapshotVersion: "",
  })
  await resetDatabase()
})

test("published task board carries canonical task orderKey through overlay projection", async () => {
  await using tmp = await tmpdir({ git: true })
  const app = Server.App()

  const createResponse = await app.request("/task", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-opencorvus-directory": tmp.path,
    },
    body: JSON.stringify({
      request: "Render the task request card without losing the backend order key.",
      source: "test",
      title: "Board order key e2e",
      model: "test-provider/test-model",
      queue: true,
    }),
  })

  expect(createResponse.status).toBe(202)
  const created = (await createResponse.json()) as { task_id: string }
  expect(created.task_id).toMatch(/^tsk_/)

  const interactionID = Identifier.ascending("interaction")
  const interactionCreated = Date.now()
  Database.use((db) =>
    db
      .insert(EngineInteractionRequestTable)
      .values({
        id: interactionID,
        task_id: created.task_id,
        run_id: null,
        external_id: "question-board-orderkey-e2e",
        request_type: "question",
        status: "rejected",
        title: "Replica scope",
        body: "Which scope should be rendered first?",
        payload: {
          questions: [
            {
              header: "Scope",
              question: "Which scope should be rendered first?",
              options: [{ label: "Top dashboard" }],
              multiple: false,
              custom: false,
            },
          ],
        },
        response: {},
        time_resolved: interactionCreated + 1,
        time_created: interactionCreated,
        time_updated: interactionCreated + 1,
      })
      .run(),
  )

  const boardResponse = await app.request(`/task/${created.task_id}/board`, {
    headers: {
      "x-opencorvus-directory": tmp.path,
    },
  })

  expect(boardResponse.status).toBe(200)
  const board = await boardResponse.json()
  expect(() => TaskBoard.parse(board)).not.toThrow()
  expect(board.task.orderKey).toMatch(/^v1:/)
  expect(board.interactions).toHaveLength(1)
  expect(board.interactions[0].orderKey).toBe(
    timelineOrderKey({
      domain: "interaction",
      time: interactionCreated,
      id: interactionID,
    }),
  )

  setBoardStore("selectedSource", { kind: "task", id: created.task_id })
  expect(() => setBoardData(board)).not.toThrow()
  expect(cardTreeStore.cards["ctx:user-request"]?.orderKey).toBe(board.task.orderKey)
  expect(Object.values(cardTreeStore.cards).some((card: any) => card?.orderKey === board.interactions[0].orderKey)).toBe(
    true,
  )
})
