import { describe, expect, test } from "bun:test"
import {
  BuildResultSchema,
  BuildTarget,
  formatBuildResultSchemaError,
  validateBuildIntegrityRepairReport,
} from "../../src/build/types"

// All BuildResult fixtures registered fact_check_items: []
// (specs/fact-check-agent-2026-05-25.md §3.1: required field on every
// terminal report). Empty array is the honest default for tests where
// no factual claims are being asserted.
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
      tests: [
        { name: "bun test src/note-store.test.ts", passed: true, detail: "5 pass" },
      ],
      ...FCI,
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
      summary: "functional tests passed but visual score is below threshold",
      files_changed: [{ path: "mirror/eval-result.json", summary: "Recorded visual score", reason: "Visual evidence" }],
      error: "Visual score 84/100 is below the 85 threshold",
    })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      const message = formatBuildResultSchemaError(parsed.error)
      expect(message).toContain("status='passed' cannot include error")
      expect(message).toContain("status='failed'")
    }
  })

  test("accepts passed result with empty files_changed (B1: 0-edit reuse legal)", () => {
    // CLAUDE.md rule 6/13: the host doesn't enforce a minimum on
    // files_changed. The build agent may legitimately publish a prior
    // attempt's worktree without further edits; the orchestrator LLM
    // cross-checks against the host's actual_changed_files ground truth
    // (RunOutput.actualChangedFiles) and decides if the empty self-report
    // is honest. Spec architecture-rework-loosening-plan-2026-05-06.md (B1).
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
            verification_commands: [
              { command: "bun test src/settings.test.ts", passed: true, detail: "3 pass" },
            ],
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
      files_changed: [
        { path: "src/settings.ts", summary: "Changed settings", reason: "Repair F-settings" },
      ],
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
      files_changed: [
        { path: "src/settings.ts", summary: "Changed settings", reason: "Repair F-settings" },
      ],
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
