import { afterEach, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Message } from "../../src/session/message"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
})

const tokenUsage = {
  input: 0,
  output: 0,
  reasoning: 0,
  total: 0,
  cache: { read: 0, write: 0 },
}

async function createAssistantMessage(sessionID: string, directory: string) {
  return await Session.updateMessage({
    id: Identifier.ascending("message"),
    sessionID,
    role: "assistant",
    time: { created: Date.now() },
    parentID: "",
    modelID: "test-model",
    providerID: "test-provider",
    mode: "agent",
    agent: "test-agent",
    path: { cwd: directory, root: directory },
    cost: 0,
    tokens: tokenUsage,
  })
}

function completedToolPart(input: {
  sessionID: string
  messageID: string
  partID: string
  output: string
  compacted?: number
}): Message.ToolPart {
  return {
    id: input.partID,
    sessionID: input.sessionID,
    messageID: input.messageID,
    type: "tool",
    tool: "example_tool",
    callID: "call-1",
    state: {
      status: "completed",
      input: { command: "run" },
      output: input.output,
      title: "Example tool",
      metadata: {},
      time: { start: 1, end: 2, ...(input.compacted === undefined ? {} : { compacted: input.compacted }) },
    },
  }
}

function erroredToolPart(input: {
  sessionID: string
  messageID: string
  partID: string
  message: string
}): Message.ToolPart {
  return {
    id: input.partID,
    sessionID: input.sessionID,
    messageID: input.messageID,
    type: "tool",
    tool: "example_tool",
    callID: "call-1",
    state: {
      status: "error",
      input: { command: "run" },
      failure: {
        kind: "tool-execution",
        name: "Error",
        message: input.message,
        originSite: "tool-status-monotonicity.test",
        classification: "tool-execution",
      },
      metadata: {},
      time: { start: 1, end: 3 },
    },
  }
}

async function readToolPart(sessionID: string, partID: string): Promise<Message.ToolPart> {
  const messages = await Session.messages({ sessionID })
  const part = messages.flatMap((message) => message.parts).find((candidate) => candidate.id === partID)
  expect(part?.type).toBe("tool")
  return part as Message.ToolPart
}

async function collectPartUpdatedEvents<T>(fn: () => Promise<T>): Promise<{ result: T; parts: Message.Part[] }> {
  const parts: Message.Part[] = []
  const unsubscribe = Bus.subscribe(Message.Event.PartUpdated, (event) => {
    parts.push(event.properties.part)
  })
  try {
    const result = await fn()
    return { result, parts }
  } finally {
    unsubscribe()
  }
}

test("completed tool state is not overwritten by stale error update", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ kind: "assistant", title: "tool-status-terminal-order" })
      const message = await createAssistantMessage(session.id, tmp.path)
      const partID = Identifier.ascending("part")

      await Session.updatePart(
        completedToolPart({ sessionID: session.id, messageID: message.id, partID, output: "ok" }),
      )
      const stale = await collectPartUpdatedEvents(
        async () =>
          await Session.updatePart(
            erroredToolPart({ sessionID: session.id, messageID: message.id, partID, message: "late" }),
          ),
      )

      const stored = await readToolPart(session.id, partID)
      expect(stored.state.status).toBe("completed")
      if (stored.state.status === "completed") expect(stored.state.output).toBe("ok")
      expect(stale.parts).toEqual([])
    },
  })
})

test("error tool state is not overwritten by stale completed update", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ kind: "assistant", title: "tool-status-terminal-order" })
      const message = await createAssistantMessage(session.id, tmp.path)
      const partID = Identifier.ascending("part")

      await Session.updatePart(
        erroredToolPart({ sessionID: session.id, messageID: message.id, partID, message: "boom" }),
      )
      const stale = await collectPartUpdatedEvents(
        async () =>
          await Session.updatePart(
            completedToolPart({ sessionID: session.id, messageID: message.id, partID, output: "late" }),
          ),
      )

      const stored = await readToolPart(session.id, partID)
      expect(stored.state.status).toBe("error")
      if (stored.state.status === "error") expect(stored.state.failure.message).toBe("boom")
      expect(stale.parts).toEqual([])
    },
  })
})

test("same terminal tool state can refresh completed metadata", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ kind: "assistant", title: "tool-status-terminal-refresh" })
      const message = await createAssistantMessage(session.id, tmp.path)
      const partID = Identifier.ascending("part")

      await Session.updatePart(
        completedToolPart({ sessionID: session.id, messageID: message.id, partID, output: "ok" }),
      )
      const refreshed = await collectPartUpdatedEvents(
        async () =>
          await Session.updatePart(
            completedToolPart({ sessionID: session.id, messageID: message.id, partID, output: "ok", compacted: 123 }),
          ),
      )

      const stored = await readToolPart(session.id, partID)
      expect(stored.state.status).toBe("completed")
      if (stored.state.status === "completed") expect(stored.state.time.compacted).toBe(123)
      expect(refreshed.parts).toHaveLength(1)
      expect(refreshed.parts[0]?.type).toBe("tool")
    },
  })
})
