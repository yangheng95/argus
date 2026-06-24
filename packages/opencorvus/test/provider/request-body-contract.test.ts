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
  test("DeepSeek OpenAI-compatible body keeps empty reasoning_content before stream consumption", async () => {
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
    const messages = await ProviderTransform.message(
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

  test("OpenRouter DeepSeek body leaves reasoning_details on the reasoning part", async () => {
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

    const messages = (await ProviderTransform.message(
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
    )) as any[]

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

  test("Bedrock Anthropic-style request body includes cachePoint metadata", async () => {
    const bedrock = model({
      id: "amazon-bedrock/claude-sonnet-4",
      providerID: "amazon-bedrock",
      api: {
        id: "anthropic.claude-sonnet-4",
        url: "https://bedrock.aws",
        npm: "@ai-sdk/amazon-bedrock",
      },
    })

    const messages = (await ProviderTransform.message(
      [{ role: "user", content: "hello" }] as any[],
      bedrock,
      {},
    )) as any[]

    expect(messages[0].providerOptions?.bedrock).toEqual({
      cachePoint: { type: "default" },
    })
  })

  test("Hexin Claude drops text-only assistant tail after tool results for Bedrock Anthropic", async () => {
    const hexinClaude = model({
      id: "hexin/claude-sonnet-4-6-v2",
      providerID: "hexin",
      api: {
        id: "claude-sonnet-4-6-v2",
        url: "https://aimemodeldev.myhexin.com/litellm/v1",
        npm: "@ai-sdk/openai-compatible",
      },
    })

    const messages = (await ProviderTransform.message(
      [
        { role: "user", content: "decompose this task" },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "toolu.bdrk.invalid",
              toolName: "list",
              input: { path: "." },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "toolu.bdrk.invalid",
              toolName: "list",
              output: { type: "text", value: "[dir] src" },
            },
          ],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "I'll inspect the source tree next." }],
        },
      ] as any[],
      hexinClaude,
      {},
    )) as any[]

    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "tool"])
    expect(messages[1].content[0].toolCallId).toBe("toolu_bdrk_invalid")
    expect(messages[2].content[0].toolCallId).toBe("toolu_bdrk_invalid")
  })

  test("Claude keeps non-tail assistant history before a later user turn", async () => {
    const claude = model({
      id: "anthropic/claude-sonnet-4",
      providerID: "anthropic",
      api: {
        id: "claude-sonnet-4",
        url: "https://api.anthropic.com/v1",
        npm: "@ai-sdk/anthropic",
      },
    })

    const messages = (await ProviderTransform.message(
      [
        { role: "user", content: "first" },
        { role: "assistant", content: [{ type: "text", text: "prior answer" }] },
        { role: "user", content: "continue" },
      ] as any[],
      claude,
      {},
    )) as any[]

    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user"])
    expect(messages[1].content[0].text).toBe("prior answer")
  })

  test("non-Claude OpenAI-compatible providers keep assistant tail after tool results", async () => {
    const glm = model({
      id: "hexin/glm-5.1",
      providerID: "hexin",
      api: {
        id: "glm-5.1",
        url: "https://aimemodeldev.myhexin.com/litellm/v1",
        npm: "@ai-sdk/openai-compatible",
      },
    })

    const messages = (await ProviderTransform.message(
      [
        { role: "user", content: "decompose this task" },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call_1",
              toolName: "list",
              input: { path: "." },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_1",
              toolName: "list",
              output: { type: "text", value: "[dir] src" },
            },
          ],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "I'll inspect the source tree next." }],
        },
      ] as any[],
      glm,
      {},
    )) as any[]

    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "tool", "assistant"])
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

  test("Hexin Kimi K2.6 and GLM-5.1 use soft tool choice and preserve reasoning content", async () => {
    const targets = [
      model({
        id: "hexin/kimi-k2.6",
        providerID: "hexin",
        api: {
          id: "kimi-k2.6",
          url: "https://aimemodeldev.myhexin.com/litellm/v1",
          npm: "@ai-sdk/openai-compatible",
        },
        capabilities: {
          ...model({}).capabilities,
          temperature: false,
          reasoning: true,
          interleaved: { field: "reasoning_content" },
        },
      }),
      model({
        id: "hexin/openai/glm-5.1",
        providerID: "hexin",
        api: {
          id: "openai/glm-5.1",
          url: "https://aimemodeldev.myhexin.com/litellm/v1",
          npm: "@ai-sdk/openai-compatible",
        },
        capabilities: {
          ...model({}).capabilities,
          reasoning: true,
          interleaved: { field: "reasoning_content" },
        },
      }),
    ]
    const format = { type: "json_schema" as const, schema: { type: "object" }, retryCount: 2 }
    const terminalContract = {
      toolName: "Finish",
      isSatisfied: () => false,
      shouldExposeOnlyTerminalTool: () => true,
    }
    const tools = { Finish: {} }

    for (const target of targets) {
      expect(SessionLoop.structuredOutputToolChoice(format, target)).toBe("auto")
      expect(SessionLoop.terminalToolChoice(terminalContract as any, tools as any, target)).toBeUndefined()

      const messages = await ProviderTransform.message(
        [
          {
            role: "assistant",
            content: [
              { type: "reasoning", text: "thinking before the call" },
              {
                type: "tool-call",
                toolCallId: "call_1",
                toolName: "Finish",
                input: { ok: true },
              },
            ],
          },
        ] as any[],
        target,
        {},
      )
      const bodyMessages = convertToOpenAICompatibleChatMessages(messages as any)

      expect(bodyMessages[0]).toMatchObject({
        role: "assistant",
        content: null,
        reasoning_content: "thinking before the call",
      })
      expect(bodyMessages[0].tool_calls?.[0]?.function.name).toBe("Finish")
    }
  })

  test("Hexin Kimi K2.6 does not inject sampling parameters that Moonshot fixes", () => {
    const kimi = model({
      id: "hexin/kimi-k2.6",
      providerID: "hexin",
      api: {
        id: "kimi-k2.6",
        url: "https://aimemodeldev.myhexin.com/litellm/v1",
        npm: "@ai-sdk/openai-compatible",
      },
    })

    expect(ProviderTransform.temperature(kimi)).toBeUndefined()
    expect(ProviderTransform.topP(kimi)).toBeUndefined()
  })

  test("Hexin Kimi K2.6 request body uses the Moonshot fixed temperature", () => {
    const body = ProviderTransform.requestBody("hexin", {
      model: "kimi-k2.6",
      temperature: 0,
      stream: true,
    })

    expect(body).toMatchObject({
      model: "kimi-k2.6",
      temperature: 1,
      stream: true,
    })
  })

  test("Hexin Kimi K2.7 Code request body uses the Moonshot fixed temperature", () => {
    const body = ProviderTransform.requestBody("hexin", {
      model: "kimi-k2.7-code",
      temperature: 0,
      stream: true,
    })

    expect(body).toMatchObject({
      model: "kimi-k2.7-code",
      temperature: 1,
      stream: true,
    })
  })

  test("Hexin request body preserves assistant tool-call null content", () => {
    const body = ProviderTransform.requestBody("hexin", {
      model: "gpt-5.4",
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "bash", arguments: '{"command":"echo hi"}' },
            },
          ],
        },
        {
          role: "tool",
          content: "ok",
          tool_call_id: "call_1",
        },
      ],
    }) as any

    expect(body.messages[0]).toMatchObject({
      role: "assistant",
      content: null,
    })
    expect(body.messages[0].tool_calls[0].function.name).toBe("bash")
    expect(body.messages[1].content).toBe("ok")
  })

  test("Hexin request body leaves chat message content nulls untouched", () => {
    const body = ProviderTransform.requestBody("hexin", {
      model: "gpt-5.4",
      metadata: {
        content: null,
      },
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "bash", arguments: '{"content":null}' },
            },
          ],
        },
      ],
    }) as any

    expect(body.messages[0].content).toBeNull()
    expect(body.messages[0].tool_calls[0].function.arguments).toBe('{"content":null}')
    expect(body.metadata.content).toBeNull()
  })

  test("non-Hexin request body keeps OpenAI-compatible assistant tool-call null content", () => {
    const body = {
      model: "gpt-5.4",
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "bash", arguments: "{}" },
            },
          ],
        },
      ],
    }

    expect(ProviderTransform.requestBody("openai-compatible", body)).toBe(body)
    expect(body.messages[0].content).toBeNull()
  })

  test("Hexin request body normalization runs regardless of SDK package", () => {
    expect(ProviderTransform.shouldNormalizeRequestBody("hexin", "@ai-sdk/azure")).toBe(true)
    expect(ProviderTransform.shouldNormalizeRequestBody("hexin", "@ai-sdk/openai-compatible")).toBe(true)
    expect(ProviderTransform.shouldNormalizeRequestBody("deepseek", "@ai-sdk/openai-compatible")).toBe(true)
    expect(ProviderTransform.shouldNormalizeRequestBody("openai", "@ai-sdk/openai")).toBe(false)
  })
})
