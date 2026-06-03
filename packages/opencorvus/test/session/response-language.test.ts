import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import type { Agent } from "../../src/agent/agent"
import type { Message } from "../../src/session/message"
import type { Provider } from "../../src/provider/provider"

let configuredLocale: "en-US" | "zh-CN" | undefined
let capturedSystem: string | undefined

mock.module("@/config/config", () => ({
  Config: {
    get: async () => ({ locale: configuredLocale }),
    Info: {
      parse: (value: unknown) => value,
    },
  },
}))

mock.module("@/provider/provider", () => ({
  Provider: {
    getLanguage: async () => ({}),
    getProvider: async () => ({ id: "test", options: {} }),
  },
}))

mock.module("@/provider/llm", () => ({
  ProviderLLM: {
    baseHeaders: () => ({}),
    wrapModel: () => ({}),
  },
}))

mock.module("@/provider/transform", () => ({
  ProviderTransform: {
    OUTPUT_TOKEN_MAX: 16_000,
    smallOptions: () => ({}),
    options: () => ({}),
    temperature: () => undefined,
    topP: () => undefined,
    topK: () => undefined,
    optionsForToolChoice: (_model: unknown, options: unknown) => options,
    providerOptions: () => ({}),
    maxOutputTokens: () => 1_000,
  },
}))

mock.module("@/auth", () => ({
  Auth: {
    get: async () => undefined,
  },
}))

mock.module("@/plugin", () => ({
  Plugin: {
    list: async () => [],
    trigger: async (_name: string, _input: unknown, output: unknown) => output,
  },
}))

mock.module("@/permission/next", () => ({
  PermissionNext: {
    disabled: () => new Set<string>(),
  },
}))

mock.module("@/project/instance", () => ({
  Instance: {
    project: { id: "project_test" },
  },
}))

mock.module("@/trace", () => ({
  AgentTrace: {
    isEnabled: () => false,
  },
}))

mock.module("@/llm/api", () => ({
  streamText: (input: { system?: string }) => {
    capturedSystem = input.system
    return {
      text: Promise.resolve("ok"),
      fullStream: (async function* () {})(),
    }
  },
}))

const model = {
  providerID: "test",
  id: "test-model",
  api: { id: "test-model" },
  capabilities: {},
  options: {},
} as Provider.Model

const agent = {
  name: "build",
  mode: "primary",
  prompt: "BASE AGENT PROMPT",
  options: {},
  permission: {},
} as Agent.Info

const user = {
  id: "msg_test",
  sessionID: "ses_test",
  role: "user",
  time: { created: 0 },
  agent: agent.name,
  model: { providerID: model.providerID, modelID: model.id },
} as Message.User

describe("response language system prompt", () => {
  afterAll(() => {
    mock.restore()
  })

  beforeEach(() => {
    configuredLocale = undefined
    capturedSystem = undefined
  })

  test("appends Simplified Chinese instruction from configured locale", async () => {
    configuredLocale = "zh-CN"
    const { LLM } = await import("../../src/session/llm")
    await LLM.stream({
      agent,
      model,
      sessionID: "ses_test",
      system: ["RUNTIME CONTEXT"],
      messages: [{ role: "user", content: "hello" }],
      tools: {},
      abort: new AbortController().signal,
      user,
    })

    expect(capturedSystem).toEndWith(
      "请使用简体中文进行回复。除非用户明确要求其他语言，面向用户的总结、问题、状态说明、计划和交付说明都应使用简体中文；代码、命令、文件路径、API 名称和必须保留的原文不要翻译。",
    )
  })

  test("appends English instruction from configured locale", async () => {
    configuredLocale = "en-US"
    const { LLM } = await import("../../src/session/llm")
    await LLM.stream({
      agent,
      model,
      sessionID: "ses_test",
      system: ["RUNTIME CONTEXT"],
      messages: [{ role: "user", content: "hello" }],
      tools: {},
      abort: new AbortController().signal,
      user,
    })

    expect(capturedSystem).toEndWith(
      "Please respond in English. Unless the user explicitly asks for another language, user-facing summaries, questions, status updates, plans, and acceptance notes should be written in English; keep code, commands, file paths, API names, and required source text unchanged.",
    )
  })
})
