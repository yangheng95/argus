import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Memory } from "../../src/memory"
import { MemoryInjection } from "../../src/memory/injection"
import { tmpdir } from "../fixture/fixture"

describe("memory typed recall", () => {
  test("captures session episodes and promotes atomic memories globally", async () => {
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
        })

        expect(result.episode.kind).toBe("episode")
        expect(result.episode.scope).toBe("session")
        expect(result.derived.some((item) => item.kind === "lesson" && item.scope === "global")).toBe(true)
        expect(result.derived.some((item) => item.kind === "fact" && item.scope === "global")).toBe(true)
      },
    })
  })

  test("upserts derived atomic memories and prioritizes them in recall", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const content = [
          "# Failure review",
          "",
          "## Root Cause",
          "- Socket Mode must be enabled before the bot will receive events.",
          "",
          "## Notes",
          "- Use project config for xoxb and xapp tokens.",
        ].join("\n")

        Memory.captureEpisode({
          title: "Failed: Slack bot rollout",
          content,
          source: "compaction",
          projectId: Instance.project.id,
          scope: "global",
        })
        Memory.captureEpisode({
          title: "Failed: Slack bot rollout retry",
          content,
          source: "compaction",
          projectId: Instance.project.id,
          scope: "global",
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
        expect(injected).toContain("Memory Recall Policy")
      },
    })
  })

  test("search broadens recall and ranks stronger matches above weaker profile hits", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Memory.writeFile({
          title: "Profile: Slack habits",
          content: "## Profile\nAlways keep Slack open during rollout.",
          source: "reflection",
          projectId: Instance.project.id,
          scope: "global",
          kind: "profile",
          key: "slack-profile",
        })
        Memory.captureEpisode({
          title: "Failed: Slack bot rollout",
          content: [
            "# Failure review",
            "",
            "## Root Cause",
            "- Socket Mode must be enabled before the bot will receive events.",
          ].join("\n"),
          source: "compaction",
          projectId: Instance.project.id,
          scope: "global",
        })

        const results = Memory.search({
          query: "socket mode receive events slack delivery",
          projectId: Instance.project.id,
          limit: 3,
        })

        expect(results.length).toBeGreaterThan(0)
        expect(results[0]?.kind).toBe("lesson")
        expect(results.some((item) => item.kind === "profile")).toBe(true)
      },
    })
  })
})
