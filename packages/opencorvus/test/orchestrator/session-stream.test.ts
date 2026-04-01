import { afterEach, expect, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { sessionStreamHooks } from "../../src/orchestrator/session-stream"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
})

test("session stream keeps same-name tool calls aligned by finalized input", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ title: "Session stream test" })
      const hooks = sessionStreamHooks({
        sessionID: session.id,
        taskID: Identifier.ascending("task"),
        stage: "goal",
      })

      await hooks.onChunk?.({
        chunk: { type: "tool-input-start", id: "input_pkg", toolName: "read_file" },
      } as never)
      await hooks.onChunk?.({
        chunk: { type: "tool-input-delta", id: "input_pkg", delta: "{\"path\":\"package.json\"}" },
      } as never)
      await hooks.onChunk?.({
        chunk: { type: "tool-input-start", id: "input_ts", toolName: "read_file" },
      } as never)
      await hooks.onChunk?.({
        chunk: { type: "tool-input-delta", id: "input_ts", delta: "{\"path\":\"tsconfig.json\"}" },
      } as never)

      await hooks.onChunk?.({
        chunk: {
          type: "tool-call",
          toolCallId: "call_ts",
          toolName: "read_file",
          input: { path: "tsconfig.json" },
        },
      } as never)
      await hooks.onChunk?.({
        chunk: {
          type: "tool-result",
          toolCallId: "call_ts",
          toolName: "read_file",
          input: { path: "tsconfig.json" },
          output: { output: "tsconfig body", title: "read_file" },
        },
      } as never)

      await hooks.onChunk?.({
        chunk: {
          type: "tool-call",
          toolCallId: "call_pkg",
          toolName: "read_file",
          input: { path: "package.json" },
        },
      } as never)
      await hooks.onChunk?.({
        chunk: {
          type: "tool-result",
          toolCallId: "call_pkg",
          toolName: "read_file",
          input: { path: "package.json" },
          output: { output: "package body", title: "read_file" },
        },
      } as never)

      await hooks.flush()

      const messages = await Session.messages({ sessionID: session.id })
      const toolParts = messages
        .flatMap((message) => message.parts)
        .filter((part) => part.type === "tool")

      expect(toolParts).toHaveLength(2)
      expect(toolParts.map((part: any) => part.callID).sort()).toEqual(["call_pkg", "call_ts"])
      expect(toolParts.map((part: any) => part.state.status)).toEqual(["completed", "completed"])

      const packagePart = toolParts.find((part: any) => part.callID === "call_pkg") as any
      const tsconfigPart = toolParts.find((part: any) => part.callID === "call_ts") as any

      expect(packagePart.state.input).toEqual({ path: "package.json" })
      expect(packagePart.state.output).toBe("package body")
      expect(tsconfigPart.state.input).toEqual({ path: "tsconfig.json" })
      expect(tsconfigPart.state.output).toBe("tsconfig body")
    },
  })
})
