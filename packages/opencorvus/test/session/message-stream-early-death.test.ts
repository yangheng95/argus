import { describe, expect, test } from "bun:test"
import { Message } from "../../src/session/message"
import type { Provider } from "../../src/provider/provider"

/**
 * Stream early-death structural-validity gate at the toModelMessages
 * boundary. See specs/new-arch/2026-05-08-stream-early-death-and-retry-fuse.md.
 *
 * When an LLM stream early-dies (provider truncates response after opening
 * a reasoning block, socket dies, model returns nothing), the persisted
 * assistant turn ends up with `finish=null`, `error=null`, and parts like
 * `[step-start, reasoning(text="")]`. Without this gate the message gets
 * serialised to `{role:"assistant", content:"", tool_calls:undefined}`,
 * which OpenAI / DeepSeek / any chat-completion provider rejects with
 * HTTP 4xx. Before restart recovery became passive, `monitorRuns`
 * replayed the same broken history once per second in a deterministic retry storm
 * (tsk_e078e1f2a001t4ZwUl5SWgoG8o produced 277 identical errors in 2.5
 * minutes on 2026-05-08).
 */

const sessionID = "session"
const model: Provider.Model = {
  id: "test-model",
  providerID: "test",
  api: { id: "test-model", url: "https://example.com", npm: "@ai-sdk/openai" },
  name: "Test Model",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: true, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 0, input: 0, output: 0 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
} as unknown as Provider.Model

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

function assistantInfo(id: string, parentID: string): Message.Assistant {
  return {
    id,
    sessionID,
    role: "assistant",
    time: { created: 0 },
    parentID,
    modelID: model.api.id,
    providerID: model.providerID,
    mode: "",
    agent: "agent",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } as unknown as Message.Assistant
}

function part(messageID: string, id: string) {
  return { id, sessionID, messageID }
}

const userTurn: Message.WithParts = {
  info: userInfo("m-user"),
  parts: [{ ...part("m-user", "u1"), type: "text", text: "hello" }] as Message.Part[],
}

describe("toModelMessages — stream early-death structural gate", () => {
  test("drops assistant turn that has only step-start + empty reasoning (the 2026-05-08 bug shape)", async () => {
    const broken: Message.WithParts = {
      info: assistantInfo("m-assistant-broken", "m-user"),
      parts: [
        { ...part("m-assistant-broken", "ab1"), type: "step-start" },
        { ...part("m-assistant-broken", "ab2"), type: "reasoning", text: "" },
      ] as Message.Part[],
    }

    const out = await Message.toModelMessages([userTurn, broken], model)

    // Only the user turn survives; the empty assistant must be dropped, not
    // forwarded as `{role:"assistant", content:"", tool_calls:undefined}`.
    expect(out.length).toBe(1)
    expect(out[0]!.role).toBe("user")
  })

  test("drops assistant turn that has only step-start + non-empty reasoning (no provider-visible content)", async () => {
    // Reasoning blocks are provider-internal (Anthropic thinking, OpenAI
    // reasoning_content). For chat-completion providers like DeepSeek they
    // are not "content" — an assistant turn with reasoning but no text/tool
    // is still rejected on replay.
    const reasoningOnly: Message.WithParts = {
      info: assistantInfo("m-assistant-reasoning", "m-user"),
      parts: [
        { ...part("m-assistant-reasoning", "ar1"), type: "step-start" },
        { ...part("m-assistant-reasoning", "ar2"), type: "reasoning", text: "thinking..." },
      ] as Message.Part[],
    }

    const out = await Message.toModelMessages([userTurn, reasoningOnly], model)
    expect(out.length).toBe(1)
    expect(out[0]!.role).toBe("user")
  })

  test("keeps assistant turn that has at least one non-empty text part", async () => {
    const ok: Message.WithParts = {
      info: assistantInfo("m-assistant-text", "m-user"),
      parts: [
        { ...part("m-assistant-text", "t1"), type: "step-start" },
        { ...part("m-assistant-text", "t2"), type: "text", text: "answer" },
      ] as Message.Part[],
    }

    const out = await Message.toModelMessages([userTurn, ok], model)
    expect(out.length).toBe(2)
    expect(out[1]!.role).toBe("assistant")
  })

  test("keeps assistant turn that has at least one tool part", async () => {
    const ok: Message.WithParts = {
      info: assistantInfo("m-assistant-tool", "m-user"),
      parts: [
        { ...part("m-assistant-tool", "s1"), type: "step-start" },
        {
          ...part("m-assistant-tool", "tc1"),
          type: "tool",
          tool: "skill",
          callID: "call-1",
          state: {
            status: "completed",
            input: { name: "research-report" },
            output: "skill body",
            title: "skill",
            metadata: {},
            time: { start: 0, end: 1 },
          },
        },
      ] as Message.Part[],
    }

    const out = await Message.toModelMessages([userTurn, ok], model)
    // AI SDK splits a completed tool call into assistant + tool messages, so
    // we get user / assistant / tool — the assistant turn must survive the
    // gate since it carries a tool part.
    expect(out.some((m) => m.role === "assistant")).toBe(true)
    expect(out.some((m) => m.role === "tool")).toBe(true)
  })

  test("drops assistant turn that has only an empty text part", async () => {
    // Empty-string text is not "content" for chat-completion providers —
    // {role:"assistant", content:""} is rejected the same as missing content.
    const emptyText: Message.WithParts = {
      info: assistantInfo("m-assistant-empty-text", "m-user"),
      parts: [
        { ...part("m-assistant-empty-text", "et1"), type: "step-start" },
        { ...part("m-assistant-empty-text", "et2"), type: "text", text: "" },
      ] as Message.Part[],
    }

    const out = await Message.toModelMessages([userTurn, emptyText], model)
    expect(out.length).toBe(1)
    expect(out[0]!.role).toBe("user")
  })
})
