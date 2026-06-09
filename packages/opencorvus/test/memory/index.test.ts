import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Memory } from "../../src/memory"
import { MemoryInjection } from "../../src/memory/injection"
import { tmpdir } from "../fixture/fixture"

describe("memory typed recall", () => {
  test("captures session episodes and promotes structured atomics globally", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = Memory.captureEpisode({
          title: "Compaction: Slack setup",
          content: [
            "# Slack setup",
            "",
            "## Root Cause",
            "- Socket Mode must be enabled before the bot will receive events.",
            "",
            "## Outcome",
            "- Store xoxb and xapp tokens in project config.",
          ].join("\n"),
          source: "compaction",
          projectId: Instance.project.id,
          scope: "session",
          sessionID: "ses_memory_compaction",
          promoteScope: "global",
          atomics: [
            {
              kind: "lesson",
              text: "Socket Mode must be enabled before the bot will receive events.",
              section: "Root Cause",
            },
            { kind: "fact", text: "Store xoxb and xapp tokens in project config.", section: "Outcome" },
          ],
        })

        expect(result.episode.kind).toBe("episode")
        expect(result.episode.scope).toBe("session")
        expect(result.derived.some((item) => item.kind === "lesson" && item.scope === "global")).toBe(true)
        expect(result.derived.some((item) => item.kind === "fact" && item.scope === "global")).toBe(true)
      },
    })
  })

  test("legacy path (no atomics) classifies all derived as fact", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = Memory.captureEpisode({
          title: "Compaction: Slack setup legacy",
          content: [
            "# Slack setup",
            "",
            "## Root Cause",
            "- Socket Mode must be enabled before the bot will receive events.",
            "",
            "## Outcome",
            "- Store xoxb and xapp tokens in project config.",
          ].join("\n"),
          source: "compaction",
          projectId: Instance.project.id,
          scope: "session",
          sessionID: "ses_memory_legacy",
          promoteScope: "global",
        })

        expect(result.episode.kind).toBe("episode")
        expect(result.derived.length).toBeGreaterThan(0)
        expect(result.derived.every((item) => item.kind === "fact")).toBe(true)
      },
    })
  })

  test("upserts derived atomic memories and prioritizes them in recall", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Memory.captureEpisode({
          title: "Failed: Slack bot rollout",
          content: [
            "# Failure review",
            "",
            "## Root Cause",
            "- Socket Mode must be enabled before the bot will receive events.",
            "",
            "## Notes",
            "- Use project config for xoxb and xapp tokens.",
          ].join("\n"),
          source: "compaction",
          projectId: Instance.project.id,
          scope: "global",
          atomics: [
            {
              kind: "lesson",
              text: "Socket Mode must be enabled before the bot will receive events.",
              section: "Root Cause",
              importance: 92,
            },
          ],
        })
        Memory.captureEpisode({
          title: "Failed: Slack bot rollout retry",
          content: [
            "# Failure review",
            "",
            "## Root Cause",
            "- Socket Mode must be enabled before the bot will receive events.",
            "",
            "## Notes",
            "- Use project config for xoxb and xapp tokens.",
          ].join("\n"),
          source: "compaction",
          projectId: Instance.project.id,
          scope: "global",
          atomics: [
            {
              kind: "lesson",
              text: "Socket Mode must be enabled before the bot will receive events.",
              section: "Root Cause",
              importance: 92,
            },
          ],
        })

        const lessons = Memory.listFiles({
          projectId: Instance.project.id,
          kinds: ["lesson"],
        })
        expect(lessons.length).toBe(1)

        const recalled = Memory.recall({
          query: "socket mode bot receive events",
          projectId: Instance.project.id,
          limit: 3,
        })
        expect(recalled.length).toBeGreaterThan(0)
        expect(recalled[0]?.kind).toBe("lesson")

        const section = Memory.promptSection({
          query: "socket mode xoxb",
          projectId: Instance.project.id,
          limit: 3,
        })
        expect(section).toContain("Auto-Recalled Memory")
        expect(section).toContain("Lesson:")

        const injected = await MemoryInjection.systemPromptSection({
          projectID: Instance.project.id,
          sessionID: "ses_memory_prompt",
          query: "socket mode xoxb",
          memoryToolAvailable: true,
        })
        expect(injected).toContain("Auto-Recalled Memory")
        expect(injected).toContain("Memory Policy")

        const readOnlyInjected = await MemoryInjection.systemPromptSection({
          projectID: Instance.project.id,
          sessionID: "ses_memory_prompt",
          query: "socket mode xoxb",
          memoryToolAvailable: false,
        })
        expect(readOnlyInjected).toContain("Auto-Recalled Memory")
        expect(readOnlyInjected).not.toContain("Memory Policy")
        expect(readOnlyInjected).not.toContain("Proactive Writing")
      },
    })
  })
})

// Memory.listFiles { sessionIDs } — exercises the backend fix that lets
// the panel route surface "Task Context" by passing a recursive walk of
// the task's session tree. See packages/opencorvus/src/server/routes/
// panel.ts and packages/opencorvus/src/engine/store.ts:sessionIDsForTask.
describe("Memory.listFiles sessionIDs filter", () => {
  test("returns rows whose sessionID is in the set, plus all global rows", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectId = Instance.project.id
        // Three session-scoped memories under three different sessions,
        // one global memory shared across the project.
        Memory.captureEpisode({
          title: "session A note",
          content: "## Outcome\n- foo",
          source: "compaction",
          projectId,
          scope: "session",
          sessionID: "ses_a",
        })
        Memory.captureEpisode({
          title: "session B note",
          content: "## Outcome\n- bar",
          source: "compaction",
          projectId,
          scope: "session",
          sessionID: "ses_b",
        })
        Memory.captureEpisode({
          title: "session C note",
          content: "## Outcome\n- baz",
          source: "compaction",
          projectId,
          scope: "session",
          sessionID: "ses_c",
        })
        Memory.captureEpisode({
          title: "global note",
          content: "## Outcome\n- shared",
          source: "compaction",
          projectId,
          scope: "global",
        })

        // Only sessions A + B are "in the task tree".
        const filtered = Memory.listFiles({
          projectId,
          sessionIDs: ["ses_a", "ses_b"],
        })

        const titles = filtered.map((row) => row.title).sort()
        expect(titles).toContain("session A note")
        expect(titles).toContain("session B note")
        expect(titles).toContain("global note")
        expect(titles).not.toContain("session C note")

        // Empty sessionIDs array should fall through to the legacy
        // single-sessionID semantics — exercised by passing undefined
        // sessionID + empty sessionIDs (treated as null sessionSet).
        const noFilter = Memory.listFiles({
          projectId,
          sessionIDs: [],
        })
        expect(noFilter.find((r) => r.title === "global note")).toBeDefined()
      },
    })
  })
})
