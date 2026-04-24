import { describe, expect, test } from "bun:test"
import { BuildResultSchema, BuildTarget } from "../../src/build-agent/types"

describe("BuildResultSchema", () => {
  test("accepts a passed result with commit ref and test evidence", () => {
    const payload = {
      status: "passed",
      summary: "Implemented NoteStore with create/list/toggle/remove",
      patch_summary: "- Added src/note-store.ts\n- Added src/note-store.test.ts",
      commit_ref: "abc1234",
      tests: [
        { name: "bun test src/note-store.test.ts", passed: true, detail: "5 pass" },
      ],
    }
    const parsed = BuildResultSchema.safeParse(payload)
    expect(parsed.success).toBe(true)
  })

  test("accepts a failed result with error but no commit_ref", () => {
    const payload = {
      status: "failed",
      summary: "Build failed — acceptance_spec 'every toggle flips done' not met",
      patch_summary: "- Partial src/note-store.ts (no tests yet)",
      error: "toggle returned old done value for first call; root cause not identified",
      tests: [
        { name: "bun test src/note-store.test.ts", passed: false, detail: "1 fail, 4 pass" },
      ],
    }
    const parsed = BuildResultSchema.safeParse(payload)
    expect(parsed.success).toBe(true)
  })

  test("rejects empty summary", () => {
    const parsed = BuildResultSchema.safeParse({
      status: "passed",
      summary: "",
      patch_summary: "",
    })
    expect(parsed.success).toBe(false)
  })

  test("rejects non-enum status", () => {
    const parsed = BuildResultSchema.safeParse({
      status: "accepted",
      summary: "ok",
      patch_summary: "",
    })
    expect(parsed.success).toBe(false)
  })

  test("tests array defaults to empty when missing", () => {
    const parsed = BuildResultSchema.safeParse({
      status: "passed",
      summary: "no-op run",
      patch_summary: "",
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.tests).toEqual([])
  })
})

describe("BuildTarget discriminated union", () => {
  test("accepts a request shape", () => {
    const parsed = BuildTarget.safeParse({ kind: "request", text: "fix typo" })
    expect(parsed.success).toBe(true)
  })

  test("accepts a goal shape with default arrays", () => {
    const parsed = BuildTarget.safeParse({
      kind: "goal",
      id: "gol_abc",
      title: "Add NoteStore",
      objective: "Implement NoteStore with toggle / remove",
    })
    expect(parsed.success).toBe(true)
    if (parsed.success && parsed.data.kind === "goal") {
      expect(parsed.data.acceptance_specs).toEqual([])
      expect(parsed.data.owned_paths).toEqual([])
      expect(parsed.data.depends_on).toEqual([])
    }
  })

  test("rejects unknown kind", () => {
    const parsed = BuildTarget.safeParse({ kind: "mystery", text: "?" })
    expect(parsed.success).toBe(false)
  })

  test("rejects goal without id", () => {
    const parsed = BuildTarget.safeParse({
      kind: "goal",
      title: "X",
      objective: "Y",
    })
    expect(parsed.success).toBe(false)
  })
})
