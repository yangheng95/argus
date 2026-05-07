import { describe, expect, test } from "bun:test"
import { SessionCompaction } from "../../src/session/compaction"

describe("SessionCompaction continuation", () => {
  test("does not expose a user-message continuation builder", () => {
    expect("buildContinueUserMessage" in SessionCompaction).toBe(false)
  })
})
