import { describe, expect, test } from "bun:test"
import { convertToOpenAICompatibleChatMessages } from "@ai-sdk/openai-compatible/internal"
import { ProviderTransform } from "../../src/provider/transform"
import type { Provider } from "../../src/provider/provider"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionLoop } from "../../src/session/loop"

// Load SessionPrompt first because it defines prompt helpers on SessionLoop.
void SessionPrompt

function model(overrides: Partial<Provider.Model>): Provider.Model {
  return {
    id: "test/model",
    providerID: "test",
    name: "Test",
    api: {
      id: "model",
      url: "https://example.test/v1",
      npm: "@ai-sdk/openai-compatible",
    },
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: false,
      toolcall: true,
      input: { text: true, image: false, audio: false, video: false, pdf: false },
      output: { text: true, image: false, audio: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128_000, input: 128_000, output: 32_000 },
    options: {},
    headers: {},
    ...overrides,
  } as Provider.Model
}

describe("provider request-body contract", () => {
  test("DeepSeek OpenAI-compatible body keeps empty reasoning_content before stream consumption", () => {
    const deepseek = model({
      id: "deepseek/deepseek-reasoner",
      providerID: "deepseek",
      api: {
        id: "deepseek-reasoner",
        url: "https://api.deepseek.com",
        npm: "@ai-sdk/openai-compatible",
      },
      capabilities: {
        ...model({}).capabilities,
        interleaved: { field: "reasoning_content" },
      },
    })
    const messages = ProviderTransform.message(
      [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call_1",
              toolName: "bash",
              input: { command: "echo hi" },
            },
          ],
        },
      ] as any[],
      deepseek,
      {},
    )

    const bodyMessages = convertToOpenAICompatibleChatMessages(messages as any)
    expect(bodyMessages[0]).toMatchObject({
      role: "assistant",
      content: null,
      reasoning_content: "",
    })
    expect(bodyMessages[0].tool_calls?.[0]?.function.name).toBe("bash")
  })

  test("OpenRouter DeepSeek body leaves reasoning_details on the reasoning part", () => {
    const reasoningDetails = [{ type: "reasoning.text", text: "thinking", format: "unknown", index: 0 }]
    const openrouter = model({
      id: "openrouter/deepseek-r1",
      providerID: "openrouter",
      api: {
        id: "deepseek/deepseek-r1",
        url: "https://openrouter.ai/api/v1",
        npm: "@openrouter/ai-sdk-provider",
      },
      capabilities: {
        ...model({}).capabilities,
        interleaved: { field: "reasoning_details" },
      },
    })

    const messages = ProviderTransform.message(
      [
        {
          role: "assistant",
          content: [
            {
              type: "reasoning",
              text: "thinking",
              providerOptions: { openrouter: { reasoning_details: reasoningDetails } },
            },
            { type: "text", text: "answer" },
          ],
        },
      ] as any[],
      openrouter,
      {},
    ) as any[]

    expect(messages[0].content[0].providerOptions.openrouter.reasoning_details).toEqual(reasoningDetails)
    expect(messages[0].providerOptions?.openaiCompatible?.reasoning_details).toBeUndefined()
  })

  test("Azure reasoning request options are available under both SDK namespaces", () => {
    const azure = model({
      id: "azure/gpt-5.4",
      providerID: "azure",
      api: {
        id: "gpt-5.4",
        url: "https://example.openai.azure.com/openai/deployments/gpt-5.4",
        npm: "@ai-sdk/azure",
      },
    })

    const options = ProviderTransform.options({ model: azure, sessionID: "ses_contract", providerOptions: {} })
    const providerOptions = ProviderTransform.providerOptions(azure, options)

    expect(providerOptions.openai).toMatchObject({
      promptCacheKey: "ses_contract",
      reasoningEffort: "medium",
      reasoningSummary: "auto",
    })
    expect(providerOptions.azure).toEqual(providerOptions.openai)
  })

  test("Bedrock Anthropic-style request body includes cachePoint metadata", () => {
    const bedrock = model({
      id: "amazon-bedrock/claude-sonnet-4",
      providerID: "amazon-bedrock",
      api: {
        id: "anthropic.claude-sonnet-4",
        url: "https://bedrock.aws",
        npm: "@ai-sdk/amazon-bedrock",
      },
    })

    const messages = ProviderTransform.message([{ role: "user", content: "hello" }] as any[], bedrock, {}) as any[]

    expect(messages[0].providerOptions?.bedrock).toEqual({
      cachePoint: { type: "default" },
    })
  })

  test("dotted OpenAI-compatible provider IDs use the SDK-readable providerOptions namespace", () => {
    const custom = model({
      id: "wafer/deepseek-r1",
      providerID: "wafer.ai",
      api: {
        id: "deepseek-r1",
        url: "https://wafer.ai/v1",
        npm: "@ai-sdk/openai-compatible",
      },
    })

    expect(ProviderTransform.providerOptions(custom, { reasoningEffort: "high" })).toEqual({
      wafer: { reasoningEffort: "high" },
    })
  })

  test("reasoning models use soft tool choice for JSON-schema output", () => {
    const format = { type: "json_schema" as const, schema: { type: "object" }, retryCount: 2 }

    expect(SessionLoop.structuredOutputToolChoice(format, { capabilities: { reasoning: true } })).toBe("auto")
  })
})
