import { describe, test, expect, beforeEach } from "bun:test"
import { extractTitle, validateContent } from "../../src/quicknote/text-processor"
import { createNote, listNotes, getNote, deleteNote, deleteProjectNotes } from "../../src/quicknote/service"
import { Database, eq } from "@/storage/db"
import { QuickNoteTable } from "../../src/quicknote/quicknote.sql"

describe("quicknote.service", () => {
  // 在每个测试前清空数据库
  beforeEach(() => {
    Database.use((db) => {
      db.delete(QuickNoteTable).run()
    })
  })

  describe("extractTitle", () => {
    test("extracts first 15 characters as title", () => {
      const content = "这是一个测试笔记内容，用于验证标题提取功能"
      const title = extractTitle(content)
      expect(title.length).toBe(15)
      expect(title).toBe(content.slice(0, 15))
    })

    test("handles content shorter than 15 characters", () => {
      const content = "短内容"
      const title = extractTitle(content)
      expect(title).toBe("短内容")
    })

    test("returns empty string for empty content", () => {
      expect(extractTitle("")).toBe("")
    })
  })

  describe("validateContent", () => {
    test("validates content within limits", () => {
      const content = "有效的测试内容"
      expect(validateContent(content)).toBe(true)
    })

    test("accepts empty content", () => {
      expect(validateContent("")).toBe(true)
    })

    test("rejects content over 2000 characters", () => {
      const content = "A".repeat(2001)
      expect(validateContent(content)).toBe(false)
    })

    test("accepts content exactly at 2000 characters", () => {
      const content = "A".repeat(2000)
      expect(validateContent(content)).toBe(true)
    })
  })

  describe("createNote", () => {
    test("creates a note successfully", () => {
      const content = "这是一个测试笔记"
      const result = createNote({ content })

      expect(result.note_id).toBeDefined()
      expect(result.note_id).toMatch(/^nte_/)
      expect(result.summary).toBe("这是一个测试笔记")
    })

    test("extracts first 15 characters as summary", () => {
      const content = "这是一个很长的测试笔记内容，用于验证摘要提取功能是否正常"
      const result = createNote({ content })

      expect(result.summary.length).toBe(15)
      expect(result.summary).toBe(content.slice(0, 15))
    })

    test("throws error for content over 2000 characters", () => {
      const content = "A".repeat(2001)

      expect(() => createNote({ content })).toThrow("内容长度不能超过 2000 字符")
    })

    test("creates note with empty content", () => {
      const content = ""
      const result = createNote({ content })

      expect(result.note_id).toBeDefined()
      expect(result.summary).toBe("")
    })
  })

  describe("listNotes", () => {
    test("returns empty array when no notes exist", () => {
      const notes = listNotes()
      expect(notes).toEqual([])
    })

    test("returns all notes", () => {
      const note1 = createNote({ content: "笔记 1" })
      const note2 = createNote({ content: "笔记 2" })

      const notes = listNotes()

      expect(notes.length).toBe(2)
      expect(notes.map((n) => n.note_id)).toContain(note1.note_id)
      expect(notes.map((n) => n.note_id)).toContain(note2.note_id)
    })

    test("returns notes ordered by created_at descending", () => {
      const note1 = createNote({ content: "笔记 1" })
      // 稍微等待以确保时间戳不同
      const start = Date.now()
      while (Date.now() === start) {
        // 等待
      }
      const note2 = createNote({ content: "笔记 2" })

      const notes = listNotes()

      expect(notes.length).toBe(2)
      expect(notes[0].note_id).toBe(note2.note_id)
      expect(notes[1].note_id).toBe(note1.note_id)
    })
  })

  describe("getNote", () => {
    test("returns undefined for non-existent note", () => {
      const note = getNote("nte_nonexistent")
      expect(note).toBeUndefined()
    })

    test("returns note by id", () => {
      const created = createNote({ content: "测试笔记内容" })
      const note = getNote(created.note_id)

      expect(note).toBeDefined()
      expect(note?.note_id).toBe(created.note_id)
      expect(note?.content).toBe("测试笔记内容")
      expect(note?.summary).toBe("测试笔记内容")
    })

    test("returns note with all fields", () => {
      const created = createNote({ content: "完整字段测试" })
      const note = getNote(created.note_id)

      expect(note).toBeDefined()
      expect(note?.note_id).toBeDefined()
      expect(note?.content).toBe("完整字段测试")
      expect(note?.summary).toBe("完整字段测试")
      expect(note?.tags).toBe("[]")
      expect(note?.status).toBe("draft")
      expect(note?.created_at).toBeDefined()
      expect(note?.updated_at).toBeDefined()
    })
  })

  describe("deleteNote", () => {
    test("returns false for non-existent note", () => {
      const result = deleteNote("nte_nonexistent")
      expect(result).toBe(false)
    })

    test("deletes note successfully", () => {
      const created = createNote({ content: "待删除的笔记" })

      const deleteResult = deleteNote(created.note_id)
      expect(deleteResult).toBe(true)

      // 验证笔记已被删除
      const note = getNote(created.note_id)
      expect(note).toBeUndefined()
    })

    test("deletes note and removes from list", () => {
      const note1 = createNote({ content: "笔记 1" })
      createNote({ content: "笔记 2" })

      deleteNote(note1.note_id)

      const notes = listNotes()
      expect(notes.length).toBe(1)
      expect(notes[0].note_id).not.toBe(note1.note_id)
    })
  })

  describe("deleteProjectNotes", () => {
    test("deletes only notes attached to the selected project", () => {
      const now = Date.now()
      Database.use((db) => {
        db.insert(QuickNoteTable)
          .values([
            {
              id: "nte_project_a",
              project_id: "project_a",
              content: "project A note",
              summary: "project A note",
              tags: "[]",
              status: "draft",
              time_created: now,
              time_updated: now,
            },
            {
              id: "nte_project_b",
              project_id: "project_b",
              content: "project B note",
              summary: "project B note",
              tags: "[]",
              status: "draft",
              time_created: now,
              time_updated: now,
            },
          ])
          .run()
      })

      deleteProjectNotes({ projectID: "project_a" })

      expect(Database.use((db) => db.select().from(QuickNoteTable).where(eq(QuickNoteTable.id, "nte_project_a")).all()))
        .toHaveLength(0)
      expect(Database.use((db) => db.select().from(QuickNoteTable).where(eq(QuickNoteTable.id, "nte_project_b")).all()))
        .toHaveLength(1)
    })
  })
})
