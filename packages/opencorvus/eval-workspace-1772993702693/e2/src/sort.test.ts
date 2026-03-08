import { describe, expect, test } from "bun:test"
import { numericSort } from "./sort"

describe("numericSort", () => {
  test("sorts basic numbers correctly", () => {
    // Verify basic numeric ordering: [3, 1, 2] should become [1, 2, 3]
    expect(numericSort([3, 1, 2])).toEqual([1, 2, 3])
  })

  test("fixes string comparison bug - critical test case", () => {
    // This is the BUG VERIFICATION test:
    // String sort would give: [1, 10, 2, 20] (because "10" < "2" lexicographically)
    // Numeric sort must give: [1, 2, 10, 20] (correct numeric ordering)
    expect(numericSort([1, 10, 2, 20])).toEqual([1, 2, 10, 20])
  })

  test("sorts negative numbers correctly", () => {
    // Verify negative numbers are handled: [-5, 3, -1, 0] should become [-5, -1, 0, 3]
    expect(numericSort([-5, 3, -1, 0])).toEqual([-5, -1, 0, 3])
  })

  test("handles empty array", () => {
    // Edge case: empty array should return empty array
    expect(numericSort([])).toEqual([])
  })

  test("handles single element", () => {
    // Edge case: single element should return same element
    expect(numericSort([42])).toEqual([42])
  })

  test("does not mutate original array", () => {
    // Verify functional programming principle: input array is not mutated
    const original = [3, 1, 2]
    const copy = [...original]
    numericSort(original)
    expect(original).toEqual(copy) // Original should be unchanged
  })

  test("handles already sorted array", () => {
    // Edge case: already sorted array should remain sorted
    expect(numericSort([1, 2, 3, 4, 5])).toEqual([1, 2, 3, 4, 5])
  })

  test("handles reverse sorted array", () => {
    // Edge case: reverse sorted should become ascending
    expect(numericSort([5, 4, 3, 2, 1])).toEqual([1, 2, 3, 4, 5])
  })

  test("handles duplicate numbers", () => {
    // Edge case: duplicates should be preserved in sorted order
    expect(numericSort([3, 1, 2, 1, 3])).toEqual([1, 1, 2, 3, 3])
  })
})
