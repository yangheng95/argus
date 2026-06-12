import { describe, expect, test } from "bun:test"
import type { LanguageModelV3CallOptions, LanguageModelV3StreamPart } from "@ai-sdk/provider"
import { jsonSchema, streamText, tool } from "ai"
import { convertReadableStreamToArray, MockLanguageModelV3, simulateReadableStream } from "ai/test"
import { ProviderLLM } from "../../src/provider/llm"
import type { Provider } from "../../src/provider/provider"

const providerModel = {
  id: "provider/model",
  providerID: "hexin",
  api: {
    id: "provider/model",
    npm: "@ai-sdk/openai-compatible",
  },
  capabilities: {
    input: {
      image: true,
      audio: true,
      video: true,
      pdf: true,
    },
  },
} as Provider.Model

function usage() {
  return {
    inputTokens: {
      total: 1,
      noCache: 1,
      cacheRead: 0,
      cacheWrite: 0,
    },
    outputTokens: {
      total: 1,
      text: 1,
      reasoning: 0,
    },
  }
}

function streamFrom(chunks: LanguageModelV3StreamPart[]) {
  return simulateReadableStream({
    chunks,
    initialDelayInMs: null,
    chunkDelayInMs: null,
  })
}

describe("ProviderLLM local tool execution metadata", () => {
  test("executes a local function tool even when the provider stream incorrectly marks it provider-executed", async () => {
    let executedInput: unknown
    const mock = new MockLanguageModelV3({
      doStream: async () => ({
        stream: streamFrom([
          { type: "stream-start", warnings: [] },
          { type: "tool-input-start", id: "call_search", toolName: "search_code", providerExecuted: true },
          { type: "tool-input-delta", id: "call_search", delta: '{"pattern":"industrialProduction"}' },
          { type: "tool-input-end", id: "call_search" },
          {
            type: "tool-call",
            toolCallId: "call_search",
            toolName: "search_code",
            input: '{"pattern":"industrialProduction"}',
            providerExecuted: true,
          },
          { type: "finish", finishReason: "tool-calls", usage: usage() },
        ]),
      }),
    })

    const result = streamText({
      model: ProviderLLM.wrapModel(mock, providerModel, {}),
      messages: [{ role: "user", content: "Find the industrial production node." }],
      tools: {
        search_code: tool({
          inputSchema: jsonSchema({
            type: "object",
            properties: {
              pattern: { type: "string" },
            },
            required: ["pattern"],
            additionalProperties: false,
          }),
          execute: async (input) => {
            executedInput = input
            return { matches: 1 }
          },
        }),
      },
    })

    const parts = []
    for await (const part of result.fullStream) {
      parts.push(part)
    }

    expect(executedInput).toEqual({ pattern: "industrialProduction" })
    expect(parts.some((part) => part.type === "tool-result")).toBe(true)
    expect(
      parts
        .filter(
          (part) => (part.type === "tool-input-start" || part.type === "tool-call") && part.toolName === "search_code",
        )
        .every((part) => part.providerExecuted !== true),
    ).toBe(true)
  })

  test("preserves provider-executed metadata for provider-defined tools", async () => {
    const mock = new MockLanguageModelV3({
      doStream: async () => ({
        stream: streamFrom([
          { type: "stream-start", warnings: [] },
          { type: "tool-input-start", id: "call_server", toolName: "server_search", providerExecuted: true },
          {
            type: "tool-call",
            toolCallId: "call_server",
            toolName: "server_search",
            input: '{"query":"macro"}',
            providerExecuted: true,
          },
          { type: "finish", finishReason: "tool-calls", usage: usage() },
        ]),
      }),
    })
    const wrapped = ProviderLLM.wrapModel(mock, providerModel, {})
    const response = await wrapped.doStream({
      prompt: [],
      tools: [{ type: "provider", name: "server_search", id: "server.search", args: {} }],
    } as LanguageModelV3CallOptions)

    const chunks = await convertReadableStreamToArray(response.stream)
    expect(chunks.find((chunk) => chunk.type === "tool-input-start")?.providerExecuted).toBe(true)
    expect(chunks.find((chunk) => chunk.type === "tool-call")?.providerExecuted).toBe(true)
  })
})
