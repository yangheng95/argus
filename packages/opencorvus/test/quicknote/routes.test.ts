import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { QuickNoteRoutes } from "../../src/server/routes/quicknote"
import { Instance } from "../../src/project/instance"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("quicknote.routes", () => {
  let app: Hono

  beforeEach(async () => {
    await resetDatabase()
    const tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        app = new Hono().route("/", QuickNoteRoutes())
      },
    })
  })

  afterEach(async () => {
    await resetDatabase()
    await Instance.disposeAll()
  })

  test("POST /notes creates a note", async () => {
    const response = await app.request("/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "API 测试笔记",
        tags: ["api", "test"],
      }),
    })

    if (response.status !== 200) {
      console.log("Error response:", await response.text())
    }
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.note_id).toBeDefined()
    expect(data.note_id).toMatch(/^nte_/)
    expect(data.summary).toBe("API 测试笔记")
  })

  test("POST /notes rejects empty content", async () => {
    const response = await app.request("/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "" }),
    })

    expect(response.status).toBe(400)
  })

  test("POST /notes rejects content over 2000 characters", async () => {
    const response = await app.request("/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "A".repeat(2001) }),
    })

    expect(response.status).toBe(400)
  })

  test("POST /notes works with minimal parameters", async () => {
    const response = await app.request("/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "最小参数测试" }),
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.note_id).toBeDefined()
    expect(data.summary).toBe("最小参数测试")
  })

  test("GET /notes/:id retrieves a note", async () => {
    // First create a note
    const createResponse = await app.request("/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "获取测试笔记",
        tags: ["test"],
      }),
    })
    const created = await createResponse.json()

    // Then retrieve it
    const getResponse = await app.request(`/notes/${created.note_id}`)
    expect(getResponse.status).toBe(200)
    const data = await getResponse.json()
    expect(data.note_id).toBe(created.note_id)
    expect(data.content).toBe("获取测试笔记")
    expect(data.tags).toBe("[]")
    expect(data.status).toBe("draft")
  })

  test("GET /notes/:id returns 404 for non-existent note", async () => {
    const response = await app.request("/notes/nte_nonexistent")
    expect(response.status).toBe(404)
  })

  test("POST /notes with user_id stores user association", async () => {
    const response = await app.request("/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "用户关联测试",
        user_id: "test-user-123",
      }),
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.note_id).toBeDefined()
  })
})
