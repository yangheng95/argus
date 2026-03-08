/**
 * Numeric sort function that correctly sorts numbers using arithmetic comparison.
 *
 * WHY NUMERIC COMPARISON IS NEEDED:
 * JavaScript's default Array.sort() converts elements to strings and performs
 * lexicographic (string) comparison. This causes incorrect ordering for numbers:
 *   [1, 10, 2].sort() // Returns [1, 10, 2] - WRONG! (string "10" < "2")
 *
 * HOW A - B WORKS:
 * The comparator (a, b) => a - b uses arithmetic subtraction:
 *   - If a < b: result is negative → a comes before b
 *   - If a === b: result is 0 → order unchanged
 *   - If a > b: result is positive → a comes after b
 *
 * This ensures true numeric ordering where 2 < 10, not "2" > "10".
 *
 * EDGE CASES HANDLED:
 *   - Empty array: returns empty array []
 *   - Single element: returns same element [42]
 *   - Negative numbers: correctly sorts [-5, -1, 0, 3]
 *   - Input mutation: returns NEW array, original is preserved
 *
 * @param arr - Array of numbers to sort
 * @returns A new array with numbers sorted in ascending order
 *
 * @example
 * numericSort([3, 1, 2])        // Returns [1, 2, 3]
 * numericSort([1, 10, 2, 20])   // Returns [1, 2, 10, 20] (not [1, 10, 2, 20])
 * numericSort([-5, 3, -1, 0])   // Returns [-5, -1, 0, 3]
 */
export function numericSort(arr: number[]): number[] {
  // Create a copy with slice() to avoid mutating the input array
  // Then sort using numeric comparison (a - b) instead of string comparison
  return arr.slice().sort((a, b) => a - b)
}
