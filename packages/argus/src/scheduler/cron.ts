/**
 * Cron expression parser and scheduler.
 *
 * Supports:
 * - Standard 5-field cron: "minute hour day-of-month month day-of-week"
 * - Simple intervals: "30m", "2h", "24h", "1d"
 * - Both are stored in CronJob; intervals are converted to next_run timestamps.
 */
export namespace Cron {
  /** Parsed cron expression. */
  export type Parsed =
    | { type: "cron"; fields: CronFields }
    | { type: "interval"; ms: number }

  /** 5-field cron: minute, hour, day-of-month, month, day-of-week */
  export interface CronFields {
    minute: number[]  // 0-59
    hour: number[]    // 0-23
    dom: number[]     // 1-31
    month: number[]   // 1-12
    dow: number[]     // 0-6 (0=Sunday)
  }

  const INTERVAL_RE = /^(\d+)(m|h|d)$/i

  /**
   * Parse a cron expression or interval string.
   * @throws Error if the expression is invalid
   */
  export function parse(expression: string): Parsed {
    const trimmed = expression.trim()

    // Try interval format first
    const intervalMatch = trimmed.match(INTERVAL_RE)
    if (intervalMatch) {
      const value = parseInt(intervalMatch[1], 10)
      const unit = intervalMatch[2].toLowerCase()
      const multipliers: Record<string, number> = {
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000,
      }
      const ms = value * multipliers[unit]
      if (ms <= 0) throw new Error(`Invalid interval: ${expression}`)
      return { type: "interval", ms }
    }

    // Standard 5-field cron
    const parts = trimmed.split(/\s+/)
    if (parts.length !== 5) {
      throw new Error(`Invalid cron expression (expected 5 fields): ${expression}`)
    }

    return {
      type: "cron",
      fields: {
        minute: parseField(parts[0], 0, 59),
        hour: parseField(parts[1], 0, 23),
        dom: parseField(parts[2], 1, 31),
        month: parseField(parts[3], 1, 12),
        dow: parseField(parts[4], 0, 6),
      },
    }
  }

  /**
   * Compute the next run time after `after` (ms since epoch).
   * For intervals: after + interval_ms.
   * For cron: next matching minute boundary.
   */
  export function nextRun(parsed: Parsed, after: number): number {
    if (parsed.type === "interval") {
      return after + parsed.ms
    }

    // Cron: iterate minute-by-minute from next minute
    const start = new Date(after)
    start.setSeconds(0, 0)
    start.setMinutes(start.getMinutes() + 1)

    // Search up to 366 days ahead to handle all cron patterns
    const limit = after + 366 * 24 * 60 * 60 * 1000
    const d = start
    while (d.getTime() < limit) {
      if (matches(parsed, d.getTime())) {
        return d.getTime()
      }
      d.setMinutes(d.getMinutes() + 1)
    }
    throw new Error("No matching time found within 366 days")
  }

  /**
   * Check if a timestamp matches the cron expression.
   * For intervals: always returns false (intervals don't "match" times).
   */
  export function matches(parsed: Parsed, timestamp: number): boolean {
    if (parsed.type === "interval") return false

    const d = new Date(timestamp)
    const { fields } = parsed
    return (
      fields.minute.includes(d.getMinutes()) &&
      fields.hour.includes(d.getHours()) &&
      fields.dom.includes(d.getDate()) &&
      fields.month.includes(d.getMonth() + 1) &&
      fields.dow.includes(d.getDay())
    )
  }

  /**
   * Format a parsed expression back to a human-readable string.
   */
  export function describe(parsed: Parsed): string {
    if (parsed.type === "interval") {
      const totalMin = parsed.ms / (60 * 1000)
      if (totalMin < 60) return `every ${totalMin}m`
      const totalHr = totalMin / 60
      if (totalHr < 24) return `every ${totalHr}h`
      return `every ${totalHr / 24}d`
    }
    // For cron, just show the raw fields
    const f = parsed.fields
    return `cron(${fieldStr(f.minute)} ${fieldStr(f.hour)} ${fieldStr(f.dom)} ${fieldStr(f.month)} ${fieldStr(f.dow)})`
  }

  // --- Internal helpers ---

  function fieldStr(values: number[]): string {
    // Check if it covers all values in the range — simplify to "*"
    // This is a heuristic; just show the values
    return values.join(",")
  }

  /** Parse a single cron field (e.g. star/5, "1,3,5", "1-10", "*") */
  function parseField(field: string, min: number, max: number): number[] {
    const values = new Set<number>()

    for (const part of field.split(",")) {
      const stepMatch = part.match(/^(.+)\/(\d+)$/)
      if (stepMatch) {
        const range = parseRange(stepMatch[1], min, max)
        const step = parseInt(stepMatch[2], 10)
        if (step <= 0) throw new Error(`Invalid step: ${part}`)
        for (let i = range[0]; i <= range[range.length - 1]; i += step) {
          if (i >= min && i <= max) values.add(i)
        }
      } else {
        for (const v of parseRange(part, min, max)) {
          values.add(v)
        }
      }
    }

    if (values.size === 0) throw new Error(`Empty field: ${field}`)
    return Array.from(values).sort((a, b) => a - b)
  }

  /** Parse a range like "1-5" or "*" or "3" */
  function parseRange(part: string, min: number, max: number): number[] {
    if (part === "*") {
      const result: number[] = []
      for (let i = min; i <= max; i++) result.push(i)
      return result
    }

    const rangeMatch = part.match(/^(\d+)-(\d+)$/)
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10)
      const end = parseInt(rangeMatch[2], 10)
      if (start < min || end > max || start > end) {
        throw new Error(`Invalid range: ${part} (allowed: ${min}-${max})`)
      }
      const result: number[] = []
      for (let i = start; i <= end; i++) result.push(i)
      return result
    }

    const num = parseInt(part, 10)
    if (isNaN(num) || num < min || num > max) {
      throw new Error(`Invalid value: ${part} (allowed: ${min}-${max})`)
    }
    return [num]
  }
}
