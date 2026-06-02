import { describe, expect, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionCompaction } from "../../src/session/compaction"
import { CompactionHandoff } from "../../src/session/compaction-handoff"
import { Message } from "../../src/session/message"
import { SessionControl } from "../../src/session/control"
import type { Config } from "../../src/config/config"
import type { Provider } from "../../src/provider/provider"
import { tmpdir } from "../fixture/fixture"

const sessionID = "session"

function model(): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: {
      context: 1_000_000,
      output: 20_000,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: "@ai-sdk/anthropic" },
    options: {},
  } as Provider.Model
}

function userInfo(id: string): Message.User {
  return {
    id,
    sessionID,
    role: "user",
    time: { created: 0 },
    agent: "build",
    model: { providerID: "test", modelID: "test-model" },
  } as Message.User
}

function assistantInfo(id: string, parentID: string): Message.Assistant {
  return {
    id,
    sessionID,
    role: "assistant",
    time: { created: 0 },
    parentID,
    modelID: "test-model",
    providerID: "test",
    agent: "build",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  } as Message.Assistant
}

function basePart(messageID: string, id: string) {
  return {
    id,
    sessionID,
    messageID,
  }
}

function textMessage(id: string, role: "user" | "assistant", text: string, parentID?: string): Message.WithParts {
  const info = role === "user" ? userInfo(id) : assistantInfo(id, parentID ?? "missing-parent")
  return {
    info,
    parts: [{ ...basePart(id, `p-${id}`), type: "text", text }] as Message.Part[],
  }
}

function handoffFixture(sourceUserMessageID = "m-source"): CompactionHandoff.Info {
  return {
    objective: "Preserve the dispatcher anchor across compaction",
    acceptanceCriteria: ["The dispatch anchor remains verbatim in the visible message stream"],
    durableInstructionSources: [{ path: "/repo/AGENTS.md", role: "project rules" }],
    activeBuildContracts: [],
    todos: [],
    workingContext: [
      "The first dispatcher user message remains the visible anchor and must not be duplicated in userMessages.",
    ],
    chronology: [
      {
        event: "Separated dispatch anchor from the compactable post-anchor history",
        evidence: sourceUserMessageID,
      },
    ],
    currentState: {
      phase: "validating dispatch anchor preservation",
      activeTask: "keep the first user message visible after compaction",
      sourceUserMessage: {
        id: sourceUserMessageID,
        agent: "build",
        model: { providerID: "test", modelID: "test-model" },
        formatType: "text",
        systemMode: null,
        toolNames: [],
        variant: null,
        extraKeys: [],
      },
    },
    decisions: [],
    evidence: [],
    files: [],
    testsAndCommands: [],
    errorsAndBlockers: [],
    userMessages: ["Summarize only post-anchor turns."],
    nextActions: ["continue with the preserved dispatch anchor"],
    openRisks: [],
  }
}

async function* stream(messages: Message.WithParts[]) {
  for (const message of messages) yield message
}

describe("session compaction dispatch anchor", () => {
  test("selectCompactionInput skips compaction for one user message plus assistant turns", async () => {
    const messages: Message.WithParts[] = [
      textMessage("m-dispatch", "user", "DISPATCH ANCHOR"),
      ...Array.from({ length: 5 }, (_, index) =>
        textMessage(`m-assistant-${index}`, "assistant", `assistant turn ${index}`, "m-dispatch"),
      ),
    ]

    const selected = await SessionCompaction.TestHooks.selectCompactionInput({
      messages,
      config: { compaction: { tail_turns: 2 } } as Config.Info,
      model: model(),
    })

    expect(selected).toEqual({ head: [] })
  })

  test("selectCompactionInput separates anchor, compactable head, and preserved tail", async () => {
    const messages: Message.WithParts[] = [
      textMessage("m-dispatch", "user", "DISPATCH ANCHOR"),
      textMessage("m-a0", "assistant", "first answer", "m-dispatch"),
      textMessage("m-u1", "user", "middle user request"),
      textMessage("m-a1", "assistant", "middle answer", "m-u1"),
      textMessage("m-u2", "user", "tail user request"),
      textMessage("m-a2", "assistant", "tail answer", "m-u2"),
    ]

    const selected = await SessionCompaction.TestHooks.selectCompactionInput({
      messages,
      config: { compaction: { tail_turns: 1 } } as Config.Info,
      model: model(),
    })

    expect(selected.anchor_id).toBe("m-dispatch")
    expect(selected.tail_start_id).toBe("m-u2")
    expect(selected.head.map((message) => message.info.id)).toEqual(["m-a0", "m-u1", "m-a1"])
  })

  test("filterCompacted places the dispatch anchor before the compaction marker and preserved tail", async () => {
    const compactionUser = "m-compaction-user"
    const compactionSummary = "m-compaction-summary"
    const anchor = "m-dispatch"
    const tailUser = "m-tail-user"
    const tailAssistant = "m-tail-assistant"
    const newestFirst: Message.WithParts[] = [
      {
        info: {
          ...assistantInfo(compactionSummary, compactionUser),
          summary: true,
          finish: "stop",
          structured: handoffFixture("m-source"),
        },
        parts: [{ ...basePart(compactionSummary, "p-summary"), type: "text", text: "summary" }],
      },
      {
        info: userInfo(compactionUser),
        parts: [
          {
            ...basePart(compactionUser, "p-compaction"),
            type: "compaction",
            auto: true,
            tail_start_id: tailUser,
            anchor_id: anchor,
          },
        ],
      },
      textMessage(tailAssistant, "assistant", "tail answer", tailUser),
      textMessage(tailUser, "user", "tail request"),
      textMessage("m-middle-assistant", "assistant", "middle answer", "m-middle-user"),
      textMessage("m-middle-user", "user", "middle request"),
      textMessage(anchor, "user", "DISPATCH ANCHOR"),
    ] as Message.WithParts[]

    const result = await Message.filterCompacted(stream(newestFirst))

    expect(result.map((message) => message.info.id)).toEqual([
      anchor,
      compactionUser,
      compactionSummary,
      tailUser,
      tailAssistant,
    ])
    expect(result[0].parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "text", text: "DISPATCH ANCHOR" })]),
    )
  })

  test("filterCompacted keeps legacy tail_start_id-only markers unchanged", async () => {
    const compactionUser = "m-compaction-user"
    const compactionSummary = "m-compaction-summary"
    const tailUser = "m-tail-user"
    const tailAssistant = "m-tail-assistant"
    const newestFirst: Message.WithParts[] = [
      {
        info: {
          ...assistantInfo(compactionSummary, compactionUser),
          summary: true,
          finish: "stop",
          structured: handoffFixture("m-source"),
        },
        parts: [{ ...basePart(compactionSummary, "p-summary"), type: "text", text: "summary" }],
      },
      {
        info: userInfo(compactionUser),
        parts: [
          {
            ...basePart(compactionUser, "p-compaction"),
            type: "compaction",
            auto: true,
            tail_start_id: tailUser,
          },
        ],
      },
      textMessage(tailAssistant, "assistant", "tail answer", tailUser),
      textMessage(tailUser, "user", "tail request"),
      textMessage("m-old-assistant", "assistant", "old answer", "m-old-user"),
      textMessage("m-old-user", "user", "old request"),
    ] as Message.WithParts[]

    const result = await Message.filterCompacted(stream(newestFirst))

    expect(result.map((message) => message.info.id)).toEqual([
      tailUser,
      tailAssistant,
      compactionUser,
      compactionSummary,
    ])
  })

  test("created compaction request is control-only and leaves dispatch text in transcript", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant", title: "dispatch anchor compaction" })
        const dispatch = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "test", modelID: "test-model" },
        })
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: dispatch.id,
          sessionID: session.id,
          type: "text",
          text: "DISPATCH TEXT MUST SURVIVE",
        })
        const source = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() + 1 },
          agent: "build",
          model: { providerID: "test", modelID: "test-model" },
        })
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: source.id,
          sessionID: session.id,
          type: "text",
          text: "tail source",
        })
        expect(source.role).toBe("user")
        if (source.role !== "user") return

        await SessionCompaction.create({
          sessionID: session.id,
          source,
          auto: true,
          overflow: false,
        })
        const messages = await Session.messages({ sessionID: session.id })
        const marker = messages.find((message) => message.parts.some((part) => part.type === "compaction"))
        expect(marker).toBeUndefined()
        expect(JSON.stringify(messages)).toContain("DISPATCH TEXT MUST SURVIVE")
        const controls = SessionControl.pending(session.id)
        expect(controls).toHaveLength(1)
        expect(controls[0].kind).toBe("compaction_request")
        expect(controls[0].payload.source_user_message_id).toBe(source.id)
      },
    })
  })

  test("buildPrompt carries dispatch-anchor text while selected head excludes it", async () => {
    const messages: Message.WithParts[] = [
      textMessage("m-dispatch", "user", "DISPATCH ANCHOR"),
      textMessage("m-a0", "assistant", "first answer", "m-dispatch"),
      textMessage("m-u1", "user", "middle user request"),
      textMessage("m-a1", "assistant", "middle answer", "m-u1"),
      textMessage("m-u2", "user", "tail user request"),
    ]
    const selected = await SessionCompaction.TestHooks.selectCompactionInput({
      messages,
      config: { compaction: { tail_turns: 1 } } as Config.Info,
      model: model(),
    })
    const selectedWire = JSON.stringify(await Message.toModelMessages(selected.head, model()))
    const prompt = SessionCompaction.buildPrompt({
      previousSummary: undefined,
      runtime: "<handoff-runtime-state></handoff-runtime-state>",
      context: [],
      dispatchAnchor: "DISPATCH ANCHOR",
    })

    expect(prompt).toContain("<dispatch-anchor>\nDISPATCH ANCHOR\n</dispatch-anchor>")
    expect(prompt).toContain("Do not re-summarize it into userMessages[]")
    expect(selectedWire).not.toContain("DISPATCH ANCHOR")
  })

  test("compaction transcript flattens historical tool calls into inert text", () => {
    const assistant = assistantInfo("m-assistant", "m-user")
    const messages: Message.WithParts[] = [
      textMessage("m-user", "user", "Inspect the repository"),
      {
        info: assistant,
        parts: [
          {
            ...basePart(assistant.id, "p-tool"),
            type: "tool",
            callID: "call_read",
            tool: "read",
            state: {
              status: "completed",
              input: { filePath: "src/App.tsx" },
              output: "file contents",
              title: "Read",
              metadata: {},
              time: { start: 1, end: 2 },
            },
          },
        ],
      },
    ] as Message.WithParts[]

    const transcript = SessionCompaction.TestHooks.compactionTranscriptMessages(messages)
    const transcriptText = (transcript[0].content as Array<{ type: "text"; text: string }>)[0].text
    const wire = JSON.stringify(transcript)

    expect(transcript).toHaveLength(1)
    expect(transcript[0].role).toBe("user")
    expect(transcriptText).toContain('<tool name="read" status="completed">')
    expect(transcriptText).toContain("file contents")
    expect(wire).not.toContain('"type":"tool-call"')
    expect(wire).not.toContain('"type":"tool-result"')
    expect(wire).not.toContain('"role":"tool"')
  })

  test("compaction transcript keeps a 30k bounded head and tail for large tool output", () => {
    const assistant = assistantInfo("m-assistant", "m-user")
    const headMarker = "HEAD-REQUIREMENT-DO-NOT-LOSE"
    const middleMarker = "MIDDLE-SHOULD-BE-OMITTED"
    const tailMarker = "TAIL-NEXT-ACTION-DO-NOT-LOSE"
    const largeOutput = [headMarker, "x".repeat(25_000), middleMarker, "y".repeat(25_000), tailMarker].join("\n")
    const messages: Message.WithParts[] = [
      textMessage("m-user", "user", "Inspect the large build log"),
      {
        info: assistant,
        parts: [
          {
            ...basePart(assistant.id, "p-tool"),
            type: "tool",
            callID: "call_bash",
            tool: "bash",
            state: {
              status: "completed",
              input: { command: "bun test" },
              output: largeOutput,
              title: "Run tests",
              metadata: {},
              time: { start: 1, end: 2 },
            },
          },
        ],
      },
    ] as Message.WithParts[]

    const transcript = SessionCompaction.TestHooks.compactionTranscriptMessages(messages)
    const transcriptText = (transcript[0].content as Array<{ type: "text"; text: string }>)[0].text

    expect(transcriptText).toContain(headMarker)
    expect(transcriptText).toContain(tailMarker)
    expect(transcriptText).toContain("[omitted")
    expect(transcriptText).toContain("chars from compaction transcript")
    expect(transcriptText).not.toContain(middleMarker)
  })
})
