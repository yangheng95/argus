import { describe, expect, test } from "bun:test"
import { BuildResultSchema, BuildTarget } from "../../src/build/types"

describe("BuildResultSchema", () => {
  test("accepts a passed result with commit ref and test evidence", () => {
    const payload = {
      status: "passed",
      summary: "Implemented NoteStore with create/list/toggle/remove",
      files_changed: [
        {
          path: "src/note-store.ts",
          summary: "Added NoteStore create/list/toggle/remove logic.",
          reason: "Core implementation file for the requested store behavior.",
        },
        {
          path: "src/note-store.test.ts",
          summary: "Added regression tests for NoteStore behavior.",
          reason: "Acceptance evidence for the store contract.",
        },
      ],
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
      files_changed: [
        {
          path: "src/note-store.ts",
          summary: "Partially changed toggle logic before verification failed.",
          reason: "The failing acceptance spec required changing toggle behavior.",
        },
      ],
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
      files_changed: [{ path: "src/a.ts", summary: "Changed a", reason: "Required for test" }],
    })
    expect(parsed.success).toBe(false)
  })

  test("rejects non-enum status", () => {
    const parsed = BuildResultSchema.safeParse({
      status: "accepted",
      summary: "ok",
      files_changed: [{ path: "src/a.ts", summary: "Changed a", reason: "Required for test" }],
    })
    expect(parsed.success).toBe(false)
  })

  test("tests array defaults to empty when missing", () => {
    const parsed = BuildResultSchema.safeParse({
      status: "passed",
      summary: "no-op run",
      files_changed: [{ path: "src/a.ts", summary: "Changed a", reason: "Required for test" }],
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.tests).toEqual([])
  })

  test("requires a concrete error for failed results", () => {
    const missing = BuildResultSchema.safeParse({
      status: "failed",
      summary: "verification failed",
    })
    expect(missing.success).toBe(false)

    const empty = BuildResultSchema.safeParse({
      status: "failed",
      summary: "verification failed",
      error: "   ",
    })
    expect(empty.success).toBe(false)
  })

  test("rejects error on passed results", () => {
    const parsed = BuildResultSchema.safeParse({
      status: "passed",
      summary: "implemented",
      files_changed: [{ path: "src/a.ts", summary: "Changed a", reason: "Required for test" }],
      error: "should not exist on passed branch",
    })
    expect(parsed.success).toBe(false)
  })

  test("passed with empty files_changed[] requires reused_prior_attempt.rationale", () => {
    // Default closure for passed: must explain at least one file OR mark
    // reused_prior_attempt. Both empty → schema reject so the LLM cannot
    // silently report success without evidence of work.
    const parsed = BuildResultSchema.safeParse({
      status: "passed",
      summary: "claimed success without file-level explanation",
      files_changed: [],
    })
    expect(parsed.success).toBe(false)
  })

  test("accepts a passed result with empty files_changed[] when reused_prior_attempt.rationale is set", () => {
    // architecture_review_rework retry path: prior attempt's worktree already
    // satisfies every acceptance_spec; LLM publishes via merge_back without
    // further edits. Schema must allow this honest reporting (Fix 4).
    const parsed = BuildResultSchema.safeParse({
      status: "passed",
      summary: "Reused V1 worktree; integrity advisory feedback addressed by orchestrator",
      files_changed: [],
      reused_prior_attempt: {
        rationale:
          "V1 wrote vite.config.ts, src/main.tsx, package.json which already cover acc-bootstrap-build; " +
          "the integrity finding was a task-level architectural concern that this goal cannot repair at the goal layer.",
      },
      tests: [{ name: "bun run build", passed: true }],
    })
    expect(parsed.success).toBe(true)
  })

  test("rejects reused_prior_attempt.rationale shorter than 20 chars", () => {
    // Guard against the LLM stamping a meaningless rationale to escape the
    // empty-files_changed check. The minimum length forces the LLM to cite
    // concrete spec coverage.
    const parsed = BuildResultSchema.safeParse({
      status: "passed",
      summary: "reused",
      files_changed: [],
      reused_prior_attempt: { rationale: "ok" },
    })
    expect(parsed.success).toBe(false)
  })

  test("passed with files_changed[] does not require reused_prior_attempt", () => {
    // Default success path stays unchanged: explain each changed file, no
    // reuse marker needed.
    const parsed = BuildResultSchema.safeParse({
      status: "passed",
      summary: "ok",
      files_changed: [{ path: "src/a.ts", summary: "Changed a", reason: "Required for acceptance" }],
    })
    expect(parsed.success).toBe(true)
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
