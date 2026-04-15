import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { writeIntentBundle } from "@/goal/intent-bundle"

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "intent-bundle-"))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe("writeIntentBundle", () => {
  test("writes request.md verbatim and a README index when no clarifications/notes", async () => {
    await writeIntentBundle({
      worktreeDir: tmpDir,
      taskID: "tsk_1",
      title: "Test Task",
      request: "Line one\nLine two with PRD content\n",
    })

    const requestMd = await fs.readFile(path.join(tmpDir, ".opencorvus", "intent", "request.md"), "utf8")
    expect(requestMd).toContain("# Test Task")
    expect(requestMd).toContain("Line one")
    expect(requestMd).toContain("Line two with PRD content")

    const readmeMd = await fs.readFile(path.join(tmpDir, ".opencorvus", "intent", "README.md"), "utf8")
    expect(readmeMd).toContain("# Intent Bundle")
    expect(readmeMd).toContain("request.md")
    expect(readmeMd).not.toContain("clarifications.md")
    expect(readmeMd).not.toContain("operator-notes.md")

    await expect(fs.access(path.join(tmpDir, ".opencorvus", "intent", "clarifications.md"))).rejects.toThrow()
    await expect(fs.access(path.join(tmpDir, ".opencorvus", "intent", "operator-notes.md"))).rejects.toThrow()
  })

  test("writes clarifications.md and operator-notes.md when provided, strips leading ## header", async () => {
    await writeIntentBundle({
      worktreeDir: tmpDir,
      taskID: "tsk_2",
      title: "Task with clarifications",
      request: "Implement feature X",
      clarifications: "\n\n## Answered Clarifications\n\n- Q: Foo?\n  A: Bar.\n",
      operatorNotes: "\n\n## Operator Notes\n\nUse Bun. Do not use npm.\n",
    })

    const clarMd = await fs.readFile(path.join(tmpDir, ".opencorvus", "intent", "clarifications.md"), "utf8")
    expect(clarMd).not.toContain("## Answered Clarifications")
    expect(clarMd).toContain("Q: Foo?")
    expect(clarMd).toContain("A: Bar.")

    const notesMd = await fs.readFile(path.join(tmpDir, ".opencorvus", "intent", "operator-notes.md"), "utf8")
    expect(notesMd).not.toContain("## Operator Notes")
    expect(notesMd).toContain("Use Bun. Do not use npm.")

    const readmeMd = await fs.readFile(path.join(tmpDir, ".opencorvus", "intent", "README.md"), "utf8")
    expect(readmeMd).toContain("clarifications.md")
    expect(readmeMd).toContain("operator-notes.md")
  })

  test("empty clarifications/notes strings are treated as absent", async () => {
    await writeIntentBundle({
      worktreeDir: tmpDir,
      taskID: "tsk_3",
      title: "Empty-string inputs",
      request: "Request body",
      clarifications: "",
      operatorNotes: "   \n\n   ",
    })

    await expect(fs.access(path.join(tmpDir, ".opencorvus", "intent", "clarifications.md"))).rejects.toThrow()
    await expect(fs.access(path.join(tmpDir, ".opencorvus", "intent", "operator-notes.md"))).rejects.toThrow()
  })

  test("overwrites existing files on repeat call (idempotent with fresh state)", async () => {
    await writeIntentBundle({
      worktreeDir: tmpDir,
      taskID: "tsk_4",
      title: "First title",
      request: "First request body",
    })

    await writeIntentBundle({
      worktreeDir: tmpDir,
      taskID: "tsk_4",
      title: "Updated title",
      request: "Updated request body",
    })

    const requestMd = await fs.readFile(path.join(tmpDir, ".opencorvus", "intent", "request.md"), "utf8")
    expect(requestMd).toContain("# Updated title")
    expect(requestMd).toContain("Updated request body")
    expect(requestMd).not.toContain("First title")
    expect(requestMd).not.toContain("First request body")
  })

  test("propagates write errors instead of swallowing (no fallback on failure)", async () => {
    const badDir = path.join(tmpDir, "blocked-parent")
    await fs.mkdir(badDir)
    await fs.writeFile(path.join(badDir, ".opencorvus"), "blocker")

    await expect(
      writeIntentBundle({
        worktreeDir: badDir,
        taskID: "tsk_err",
        title: "Error case",
        request: "x",
      }),
    ).rejects.toThrow()
  })
})
