import { describe, expect, test } from "bun:test"
import { OrchestratorEventNote } from "../../src/orchestrator/agent"

describe("orchestrator event notes", () => {
  test("failed batch note distinguishes diagnostic worktrees from primary workspace pollution", () => {
    const note = OrchestratorEventNote.batchComplete({
      runID: "run_report_hint",
      passed: 0,
      failed: 1,
      total: 1,
    })

    expect(note).toContain("Failed goal worktrees are diagnostic evidence")
    expect(note).toContain(".opencorvus/worktrees")
    expect(note).toContain("not primary workspace pollution")
    expect(note).toContain("Do not restart_from_stage solely because")
    expect(note).toContain("query_failed_goals")
  })
})
