import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { MemoryTool } from "../../src/tool/memory"

function ctx(sessionID: string) {
  return {
    sessionID,
    messageID: "msg_test_memory",
    callID: "",
    agent: "build",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => {},
    ask: async () => {},
  }
}

describe("tool.memory", () => {
  test("supports global and session-scoped memory lifecycle", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const memory = await MemoryTool.init()
        const sessionA = ctx("ses_test_memory_a")
        const sessionB = ctx("ses_test_memory_b")

        const write = await memory.execute(
          {
            action: "write",
            title: "Slack bot registration notes",
            content:
              "## Slack Setup\n- Enable Socket Mode\n- Configure xoxb and xapp tokens\n- Subscribe message.channels",
            kind: "lesson",
          },
          sessionA,
        )
        const writeData = JSON.parse(write.output) as { fileId: string; scope: string; kind: string }
        expect(write.title).toContain("Saved:")
        expect(writeData.scope).toBe("global")
        expect(writeData.kind).toBe("lesson")
        expect(typeof writeData.fileId).toBe("string")

        const sessionWrite = await memory.execute(
          {
            action: "write",
            title: "Temporary branch notes",
            content: "## Session note\n- Use feature/temp-memory while validating this session only",
            kind: "episode",
            scope: "session",
          },
          sessionA,
        )
        const sessionWriteData = JSON.parse(sessionWrite.output) as { fileId: string; scope: string; kind: string }
        expect(sessionWriteData.scope).toBe("session")
        expect(sessionWriteData.kind).toBe("episode")

        const search = await memory.execute(
          {
            action: "search",
            query: "Slack Socket Mode xoxb xapp",
            maxResults: 5,
          },
          sessionB,
        )
        const searchData = JSON.parse(search.output) as { results: Array<{ fileId: string; scope: string; kind: string }> }
        expect(searchData.results.length).toBeGreaterThan(0)
        expect(searchData.results.some((r) => r.fileId === writeData.fileId)).toBe(true)
        expect(searchData.results.every((r) => r.scope === "global")).toBe(true)
        expect(searchData.results.some((r) => r.kind === "lesson")).toBe(true)

        const sessionSearch = await memory.execute(
          {
            action: "search",
            query: "feature temp-memory validating session",
            scope: "session",
            maxResults: 5,
          },
          sessionA,
        )
        const sessionSearchData = JSON.parse(sessionSearch.output) as { results: Array<{ fileId: string }> }
        expect(sessionSearchData.results.some((r) => r.fileId === sessionWriteData.fileId)).toBe(true)

        const otherSessionSearch = await memory.execute(
          {
            action: "search",
            query: "feature temp-memory validating session",
            scope: "all",
            maxResults: 5,
          },
          sessionB,
        )
        const otherSessionData = JSON.parse(otherSessionSearch.output) as { results: Array<{ fileId: string }> }
        expect(otherSessionSearch.title).toBe("No memories found")
        expect(otherSessionData.results.length).toBe(0)

        const get = await memory.execute(
          {
            action: "get",
            fileId: writeData.fileId,
          },
          sessionA,
        )
        const getData = JSON.parse(get.output) as { text: string; scope: string; kind: string }
        expect(getData.text).toContain("Socket Mode")
        expect(getData.scope).toBe("global")
        expect(getData.kind).toBe("lesson")

        const list = await memory.execute(
          {
            action: "list",
          },
          sessionA,
        )
        const listData = JSON.parse(list.output) as { files: Array<{ id: string; kind: string }> }
        expect(listData.files.some((f) => f.id === writeData.fileId)).toBe(true)
        expect(listData.files.some((f) => f.id === sessionWriteData.fileId)).toBe(true)
        expect(listData.files.some((f) => f.id === sessionWriteData.fileId && f.kind === "episode")).toBe(true)

        const del = await memory.execute(
          {
            action: "delete",
            fileId: sessionWriteData.fileId,
          },
          sessionA,
        )
        expect(del.title).toContain("Deleted:")

        const after = await memory.execute(
          {
            action: "search",
            query: "feature temp-memory validating session",
            scope: "session",
            maxResults: 5,
          },
          sessionA,
        )
        const afterData = JSON.parse(after.output) as { results: Array<{ fileId: string }> }
        expect(after.title).toBe("No memories found")
        expect(afterData.results.length).toBe(0)
      },
    })
  })

})
