import { describe, test, expect } from "bun:test"
import { Cron } from "../../src/scheduler/cron"

// ─── Cron.parse ──────────────────────────────────────────────────────────────

describe("Cron.parse — interval format", () => {
  test("parses minutes interval (30m)", () => {
    const parsed = Cron.parse("30m")
    expect(parsed.type).toBe("interval")
    if (parsed.type === "interval") {
      expect(parsed.ms).toBe(30 * 60 * 1000)
    }
  })

  test("parses hours interval (2h)", () => {
    const parsed = Cron.parse("2h")
    expect(parsed.type).toBe("interval")
    if (parsed.type === "interval") {
      expect(parsed.ms).toBe(2 * 60 * 60 * 1000)
    }
  })

  test("parses days interval (1d)", () => {
    const parsed = Cron.parse("1d")
    expect(parsed.type).toBe("interval")
    if (parsed.type === "interval") {
      expect(parsed.ms).toBe(24 * 60 * 60 * 1000)
    }
  })

  test("parses large minute interval (120m)", () => {
    const parsed = Cron.parse("120m")
    expect(parsed.type).toBe("interval")
    if (parsed.type === "interval") {
      expect(parsed.ms).toBe(120 * 60 * 1000)
    }
  })

  test("interval parsing is case-insensitive (30M)", () => {
    const parsed = Cron.parse("30M")
    expect(parsed.type).toBe("interval")
  })

  test("trims whitespace from interval", () => {
    const parsed = Cron.parse("  5m  ")
    expect(parsed.type).toBe("interval")
  })
})

describe("Cron.parse — standard 5-field cron", () => {
  test("parses wildcard cron (* * * * *)", () => {
    const parsed = Cron.parse("* * * * *")
    expect(parsed.type).toBe("cron")
    if (parsed.type === "cron") {
      expect(parsed.fields.minute).toHaveLength(60)
      expect(parsed.fields.hour).toHaveLength(24)
      expect(parsed.fields.dom).toHaveLength(31)
      expect(parsed.fields.month).toHaveLength(12)
      expect(parsed.fields.dow).toHaveLength(7)
    }
  })

  test("parses specific minute and hour (30 9 * * *)", () => {
    const parsed = Cron.parse("30 9 * * *")
    expect(parsed.type).toBe("cron")
    if (parsed.type === "cron") {
      expect(parsed.fields.minute).toEqual([30])
      expect(parsed.fields.hour).toEqual([9])
    }
  })

  test("parses range (1-5 * * * *)", () => {
    const parsed = Cron.parse("1-5 * * * *")
    expect(parsed.type).toBe("cron")
    if (parsed.type === "cron") {
      expect(parsed.fields.minute).toEqual([1, 2, 3, 4, 5])
    }
  })

  test("parses step (*/15 * * * *)", () => {
    const parsed = Cron.parse("*/15 * * * *")
    expect(parsed.type).toBe("cron")
    if (parsed.type === "cron") {
      expect(parsed.fields.minute).toEqual([0, 15, 30, 45])
    }
  })

  test("parses list (1,15,30 * * * *)", () => {
    const parsed = Cron.parse("1,15,30 * * * *")
    expect(parsed.type).toBe("cron")
    if (parsed.type === "cron") {
      expect(parsed.fields.minute).toEqual([1, 15, 30])
    }
  })

  test("parses day-of-week field (0 = Sunday)", () => {
    const parsed = Cron.parse("0 9 * * 1")
    expect(parsed.type).toBe("cron")
    if (parsed.type === "cron") {
      expect(parsed.fields.dow).toEqual([1]) // Monday
    }
  })

  test("parses month field (1-12)", () => {
    const parsed = Cron.parse("0 0 1 6 *")
    expect(parsed.type).toBe("cron")
    if (parsed.type === "cron") {
      expect(parsed.fields.month).toEqual([6])
      expect(parsed.fields.dom).toEqual([1])
    }
  })

  test("fields are sorted ascending", () => {
    const parsed = Cron.parse("30,5,15 * * * *")
    expect(parsed.type).toBe("cron")
    if (parsed.type === "cron") {
      expect(parsed.fields.minute).toEqual([5, 15, 30])
    }
  })
})

describe("Cron.parse — error cases", () => {
  test("throws on wrong number of fields", () => {
    expect(() => Cron.parse("* * * *")).toThrow()
    expect(() => Cron.parse("* * * * * *")).toThrow()
  })

  test("throws on invalid range (out of bounds)", () => {
    expect(() => Cron.parse("60 * * * *")).toThrow()
    expect(() => Cron.parse("* 24 * * *")).toThrow()
    expect(() => Cron.parse("* * 0 * *")).toThrow()
    expect(() => Cron.parse("* * * 13 *")).toThrow()
    expect(() => Cron.parse("* * * * 7")).toThrow()
  })

  test("throws on invalid step (0)", () => {
    expect(() => Cron.parse("*/0 * * * *")).toThrow()
  })

  test("throws on non-numeric value", () => {
    expect(() => Cron.parse("abc * * * *")).toThrow()
  })
})

// ─── Cron.nextRun ─────────────────────────────────────────────────────────────

describe("Cron.nextRun — interval", () => {
  test("returns after + ms for interval", () => {
    const parsed = Cron.parse("30m")
    const after = 1700000000000
    expect(Cron.nextRun(parsed, after)).toBe(after + 30 * 60 * 1000)
  })

  test("1h interval adds exactly one hour", () => {
    const parsed = Cron.parse("1h")
    const after = 1700000000000
    expect(Cron.nextRun(parsed, after)).toBe(after + 60 * 60 * 1000)
  })
})

describe("Cron.nextRun — cron expression", () => {
  test("finds next minute for * * * * *", () => {
    const parsed = Cron.parse("* * * * *")
    // Create a reference point at exactly the start of a minute
    const d = new Date("2024-01-15T10:30:00.000Z")
    const after = d.getTime()
    const next = Cron.nextRun(parsed, after)
    // Next should be exactly 1 minute later (next minute boundary)
    expect(next).toBe(after + 60 * 1000)
  })

  test("next run is always in the future", () => {
    const parsed = Cron.parse("30 9 * * *")
    const after = Date.now()
    const next = Cron.nextRun(parsed, after)
    expect(next).toBeGreaterThan(after)
  })

  test("next run matches expected minute/hour", () => {
    const parsed = Cron.parse("30 9 * * *")
    const after = Date.now()
    const next = Cron.nextRun(parsed, after)
    const d = new Date(next)
    expect(d.getMinutes()).toBe(30)
    expect(d.getHours()).toBe(9)
  })
})

// ─── Cron.matches ─────────────────────────────────────────────────────────────

describe("Cron.matches", () => {
  test("returns false for interval type", () => {
    const parsed = Cron.parse("30m")
    expect(Cron.matches(parsed, Date.now())).toBe(false)
  })

  test("returns true when all fields match", () => {
    const parsed = Cron.parse("* * * * *")
    // Every minute matches
    const ts = new Date("2024-06-15T10:30:00.000Z").getTime()
    expect(Cron.matches(parsed, ts)).toBe(true)
  })

  test("returns false when minute does not match", () => {
    // Only matches at minute 0
    const parsed = Cron.parse("0 * * * *")
    const ts = new Date("2024-06-15T10:30:00.000Z").getTime() // minute=30
    expect(Cron.matches(parsed, ts)).toBe(false)
  })

  test("returns true at the matching minute", () => {
    const parsed = Cron.parse("0 * * * *")
    const ts = new Date("2024-06-15T10:00:00.000Z").getTime() // minute=0
    expect(Cron.matches(parsed, ts)).toBe(true)
  })

  test("matches specific hour correctly", () => {
    const parsed = Cron.parse("0 9 * * *") // every day at 09:00
    const match = new Date("2024-06-15T09:00:00.000Z").getTime()
    const noMatch = new Date("2024-06-15T10:00:00.000Z").getTime()
    expect(Cron.matches(parsed, match)).toBe(true)
    expect(Cron.matches(parsed, noMatch)).toBe(false)
  })
})

// ─── Cron.describe ────────────────────────────────────────────────────────────

describe("Cron.describe", () => {
  test("describes minute interval", () => {
    const parsed = Cron.parse("30m")
    expect(Cron.describe(parsed)).toBe("every 30m")
  })

  test("describes hour interval", () => {
    const parsed = Cron.parse("2h")
    expect(Cron.describe(parsed)).toBe("every 2h")
  })

  test("describes day interval", () => {
    const parsed = Cron.parse("1d")
    expect(Cron.describe(parsed)).toBe("every 1d")
  })

  test("describes cron expression with cron() wrapper", () => {
    const parsed = Cron.parse("30 9 * * *")
    const desc = Cron.describe(parsed)
    expect(desc).toStartWith("cron(")
    expect(desc).toContain("30")
    expect(desc).toContain("9")
  })

  test("describes wildcard cron correctly", () => {
    const parsed = Cron.parse("* * * * *")
    const desc = Cron.describe(parsed)
    expect(desc).toStartWith("cron(")
  })
})
