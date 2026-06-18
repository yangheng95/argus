import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { QuickNoteTable } from "../../src/quicknote/quicknote.sql"
import { MAX_CONTENT_LENGTH } from "../../src/quicknote/text-processor"
import { Server } from "../../src/server/server"
import { Database, eq } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("quicknote routes", () => {
  beforeEach(async () => {
    Server.resetProjectRoutesAppForTest()
    await resetDatabase()
  })

  afterEach(async () => {
    Server.resetProjectRoutesAppForTest()
    await resetDatabase()
  })

  test("POST /api/v1/notes is mounted through Server.App and documented", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.App()

    const response = await app.request("/api/v1/notes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-opencorvus-directory": tmp.path,
      },
      body: JSON.stringify({ content: "QuickNote route smoke" }),
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      code: number
      data: { note_id: string; summary: string }
    }
    expect(body.code).toBe(200)
    expect(body.data.note_id).toMatch(/^nte_/)
    expect(body.data.summary).toBe("QuickNote route")

    const row = Database.use((db) =>
      db.select().from(QuickNoteTable).where(eq(QuickNoteTable.id, body.data.note_id)).get(),
    )
    expect(row?.content).toBe("QuickNote route smoke")

    const spec = await Server.openapi()
    const operation = spec.paths?.["/api/v1/notes"]?.post
    expect(operation?.operationId).toBe("quicknote.create")
    expect(operation?.requestBody?.content?.["application/json"]?.schema).toEqual({
      $ref: "#/components/schemas/CreateQuickNoteRequest",
    })
    expect(operation?.parameters?.some((parameter: { name?: string }) => parameter.name === "directory")).toBe(true)
  })

  test("POST /api/v1/notes rejects invalid content", async () => {
    await using tmp = await tmpdir({ git: true })
    const invalidContent = "x".repeat(MAX_CONTENT_LENGTH + 1)
    const response = await Server.App().request("/api/v1/notes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-opencorvus-directory": tmp.path,
      },
      body: JSON.stringify({ content: invalidContent }),
    })

    expect(response.status).toBe(400)
    const rows = Database.use((db) =>
      db.select().from(QuickNoteTable).where(eq(QuickNoteTable.content, invalidContent)).all(),
    )
    expect(rows).toEqual([])
  })
})
