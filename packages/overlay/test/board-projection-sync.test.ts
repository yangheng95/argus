import { afterEach, expect, test } from "bun:test"
import { boardStore, setBoardStore, setBoardData, setSnapshotVersion } from "../src/store/board"
import { cardTreeStore } from "../src/store/card-tree"
import { resetWriter } from "../src/services/tree-writer"
import { boardSnapshot } from "../src/services/sync"

const TASK_ID = "tsk_board_projection"
// audit-2026-04-29 W2-V25 — test was authored against the per-
// attempt step card format `step:<goal>:<run>:<stepID>`. That
// format was reverted on 2026-04-26 (see goalStepCardID in
// tree-writer.ts: "Removing runID from the card id keeps both
// observers pointed at the same card and merges retry attempts
// into one rolling timeline"). The test was never updated, so
// it looked up an ID the production code never produces and
// silently failed across the suite.
const STEP_ID = "step:goal_projection:build"
const PHASE_ID = `${STEP_ID}:phase:plan`

function boardWith(status: "running" | "failed") {
  return {
    snapshotVersion: `board-revision-${status}`,
    task: {
      id: TASK_ID,
      status: "active",
      request: "sync projected cards",
      sessionID: "ses_root",
      time: { created: 1_776_000_100_000 },
      attachments: [],
    },
    workflow: {
      steps: [
        {
          id: "build",
          phases: [{ id: "plan", label: "Plan", sessionKind: "planner" }],
        },
      ],
    },
    goalWorkflows: [
      {
        goalID: "goal_projection",
        goalRunID: "gr_projection",
        goalTitle: "Projection",
        goalStatus: status === "failed" ? "failed" : "running",
        orderIndex: 0,
        retryCount: 0,
        steps: [
          {
            stepID: "build",
            label: "Executor",
            status,
            startedAt: 1_776_000_100_100,
            ...(status === "failed" ? { completedAt: 1_776_000_100_300 } : {}),
            phases: {
              plan: {
                status: status === "failed" ? "completed" : "running",
                startedAt: 1_776_000_100_200,
                ...(status === "failed" ? { completedAt: 1_776_000_100_300 } : {}),
              },
            },
          },
        ],
      },
    ],
    interactions: [],
  }
}

afterEach(() => {
  resetWriter()
  setBoardStore({
    board: null,
    selectedSource: null,
    snapshotVersion: "",
  })
})

test("setBoardData reprojects step and phase cards immediately", () => {
  resetWriter()
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })

  setBoardData(boardWith("running"))
  expect(boardStore.snapshotVersion).toBe("board-revision-running")
  expect(boardStore.board?.snapshotVersion).toBe("board-revision-running")
  expect(cardTreeStore.cards[STEP_ID]?.status).toBe("running")
  expect(cardTreeStore.cards[PHASE_ID]?.status).toBe("running")

  setBoardData(boardWith("failed"))
  expect(boardStore.snapshotVersion).toBe("board-revision-failed")
  expect(boardStore.board?.snapshotVersion).toBe("board-revision-failed")
  expect(cardTreeStore.cards[STEP_ID]?.status).toBe("error")
  expect(cardTreeStore.cards[PHASE_ID]?.status).toBe("completed")
})

test("setBoardData rejects full board payloads without a non-empty snapshotVersion", () => {
  const missingVersion = { ...boardWith("running") }
  delete (missingVersion as any).snapshotVersion

  expect(() => setBoardData(missingVersion)).toThrow(/snapshotVersion/)
  expect(() => setBoardData({ ...boardWith("running"), snapshotVersion: "" })).toThrow(/snapshotVersion/)
  expect(() => setBoardData(null)).toThrow(/board payload must be object/)
  expect(boardStore.board).toBeNull()
  expect(boardStore.snapshotVersion).toBe("")
})

test("snapshotVersion store field cannot diverge from the loaded board", () => {
  setBoardData(boardWith("running"))

  expect(boardStore.snapshotVersion).toBe(boardStore.board?.snapshotVersion)
  expect(() => setSnapshotVersion("board-revision-other")).toThrow(/must match/)
  expect(boardStore.snapshotVersion).toBe("board-revision-running")
  expect(boardStore.board?.snapshotVersion).toBe("board-revision-running")
})

test("boardSnapshot rejects revisionless board payloads", () => {
  expect(boardSnapshot(boardWith("running"))).toBe("board-revision-running")
  expect(() => boardSnapshot({ ...boardWith("running"), snapshotVersion: "" })).toThrow(/snapshotVersion/)
  expect(() => boardSnapshot({ task: { id: TASK_ID } })).toThrow(/snapshotVersion/)
})
