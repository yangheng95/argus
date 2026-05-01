import { describe, expect, test } from "bun:test"
import { APICallError } from "ai"
import { Message } from "../../src/session/message"
import type { Provider } from "../../src/provider/provider"

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
  })

  test("filters out messages with no parts", () => {
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

    expect(Message.toModelMessages(input, model)).toStrictEqual([
      {
        role: "user",
        content: [{ type: "text", text: "hello" }],
      },
    ])
  })

  test("includes every user text part without visibility flags", () => {
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

    expect(Message.toModelMessages(input, model)).toStrictEqual([
      {
        role: "user",
        content: [{ type: "text", text: "visible" }],
      },
    ])
  })

  test("includes every assistant text part without visibility flags", () => {
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

    expect(Message.toModelMessages(input, model)).toStrictEqual([
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

  test("converts user text/file parts and injects compaction/subtask prompts", () => {
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

    expect(Message.toModelMessages(input, model)).toStrictEqual([
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
          { type: "text", text: "What did we do so far?" },
          { type: "text", text: "The following tool was executed by the user" },
        ],
      },
    ])
  })

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

    expect(await Message.toModelMessages(input, model)).toStrictEqual([
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

    const result = await Message.toModelMessages(input, model)
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

  test("omits provider metadata when assistant model differs", () => {
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

    expect(Message.toModelMessages(input, model)).toStrictEqual([
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

  test("replaces compacted tool output with placeholder", () => {
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

    expect(Message.toModelMessages(input, model)).toStrictEqual([
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

  test("converts assistant tool error into error-text tool result", () => {
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
              error: "nope",
              time: { start: 0, end: 1 },
              metadata: {},
            },
            metadata: { openai: { tool: "meta" } },
          },
        ] as Message.Part[],
      },
    ]

    expect(Message.toModelMessages(input, model)).toStrictEqual([
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
            output: { type: "error-text", value: "nope" },
            providerOptions: { openai: { tool: "meta" } },
          },
        ],
      },
    ])
  })

  test("filters assistant messages with non-abort errors", () => {
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

    expect(Message.toModelMessages(input, model)).toStrictEqual([])
  })

  test("includes aborted assistant messages only when they have non-step-start/reasoning content", () => {
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

    expect(Message.toModelMessages(input, model)).toStrictEqual([
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "thinking", providerOptions: undefined },
          { type: "text", text: "partial answer" },
        ],
      },
    ])
  })

  test("splits assistant messages on step-start boundaries", () => {
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

    expect(Message.toModelMessages(input, model)).toStrictEqual([
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

  test("drops messages that only contain step-start parts", () => {
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

    expect(Message.toModelMessages(input, model)).toStrictEqual([])
  })

  test("converts pending/running tool calls to error results to prevent dangling tool_use", () => {
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
            callID: "call-pending",
            tool: "bash",
            state: {
              status: "pending",
              input: { cmd: "ls" },
              raw: "",
            },
          },
          {
            ...basePart(assistantID, "a2"),
            type: "tool",
            callID: "call-running",
            tool: "read",
            state: {
              status: "running",
              input: { path: "/tmp" },
              time: { start: 0 },
            },
          },
        ] as Message.Part[],
      },
    ]

    const result = Message.toModelMessages(input, model)

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
            toolCallId: "call-pending",
            toolName: "bash",
            input: { cmd: "ls" },
            providerExecuted: undefined,
          },
          {
            type: "tool-call",
            toolCallId: "call-running",
            toolName: "read",
            input: { path: "/tmp" },
            providerExecuted: undefined,
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-pending",
            toolName: "bash",
            output: { type: "error-text", value: "[Tool execution was interrupted]" },
          },
          {
            type: "tool-result",
            toolCallId: "call-running",
            toolName: "read",
            output: { type: "error-text", value: "[Tool execution was interrupted]" },
          },
        ],
      },
    ])
  })

  test("projects earlier stateful-snapshot tool results to a superseded note", () => {
    const firstAssistant = "m-a1"
    const secondUser = "m-u2"
    const secondAssistant = "m-a2"

    const input: Message.WithParts[] = [
      {
        info: userInfo("m-u1"),
        parts: [
          { ...basePart("m-u1", "u1"), type: "text", text: "check state" },
        ] as Message.Part[],
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
              input: { scope: "all" },
              output: "SNAPSHOT_OLD: goals + decisions + deliveries (4000 tokens of state)",
              title: "read_context",
              metadata: {},
              time: { start: 0, end: 1 },
            },
          },
        ] as Message.Part[],
      },
      {
        info: userInfo(secondUser),
        parts: [
          { ...basePart(secondUser, "u2"), type: "text", text: "check again" },
        ] as Message.Part[],
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
              input: { scope: "all" },
              output: "SNAPSHOT_LATEST: current state",
              title: "read_context",
              metadata: {},
              time: { start: 2, end: 3 },
            },
          },
        ] as Message.Part[],
      },
    ]

    const out = Message.toModelMessages(input, model)
    // Find the two tool-result messages and inspect their output values.
    const toolResults = out
      .filter((m) => m.role === "tool")
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .filter((c: any) => c.type === "tool-result") as Array<{ toolCallId: string; output: { type: string; value: string } }>

    expect(toolResults.length).toBe(2)
    const first = toolResults.find((r) => r.toolCallId === "call-first")!
    const latest = toolResults.find((r) => r.toolCallId === "call-latest")!
    expect(first.output.value).toBe("[read_context snapshot superseded by a later call in this session]")
    expect(latest.output.value).toBe("SNAPSHOT_LATEST: current state")
    // Make sure we did not drop the old payload's original bytes before projection ran
    expect(first.output.value).not.toContain("SNAPSHOT_OLD")
  })

  test("does not project non-stateful tool results (e.g. bash) across turns", () => {
    const input: Message.WithParts[] = [
      {
        info: userInfo("m-u1"),
        parts: [
          { ...basePart("m-u1", "u1"), type: "text", text: "run" },
        ] as Message.Part[],
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
        parts: [
          { ...basePart("m-u2", "u2"), type: "text", text: "again" },
        ] as Message.Part[],
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

    const out = Message.toModelMessages(input, model)
    const toolResults = out
      .filter((m) => m.role === "tool")
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .filter((c: any) => c.type === "tool-result") as Array<{ toolCallId: string; output: { type: string; value: string } }>
    expect(toolResults.length).toBe(2)
    expect(toolResults[0].output.value).toBe("OUTPUT_FIRST")
    expect(toolResults[1].output.value).toBe("OUTPUT_SECOND")
  })

  test("keeps a single stateful-snapshot call unchanged when it is the only one", () => {
    const input: Message.WithParts[] = [
      {
        info: userInfo("m-u1"),
        parts: [
          { ...basePart("m-u1", "u1"), type: "text", text: "check state once" },
        ] as Message.Part[],
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

    const out = Message.toModelMessages(input, model)
    const toolResults = out
      .filter((m) => m.role === "tool")
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .filter((c: any) => c.type === "tool-result") as Array<{ toolCallId: string; output: { type: string; value: string } }>
    expect(toolResults.length).toBe(1)
    expect(toolResults[0].output.value).toBe("FAILED_GOALS_SNAPSHOT")
  })

  test("preserves reasoning on every assistant message — no strip (cache + Anthropic protocol)", () => {
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
    const out = Message.toModelMessages(input, model)

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
      "The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)",
      "Please reduce the length of the messages or completion",
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

  test("propagates 429 quota body as retryable APIError", () => {
    // Regression for the 2026-04-28 incident: alibaba-coding-plan-cn returned
    // HTTP 429 "usage allocated quota exceeded. please try again later." The
    // provider-fetch wrapper used to throw a plain Error which fell through
    // to NamedError.Unknown — bypassing SessionRetry's APIError-aware backoff
    // and turning a transient rate-limit into an orchestrator wake loop.
    // After the fix the wrapper throws an APICallError with statusCode=429,
    // and the AI SDK marks 429 as retryable by default; Message.fromError
    // must surface that as Message.APIError(isRetryable=true).
    const result = Message.fromError(
      new APICallError({
        message:
          "Provider alibaba-coding-plan-cn returned HTTP 429: usage allocated quota exceeded. please try again later.",
        url: "https://coding.dashscope.aliyuncs.com/v1/chat/completions",
        requestBodyValues: {},
        statusCode: 429,
        responseHeaders: { "content-type": "application/json" },
        responseBody:
          '{"error":{"message":"usage allocated quota exceeded. please try again later."}}',
      }),
      { providerID: "alibaba-coding-plan-cn" },
    ) as Message.APIError
    expect(Message.APIError.isInstance(result)).toBe(true)
    expect(result.data.statusCode).toBe(429)
    expect(result.data.isRetryable).toBe(true)
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
