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
    expect(note).toContain("route stuck-state repair inside this task")
    expect(note).not.toContain("report the failed goal blockers and wait")
  })

  test("dependency-blocked batch note requires same-task repair instead of passive wait", () => {
    const note = OrchestratorEventNote.batchComplete({
      runID: "run_dep_blocked",
      passed: 1,
      failed: 1,
      total: 3,
      depBlocked: [
        {
          goalTitle: "Verification",
          blockedBy: [{ title: "Shared shell", status: "failed" }],
        },
      ],
    })

    expect(note).toContain("resolve the blocking goals")
    expect(note).toContain("route the concrete root cause")
    expect(note).toContain("assistant.auto_iteration=false disables host-side queued loops")
    expect(note).not.toContain("report blockers and wait")
  })
})
