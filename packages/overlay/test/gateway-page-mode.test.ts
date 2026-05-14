import { afterEach, beforeEach, expect, test } from "bun:test"
import { isGatewayPage, pageMode, setPageMode } from "../src/store/page-mode"

// The pageMode signal is module-level state — bun:test runs every file
// in the same process, so leaving it on "gateway" between tests would
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
  expect(isGatewayPage()).toBe(false)
})

test("setPageMode toggles between panel and gateway without losing state", () => {
  setPageMode("gateway")
  expect(pageMode()).toBe("gateway")
  expect(isGatewayPage()).toBe(true)

  setPageMode("panel")
  expect(pageMode()).toBe("panel")
  expect(isGatewayPage()).toBe(false)

  setPageMode("gateway")
  expect(pageMode()).toBe("gateway")
})

test("setPageMode rejects unknown values (rule 7 — no fallback)", () => {
  expect(() => setPageMode("settings" as any)).toThrow(/unsupported page mode/)
  expect(() => setPageMode("" as any)).toThrow(/unsupported page mode/)
})
