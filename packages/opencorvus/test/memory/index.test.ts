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
            { kind: "lesson", text: "Socket Mode must be enabled before the bot will receive events.", section: "Root Cause" },
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
            { kind: "lesson", text: "Socket Mode must be enabled before the bot will receive events.", section: "Root Cause", importance: 92 },
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
            { kind: "lesson", text: "Socket Mode must be enabled before the bot will receive events.", section: "Root Cause", importance: 92 },
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
        })
        expect(injected).toContain("Auto-Recalled Memory")
        expect(injected).toContain("Memory Policy")
      },
    })
  })
})
