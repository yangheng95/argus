import { expect, test } from "bun:test"
import { missionPage, type MissionRecord } from "../src/services/mission"

function mission(index: number): MissionRecord {
  return {
    missionID: `mission-${index}`,
    sessionID: `ses_${index}`,
    title: `Mission ${index}`,
    directory: "D:/workspace",
    created: 1_000 + index,
    updated: 2_000 + index,
    tasks: [],
    taskStats: { total: 0, queued: 0, active: 0, completed: 0, failed: 0, cancelled: 0 },
  }
}

test("missionPage keeps ten visible Missions and exposes the last visible cursor", () => {
  const page = missionPage(
    Array.from({ length: 11 }, (_, index) => mission(index)),
    10,
  )

  expect(page.records).toHaveLength(10)
  expect(page.hasMore).toBe(true)
  expect(page.cursor).toEqual({ updated: 2_009, sessionID: "ses_9" })
})

test("missionPage clears the cursor when the result is empty", () => {
  expect(missionPage([], 10)).toEqual({ records: [], hasMore: false, cursor: null })
})
