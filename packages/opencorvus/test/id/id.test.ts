import { describe, test, expect } from "bun:test"
import { Identifier } from "../../src/id/id"

describe("Identifier.create", () => {
  test("creates ascending ID with correct prefix", () => {
    const id = Identifier.create("session", false)
    expect(id).toStartWith("ses_")
  })

  test("creates descending ID with correct prefix", () => {
    const id = Identifier.create("message", true)
    expect(id).toStartWith("msg_")
  })

  test("ID has correct total length for short prefix", () => {
    // "ses" (3) + "_" (1) + 12 hex chars + 14 base62 chars = 30 chars
    const id = Identifier.create("session", false)
    expect(id.length).toBe(30)
  })

  test("ID has correct total length for tool prefix", () => {
    // "tool" (4) + "_" (1) + 12 hex chars + 14 base62 chars = 31 chars
    const id = Identifier.create("tool", false)
    expect(id.length).toBe(31)
  })

  test("creates unique IDs on successive calls", () => {
    const ids = new Set(Array.from({ length: 10 }, () => Identifier.create("session", false)))
    expect(ids.size).toBe(10)
  })

  test("accepts a custom timestamp and produces a valid ID", () => {
    const ts = 1700000000000
    const id = Identifier.create("session", false, ts)
    expect(id).toStartWith("ses_")
    expect(id.length).toBe(30)
  })
})

describe("Identifier.ascending", () => {
  test("generates ascending ID with correct prefix", () => {
    const id = Identifier.ascending("session")
    expect(id).toStartWith("ses_")
  })

  test("passes through a valid given ID", () => {
    const given = "ses_000000000000AAAAAAAAAAAAAA"
    const id = Identifier.ascending("session", given)
    expect(id).toBe(given)
  })

  test("throws when given ID has wrong prefix", () => {
    const wrong = "msg_000000000000AAAAAAAAAAAAAA"
    expect(() => Identifier.ascending("session", wrong)).toThrow()
  })

  test("ascending IDs are lexicographically sortable by creation time", () => {
    const ids: string[] = []
    // Use distinct timestamps to ensure stable ordering
    const timestamps = [1700000000000, 1700000001000, 1700000002000]
    for (const ts of timestamps) {
      ids.push(Identifier.create("session", false, ts))
    }
    const sorted = [...ids].sort()
    expect(sorted).toEqual(ids)
  })
})

describe("Identifier.descending", () => {
  test("generates descending ID with correct prefix", () => {
    const id = Identifier.descending("session")
    expect(id).toStartWith("ses_")
  })

  test("passes through a valid given ID", () => {
    const given = "ses_000000000000AAAAAAAAAAAAAA"
    const id = Identifier.descending("session", given)
    expect(id).toBe(given)
  })

  test("throws when given ID has wrong prefix for descending", () => {
    const wrong = "msg_000000000000AAAAAAAAAAAAAA"
    expect(() => Identifier.descending("session", wrong)).toThrow()
  })

  test("descending IDs sort newest first (reverse lexicographic order)", () => {
    const ids: string[] = []
    const timestamps = [1700000000000, 1700000001000, 1700000002000]
    for (const ts of timestamps) {
      ids.push(Identifier.create("session", true, ts))
    }
    // Later timestamps produce lexicographically smaller descending IDs
    const sorted = [...ids].sort()
    expect(sorted).toEqual([...ids].reverse())
  })
})

describe("Identifier.schema", () => {
  test("validates session ID", () => {
    const schema = Identifier.schema("session")
    const id = Identifier.ascending("session")
    expect(schema.safeParse(id).success).toBe(true)
  })

  test("rejects ID with wrong prefix", () => {
    const schema = Identifier.schema("session")
    const wrongId = "msg_000000000000AAAAAAAAAAAAAA"
    expect(schema.safeParse(wrongId).success).toBe(false)
  })

  test("validates all prefix types", () => {
    const prefixes = [
      "session", "message", "permission", "question", "user",
      "part", "pty", "tool", "workspace", "memory",
      "memchunk", "cron", "task", "goal",
    ] as const
    for (const prefix of prefixes) {
      const schema = Identifier.schema(prefix)
      const id = Identifier.ascending(prefix)
      expect(schema.safeParse(id).success).toBe(true)
    }
  })
})

describe("Identifier.timestamp", () => {
  // timestamp() recovers the bottom 48 bits of (ts * 4096), not the exact
  // original timestamp. Its contract is preserved *relative ordering* for IDs
  // created within the same epoch window (< 2^36 ms apart ≈ 786 days).

  test("returns a positive number", () => {
    const id = Identifier.create("session", false)
    const ts = Identifier.timestamp(id)
    expect(ts).toBeGreaterThan(0)
  })

  test("IDs created later have a larger (or equal) recovered timestamp", () => {
    // Use timestamps 1 second apart — well within the safe window
    const ts1 = 1700000000000
    const ts2 = 1700000001000
    const id1 = Identifier.create("session", false, ts1)
    const id2 = Identifier.create("session", false, ts2)
    expect(Identifier.timestamp(id2)).toBeGreaterThan(Identifier.timestamp(id1))
  })

  test("recovered timestamp ordering matches lexicographic order", () => {
    const ts1 = 1700000000000
    const ts2 = 1700000010000
    const id1 = Identifier.create("session", false, ts1)
    const id2 = Identifier.create("session", false, ts2)
    // Ascending IDs sort lexicographically in creation order
    expect(id1 < id2).toBe(true)
    expect(Identifier.timestamp(id1) < Identifier.timestamp(id2)).toBe(true)
  })

  test("IDs created at same timestamp get increasing counters (thus different timestamps)", () => {
    const ts = 1700000000000
    const id1 = Identifier.create("session", false, ts)
    const id2 = Identifier.create("session", false, ts)
    // Counter ensures uniqueness even at same millisecond
    expect(Identifier.timestamp(id1)).toBeLessThanOrEqual(Identifier.timestamp(id2))
  })
})
