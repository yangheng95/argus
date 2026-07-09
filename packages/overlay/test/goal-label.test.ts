import { expect, test } from "bun:test"

import {
  goalCompactLabel,
  goalCompactLabelFromIndexes,
  goalRevisionLabel,
  goalRevisionLabelFromIndexes,
} from "../src/utils/goal-label"

test("goal revision labels preserve the full historical goal identifier", () => {
  expect(goalRevisionLabel(6, 1)).toBe("#G6V1")
  expect(goalRevisionLabel(6, 2)).toBe("#G6V2")
  expect(goalRevisionLabel(0, 2)).toBe("V2")
  expect(goalRevisionLabelFromIndexes(5, 1)).toBe("#G6V2")
})

test("goal compact labels omit the first revision and keep retries visible", () => {
  expect(goalCompactLabel(6, 1)).toBe("#G6")
  expect(goalCompactLabel(6, 2)).toBe("#G6·2")
  expect(goalCompactLabelFromIndexes(5, 0)).toBe("#G6")
  expect(goalCompactLabelFromIndexes(5, 1)).toBe("#G6·2")
})

test("goal compact labels keep the existing degenerate no-order shape", () => {
  expect(goalCompactLabel(0, 1)).toBe("V1")
  expect(goalCompactLabel(0, 3)).toBe("V3")
  expect(goalCompactLabelFromIndexes(Number.NaN, 2)).toBe("V3")
})
