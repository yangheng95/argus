import { describe, expect, test } from "bun:test"
import { observeMissionParts, type MissionPartRow } from "../../script/mission-e2e-inactivity"

function row(input: Partial<MissionPartRow> & Pick<MissionPartRow, "id" | "t">): MissionPartRow {
  return {
    tool: null,
    st: null,
    title: null,
    text: null,
    time_updated: null,
    ...input,
  }
}

describe("mission E2E inactivity observation", () => {
  test("counts only newly observed parts so the caller can reset the inactivity timeout", () => {
    const seen = new Map<string, string>([["already-seen", JSON.stringify(["text", "", "", "", "old", 0])]])
    const logs: string[] = []

    const first = observeMissionParts({
      rows: [
        row({ id: "already-seen", t: "text", text: "old" }),
        row({ id: "tool-1", t: "tool", tool: "write", st: "running", title: "frontier.md" }),
      ],
      seen,
      prompt: "prompt",
      emit: (message) => logs.push(message),
      stamp: (message) => `STAMP ${message}`,
    })
    const second = observeMissionParts({
      rows: [row({ id: "tool-1", t: "tool", tool: "write", st: "running", title: "frontier.md" })],
      seen,
      prompt: "prompt",
      emit: (message) => logs.push(message),
      stamp: (message) => `STAMP ${message}`,
    })

    expect(first).toBe(1)
    expect(second).toBe(0)
    expect(logs).toEqual(["STAMP   TOOL write [running] frontier.md"])
  })

  test("counts meaningful updates to an existing part as activity", () => {
    const seen = new Map<string, string>()
    const logs: string[] = []

    const first = observeMissionParts({
      rows: [row({ id: "tool-1", t: "tool", tool: "write", st: "running", title: "frontier.md", time_updated: 10 })],
      seen,
      prompt: "prompt",
      emit: (message) => logs.push(message),
      stamp: (message) => `STAMP ${message}`,
    })
    const second = observeMissionParts({
      rows: [row({ id: "tool-1", t: "tool", tool: "write", st: "completed", title: "frontier.md", time_updated: 20 })],
      seen,
      prompt: "prompt",
      emit: (message) => logs.push(message),
      stamp: (message) => `STAMP ${message}`,
    })
    const third = observeMissionParts({
      rows: [row({ id: "tool-1", t: "tool", tool: "write", st: "completed", title: "frontier.md", time_updated: 20 })],
      seen,
      prompt: "prompt",
      emit: (message) => logs.push(message),
      stamp: (message) => `STAMP ${message}`,
    })

    expect(first).toBe(1)
    expect(second).toBe(1)
    expect(third).toBe(0)
    expect(logs).toEqual(["STAMP   TOOL write [running] frontier.md", "STAMP   TOOL write [completed] frontier.md"])
  })
})
