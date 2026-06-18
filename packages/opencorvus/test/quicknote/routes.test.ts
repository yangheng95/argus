import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import * as QuickNoteModule from "../../src/quicknote"
import { QuickNoteTable } from "../../src/quicknote/quicknote.sql"
import { MAX_CONTENT_LENGTH } from "../../src/quicknote/text-processor"
import { Server } from "../../src/server/server"
import { Database, eq } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const QUICKNOTE_README = readFileSync(join(import.meta.dir, "../../src/quicknote/README.md"), "utf8")

function documentedHttpOperations(markdown: string): Array<{ method: string; path: string }> {
  const operations: Array<{ method: string; path: string }> = []
  let inHttpBlock = false
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === "```http") {
      inHttpBlock = true
      continue
    }
    if (trimmed.startsWith("```")) {
      inHttpBlock = false
      continue
    }
    if (!inHttpBlock) continue
    const match = /^(GET|POST|PUT|PATCH|DELETE)\s+(\/api\/\S*)$/.exec(trimmed)
    if (!match) continue
    operations.push({
      method: match[1].toLowerCase(),
      path: match[2].replace(/:([^/]+)/g, "{$1}"),
    })
  }
  return operations
}

function httpRequestBodyExample(markdown: string, marker: string): Record<string, unknown> {
  const blockPattern = /```http\s*([\s\S]*?)```/g
  for (const match of markdown.matchAll(blockPattern)) {
    const block = match[1]
    if (!block.includes(marker)) continue
    const bodyStart = block.indexOf("{")
    expect(bodyStart).toBeGreaterThanOrEqual(0)
    return JSON.parse(block.slice(bodyStart)) as Record<string, unknown>
  }
  throw new Error(`HTTP example not found for ${marker}`)
}

function schemaForRef(spec: any, ref: string): any {
  const name = ref.replace("#/components/schemas/", "")
  return spec.components?.schemas?.[name]
}

function documentedQuickNoteImports(markdown: string): string[] {
  const imports = new Set<string>()
  const pattern = /import\s+\{([\s\S]*?)\}\s+from\s+["']@\/quicknote["']/g
  for (const match of markdown.matchAll(pattern)) {
    for (const item of match[1].split(",")) {
      const name = item.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim()
      if (name) imports.add(name)
    }
  }
  return [...imports].sort()
}

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

  test("QuickNote README HTTP examples match the generated OpenAPI contract", async () => {
    const spec = await Server.openapi()
    const operations = documentedHttpOperations(QUICKNOTE_README)

    expect(operations).toEqual([{ method: "post", path: "/api/v1/notes" }])
    for (const operation of operations) {
      expect(spec.paths?.[operation.path]?.[operation.method]).toBeDefined()
    }

    const createOperation = spec.paths?.["/api/v1/notes"]?.post
    const requestSchemaRef = createOperation?.requestBody?.content?.["application/json"]?.schema?.$ref
    expect(requestSchemaRef).toBe("#/components/schemas/CreateQuickNoteRequest")
    const requestSchema = schemaForRef(spec, requestSchemaRef)
    expect(Object.keys(httpRequestBodyExample(QUICKNOTE_README, "POST /api/v1/notes")).sort()).toEqual(
      Object.keys(requestSchema.properties ?? {}).sort(),
    )
  })

  test("QuickNote README imports only exported module members", () => {
    const exportedNames = new Set(Object.keys(QuickNoteModule))
    const missingNames = documentedQuickNoteImports(QUICKNOTE_README).filter((name) => !exportedNames.has(name))

    expect(missingNames).toEqual([])
  })
})
