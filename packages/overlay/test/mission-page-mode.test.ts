import { afterEach, beforeEach, expect, test } from "bun:test"
import { isMissionPage, pageMode, setPageMode } from "../src/store/page-mode"

// The pageMode signal is module-level state — bun:test runs every file
// in the same process, so leaving it on "mission" between tests would
// silently corrupt other test files that read the signal. Reset before
// AND after each test so an mid-test crash never poisons later tests.
beforeEach(() => {
  setPageMode("panel")
})
afterEach(() => {
  setPageMode("panel")
})

test("page mode defaults to panel", () => {
  expect(pageMode()).toBe("panel")
  expect(isMissionPage()).toBe(false)
})

test("setPageMode toggles between panel and mission without losing state", () => {
  setPageMode("mission")
  expect(pageMode()).toBe("mission")
  expect(isMissionPage()).toBe(true)

  setPageMode("panel")
  expect(pageMode()).toBe("panel")
  expect(isMissionPage()).toBe(false)

  setPageMode("mission")
  expect(pageMode()).toBe("mission")
})

test("setPageMode rejects unknown values (rule 7 — no fallback)", () => {
  expect(() => setPageMode("settings" as any)).toThrow(/unsupported page mode/)
  expect(() => setPageMode("" as any)).toThrow(/unsupported page mode/)
})
