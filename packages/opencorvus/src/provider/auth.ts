import { Instance } from "@/project/instance"
import { Plugin } from "../plugin"
import { map, filter, pipe, fromEntries, mapValues } from "remeda"
import z from "zod"
import { fn } from "@/util/fn"
import type { AuthOuathResult } from "@opencorvus-ai/plugin"
import { NamedError } from "@opencorvus-ai/util/error"
import { Auth } from "@/auth"

export namespace ProviderAuth {
  const state = Instance.state(async () => {
    const methods = pipe(
      await Plugin.list(),
      filter((x) => x.auth?.provider !== undefined),
      map((x) => [x.auth!.provider, x.auth!] as const),
      fromEntries(),
    )
    return { methods, pending: {} as Record<string, AuthOuathResult> }
  })

  export const Prompt = z.discriminatedUnion("type", [
    z.object({
      type: z.literal("text"),
      key: z.string(),
      message: z.string(),
      placeholder: z.string().optional(),
    }),
    z.object({
      type: z.literal("select"),
      key: z.string(),
      message: z.string(),
      options: z.array(
        z.object({
          label: z.string(),
          value: z.string(),
          hint: z.string().optional(),
        }),
      ),
    }),
  ]).meta({
    ref: "ProviderAuthPrompt",
  })
  export type Prompt = z.infer<typeof Prompt>

  export const Method = z
    .object({
      type: z.union([z.literal("oauth"), z.literal("api")]),
      label: z.string(),
      prompts: Prompt.array().optional(),
    })
    .meta({
      ref: "ProviderAuthMethod",
    })
  export type Method = z.infer<typeof Method>

  export async function methods() {
    const s = await state().then((x) => x.methods)
    return mapValues(s, (x) =>
      x.methods.map(
        (y): Method => ({
          type: y.type,
          label: y.label,
          prompts: prompts(y.prompts),
        }),
      ),
    )
  }

  function prompts(value?: Array<Record<string, unknown>>) {
    if (!Array.isArray(value)) return undefined
    const result = value
      .filter((item) => typeof item?.condition !== "function")
      .map(viewPrompt)
      .filter((item): item is Prompt => !!item)
    return result.length > 0 ? result : undefined
  }

  function viewPrompt(prompt?: Record<string, unknown>) {
    if (!prompt || typeof prompt !== "object") return undefined
    if (prompt.type === "text" && typeof prompt.key === "string" && typeof prompt.message === "string") {
      return Prompt.parse({
        type: "text",
        key: prompt.key,
        message: prompt.message,
        ...(typeof prompt.placeholder === "string" ? { placeholder: prompt.placeholder } : {}),
      })
    }
    if (
      prompt.type === "select" &&
      typeof prompt.key === "string" &&
      typeof prompt.message === "string" &&
      Array.isArray(prompt.options)
    ) {
      return Prompt.parse({
        type: "select",
        key: prompt.key,
        message: prompt.message,
        options: prompt.options,
      })
    }
    return undefined
  }

  export const resolvePrompts = fn(
    z.object({
      providerID: z.string(),
      method: z.number(),
      inputs: z.record(z.string(), z.string()).optional(),
    }),
    async (input) => {
      const auth = await state().then((s) => s.methods[input.providerID])
      const method = auth.methods[input.method]
      const prompts = Array.isArray(method.prompts) ? method.prompts : []
      return prompts
        .filter((prompt) => typeof prompt.condition !== "function" || prompt.condition(input.inputs ?? {}))
        .map(viewPrompt)
        .filter((item): item is Prompt => !!item)
    },
  )

  export const Authorization = z
    .object({
      url: z.string(),
      method: z.union([z.literal("auto"), z.literal("code")]),
      instructions: z.string(),
    })
    .meta({
      ref: "ProviderAuthAuthorization",
    })
  export type Authorization = z.infer<typeof Authorization>

  export const authorize = fn(
    z.object({
      providerID: z.string(),
      method: z.number(),
      inputs: z.record(z.string(), z.string()).optional(),
    }),
    async (input): Promise<Authorization | undefined> => {
      const auth = await state().then((s) => s.methods[input.providerID])
      const method = auth.methods[input.method]
      if (method.type === "oauth") {
        const result = await method.authorize(input.inputs)
        await state().then((s) => (s.pending[input.providerID] = result))
        return {
          url: result.url,
          method: result.method,
          instructions: result.instructions,
        }
      }
    },
  )

  export const callback = fn(
    z.object({
      providerID: z.string(),
      method: z.number(),
      code: z.string().optional(),
    }),
    async (input) => {
      const match = await state().then((s) => s.pending[input.providerID])
      if (!match) throw new OauthMissing({ providerID: input.providerID })
      let result

      if (match.method === "code") {
        if (!input.code) throw new OauthCodeMissing({ providerID: input.providerID })
        result = await match.callback(input.code)
      }

      if (match.method === "auto") {
        result = await match.callback()
      }

      if (result?.type === "success") {
        const providerID = result.provider || input.providerID
        if ("key" in result) {
          await Auth.set(providerID, {
            type: "api",
            key: result.key,
          })
        }
        if ("refresh" in result) {
          const info: Auth.Info = {
            type: "oauth",
            access: result.access,
            refresh: result.refresh,
            expires: result.expires,
          }
          if (result.accountId) {
            info.accountId = result.accountId
          }
          if ("enterpriseUrl" in result && typeof result.enterpriseUrl === "string" && result.enterpriseUrl) {
            info.enterpriseUrl = result.enterpriseUrl
          }
          await Auth.set(providerID, info)
        }
        return
      }

      throw new OauthCallbackFailed({})
    },
  )

  export const api = fn(
    z.object({
      providerID: z.string(),
      key: z.string(),
    }),
    async (input) => {
      await Auth.set(input.providerID, {
        type: "api",
        key: input.key,
      })
    },
  )

  export const execute = fn(
    z.object({
      providerID: z.string(),
      method: z.number(),
      inputs: z.record(z.string(), z.string()).optional(),
    }),
    async (input) => {
      const auth = await state().then((s) => s.methods[input.providerID])
      const method = auth.methods[input.method]
      if (method.type !== "api") return
      if (!method.authorize) throw new OauthCallbackFailed({})
      const result = await method.authorize(input.inputs)
      if (result?.type !== "success") throw new OauthCallbackFailed({})
      await Auth.set(result.provider || input.providerID, {
        type: "api",
        key: result.key,
      })
    },
  )

  export const OauthMissing = NamedError.create(
    "ProviderAuthOauthMissing",
    z.object({
      providerID: z.string(),
    }),
  )
  export const OauthCodeMissing = NamedError.create(
    "ProviderAuthOauthCodeMissing",
    z.object({
      providerID: z.string(),
    }),
  )

  export const OauthCallbackFailed = NamedError.create("ProviderAuthOauthCallbackFailed", z.object({}))
}
