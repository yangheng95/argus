import { describe, test, expect, afterAll } from "bun:test"
import { Truncate } from "../../src/tool/truncation"
import { Identifier } from "../../src/id/id"
import { Filesystem } from "../../src/util/filesystem"
import fs from "fs/promises"
import path from "path"

const FIXTURES_DIR = path.join(import.meta.dir, "fixtures")

// Truncate.output now refuses to silently lose data: an agent without the
// `task` tool or both `read`+`search_code` has no way to re-fetch the saved file,
// so calling Truncate from such an agent is a CLAUDE.md rule #1 violation
// and throws. Tests that exercise the truncation logic itself supply an
// agent that owns task permission to satisfy the recovery-path contract.
const AGENT_WITH_TASK = {
  name: "test-agent",
  permission: [{ permission: "task", pattern: "*", action: "allow" as const }],
} as any

const AGENT_WITH_READ_SEARCH_CODE = {
  name: "test-agent-search",
  permission: [
    { permission: "read", pattern: "*", action: "allow" as const },
    { permission: "search_code", pattern: "*", action: "allow" as const },
  ],
} as any

describe("Truncate", () => {
  describe("output", () => {
    test("truncates large json file by bytes", async () => {
      const content = await Filesystem.readText(path.join(FIXTURES_DIR, "models-api.json"))
      const result = await Truncate.output(content, {}, AGENT_WITH_TASK)

      expect(result.truncated).toBe(true)
      expect(result.content).toContain("truncated...")
      if (result.truncated) expect(result.outputPath).toBeDefined()
    })

    test("returns content unchanged when under limits", async () => {
      const content = "line1\nline2\nline3"
      const result = await Truncate.output(content)

      expect(result.truncated).toBe(false)
      expect(result.content).toBe(content)
    })

    test("truncates by line count", async () => {
      const lines = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n")
      const result = await Truncate.output(lines, { maxLines: 10 }, AGENT_WITH_TASK)

      expect(result.truncated).toBe(true)
      expect(result.content).toContain("...90 lines truncated...")
    })

    test("truncates by byte count", async () => {
      const content = "a".repeat(1000)
      const result = await Truncate.output(content, { maxBytes: 100 }, AGENT_WITH_TASK)

      expect(result.truncated).toBe(true)
      expect(result.content).toContain("truncated...")
    })

    test("truncates from head when explicitly requested", async () => {
      const lines = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n")
      const result = await Truncate.output(lines, { maxLines: 3, direction: "head" }, AGENT_WITH_TASK)

      expect(result.truncated).toBe(true)
      expect(result.content).toContain("line0")
      expect(result.content).toContain("line1")
      expect(result.content).toContain("line2")
      expect(result.content).not.toContain("line9")
    })

    test("truncates from tail by default (most-relevant-info-last for logs/errors)", async () => {
      const lines = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n")
      const result = await Truncate.output(lines, { maxLines: 3 }, AGENT_WITH_TASK)

      expect(result.truncated).toBe(true)
      expect(result.content).toContain("line7")
      expect(result.content).toContain("line8")
      expect(result.content).toContain("line9")
      expect(result.content).not.toContain("line0")
    })

    test("uses default MAX_LINES and MAX_BYTES", () => {
      expect(Truncate.MAX_LINES).toBe(2000)
      expect(Truncate.MAX_BYTES).toBe(50 * 1024)
    })

    test("large single-line file truncates with byte message", async () => {
      const content = await Filesystem.readText(path.join(FIXTURES_DIR, "models-api.json"))
      const result = await Truncate.output(content, {}, AGENT_WITH_TASK)

      expect(result.truncated).toBe(true)
      expect(result.content).toContain("bytes truncated...")
      expect(Buffer.byteLength(content, "utf-8")).toBeGreaterThan(Truncate.MAX_BYTES)
    })

    test("writes full output to file when truncated", async () => {
      const lines = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n")
      const result = await Truncate.output(lines, { maxLines: 10 }, AGENT_WITH_TASK)

      expect(result.truncated).toBe(true)
      expect(result.content).toContain("The tool call succeeded but the output was truncated")
      expect(result.content).toContain("search_code")
      if (!result.truncated) throw new Error("expected truncated")
      expect(result.outputPath).toBeDefined()
      expect(result.outputPath).toContain("tool_")

      const written = await Filesystem.readText(result.outputPath!)
      expect(written).toBe(lines)
    })

    test("throws when truncation needed but agent has no recovery path (no task / no read+search_code)", async () => {
      const lines = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n")
      // No agent passed → cannot recover the saved copy. Silent truncation
      // here would be a CLAUDE.md rule #1 fallback. Surface the failure.
      await expect(Truncate.output(lines, { maxLines: 10 })).rejects.toThrow(/silently lose data/)
    })

    test("throws when agent explicitly denies all recovery tools", async () => {
      const lines = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n")
      // Explicit deny on every recovery tool — no other ruleset overrides.
      const denyAll = {
        name: "deny-all",
        permission: [
          { permission: "task", pattern: "*", action: "deny" as const },
          { permission: "read", pattern: "*", action: "deny" as const },
          { permission: "search_code", pattern: "*", action: "deny" as const },
        ],
      } as any
      await expect(Truncate.output(lines, { maxLines: 10 }, denyAll)).rejects.toThrow(/silently lose data/)
    })

    test("throws when no agent context is supplied at all", async () => {
      const lines = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n")
      // No agent → no permission ruleset → cannot prove recovery path exists.
      // Per CLAUDE.md rule #1 we surface the failure rather than silently
      // dropping the tail of the output.
      await expect(Truncate.output(lines, { maxLines: 10 })).rejects.toThrow(/silently lose data/)
    })

    test("permits truncation when agent has read AND search_code but task is denied", async () => {
      const lines = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n")
      const rgOnly = {
        name: "rg",
        permission: [
          { permission: "task", pattern: "*", action: "deny" as const },
          { permission: "read", pattern: "*", action: "allow" as const },
          { permission: "search_code", pattern: "*", action: "allow" as const },
        ],
      } as any
      const result = await Truncate.output(lines, { maxLines: 10 }, rgOnly)
      expect(result.truncated).toBe(true)
      expect(result.content).toContain("search_code")
      // No "Task tool" hint when task is denied
      expect(result.content).not.toContain("Task tool")
    })

    test("suggests Task tool when agent has task permission", async () => {
      const lines = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n")
      const agent = { permission: [{ permission: "task", pattern: "*", action: "allow" as const }] }
      const result = await Truncate.output(lines, { maxLines: 10 }, agent as any)

      expect(result.truncated).toBe(true)
      expect(result.content).toContain("search_code")
      expect(result.content).toContain("Task tool")
    })

    test("omits Task tool hint when agent has read+search_code but task is denied", async () => {
      const lines = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n")
      const agent = {
        name: "rg-only",
        permission: [
          { permission: "task", pattern: "*", action: "deny" as const },
          { permission: "read", pattern: "*", action: "allow" as const },
          { permission: "search_code", pattern: "*", action: "allow" as const },
        ],
      }
      const result = await Truncate.output(lines, { maxLines: 10 }, agent as any)

      expect(result.truncated).toBe(true)
      expect(result.content).toContain("search_code")
      expect(result.content).not.toContain("Task tool")
    })

    test("does not write file when not truncated", async () => {
      const content = "short content"
      const result = await Truncate.output(content)

      expect(result.truncated).toBe(false)
      if (result.truncated) throw new Error("expected not truncated")
      expect("outputPath" in result).toBe(false)
    })
  })

  describe("cleanup", () => {
    const DAY_MS = 24 * 60 * 60 * 1000
    let oldFile: string
    let recentFile: string

    afterAll(async () => {
      await fs.unlink(oldFile).catch(() => {})
      await fs.unlink(recentFile).catch(() => {})
    })

    test("deletes files older than 7 days and preserves recent files", async () => {
      await fs.mkdir(Truncate.DIR, { recursive: true })

      // Create an old file (10 days ago)
      const oldTimestamp = Date.now() - 10 * DAY_MS
      const oldId = Identifier.create("tool", false, oldTimestamp)
      oldFile = path.join(Truncate.DIR, oldId)
      await Filesystem.write(oldFile, "old content")

      // Create a recent file (3 days ago)
      const recentTimestamp = Date.now() - 3 * DAY_MS
      const recentId = Identifier.create("tool", false, recentTimestamp)
      recentFile = path.join(Truncate.DIR, recentId)
      await Filesystem.write(recentFile, "recent content")

      await Truncate.cleanup()

      // Old file should be deleted
      expect(await Filesystem.exists(oldFile)).toBe(false)

      // Recent file should still exist
      expect(await Filesystem.exists(recentFile)).toBe(true)
    })
  })
})
