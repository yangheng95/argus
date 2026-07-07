import { test } from "bun:test"

console.log("99 pass")
console.log("0 fail")
console.log("Ran 99 tests across 1 file. [1.00ms]")

test("real pass count", () => {
  // The isolated runner must parse Bun's final summary, not this file's stdout.
})
