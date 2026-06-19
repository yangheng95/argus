import { beforeEach, describe, expect, mock, test } from "bun:test"

let promptResponse: unknown = []
let apiCalls: Array<{ path: string; body: any }> = []

mock.module("../src/services/api", () => ({
  apiJson: async (path: string, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined
    apiCalls.push({ path, body })
    if (path.endsWith("/auth/prompts")) return promptResponse
    throw new Error(`unexpected api path ${path}`)
  },
}))

const { setAppStore } = await import("../src/store/app")
const { setLocaleData } = await import("../src/utils/i18n")
const { authenticateSelectedProvider, providerAuthInputs } = await import("../src/services/llm")
type AuthDialogCallbacks = import("../src/services/llm").AuthDialogCallbacks

function authCallbacks(overrides: Partial<AuthDialogCallbacks> = {}): AuthDialogCallbacks {
  return {
    nativePrompt: async () => null,
    nativeSelect: async () => null,
    nativeConfirm: async () => false,
    nativeOpen: async () => false,
    showLlmNotice: () => undefined,
    onAuthCancelled: () => undefined,
    ...overrides,
  }
}

describe("provider auth select source", () => {
  beforeEach(() => {
    promptResponse = []
    apiCalls = []
    setLocaleData("en-US", {
      common: { cancel: "Cancel", ok: "OK" },
      llm: {
        auth_choose_method: "Choose auth method",
        auth_method: "Auth method",
        auth_type_api: "API",
        auth_type_oauth: "OAuth",
      },
    })
    setAppStore({
      providerCatalog: {
        all: [
          { id: "custom-api", name: "Custom API" },
          { id: "mixed-provider", name: "Mixed Provider" },
        ],
        connected: [],
        default: {},
      },
      providerAuth: {},
    })
  })

  test("provider auth select prompts reject missing selectValue before native select opens", async () => {
    promptResponse = [
      {
        type: "select",
        key: "region",
        message: "Region",
        options: [
          { label: "Europe", value: "eu" },
          { label: "United States", value: "us" },
        ],
      },
    ]
    let selectCalls = 0

    await expect(
      providerAuthInputs("custom-api", 0, {
        nativePrompt: async () => null,
        nativeSelect: async () => {
          selectCalls += 1
          return null
        },
      }),
    ).rejects.toThrow("requires selectValue")
    expect(selectCalls).toBe(0)
  })

  test("provider auth select prompts reject invalid selectValue before native select opens", async () => {
    promptResponse = [
      {
        type: "select",
        key: "region",
        message: "Region",
        selectValue: "apac",
        options: [
          { label: "Europe", value: "eu" },
          { label: "United States", value: "us" },
        ],
      },
    ]
    let selectCalls = 0

    await expect(
      providerAuthInputs("custom-api", 0, {
        nativePrompt: async () => null,
        nativeSelect: async () => {
          selectCalls += 1
          return null
        },
      }),
    ).rejects.toThrow("is not in options")
    expect(selectCalls).toBe(0)
  })

  test("provider auth select prompts pass the protocol selectValue to native select", async () => {
    promptResponse = [
      {
        type: "select",
        key: "region",
        message: "Region",
        selectValue: "us",
        options: [
          { label: "Europe", value: "eu" },
          { label: "United States", value: "us" },
        ],
      },
    ]

    const inputs = await providerAuthInputs("custom-api", 0, {
      nativePrompt: async () => null,
      nativeSelect: async (_message, opts) => {
        expect(opts.selectValue).toBe("us")
        return opts.selectValue
      },
    })

    expect(inputs).toEqual({ region: "us" })
    expect(apiCalls[1]?.body?.inputs).toEqual({ region: "us" })
  })

  test("multiple auth methods use the explicit preferred method as selectValue", async () => {
    setAppStore("providerAuth", {
      "mixed-provider": [
        { type: "api", label: "API key" },
        { type: "oauth", label: "Browser OAuth", preferred: true },
      ],
    })
    const selections: string[] = []

    const ok = await authenticateSelectedProvider(
      "mixed-provider",
      authCallbacks({
        nativeSelect: async (_message, opts) => {
          selections.push(opts.selectValue)
          return null
        },
      }),
    )

    expect(ok).toBe(false)
    expect(selections).toEqual(["1"])
  })

  test("multiple auth methods without a preferred source fail before native select opens", async () => {
    setAppStore("providerAuth", {
      "mixed-provider": [
        { type: "api", label: "API key" },
        { type: "oauth", label: "Browser OAuth" },
      ],
    })
    let selectCalls = 0

    await expect(
      authenticateSelectedProvider(
        "mixed-provider",
        authCallbacks({
          nativeSelect: async () => {
            selectCalls += 1
            return null
          },
        }),
      ),
    ).rejects.toThrow("requires one preferred auth method")
    expect(selectCalls).toBe(0)
  })
})
