import { describe, expect, test } from "bun:test"
import type { Config } from "@/config/config"
import type { Provider } from "@/provider/provider"
import { SessionCompaction } from "@/session/compaction"
import { Message } from "@/session/message"
import { Token } from "@/util/token"

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

function userMessage(id: string, text: string): Message.WithParts {
  return {
    info: userInfo(id),
    parts: [{ ...basePart(id, `p-${id}`), type: "text", text }] as Message.Part[],
  }
}

function assistantStepMessage(id: string, parentID: string, text: string): Message.WithParts {
  return {
    info: assistantInfo(id, parentID),
    parts: [
      { ...basePart(id, `p-${id}-step`), type: "step-start" },
      { ...basePart(id, `p-${id}-text`), type: "text", text },
    ] as Message.Part[],
  }
}

async function* stream(messages: Message.WithParts[]) {
  for (const message of messages) yield message
}

describe("build-session compaction tail selection", () => {
  test("compacts assistant step tails instead of emitting assistant-only tail markers", async () => {
    const preserveRecent = 8_000
    const messages: Message.WithParts[] = [
      userMessage("m-dispatch", "DISPATCH ANCHOR"),
      ...Array.from({ length: 50 }, (_, index) =>
        assistantStepMessage(`m-assistant-${index}`, "m-dispatch", `assistant ${index}\n${"x".repeat(12_000)}`),
      ),
    ]

    const selected = await SessionCompaction.TestHooks.selectCompactionInput({
      messages,
      config: { compaction: { tail_turns: 2, preserve_recent_tokens: preserveRecent } } as Config.Info,
      model: model(),
    })

    expect(selected.anchor_id).toBe("m-dispatch")
    expect(selected.tail_start_id).toBeUndefined()
    expect(selected.head.map((message) => message.info.id)).toEqual([
      ...Array.from({ length: 50 }, (_, index) => `m-assistant-${index}`),
    ])

    const selectedEstimate = Token.estimate(
      JSON.stringify(SessionCompaction.TestHooks.compactionTranscriptMessages(selected.head)),
    )
    expect(selectedEstimate).toBeGreaterThan(preserveRecent)
  })

  test("keeps low-volume assistant step sessions un-compacted when the recent tail covers the history", async () => {
    const messages: Message.WithParts[] = [
      userMessage("m-dispatch", "DISPATCH ANCHOR"),
      assistantStepMessage("m-assistant-0", "m-dispatch", "first step"),
      assistantStepMessage("m-assistant-1", "m-dispatch", "second step"),
    ]

    const selected = await SessionCompaction.TestHooks.selectCompactionInput({
      messages,
      config: { compaction: { tail_turns: 2, preserve_recent_tokens: 8_000 } } as Config.Info,
      model: model(),
    })

    expect(selected).toEqual({ head: [] })
  })

  test("still separates head and tail for ordinary multi-user sessions", async () => {
    const messages: Message.WithParts[] = [
      userMessage("m-u0", "first request"),
      assistantStepMessage("m-a0", "m-u0", "first answer"),
      userMessage("m-u1", "middle request"),
      assistantStepMessage("m-a1", "m-u1", "middle answer"),
      userMessage("m-u2", "tail request"),
      assistantStepMessage("m-a2", "m-u2", "tail answer"),
    ]

    const selected = await SessionCompaction.TestHooks.selectCompactionInput({
      messages,
      config: { compaction: { tail_turns: 2, preserve_recent_tokens: 8_000 } } as Config.Info,
      model: model(),
    })

    expect(selected.anchor_id).toBe("m-u0")
    expect(selected.tail_start_id).toBe("m-u2")
    expect(selected.head.map((message) => message.info.id)).toEqual(["m-a0", "m-u1", "m-a1"])
  })

  test("filterCompacted rejects anchored assistant tail_start_id markers", async () => {
    const compactionUser = "m-compaction-user"
    const compactionSummary = "m-compaction-summary"
    const anchor = "m-dispatch"
    const tailStart = "m-assistant-48"
    const tailEnd = "m-assistant-49"
    const newestFirst: Message.WithParts[] = [
      {
        info: {
          ...assistantInfo(compactionSummary, compactionUser),
          summary: true,
          finish: "stop",
          structured: {
            objective: "Preserve build-session assistant tail after compaction",
            acceptanceCriteria: ["The anchored assistant tail remains visible"],
            durableInstructionSources: [],
            activeBuildContracts: [],
            todos: [],
            workingContext: ["Assistant step tails must not be replayed without a real user turn boundary."],
            chronology: [
              {
                event: "Rejected assistant tail_start_id marker during compacted history filtering",
                evidence: tailStart,
              },
            ],
            currentState: {
              phase: "validating assistant tail",
              activeTask: "preserve assistant step tail",
              sourceUserMessage: {
                id: anchor,
                agent: "build",
                model: { providerID: "test", modelID: "test-model" },
                formatType: "text",
                systemMode: null,
                toolNames: [],
                variant: null,
                extraKeys: [],
              },
            },
            agentHandoff: {
              kind: "build",
              deliverables: [
                {
                  fact: "Assistant tail filtering is the build-session compaction deliverable",
                  evidence: tailStart,
                },
              ],
              codeChanges: [],
              verification: [],
              runtimeState: [
                {
                  fact: "Assistant step tail markers are rejected by compacted history filtering",
                  evidence: tailStart,
                },
              ],
              handoffArtifacts: [],
            },
            decisions: [],
            evidence: [],
            files: [],
            testsAndCommands: [],
            errorsAndBlockers: [],
            userMessages: [],
            nextActions: ["continue from the assistant step tail"],
            openRisks: [],
          },
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
            tail_start_id: tailStart,
            anchor_id: anchor,
          },
        ],
      },
      assistantStepMessage(tailEnd, anchor, "tail end"),
      assistantStepMessage(tailStart, anchor, "tail start"),
      assistantStepMessage("m-assistant-47", anchor, "compacted old step"),
      userMessage(anchor, "DISPATCH ANCHOR"),
    ] as Message.WithParts[]

    const result = await Message.filterCompacted(stream(newestFirst))

    expect(result.map((message) => message.info.id)).toEqual([compactionUser, compactionSummary])
  })
})
