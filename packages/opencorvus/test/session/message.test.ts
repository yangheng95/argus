import { describe, expect, test } from "bun:test"
import { APICallError } from "ai"
import { convertToOpenAICompatibleChatMessages } from "@ai-sdk/openai-compatible/internal"
import { Message } from "../../src/session/message"
import { CompactionHandoff } from "../../src/session/compaction-handoff"
import { Instance } from "../../src/project/instance"
import { AttachmentStore } from "../../src/storage/attachment-store"
import type { Provider } from "../../src/provider/provider"
import { tmpdir } from "../fixture/fixture"

const sessionID = "session"
const model: Provider.Model = {
  id: "test-model",
  providerID: "test",
  api: {
    id: "test-model",
    url: "https://example.com",
    npm: "@ai-sdk/openai",
  },
  name: "Test Model",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: {
      text: true,
      audio: false,
      image: true,
      video: false,
      pdf: false,
    },
    output: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    },
    interleaved: false,
  },
  cost: {
    input: 0,
    output: 0,
    cache: {
      read: 0,
      write: 0,
    },
  },
  limit: {
    context: 0,
    input: 0,
    output: 0,
  },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

function userInfo(id: string): Message.User {
  return {
    id,
    sessionID,
    role: "user",
    time: { created: 0 },
    agent: "user",
    model: { providerID: "test", modelID: "test" },
    tools: {},
    mode: "",
  } as unknown as Message.User
}

function assistantInfo(
  id: string,
  parentID: string,
  error?: Message.Assistant["error"],
  meta?: { providerID: string; modelID: string },
): Message.Assistant {
  const infoModel = meta ?? { providerID: model.providerID, modelID: model.api.id }
  return {
    id,
    sessionID,
    role: "assistant",
    time: { created: 0 },
    error,
    parentID,
    modelID: infoModel.modelID,
    providerID: infoModel.providerID,
    mode: "",
    agent: "agent",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  } as unknown as Message.Assistant
}

function basePart(messageID: string, id: string) {
  return {
    id,
    sessionID,
    messageID,
  }
}

function handoffFixture(): CompactionHandoff.Info {
  return {
    objective: "Harden compaction handoff so sessions resume with requirements intact",
    acceptanceCriteria: ["Legacy prose summaries must not compact away older turns"],
    durableInstructionSources: [{ path: "/repo/AGENTS.md", role: "project rules" }],
    activeBuildContracts: [],
    todos: [],
    workingContext: ["Only structured compaction handoffs may become compacted history boundaries."],
    chronology: [
      {
        event: "Validated that legacy prose summaries do not compact away older turns",
        evidence: "packages/opencorvus/src/session/message.ts",
      },
    ],
    currentState: {
      phase: "validating compaction boundary behavior",
      activeTask: "update filterCompacted summary boundary validation",
      sourceUserMessage: {
        id: "m-source",
        agent: "build",
        model: { providerID: "test", modelID: "test" },
        formatType: "text",
        systemMode: null,
        toolNames: [],
        variant: null,
        extraKeys: [],
      },
    },
    decisions: [],
    evidence: [
      {
        kind: "file",
        value: "packages/opencorvus/src/session/message.ts",
        detail: "boundary check uses structured handoff validation",
      },
    ],
    files: [
      {
        path: "packages/opencorvus/src/session/message.ts",
        status: "modified",
        detail: "compaction boundary validation",
      },
    ],
    testsAndCommands: [],
    errorsAndBlockers: [],
    userMessages: ["Preserve compaction boundaries only when the handoff is structured."],
    nextActions: ["run targeted message tests for compaction boundary validation"],
    openRisks: [],
  }
}

describe("session.message.toModelMessage", () => {
  test("rejects text visibility split flags at the message boundary", () => {
    const base = {
      ...basePart("m-user", "p1"),
      type: "text",
      text: "hello",
    }

    expect(Message.Part.safeParse({ ...base, synthetic: true }).success).toBe(false)
    expect(Message.Part.safeParse({ ...base, ignored: true }).success).toBe(false)
    expect(Message.Part.safeParse({ ...base, audience: { ui: false } }).success).toBe(false)
    expect(Message.Part.safeParse({ ...base, channel: "assistant" }).success).toBe(false)
    expect(Message.Part.safeParse({ ...base, resolvedRole: "assistant" }).success).toBe(false)
  })

  test("filters out messages with no parts", async () => {
    const input: Message.WithParts[] = [
      {
        info: userInfo("m-empty"),
        parts: [],
      },
      {
        info: userInfo("m-user"),
        parts: [
          {
            ...basePart("m-user", "p1"),
            type: "text",
            text: "hello",
          },
        ] as Message.Part[],
      },
    ]

    expect(await Message.toModelMessages(input, model)).toStrictEqual([
      {
        role: "user",
        content: [{ type: "text", text: "hello" }],
      },
    ])
  })

  test("includes every user text part without visibility flags", async () => {
    const messageID = "m-user"

    const input: Message.WithParts[] = [
      {
        info: userInfo(messageID),
        parts: [
          {
            ...basePart(messageID, "p1"),
            type: "text",
            text: "visible",
          },
        ] as Message.Part[],
      },
    ]

    expect(await Message.toModelMessages(input, model)).toStrictEqual([
      {
        role: "user",
        content: [{ type: "text", text: "visible" }],
      },
    ])
  })

  test("includes every assistant text part without visibility flags", async () => {
    const messageID = "m-user"

    const input: Message.WithParts[] = [
      {
        info: userInfo(messageID),
        parts: [
          {
            ...basePart(messageID, "p1"),
            type: "text",
            text: "hello",
          },
        ] as Message.Part[],
      },
      {
        info: assistantInfo("m-assistant", messageID),
        parts: [
          {
            ...basePart("m-assistant", "a1"),
            type: "text",
            text: "assistant",
          },
        ] as Message.Part[],
      },
    ]

    expect(await Message.toModelMessages(input, model)).toStrictEqual([
      {
        role: "user",
        content: [{ type: "text", text: "hello" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "assistant" }],
      },
    ])
  })

  test("projects patch evidence with bounded text while preserving stored file list", async () => {
    const userID = "m-user"
    const assistantID = "m-assistant"
    const files = Array.from({ length: 4_000 }, (_, i) => `file-${i.toString().padStart(4, "0")}.ts`)

    const patchPart: Message.PatchPart = {
      ...basePart(assistantID, "patch-1"),
      type: "patch",
      hash: "snapshot-hash",
      files,
    }
    const input: Message.WithParts[] = [
      {
        info: userInfo(userID),
        parts: [
          {
            ...basePart(userID, "p1"),
            type: "text",
            text: "hello",
          },
        ] as Message.Part[],
      },
      {
        info: assistantInfo(assistantID, userID),
        parts: [patchPart],
      },
    ]

    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const output = await Message.toModelMessages(input, model)
        const assistant = output.at(-1)
        const serialized = JSON.stringify(assistant)
        expect(patchPart.files.length).toBe(4_000)
        expect(serialized).toContain("Patch evidence truncated: 4000 files total, 3960 omitted")
        expect(serialized).toContain("file-0000.ts")
        expect(serialized).toContain("file-3999.ts")
        expect(serialized).not.toContain("file-1000.ts")
        expect(serialized.length).toBeLessThan(3_000)
        // Patch breadcrumb must be wrapped in a <patch> XML tag so the
        // model treats it as a system-injected protocol element rather
        // than prose to mimic. The earlier `[Patch evidence ...]` form
        // was easy for the model to echo back as raw text, which then
        // persisted into assistant text parts and surfaced in the
        // overlay as un-chipped raw text. See session/message.ts:933+
        // and session/prompt/system.txt for the paired prompt clause.
        expect(serialized).toContain("<patch>Patch evidence truncated:")
        expect(serialized).toContain("</patch>")
        expect(serialized).not.toContain("[Patch evidence")
      },
    })
  })

  test("converts user text/file parts without injecting control parts into provider replay", async () => {
    const messageID = "m-user"

    const input: Message.WithParts[] = [
      {
        info: userInfo(messageID),
        parts: [
          {
            ...basePart(messageID, "p1"),
            type: "text",
            text: "hello",
          },
          {
            ...basePart(messageID, "p2"),
            type: "text",
            text: "second text",
          },
          {
            ...basePart(messageID, "p3"),
            type: "file",
            mime: "image/png",
            filename: "img.png",
            url: "https://example.com/img.png",
          },
          {
            ...basePart(messageID, "p4"),
            type: "file",
            mime: "text/plain",
            filename: "note.txt",
            url: "https://example.com/note.txt",
          },
          {
            ...basePart(messageID, "p5"),
            type: "file",
            mime: "application/x-directory",
            filename: "dir",
            url: "https://example.com/dir",
          },
          {
            ...basePart(messageID, "p6"),
            type: "compaction",
            auto: true,
          },
          {
            ...basePart(messageID, "p7"),
            type: "subtask",
            prompt: "prompt",
            description: "desc",
            agent: "agent",
          },
        ] as Message.Part[],
      },
    ]

    expect(await Message.toModelMessages(input, model)).toStrictEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "hello" },
          { type: "text", text: "second text" },
          {
            type: "file",
            mediaType: "image/png",
            filename: "img.png",
            data: "https://example.com/img.png",
          },
        ],
      },
    ])
  })

  test("injects compaction handoff as explicit runtime context instead of assistant replay", async () => {
    const userID = "m-source"
    const assistantID = "m-summary"
    const summary = {
      ...assistantInfo(assistantID, userID),
      summary: true,
      finish: "stop",
      structured: handoffFixture(),
    } satisfies Message.Assistant

    const result = await Message.toModelMessages(
      [
        {
          info: userInfo(userID),
          parts: [
            {
              ...basePart(userID, "p-user"),
              type: "text",
              text: "continue the build",
            },
          ] as Message.Part[],
        },
        {
          info: summary,
          parts: [
            {
              ...basePart(assistantID, "p-summary"),
              type: "text",
              text: "This internal summary should not replay as assistant content.",
            },
          ] as Message.Part[],
        },
      ],
      model,
    )

    expect(result).toHaveLength(1)
    expect(result[0].role).toBe("user")
    const wire = JSON.stringify(result)
    expect(wire).toContain("<compaction-handoff>")
    expect(wire).toContain("Harden compaction handoff so sessions resume with requirements intact")
    expect(wire).not.toContain('"role":"assistant"')
    expect(wire).not.toContain("This internal summary should not replay as assistant content.")
  })

  test("hydrates persisted AttachmentStore refs for provider-bound user file parts", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const messageID = "m-user-ref"
        const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
        const ref = await AttachmentStore.write(Instance.project.id, bytes, "image/png", "ref.png")

        const input: Message.WithParts[] = [
          {
            info: userInfo(messageID),
            parts: [
              {
                ...basePart(messageID, "p-ref"),
                type: "file",
                mime: "image/png",
                filename: "ref.png",
                url: ref.url,
              },
            ] as Message.Part[],
          },
        ]

        expect(await Message.toModelMessages(input, model)).toStrictEqual([
          {
            role: "user",
            content: [
              {
                type: "file",
                mediaType: "image/png",
                filename: "ref.png",
                data: `data:image/png;base64,${bytes.toString("base64")}`,
              },
            ],
          },
        ])
      },
    })
  }, 20000)

  test("converts assistant tool completion into tool-call + tool-result messages with attachments", async () => {
    const userID = "m-user"
    const assistantID = "m-assistant"

    const input: Message.WithParts[] = [
      {
        info: userInfo(userID),
        parts: [
          {
            ...basePart(userID, "u1"),
            type: "text",
            text: "run tool",
          },
        ] as Message.Part[],
      },
      {
        info: assistantInfo(assistantID, userID),
        parts: [
          {
            ...basePart(assistantID, "a1"),
            type: "text",
            text: "done",
            metadata: { openai: { assistant: "meta" } },
          },
          {
            ...basePart(assistantID, "a2"),
            type: "tool",
            callID: "call-1",
            tool: "bash",
            state: {
              status: "completed",
              input: { cmd: "ls" },
              output: "ok",
              title: "Bash",
              metadata: {},
              time: { start: 0, end: 1 },
              attachments: [
                {
                  ...basePart(assistantID, "file-1"),
                  type: "file",
                  mime: "image/png",
                  filename: "attachment.png",
                  url: "data:image/png;base64,Zm9v",
                },
              ],
            },
            metadata: { openai: { tool: "meta" } },
          },
        ] as Message.Part[],
      },
    ]

    expect(await await Message.toModelMessages(input, model)).toStrictEqual([
      {
        role: "user",
        content: [{ type: "text", text: "run tool" }],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "done", providerOptions: { openai: { assistant: "meta" } } },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "bash",
            input: { cmd: "ls" },
            providerExecuted: undefined,
            providerOptions: { openai: { tool: "meta" } },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "bash",
            output: {
              type: "content",
              value: [
                { type: "text", text: "ok" },
                { type: "image-data", mediaType: "image/png", data: "Zm9v" },
              ],
            },
            providerOptions: { openai: { tool: "meta" } },
          },
        ],
      },
    ])
  })

  test("compaction projection strips media and truncates large tool outputs", async () => {
    const userID = "m-user-compact"
    const assistantID = "m-assistant-compact"
    const input: Message.WithParts[] = [
      {
        info: userInfo(userID),
        parts: [
          {
            ...basePart(userID, "u1"),
            type: "text",
            text: "summarize this",
          },
          {
            ...basePart(userID, "u2"),
            type: "file",
            mime: "image/png",
            filename: "large.png",
            url: "data:image/png;base64,Zm9v",
          },
        ] as Message.Part[],
      },
      {
        info: assistantInfo(assistantID, userID),
        parts: [
          {
            ...basePart(assistantID, "a1"),
            type: "tool",
            callID: "call-compact",
            tool: "read",
            state: {
              status: "completed",
              input: { path: "huge.log" },
              output: "0123456789".repeat(20),
              title: "Read",
              metadata: {},
              time: { start: 0, end: 1 },
              attachments: [
                {
                  ...basePart(assistantID, "file-compact"),
                  type: "file",
                  mime: "image/png",
                  filename: "tool.png",
                  url: "data:image/png;base64,YmFy",
                },
              ],
            },
            metadata: {},
          },
        ] as Message.Part[],
      },
    ]

    const result = await Message.toModelMessages(input, model, {
      stripMedia: true,
      toolOutputMaxChars: 40,
    })
    const wire = JSON.stringify(result)

    expect(wire).toContain("[Attached image/png: large.png omitted from compaction context]")
    expect(wire).toContain("Tool output truncated for compaction")
    expect(wire).not.toContain("data:image/png;base64")
  })

  test("screenshot-only tool output (no text) emits image-data without an empty text part", async () => {
    // Regression: AI SDK v6 ToolModelOutput.content rejects items where the
    // discriminator type matches but the required field is undefined. Pre-fix
    // we always emitted `{type: "text", text: outputObject.text}` first; when
    // a tool produced only attachments (e.g. screen tool with no caption) the
    // text part landed with `text: undefined` and failed standardizePrompt
    // with `Invalid prompt: The messages do not match the ModelMessage[] schema`.
    // Assert the empty text part is gone AND no project-scoped media-type
    // shape leaks back in.
    const userID = "m-user"
    const assistantID = "m-assistant"

    const input: Message.WithParts[] = [
      {
        info: userInfo(userID),
        parts: [
          {
            ...basePart(userID, "u1"),
            type: "text",
            text: "screenshot please",
          },
        ] as Message.Part[],
      },
      {
        info: assistantInfo(assistantID, userID),
        parts: [
          {
            ...basePart(assistantID, "a1"),
            type: "tool",
            callID: "call-screen-1",
            tool: "screen",
            state: {
              status: "completed",
              input: { region: "active" },
              output: "",
              title: "Screen",
              metadata: {},
              time: { start: 0, end: 1 },
              attachments: [
                {
                  ...basePart(assistantID, "file-1"),
                  type: "file",
                  mime: "image/png",
                  filename: "shot.png",
                  url: "data:image/png;base64,UE5H",
                },
              ],
            },
            metadata: {},
          },
        ] as Message.Part[],
      },
    ]

    const result = await await Message.toModelMessages(input, model)
    const toolMsg = result.find((m: { role: string }) => m.role === "tool") as
      | {
          role: "tool"
          content: Array<{
            type: string
            output: { type: string; value: Array<{ type: string; text?: string; data?: string }> }
          }>
        }
      | undefined
    expect(toolMsg).toBeDefined()
    const output = toolMsg!.content[0].output
    expect(output.type).toBe("content")
    // No empty text part survived.
    expect(output.value.find((p) => p.type === "text")).toBeUndefined()
    // The attachment landed under the v6 `image-data` discriminator (not the
    // deprecated `media` shape).
    const imagePart = output.value.find((p) => p.type === "image-data")
    expect(imagePart).toBeDefined()
    expect(imagePart!.data).toBe("UE5H")
  })

  test("omits provider metadata when assistant model differs", async () => {
    const userID = "m-user"
    const assistantID = "m-assistant"

    const input: Message.WithParts[] = [
      {
        info: userInfo(userID),
        parts: [
          {
            ...basePart(userID, "u1"),
            type: "text",
            text: "run tool",
          },
        ] as Message.Part[],
      },
      {
        info: assistantInfo(assistantID, userID, undefined, { providerID: "other", modelID: "other" }),
        parts: [
          {
            ...basePart(assistantID, "a1"),
            type: "text",
            text: "done",
            metadata: { openai: { assistant: "meta" } },
          },
          {
            ...basePart(assistantID, "a2"),
            type: "tool",
            callID: "call-1",
            tool: "bash",
            state: {
              status: "completed",
              input: { cmd: "ls" },
              output: "ok",
              title: "Bash",
              metadata: {},
              time: { start: 0, end: 1 },
            },
            metadata: { openai: { tool: "meta" } },
          },
        ] as Message.Part[],
      },
    ]

    expect(await Message.toModelMessages(input, model)).toStrictEqual([
      {
        role: "user",
        content: [{ type: "text", text: "run tool" }],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "done" },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "bash",
            input: { cmd: "ls" },
            providerExecuted: undefined,
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "bash",
            output: { type: "text", value: "ok" },
          },
        ],
      },
    ])
  })

  test("replaces compacted tool output with placeholder", async () => {
    const userID = "m-user"
    const assistantID = "m-assistant"

    const input: Message.WithParts[] = [
      {
        info: userInfo(userID),
        parts: [
          {
            ...basePart(userID, "u1"),
            type: "text",
            text: "run tool",
          },
        ] as Message.Part[],
      },
      {
        info: assistantInfo(assistantID, userID),
        parts: [
          {
            ...basePart(assistantID, "a1"),
            type: "tool",
            callID: "call-1",
            tool: "bash",
            state: {
              status: "completed",
              input: { cmd: "ls" },
              output: "this should be cleared",
              title: "Bash",
              metadata: {},
              time: { start: 0, end: 1, compacted: 1 },
            },
          },
        ] as Message.Part[],
      },
    ]

    expect(await Message.toModelMessages(input, model)).toStrictEqual([
      {
        role: "user",
        content: [{ type: "text", text: "run tool" }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "bash",
            input: { cmd: "ls" },
            providerExecuted: undefined,
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "bash",
            output: { type: "text", value: "[Old tool result content cleared]" },
          },
        ],
      },
    ])
  })

  test("converts assistant tool error into error-text tool result", async () => {
    const userID = "m-user"
    const assistantID = "m-assistant"

    const input: Message.WithParts[] = [
      {
        info: userInfo(userID),
        parts: [
          {
            ...basePart(userID, "u1"),
            type: "text",
            text: "run tool",
          },
        ] as Message.Part[],
      },
      {
        info: assistantInfo(assistantID, userID),
        parts: [
          {
            ...basePart(assistantID, "a1"),
            type: "tool",
            callID: "call-1",
            tool: "bash",
            state: {
              status: "error",
              input: { cmd: "ls" },
              failure: {
                kind: "tool-execute-error",
                name: "Error",
                message: "nope",
                originSite: "test",
                classification: "tool-execution",
              },
              time: { start: 0, end: 1 },
              metadata: {},
            },
            metadata: { openai: { tool: "meta" } },
          },
        ] as Message.Part[],
      },
    ]

    expect(await Message.toModelMessages(input, model)).toStrictEqual([
      {
        role: "user",
        content: [{ type: "text", text: "run tool" }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "bash",
            input: { cmd: "ls" },
            providerExecuted: undefined,
            providerOptions: { openai: { tool: "meta" } },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "bash",
            output: { type: "error-text", value: "tool-execute-error/Error at test: nope" },
            providerOptions: { openai: { tool: "meta" } },
          },
        ],
      },
    ])
  })

  test("filters assistant messages with non-abort errors", async () => {
    const assistantID = "m-assistant"

    const input: Message.WithParts[] = [
      {
        info: assistantInfo(
          assistantID,
          "m-parent",
          new Message.APIError({ message: "boom", isRetryable: true }).toObject() as Message.APIError,
        ),
        parts: [
          {
            ...basePart(assistantID, "a1"),
            type: "text",
            text: "should not render",
          },
        ] as Message.Part[],
      },
    ]

    expect(await Message.toModelMessages(input, model)).toStrictEqual([])
  })

  test("preserves assistant-level errors in compaction projection", async () => {
    const assistantID = "m-assistant"
    const input: Message.WithParts[] = [
      {
        info: assistantInfo(
          assistantID,
          "m-parent",
          new Message.ContextOverflowError({ message: "context too large" }).toObject(),
        ),
        parts: [{ ...basePart(assistantID, "a1"), type: "text", text: "partial diagnostic" }] as Message.Part[],
      },
    ]

    const result = await Message.toModelMessages(input, model, { preserveAssistantErrors: true })

    expect(JSON.stringify(result)).toContain("ContextOverflowError")
    expect(JSON.stringify(result)).toContain("context too large")
    expect(JSON.stringify(result)).toContain("partial diagnostic")
  })

  test("includes aborted assistant messages only when they have non-step-start/reasoning content", async () => {
    const assistantID1 = "m-assistant-1"
    const assistantID2 = "m-assistant-2"

    const aborted = new Message.AbortedError({ message: "aborted" }).toObject() as Message.Assistant["error"]

    const input: Message.WithParts[] = [
      {
        info: assistantInfo(assistantID1, "m-parent", aborted),
        parts: [
          {
            ...basePart(assistantID1, "a1"),
            type: "reasoning",
            text: "thinking",
            time: { start: 0 },
          },
          {
            ...basePart(assistantID1, "a2"),
            type: "text",
            text: "partial answer",
          },
        ] as Message.Part[],
      },
      {
        info: assistantInfo(assistantID2, "m-parent", aborted),
        parts: [
          {
            ...basePart(assistantID2, "b1"),
            type: "step-start",
          },
          {
            ...basePart(assistantID2, "b2"),
            type: "reasoning",
            text: "thinking",
            time: { start: 0 },
          },
        ] as Message.Part[],
      },
    ]

    expect(await Message.toModelMessages(input, model)).toStrictEqual([
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "thinking", providerOptions: undefined },
          { type: "text", text: "partial answer" },
        ],
      },
    ])
  })

  test("splits assistant messages on step-start boundaries", async () => {
    const assistantID = "m-assistant"

    const input: Message.WithParts[] = [
      {
        info: assistantInfo(assistantID, "m-parent"),
        parts: [
          {
            ...basePart(assistantID, "p1"),
            type: "text",
            text: "first",
          },
          {
            ...basePart(assistantID, "p2"),
            type: "step-start",
          },
          {
            ...basePart(assistantID, "p3"),
            type: "text",
            text: "second",
          },
        ] as Message.Part[],
      },
    ]

    expect(await Message.toModelMessages(input, model)).toStrictEqual([
      {
        role: "assistant",
        content: [{ type: "text", text: "first" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "second" }],
      },
    ])
  })

  test("drops messages that only contain step-start parts", async () => {
    const assistantID = "m-assistant"

    const input: Message.WithParts[] = [
      {
        info: assistantInfo(assistantID, "m-parent"),
        parts: [
          {
            ...basePart(assistantID, "p1"),
            type: "step-start",
          },
        ] as Message.Part[],
      },
    ]

    expect(await Message.toModelMessages(input, model)).toStrictEqual([])
  })

  test("converts tool failures with structured cause text and original input", async () => {
    const userID = "m-user"
    const assistantID = "m-assistant"

    const input: Message.WithParts[] = [
      {
        info: userInfo(userID),
        parts: [
          {
            ...basePart(userID, "u1"),
            type: "text",
            text: "run tool",
          },
        ] as Message.Part[],
      },
      {
        info: assistantInfo(assistantID, userID),
        parts: [
          {
            ...basePart(assistantID, "a2"),
            type: "tool",
            callID: "call-running",
            tool: "read",
            state: {
              status: "error",
              input: [],
              failure: {
                kind: "tool-input-invalid",
                name: "InvalidToolInputError",
                message: "Expected object, received array",
                originSite: "session.processor.tool-error",
                classification: "tool-input-invalid",
              },
              time: { start: 0, end: 1 },
            },
          },
        ] as Message.Part[],
      },
    ]

    const result = await Message.toModelMessages(input, model)

    expect(result).toStrictEqual([
      {
        role: "user",
        content: [{ type: "text", text: "run tool" }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-running",
            toolName: "read",
            input: {},
            providerExecuted: undefined,
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-running",
            toolName: "read",
            output: {
              type: "error-text",
              value:
                "tool-input-invalid/InvalidToolInputError at session.processor.tool-error: Expected object, received array",
            },
          },
        ],
      },
    ])
  })

  test("normalizes persisted string tool inputs before provider replay", async () => {
    const userID = "m-user-string-input"
    const assistantID = "m-assistant-string-input"
    const input: Message.WithParts[] = [
      {
        info: userInfo(userID),
        parts: [{ ...basePart(userID, "u1"), type: "text", text: "run tool" }] as Message.Part[],
      },
      {
        info: assistantInfo(assistantID, userID),
        parts: [
          {
            ...basePart(assistantID, "a1"),
            type: "tool",
            callID: "call-string",
            tool: "read",
            state: {
              status: "completed",
              input: '{"path":"src/index.ts"}',
              output: "ok",
              title: "Read",
              metadata: {},
              attachments: [],
              time: { start: 0, end: 1 },
            },
          },
        ] as Message.Part[],
      },
    ]

    const result = await Message.toModelMessages(input, model)
    expect((result[1] as any).content[0].input).toEqual({ path: "src/index.ts" })

    const bodyMessages = convertToOpenAICompatibleChatMessages(result as any)
    expect(bodyMessages[1].tool_calls[0].function.arguments).toBe('{"path":"src/index.ts"}')
  })

  test("projects earlier stateful-snapshot tool results to a superseded note", async () => {
    const firstAssistant = "m-a1"
    const secondUser = "m-u2"
    const secondAssistant = "m-a2"

    const input: Message.WithParts[] = [
      {
        info: userInfo("m-u1"),
        parts: [{ ...basePart("m-u1", "u1"), type: "text", text: "check state" }] as Message.Part[],
      },
      {
        info: assistantInfo(firstAssistant, "m-u1"),
        parts: [
          {
            ...basePart(firstAssistant, "a1-tool"),
            type: "tool",
            callID: "call-first",
            tool: "read_context",
            state: {
              status: "completed",
              input: { scope: "decisions" },
              output: "SNAPSHOT_OLD: decision audit drilldown (4000 tokens of evidence)",
              title: "read_context",
              metadata: {},
              time: { start: 0, end: 1 },
            },
          },
        ] as Message.Part[],
      },
      {
        info: userInfo(secondUser),
        parts: [{ ...basePart(secondUser, "u2"), type: "text", text: "check again" }] as Message.Part[],
      },
      {
        info: assistantInfo(secondAssistant, secondUser),
        parts: [
          {
            ...basePart(secondAssistant, "a2-tool"),
            type: "tool",
            callID: "call-latest",
            tool: "read_context",
            state: {
              status: "completed",
              input: { scope: "decisions" },
              output: "SNAPSHOT_LATEST: current decision audit",
              title: "read_context",
              metadata: {},
              time: { start: 2, end: 3 },
            },
          },
        ] as Message.Part[],
      },
    ]

    const out = await Message.toModelMessages(input, model)
    // Find the two tool-result messages and inspect their output values.
    const toolResults = out
      .filter((m) => m.role === "tool")
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .filter((c: any) => c.type === "tool-result") as Array<{
      toolCallId: string
      output: { type: string; value: string }
    }>

    expect(toolResults.length).toBe(2)
    const first = toolResults.find((r) => r.toolCallId === "call-first")!
    const latest = toolResults.find((r) => r.toolCallId === "call-latest")!
    expect(first.output.value).toBe("[read_context snapshot superseded by a later call in this session]")
    expect(latest.output.value).toBe("SNAPSHOT_LATEST: current decision audit")
    // Make sure we did not drop the old payload's original bytes before projection ran
    expect(first.output.value).not.toContain("SNAPSHOT_OLD")
  })

  test("does not project non-stateful tool results (e.g. bash) across turns", async () => {
    const input: Message.WithParts[] = [
      {
        info: userInfo("m-u1"),
        parts: [{ ...basePart("m-u1", "u1"), type: "text", text: "run" }] as Message.Part[],
      },
      {
        info: assistantInfo("m-a1", "m-u1"),
        parts: [
          {
            ...basePart("m-a1", "a1"),
            type: "tool",
            callID: "bash-1",
            tool: "bash",
            state: {
              status: "completed",
              input: { cmd: "ls" },
              output: "OUTPUT_FIRST",
              title: "Bash",
              metadata: {},
              time: { start: 0, end: 1 },
            },
          },
        ] as Message.Part[],
      },
      {
        info: userInfo("m-u2"),
        parts: [{ ...basePart("m-u2", "u2"), type: "text", text: "again" }] as Message.Part[],
      },
      {
        info: assistantInfo("m-a2", "m-u2"),
        parts: [
          {
            ...basePart("m-a2", "a2"),
            type: "tool",
            callID: "bash-2",
            tool: "bash",
            state: {
              status: "completed",
              input: { cmd: "pwd" },
              output: "OUTPUT_SECOND",
              title: "Bash",
              metadata: {},
              time: { start: 2, end: 3 },
            },
          },
        ] as Message.Part[],
      },
    ]

    const out = await Message.toModelMessages(input, model)
    const toolResults = out
      .filter((m) => m.role === "tool")
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .filter((c: any) => c.type === "tool-result") as Array<{
      toolCallId: string
      output: { type: string; value: string }
    }>
    expect(toolResults.length).toBe(2)
    expect(toolResults[0].output.value).toBe("OUTPUT_FIRST")
    expect(toolResults[1].output.value).toBe("OUTPUT_SECOND")
  })

  test("keeps a single stateful-snapshot call unchanged when it is the only one", async () => {
    const input: Message.WithParts[] = [
      {
        info: userInfo("m-u1"),
        parts: [{ ...basePart("m-u1", "u1"), type: "text", text: "check state once" }] as Message.Part[],
      },
      {
        info: assistantInfo("m-a1", "m-u1"),
        parts: [
          {
            ...basePart("m-a1", "a1"),
            type: "tool",
            callID: "only",
            tool: "query_failed_goals",
            state: {
              status: "completed",
              input: {},
              output: "FAILED_GOALS_SNAPSHOT",
              title: "query_failed_goals",
              metadata: {},
              time: { start: 0, end: 1 },
            },
          },
        ] as Message.Part[],
      },
    ]

    const out = await Message.toModelMessages(input, model)
    const toolResults = out
      .filter((m) => m.role === "tool")
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .filter((c: any) => c.type === "tool-result") as Array<{
      toolCallId: string
      output: { type: string; value: string }
    }>
    expect(toolResults.length).toBe(1)
    expect(toolResults[0].output.value).toBe("FAILED_GOALS_SNAPSHOT")
  })

  test("preserves reasoning on every assistant message — no strip (cache + Anthropic protocol)", async () => {
    // Locks in pass-through. Stripping older reasoning was tried and
    // reverted because it broke prompt-cache hits (cache prefix bytes
    // change every turn) and risked Anthropic's thinking+tool_use
    // protocol requirement. See toModelMessages comment for the full
    // rationale.
    const turn = (i: number): Message.WithParts[] => [
      {
        info: userInfo(`u${i}`),
        parts: [{ ...basePart(`u${i}`, `up${i}`), type: "text", text: `q${i}` }] as Message.Part[],
      },
      {
        info: assistantInfo(`a${i}`, `u${i}`),
        parts: [
          {
            ...basePart(`a${i}`, `ar${i}`),
            type: "reasoning",
            text: `thought-${i}`,
            time: { start: 0 },
          },
          {
            ...basePart(`a${i}`, `at${i}`),
            type: "text",
            text: `answer-${i}`,
          },
        ] as Message.Part[],
      },
    ]
    const input: Message.WithParts[] = [...turn(1), ...turn(2), ...turn(3)]
    const out = await Message.toModelMessages(input, model)

    const reasoningTexts: string[] = []
    for (const msg of out) {
      if (msg.role !== "assistant") continue
      const content = Array.isArray(msg.content) ? msg.content : []
      for (const part of content as Array<{ type: string; text?: string }>) {
        if (part.type === "reasoning" && typeof part.text === "string") {
          reasoningTexts.push(part.text)
        }
      }
    }
    expect(reasoningTexts).toStrictEqual(["thought-1", "thought-2", "thought-3"])
  })

  test("omits assistant reasoning only for compaction projection", async () => {
    const input: Message.WithParts[] = [
      {
        info: userInfo("u-compaction-reasoning"),
        parts: [
          { ...basePart("u-compaction-reasoning", "up"), type: "text", text: "continue rewrite" },
        ] as Message.Part[],
      },
      {
        info: assistantInfo("a-compaction-reasoning", "u-compaction-reasoning"),
        parts: [
          {
            ...basePart("a-compaction-reasoning", "ar"),
            type: "reasoning",
            text: "The user is asking me to select a tool for the current issue.",
            time: { start: 0 },
          },
          {
            ...basePart("a-compaction-reasoning", "at"),
            type: "text",
            text: "Read KeyStatisticsMT.cs and started the TS rewrite.",
          },
        ] as Message.Part[],
      },
    ]

    const out = await Message.toModelMessages(input, model, { omitAssistantReasoning: true })
    const wire = JSON.stringify(out)

    expect(wire).toContain("Read KeyStatisticsMT.cs")
    expect(wire).not.toContain("select a tool")
    expect(wire).not.toContain("reasoning")
  })
})

describe("session.message.filterCompacted", () => {
  async function* stream(messages: Message.WithParts[]) {
    for (const message of messages) yield message
  }

  test("keeps the completed compaction summary and all newer turns", async () => {
    const compactionUser = "m-compaction-user"
    const compactionSummary = "m-compaction-summary"
    const recentUser = "m-recent-user"
    const recentAssistant = "m-recent-assistant"

    const newestFirst: Message.WithParts[] = [
      {
        info: assistantInfo(recentAssistant, recentUser),
        parts: [{ ...basePart(recentAssistant, "p-recent-assistant"), type: "text", text: "recent answer" }],
      },
      {
        info: userInfo(recentUser),
        parts: [{ ...basePart(recentUser, "p-recent-user"), type: "text", text: "recent question" }],
      },
      {
        info: {
          ...assistantInfo(compactionSummary, compactionUser),
          summary: true,
          finish: "stop",
          structured: handoffFixture(),
        },
        parts: [{ ...basePart(compactionSummary, "p-summary"), type: "text", text: "summary" }],
      },
      {
        info: userInfo(compactionUser),
        parts: [{ ...basePart(compactionUser, "p-compaction"), type: "compaction", auto: true }],
      },
      {
        info: assistantInfo("m-old-assistant", "m-old-user"),
        parts: [{ ...basePart("m-old-assistant", "p-old-assistant"), type: "text", text: "old answer" }],
      },
      {
        info: userInfo("m-old-user"),
        parts: [{ ...basePart("m-old-user", "p-old-user"), type: "text", text: "old question" }],
      },
    ] as Message.WithParts[]

    const result = await Message.filterCompacted(stream(newestFirst))

    expect(result.map((message) => message.info.id)).toEqual([
      compactionUser,
      compactionSummary,
      recentUser,
      recentAssistant,
    ])
  })

  test("retains exact recent tail when compaction stores tail_start_id", async () => {
    const compactionUser = "m-compaction-user"
    const compactionSummary = "m-compaction-summary"
    const retainedUser = "m-retained-user"
    const retainedAssistant = "m-retained-assistant"
    const recentUser = "m-recent-user"
    const recentAssistant = "m-recent-assistant"

    const newestFirst: Message.WithParts[] = [
      {
        info: assistantInfo(recentAssistant, recentUser),
        parts: [{ ...basePart(recentAssistant, "p-recent-assistant"), type: "text", text: "recent answer" }],
      },
      {
        info: userInfo(recentUser),
        parts: [{ ...basePart(recentUser, "p-recent-user"), type: "text", text: "recent question" }],
      },
      {
        info: {
          ...assistantInfo(compactionSummary, compactionUser),
          summary: true,
          finish: "stop",
          structured: handoffFixture(),
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
            tail_start_id: retainedUser,
          },
        ],
      },
      {
        info: assistantInfo(retainedAssistant, retainedUser),
        parts: [{ ...basePart(retainedAssistant, "p-retained-assistant"), type: "text", text: "retained answer" }],
      },
      {
        info: userInfo(retainedUser),
        parts: [{ ...basePart(retainedUser, "p-retained-user"), type: "text", text: "retained question" }],
      },
      {
        info: assistantInfo("m-old-assistant", "m-old-user"),
        parts: [{ ...basePart("m-old-assistant", "p-old-assistant"), type: "text", text: "old answer" }],
      },
      {
        info: userInfo("m-old-user"),
        parts: [{ ...basePart("m-old-user", "p-old-user"), type: "text", text: "old question" }],
      },
    ] as Message.WithParts[]

    const result = await Message.filterCompacted(stream(newestFirst))

    expect(result.map((message) => message.info.id)).toEqual([
      retainedUser,
      retainedAssistant,
      compactionUser,
      compactionSummary,
      recentUser,
      recentAssistant,
    ])
  })

  test("rejects compaction tail markers that point to an assistant-only suffix", async () => {
    const compactionUser = "m-compaction-user"
    const compactionSummary = "m-compaction-summary"
    const retainedUser = "m-retained-user"
    const retainedAssistant = "m-retained-assistant"
    const newestFirst: Message.WithParts[] = [
      {
        info: {
          ...assistantInfo(compactionSummary, compactionUser),
          summary: true,
          finish: "stop",
          structured: handoffFixture(),
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
            tail_start_id: retainedAssistant,
          },
        ],
      },
      {
        info: assistantInfo(retainedAssistant, retainedUser),
        parts: [{ ...basePart(retainedAssistant, "p-retained-assistant"), type: "text", text: "assistant suffix" }],
      },
      {
        info: userInfo(retainedUser),
        parts: [{ ...basePart(retainedUser, "p-retained-user"), type: "text", text: "retained question" }],
      },
    ] as Message.WithParts[]

    const result = await Message.filterCompacted(stream(newestFirst))

    expect(result.map((message) => message.info.id)).toEqual([compactionUser, compactionSummary])
  })

  test("compacts marker-on-anchor history without a preserved tail", async () => {
    const anchor = "m-dispatch"
    const summary = "m-compaction-summary"
    const recentUser = "m-recent-user"
    const recentAssistant = "m-recent-assistant"
    const newestFirst: Message.WithParts[] = [
      {
        info: assistantInfo(recentAssistant, recentUser),
        parts: [{ ...basePart(recentAssistant, "p-recent-assistant"), type: "text", text: "recent answer" }],
      },
      {
        info: userInfo(recentUser),
        parts: [{ ...basePart(recentUser, "p-recent-user"), type: "text", text: "recent question" }],
      },
      {
        info: {
          ...assistantInfo(summary, anchor),
          summary: true,
          finish: "stop",
          structured: handoffFixture(),
        },
        parts: [{ ...basePart(summary, "p-summary"), type: "text", text: "summary" }],
      },
      {
        info: assistantInfo("m-covered-newer", anchor),
        parts: [{ ...basePart("m-covered-newer", "p-covered-newer"), type: "text", text: "covered newer" }],
      },
      {
        info: assistantInfo("m-covered-older", anchor),
        parts: [{ ...basePart("m-covered-older", "p-covered-older"), type: "text", text: "covered older" }],
      },
      {
        info: userInfo(anchor),
        parts: [
          { ...basePart(anchor, "p-anchor-text"), type: "text", text: "DISPATCH ANCHOR" },
          { ...basePart(anchor, "p-anchor-compaction"), type: "compaction", auto: true, anchor_id: anchor },
        ],
      },
    ] as Message.WithParts[]

    const result = await Message.filterCompacted(stream(newestFirst))

    expect(result.map((message) => message.info.id)).toEqual([anchor, summary, recentUser, recentAssistant])
  })

  test("compacts marker-on-anchor history while preserving a real user tail", async () => {
    const anchor = "m-dispatch"
    const summary = "m-compaction-summary"
    const tailUser = "m-tail-user"
    const tailAssistant = "m-tail-assistant"
    const newestFirst: Message.WithParts[] = [
      {
        info: {
          ...assistantInfo(summary, anchor),
          summary: true,
          finish: "stop",
          structured: handoffFixture(),
        },
        parts: [{ ...basePart(summary, "p-summary"), type: "text", text: "summary" }],
      },
      {
        info: assistantInfo(tailAssistant, tailUser),
        parts: [{ ...basePart(tailAssistant, "p-tail-assistant"), type: "text", text: "tail answer" }],
      },
      {
        info: userInfo(tailUser),
        parts: [{ ...basePart(tailUser, "p-tail-user"), type: "text", text: "tail request" }],
      },
      {
        info: assistantInfo("m-covered", anchor),
        parts: [{ ...basePart("m-covered", "p-covered"), type: "text", text: "covered history" }],
      },
      {
        info: userInfo(anchor),
        parts: [
          { ...basePart(anchor, "p-anchor-text"), type: "text", text: "DISPATCH ANCHOR" },
          {
            ...basePart(anchor, "p-anchor-compaction"),
            type: "compaction",
            auto: true,
            anchor_id: anchor,
            tail_start_id: tailUser,
          },
        ],
      },
    ] as Message.WithParts[]

    const result = await Message.filterCompacted(stream(newestFirst))

    expect(result.map((message) => message.info.id)).toEqual([anchor, summary, tailUser, tailAssistant])
  })

  test("rejects marker-on-anchor tails that point to an assistant-only suffix", async () => {
    const anchor = "m-dispatch"
    const summary = "m-compaction-summary"
    const tailUser = "m-tail-user"
    const tailAssistant = "m-tail-assistant"
    const newestFirst: Message.WithParts[] = [
      {
        info: {
          ...assistantInfo(summary, anchor),
          summary: true,
          finish: "stop",
          structured: handoffFixture(),
        },
        parts: [{ ...basePart(summary, "p-summary"), type: "text", text: "summary" }],
      },
      {
        info: assistantInfo(tailAssistant, tailUser),
        parts: [{ ...basePart(tailAssistant, "p-tail-assistant"), type: "text", text: "assistant suffix" }],
      },
      {
        info: userInfo(tailUser),
        parts: [{ ...basePart(tailUser, "p-tail-user"), type: "text", text: "retained question" }],
      },
      {
        info: userInfo(anchor),
        parts: [
          { ...basePart(anchor, "p-anchor-text"), type: "text", text: "DISPATCH ANCHOR" },
          {
            ...basePart(anchor, "p-anchor-compaction"),
            type: "compaction",
            auto: true,
            anchor_id: anchor,
            tail_start_id: tailAssistant,
          },
        ],
      },
    ] as Message.WithParts[]

    const result = await Message.filterCompacted(stream(newestFirst))

    expect(result.map((message) => message.info.id)).toEqual([anchor, summary])
  })

  test("does not accept legacy prose summaries as compaction boundaries", async () => {
    const compactionUser = "m-compaction-user"
    const compactionSummary = "m-compaction-summary"
    const newestFirst: Message.WithParts[] = [
      {
        info: {
          ...assistantInfo(compactionSummary, compactionUser),
          summary: true,
          finish: "stop",
        },
        parts: [{ ...basePart(compactionSummary, "p-summary"), type: "text", text: "legacy prose summary" }],
      },
      {
        info: userInfo(compactionUser),
        parts: [{ ...basePart(compactionUser, "p-compaction"), type: "compaction", auto: true }],
      },
      {
        info: assistantInfo("m-old-assistant", "m-old-user"),
        parts: [{ ...basePart("m-old-assistant", "p-old-assistant"), type: "text", text: "old answer" }],
      },
      {
        info: userInfo("m-old-user"),
        parts: [{ ...basePart("m-old-user", "p-old-user"), type: "text", text: "old question" }],
      },
    ] as Message.WithParts[]

    const result = await Message.filterCompacted(stream(newestFirst))

    expect(result.map((message) => message.info.id)).toEqual([
      "m-old-user",
      "m-old-assistant",
      compactionUser,
      compactionSummary,
    ])
  })
})

describe("session.message.fromError", () => {
  test("serializes context_length_exceeded as ContextOverflowError", () => {
    const input = {
      type: "error",
      error: {
        code: "context_length_exceeded",
      },
    }
    const result = Message.fromError(input, { providerID: "test" })

    expect(result).toStrictEqual({
      name: "ContextOverflowError",
      data: {
        message: "Input exceeds context window of this model",
        responseBody: JSON.stringify(input),
      },
    })
  })

  test("serializes response error codes", () => {
    const cases = [
      {
        code: "insufficient_quota",
        message: "Quota exceeded. Check your plan and billing details.",
      },
      {
        code: "usage_not_included",
        message: "To use Codex with your ChatGPT plan, upgrade to Plus: https://chatgpt.com/explore/plus.",
      },
      {
        code: "invalid_prompt",
        message: "Invalid prompt from test",
      },
    ]

    cases.forEach((item) => {
      const input = {
        type: "error",
        error: {
          code: item.code,
          message: item.code === "invalid_prompt" ? item.message : undefined,
        },
      }
      const result = Message.fromError(input, { providerID: "test" })

      expect(result).toStrictEqual({
        name: "APIError",
        data: {
          message: item.message,
          isRetryable: false,
          responseBody: JSON.stringify(input),
        },
      })
    })
  })

  test("detects context overflow from APICallError provider messages", () => {
    const cases = [
      "prompt is too long: 213462 tokens > 200000 maximum",
      "Your input exceeds the context window of this model",
      "This model's maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens.",
      "context length exceeded",
      "The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)",
      "input length exceeds model limit",
      "request too large",
      "too many tokens in prompt",
      "Please reduce the length of the messages or completion",
      "Provider alibaba-coding-plan-cn returned HTTP 400: InternalError.Algo.InvalidParameter: Range of input length should be [1, 258048]",
      "400 status code (no body)",
      "413 status code (no body)",
    ]

    cases.forEach((message) => {
      const error = new APICallError({
        message,
        url: "https://example.com",
        requestBodyValues: {},
        statusCode: 400,
        responseHeaders: { "content-type": "application/json" },
        isRetryable: false,
      })
      const result = Message.fromError(error, { providerID: "test" })
      expect(Message.ContextOverflowError.isInstance(result)).toBe(true)
    })
  })

  test("detects provider overflow from structured APICallError bodies", () => {
    const cases = [
      {
        providerID: "openai-compatible",
        body: { error: { code: "context_length_exceeded", message: "maximum context length exceeded" } },
      },
      {
        providerID: "hexin",
        body: { error: { type: "context_overflow", message: "hexin normalized context overflow" } },
      },
      {
        providerID: "mistral",
        body: { code: "request_too_large", message: "request too large" },
      },
    ]

    for (const item of cases) {
      const error = new APICallError({
        message: "400 Bad Request",
        url: "https://example.com",
        requestBodyValues: {},
        statusCode: 400,
        responseHeaders: { "content-type": "application/json" },
        responseBody: JSON.stringify(item.body),
        isRetryable: false,
      })
      const result = Message.fromError(error, { providerID: item.providerID })
      expect(Message.ContextOverflowError.isInstance(result)).toBe(true)
    }
  })

  test("does not classify 429 no body as context overflow", () => {
    const result = Message.fromError(
      new APICallError({
        message: "429 status code (no body)",
        url: "https://example.com",
        requestBodyValues: {},
        statusCode: 429,
        responseHeaders: { "content-type": "application/json" },
        isRetryable: false,
      }),
      { providerID: "test" },
    )
    expect(Message.ContextOverflowError.isInstance(result)).toBe(false)
    expect(Message.APIError.isInstance(result)).toBe(true)
  })

  test("propagates 429 quota body as non-retryable APIError", () => {
    // alibaba-coding-plan-cn returns HTTP 429 for allocated quota exhaustion,
    // not just short-window throttling. The provider-fetch wrapper must still
    // surface an APIError with statusCode=429, but this body must be marked
    // non-retryable so the session does not burn repeated LLM turns against a
    // depleted account.
    const result = Message.fromError(
      new APICallError({
        message:
          "Provider alibaba-coding-plan-cn returned HTTP 429: usage allocated quota exceeded. please try again later.",
        url: "https://coding.dashscope.aliyuncs.com/v1/chat/completions",
        requestBodyValues: {},
        statusCode: 429,
        responseHeaders: { "content-type": "application/json" },
        responseBody: '{"error":{"message":"usage allocated quota exceeded. please try again later."}}',
      }),
      { providerID: "alibaba-coding-plan-cn" },
    ) as Message.APIError
    expect(Message.APIError.isInstance(result)).toBe(true)
    expect(result.data.statusCode).toBe(429)
    expect(result.data.isRetryable).toBe(false)
  })

  test("serializes unknown inputs", () => {
    const result = Message.fromError(123, { providerID: "test" })

    expect(result).toStrictEqual({
      name: "UnknownError",
      data: {
        message: "123",
      },
    })
  })
})
