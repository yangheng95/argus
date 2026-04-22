import { afterEach, expect, test } from "bun:test"
import { Instance } from "../../../src/project/instance"
import { Session } from "../../../src/session"
import { sessionStreamHooks } from "../../../src/agent/runtime/session-hooks"
import { resetDatabase } from "../../fixture/db"
import { tmpdir } from "../../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
})

test("tool-result closes the current stage message and preserves reasoning timing", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ kind: "assistant", title: "session hooks" })
      const hooks = sessionStreamHooks({ sessionID: session.id, taskID: "tsk_test" })

      const reasoningStartedAt = Date.now()
      await hooks.onChunk?.({
        chunk: {
          type: "reasoning-delta",
          text: "think first",
        },
      })

      await Bun.sleep(10)

      await hooks.onChunk?.({
        chunk: {
          type: "tool-input-start",
          toolName: "bash",
          id: "tool-input-1",
        },
      })
      await hooks.onChunk?.({
        chunk: {
          type: "tool-input-delta",
          id: "tool-input-1",
          delta: '{"command":"echo hi"}',
        },
      })
      await hooks.onChunk?.({
        chunk: {
          type: "tool-call",
          toolName: "bash",
          toolCallId: "call-1",
          input: { command: "echo hi" },
        },
      })

      const beforeToolResult = Date.now()
      await hooks.onChunk?.({
        chunk: {
          type: "tool-result",
          toolName: "bash",
          toolCallId: "call-1",
          input: { command: "echo hi" },
          output: "ok",
        },
      })
      await hooks.flush()

      const messages = await Session.messages({ sessionID: session.id })
      expect(messages).toHaveLength(1)

      const message = messages[0]
      if (message.info.role !== "assistant") throw new Error("expected assistant message")
      expect(message.info.time.completed).toBeDefined()
      expect(message.info.time.completed!).toBeGreaterThanOrEqual(beforeToolResult)

      const reasoning = message.parts.find((part) => part.type === "reasoning")
      expect(reasoning?.type).toBe("reasoning")
      if (reasoning?.type !== "reasoning") throw new Error("expected reasoning part")
      expect(reasoning.text).toBe("think first")
      expect(reasoning.time.start).toBeGreaterThanOrEqual(reasoningStartedAt)
      expect(reasoning.time.start).toBeLessThan(beforeToolResult)
      expect(reasoning.time.end).toBeDefined()
      expect(reasoning.time.end!).toBeGreaterThanOrEqual(reasoning.time.start)
    },
  })
})

test("flush marks interrupted tool calls as errors instead of completed", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ kind: "assistant", title: "session hooks" })
      const hooks = sessionStreamHooks({ sessionID: session.id, taskID: "tsk_test" })

      await hooks.onChunk?.({
        chunk: {
          type: "tool-input-start",
          toolName: "bash",
          id: "tool-input-1",
        },
      })
      await hooks.onChunk?.({
        chunk: {
          type: "tool-call",
          toolName: "bash",
          toolCallId: "call-1",
          input: { command: "echo hi" },
        },
      })

      await hooks.flush()

      const snapshot = hooks.failures.snapshot()
      expect(snapshot.count).toBe(1)
      expect(snapshot.items[0]?.kind).toBe("flush")

      const messages = await Session.messages({ sessionID: session.id })
      expect(messages).toHaveLength(1)

      const message = messages[0]
      if (message.info.role !== "assistant") throw new Error("expected assistant message")
      expect(message.info.time.completed).toBeDefined()

      const tool = message.parts.find((part) => part.type === "tool")
      expect(tool?.type).toBe("tool")
      if (tool?.type !== "tool") throw new Error("expected tool part")
      expect(tool.state.status).toBe("error")
      if (tool.state.status !== "error") throw new Error("expected error tool state")
      expect(tool.state.input).toEqual({ command: "echo hi" })
      expect(tool.state.error).toContain("interrupted")
    },
  })
})