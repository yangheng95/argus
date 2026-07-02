import { describe, expect, test } from "bun:test"
import {
  BuildResultSchema,
  BuildTarget,
  formatBuildResultSchemaError,
  validateBuildIntegrityRepairReport,
} from "../../src/build/types"

// Most fixtures register fact_check_items: [] explicitly so assertions stay
// close to the terminal payload shape workers are encouraged to emit.
const FCI: { fact_check_items: [] } = { fact_check_items: [] }

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
      tests: [{ name: "bun test src/note-store.test.ts", passed: true, detail: "5 pass" }],
      contract_restatement:
        "Handled the NoteStore goal: create, list, toggle, and remove notes per the acceptance specs; no UI changes were in scope.",
      followup_workload_guidance:
        "Follow-up agents should inspect persistence and concurrency requirements before estimating more NoteStore work.",
      ...FCI,
    }
    const parsed = BuildResultSchema.safeParse(payload)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.contract_restatement).toContain("NoteStore goal")
      expect(parsed.data.followup_workload_guidance).toContain("Follow-up agents")
    }
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
      tests: [{ name: "bun test src/note-store.test.ts", passed: false, detail: "1 fail, 4 pass" }],
      ...FCI,
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
      ...FCI,
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.tests).toEqual([])
  })

  test("rejects passed result with failed top-level test evidence", () => {
    const parsed = BuildResultSchema.safeParse({
      status: "passed",
      summary: "Claimed the visual repair passed despite a failed checker.",
      files_changed: [{ path: "src/App.tsx", summary: "Changed page", reason: "Repair visual checker" }],
      tests: [
        { name: "browser_preview_reference_regions map-surfaces-world-trends", passed: false, detail: "passed=false" },
      ],
      ...FCI,
    })

    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(formatBuildResultSchemaError(parsed.error)).toContain("passed build result cannot contain failed tests")
    }
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

  test("explains passed plus error as a mutually exclusive terminal shape", () => {
    const parsed = BuildResultSchema.safeParse({
      status: "passed",
      summary: "functional tests passed but preview screenshot still has blocking visual debt",
      files_changed: [
        {
          path: "preview-evidence/screenshot-review.json",
          summary: "Recorded preview screenshot review",
          reason: "Visual evidence",
        },
      ],
      error: "Preview screenshot review still has blocking visual debt",
    })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      const message = formatBuildResultSchemaError(parsed.error)
      expect(message).toContain("status='passed' cannot include error")
      expect(message).toContain("status='failed'")
    }
  })

  test("defaults missing fact_check_items to empty array", () => {
    const parsed = BuildResultSchema.safeParse({
      status: "passed",
      summary: "implemented",
      files_changed: [],
      tests: [],
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.fact_check_items).toEqual([])
  })

  test("accepts passed result with empty files_changed (B1: 0-edit reuse legal)", () => {
    // CLAUDE.md rule 6/13: the host doesn't enforce a minimum on
    // files_changed. The build agent may legitimately publish a prior
    // attempt's worktree without further edits; the orchestrator LLM
    // cross-checks against the host's actual_changed_files ground truth
    // (RunOutput.actualChangedFiles) and decides if the empty self-report
    // is honest.
    const parsed = BuildResultSchema.safeParse({
      status: "passed",
      summary: "Reused prior attempt's worktree without further edits",
      files_changed: [],
      ...FCI,
    })
    expect(parsed.success).toBe(true)
  })

  test("accepts passed no-change implementation result with empty files_changed", () => {
    const parsed = BuildResultSchema.safeParse({
      status: "passed",
      summary: "Verified the requested behavior was already implemented; no project files changed",
      files_changed: [],
      tests: [],
      ...FCI,
    })
    expect(parsed.success).toBe(true)
  })

  test("accepts integrity repair report with repaired and unrepaired findings", () => {
    const parsed = BuildResultSchema.safeParse({
      status: "failed",
      summary: "Fixed one integrity blocker; another still needs a design decision.",
      files_changed: [
        {
          path: "src/settings.ts",
          summary: "Validated persisted settings on load.",
          reason: "Repairs integrity finding F-settings.",
        },
      ],
      tests: [{ name: "bun test src/settings.test.ts", passed: true }],
      ...FCI,
      repair_report: {
        repaired_findings: [
          {
            finding_id: "F-settings",
            fingerprint: "if_1234567890abcdef",
            changed_files: ["src/settings.ts"],
            verification_commands: [{ command: "bun test src/settings.test.ts", passed: true, detail: "3 pass" }],
          },
        ],
        unrepaired_findings: [
          {
            finding_id: "F-theme",
            fingerprint: "if_fedcba0987654321",
            reason: "Theme token decision is missing from requirements.",
          },
        ],
        unrelated_changes: [],
      },
      error: "F-theme remains unrepaired.",
    })
    expect(parsed.success).toBe(true)
  })

  test("rejects repaired findings without changed files or verification", () => {
    const parsed = BuildResultSchema.safeParse({
      status: "passed",
      summary: "claimed repair",
      files_changed: [],
      repair_report: {
        repaired_findings: [
          {
            finding_id: "F-settings",
            fingerprint: "if_1234567890abcdef",
            changed_files: [],
            verification_commands: [],
          },
        ],
      },
    })
    expect(parsed.success).toBe(false)
  })

  test("rejects passed repair report with unrepaired findings or failed verification", () => {
    const unrepaired = BuildResultSchema.safeParse({
      status: "passed",
      summary: "claimed repair",
      files_changed: [],
      repair_report: {
        repaired_findings: [],
        unrepaired_findings: [{ finding_id: "F-settings", fingerprint: "if_1234567890abcdef", reason: "not fixed" }],
      },
    })
    expect(unrepaired.success).toBe(false)

    const failedVerification = BuildResultSchema.safeParse({
      status: "passed",
      summary: "claimed repair",
      files_changed: [{ path: "src/settings.ts", summary: "Changed settings", reason: "Repair F-settings" }],
      repair_report: {
        repaired_findings: [
          {
            finding_id: "F-settings",
            fingerprint: "if_1234567890abcdef",
            changed_files: ["src/settings.ts"],
            verification_commands: [{ command: "bun test src/settings.test.ts", passed: false }],
          },
        ],
      },
    })
    expect(failedVerification.success).toBe(false)
  })

  test("rejects duplicate repair report fingerprints across repaired and unrepaired arrays", () => {
    const parsed = BuildResultSchema.safeParse({
      status: "failed",
      summary: "conflicting repair report",
      files_changed: [],
      error: "conflicting repair report",
      repair_report: {
        repaired_findings: [
          {
            finding_id: "F-settings",
            fingerprint: "if_1234567890abcdef",
            changed_files: ["src/settings.ts"],
            verification_commands: [{ command: "bun test src/settings.test.ts", passed: true }],
          },
        ],
        unrepaired_findings: [
          { finding_id: "F-settings", fingerprint: "if_1234567890abcdef", reason: "also claimed unrepaired" },
        ],
      },
    })
    expect(parsed.success).toBe(false)
  })

  test("validates required integrity fingerprints against build repair report", () => {
    const passed = BuildResultSchema.parse({
      status: "passed",
      summary: "fixed",
      files_changed: [{ path: "src/settings.ts", summary: "Changed settings", reason: "Repair F-settings" }],
      repair_report: {
        repaired_findings: [
          {
            finding_id: "F-settings",
            fingerprint: "if_1234567890abcdef",
            changed_files: ["src/settings.ts"],
            verification_commands: [{ command: "bun test src/settings.test.ts", passed: true }],
          },
        ],
      },
      ...FCI,
    })
    expect(validateBuildIntegrityRepairReport(passed, ["if_1234567890abcdef"])).toBeUndefined()
    expect(validateBuildIntegrityRepairReport(passed, ["if_1234567890abcdef", "if_fedcba0987654321"])).toContain(
      "missing required fingerprints",
    )
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
      expect(parsed.data.requirement_ids).toEqual([])
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
