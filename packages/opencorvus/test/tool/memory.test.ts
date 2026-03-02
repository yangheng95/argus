import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { MemoryTool } from "../../src/tool/memory"

const ctx = {
  sessionID: "ses_test_memory",
  messageID: "msg_test_memory",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.memory", () => {
  test("supports write/search/get/list/delete lifecycle", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const memory = await MemoryTool.init()

        const write = await memory.execute(
          {
            action: "write",
            title: "Slack bot registration notes",
            content:
              "## Slack Setup\n- Enable Socket Mode\n- Configure xoxb and xapp tokens\n- Subscribe message.channels",
          },
          ctx,
        )
        const writeData = JSON.parse(write.output) as { fileId: string }
        expect(write.title).toContain("Saved:")
        expect(typeof writeData.fileId).toBe("string")

        const search = await memory.execute(
          {
            action: "search",
            query: "Slack Socket Mode xoxb xapp",
            maxResults: 5,
          },
          ctx,
        )
        const searchData = JSON.parse(search.output) as { results: Array<{ fileId: string }> }
        expect(searchData.results.length).toBeGreaterThan(0)
        expect(searchData.results.some((r) => r.fileId === writeData.fileId)).toBe(true)

        const get = await memory.execute(
          {
            action: "get",
            fileId: writeData.fileId,
          },
          ctx,
        )
        const getData = JSON.parse(get.output) as { text: string }
        expect(getData.text).toContain("Socket Mode")

        const list = await memory.execute(
          {
            action: "list",
          },
          ctx,
        )
        const listData = JSON.parse(list.output) as { files: Array<{ id: string }> }
        expect(listData.files.some((f) => f.id === writeData.fileId)).toBe(true)

        const del = await memory.execute(
          {
            action: "delete",
            fileId: writeData.fileId,
          },
          ctx,
        )
        expect(del.title).toContain("Deleted:")

        const after = await memory.execute(
          {
            action: "search",
            query: "Slack Socket Mode xoxb xapp",
            maxResults: 5,
          },
          ctx,
        )
        const afterData = JSON.parse(after.output) as { results: Array<{ fileId: string }> }
        expect(after.title).toBe("No memories found")
        expect(afterData.results.length).toBe(0)
      },
    })
  })
})
