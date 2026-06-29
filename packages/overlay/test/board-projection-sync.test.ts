import { afterEach, expect, test } from "bun:test"
import { boardStore, setBoardStore, setBoardData, setSnapshotVersion } from "../src/store/board"
import { cardTreeStore } from "../src/store/card-tree"
import { resetWriter } from "../src/services/tree-writer"
import { boardSnapshot } from "../src/services/sync"
import { installRealOverlayI18n } from "./fixtures/i18n"
import { testBoardOrderKey, testTaskOrderKey } from "./fixtures/timeline-order"

const TASK_ID = "tsk_board_projection"
const TASK_CREATED = 1_776_000_100_000
const STEP_STARTED = 1_776_000_100_100
const PHASE_STARTED = 1_776_000_100_200
// audit-2026-04-29 W2-V25 — test was authored against the per-
// attempt step card format `step:<goal>:<run>:<stepID>`. That
// format was reverted on 2026-04-26 (see goalStepCardID in
// tree-writer.ts: "Removing runID from the card id keeps both
// observers pointed at the same card and merges retry attempts
// into one rolling timeline"). The test was never updated, so
// it looked up an ID the production code never produces and
// silently failed across the suite.
const STEP_ID = "step:goal_projection:build"
const PHASE_ID = `${STEP_ID}:phase:build`

installRealOverlayI18n()

function boardWith(status: "running" | "failed") {
  return {
    snapshotVersion: `board-revision-${status}`,
    task: {
      id: TASK_ID,
      orderKey: testTaskOrderKey(TASK_ID, TASK_CREATED),
      status: "active",
      request: "sync projected cards",
      sessionID: "ses_root",
      time: { created: TASK_CREATED },
      attachments: [],
    },
    workflow: {
      steps: [
        {
          id: "build",
          orderKey: testBoardOrderKey(`${TASK_ID}-build`, TASK_CREATED, 61),
          phases: [{ id: "build", label: "Build", sessionKind: "build" }],
        },
      ],
    },
    goalWorkflows: [
      {
        goalID: "goal_projection",
        orderKey: testBoardOrderKey("goal_projection", TASK_CREATED, 60),
        goalRunID: "gr_projection",
        goalTitle: "Projection",
        goalStatus: status === "failed" ? "failed" : "running",
        orderIndex: 0,
        retryCount: 0,
        steps: [
          {
            stepID: "build",
            orderKey: testBoardOrderKey("goal_projection-build", STEP_STARTED, 61),
            label: "Executor",
            status,
            startedAt: STEP_STARTED,
            ...(status === "failed" ? { completedAt: 1_776_000_100_300 } : {}),
            payload: { buildSessionID: "ses_projection_build" },
            phases: {
              build: {
                orderKey: testBoardOrderKey("goal_projection-build-build", PHASE_STARTED, 62),
                status: status === "failed" ? "completed" : "running",
                startedAt: PHASE_STARTED,
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

test("setBoardData rejects task request projection without backend orderKey", () => {
  const board = boardWith("running")
  delete (board.task as any).orderKey

  expect(() => setBoardData(board)).toThrow(`task ${TASK_ID} missing orderKey`)
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
