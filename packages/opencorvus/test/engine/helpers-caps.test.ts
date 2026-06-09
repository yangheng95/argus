import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineTaskTable, EngineInteractionRequestTable } from "../../src/engine/engine.sql"
import { WorkbenchTaskNoteTable } from "../../src/workbench/workbench.sql"
import { operatorNotesSection, clarificationTranscriptSection } from "../../src/engine/helpers"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

let tmp: Awaited<ReturnType<typeof tmpdir>>
let projectID = ""
let taskID = ""

function seedProjectAndTask() {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(ProjectTable)
      .values({
        id: projectID,
        worktree: process.cwd(),
        name: "Helpers Caps Test",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
  Database.use((db) =>
    db
      .insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "helpers caps",
        request: "caps test",
        priority: "normal",
        time_created: now,
        time_updated: now,
        time_started: now,
      })
      .run(),
  )
}

function insertNote(content: string, offsetMs: number) {
  const now = Date.now() + offsetMs
  Database.use((db) =>
    db
      .insert(WorkbenchTaskNoteTable)
      .values({
        id: Identifier.ascending("note"),
        task_id: taskID,
        kind: "operator_note",
        source: "test",
        content,
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
}

function insertAnsweredQuestion(questionText: string, answerText: string, offsetMs: number) {
  const now = Date.now() + offsetMs
  Database.use((db) =>
    db
      .insert(EngineInteractionRequestTable)
      .values({
        id: Identifier.ascending("interaction"),
        task_id: taskID,
        external_id: Identifier.ascending("ext"),
        request_type: "question",
        status: "answered",
        title: "q",
        body: "b",
        payload: { questions: [{ question: questionText }] } as any,
        response: { answers: [answerText] } as any,
        time_resolved: now,
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
}

beforeEach(async () => {
  await resetDatabase()
  tmp = await tmpdir()
  const stamp = Date.now().toString(16)
  projectID = `project_hc_${stamp}`
  taskID = `tsk_${stamp}hc`
  seedProjectAndTask()
})

afterEach(async () => {
  await resetDatabase()
  await tmp?.[Symbol.asyncDispose]?.()
})

describe("operatorNotesSection cap", () => {
  test("keeps short notes unchanged", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        insertNote("short operator message", 0)
        const section = operatorNotesSection(taskID)
        expect(section).toContain("short operator message")
        expect(section).not.toContain("chars omitted")
      },
    })
  })

  test("trims a >1000 char note and surfaces the omission marker", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const longBody = "x".repeat(1500)
        insertNote(longBody, 0)
        const section = operatorNotesSection(taskID)
        // Must contain the head of the content but not the full body
        expect(section).toContain("x".repeat(1000))
        // Sentinel shows the tail chars count
        expect(section).toContain("500 chars omitted")
        // Full body must not leak through
        expect(section).not.toContain("x".repeat(1001))
      },
    })
  })
})

describe("clarificationTranscriptSection cap", () => {
  test("emits full transcript when under entry limit", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        for (let i = 0; i < 5; i++) {
          insertAnsweredQuestion(`q_${i}`, `a_${i}`, i)
        }
        const section = clarificationTranscriptSection(taskID)
        for (let i = 0; i < 5; i++) {
          expect(section).toContain(`q_${i}`)
          expect(section).toContain(`a_${i}`)
        }
        expect(section).not.toContain("older Q&A entries omitted")
      },
    })
  })

  test("keeps latest N entries and reports the number omitted", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Insert 40 Q&A rows — 10 older than the cap should be dropped.
        for (let i = 0; i < 40; i++) {
          insertAnsweredQuestion(`q_${i}`, `a_${i}`, i)
        }
        const section = clarificationTranscriptSection(taskID)
        expect(section).toContain("10 older Q&A entries omitted")
        // Newest 30 (indices 10..39) must be present; oldest 10 (0..9) must not
        for (let i = 10; i < 40; i++) expect(section).toContain(`q_${i}`)
        for (let i = 0; i < 10; i++) {
          expect(section).not.toContain(`- Q: q_${i}\n`)
        }
      },
    })
  })

  test("trims an >800 char single Q or A text", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const longQuestion = "why".repeat(400) // 1200 chars
        insertAnsweredQuestion(longQuestion, "ok", 0)
        const section = clarificationTranscriptSection(taskID)
        expect(section).toContain("chars omitted")
        expect(section).not.toContain(longQuestion)
      },
    })
  })
})
