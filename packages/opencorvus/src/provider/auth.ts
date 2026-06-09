import { Instance, lazyInstanceState } from "@/project/instance"
import { Plugin } from "../plugin"
import { map, filter, pipe, fromEntries, mapValues } from "remeda"
import z from "zod"
import { fn } from "@/util/fn"
import type { AuthOuathResult } from "@opencorvus-ai/plugin"
import { NamedError } from "@opencorvus-ai/util/error"
import { Auth } from "@/auth"

export namespace ProviderAuth {
  const state = lazyInstanceState(async () => {
    const methods = pipe(
      await Plugin.list(),
      filter((x) => x.auth?.provider !== undefined),
      map((x) => [x.auth!.provider, x.auth!] as const),
      fromEntries(),
    )
    return { methods, pending: {} as Record<string, AuthOuathResult> }
  })

  export const Method = z
    .object({
      type: z.union([z.literal("oauth"), z.literal("api")]),
      label: z.string(),
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
        }),
      ),
    )
  }

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
        if ("key" in result) {
          await Auth.set(input.providerID, {
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
          await Auth.set(input.providerID, info)
        }
        return
      }

      throw new OauthCallbackFailed({})
    },
  )

  export const Prompt = z
    .object({
      type: z.union([z.literal("text"), z.literal("select")]),
      key: z.string(),
      message: z.string(),
      placeholder: z.string().optional(),
      options: z
        .array(
          z.object({
            label: z.string(),
            value: z.string(),
            hint: z.string().optional(),
          }),
        )
        .optional(),
    })
    .meta({ ref: "ProviderAuthPrompt" })
  export type Prompt = z.infer<typeof Prompt>

  export const prompts = fn(
    z.object({
      providerID: z.string(),
      method: z.number(),
      inputs: z.record(z.string(), z.string()).optional(),
    }),
    async (input): Promise<Prompt[]> => {
      const auth = await state().then((s) => s.methods[input.providerID])
      if (!auth) return []
      const method = auth.methods[input.method]
      if (!method?.prompts) return []
      const currentInputs = input.inputs ?? {}
      return method.prompts
        .filter((p) => !p.condition || p.condition(currentInputs))
        .map(
          (p): Prompt => ({
            type: p.type,
            key: p.key,
            message: p.message,
            placeholder: "placeholder" in p ? p.placeholder : undefined,
            options: "options" in p ? p.options : undefined,
          }),
        )
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
      if (!auth) throw new ProviderNotFound({ providerID: input.providerID })
      const method = auth.methods[input.method]
      if (!method) throw new MethodNotFound({ providerID: input.providerID, method: input.method })

      if (method.type === "api") {
        if (method.authorize) {
          const result = await method.authorize(input.inputs)
          if (result.type === "success") {
            await Auth.set(result.provider ?? input.providerID, {
              type: "api",
              key: result.key,
            })
            return
          }
          throw new AuthExecuteFailed({})
        }
        // api method without authorize — use first input value as key
        const key = input.inputs ? Object.values(input.inputs)[0] : undefined
        if (!key) throw new AuthExecuteFailed({})
        await Auth.set(input.providerID, { type: "api", key })
        return
      }

      if (method.type === "oauth") {
        const result = await method.authorize(input.inputs)
        await state().then((s) => (s.pending[input.providerID] = result))
        return
      }
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

  export const ProviderNotFound = NamedError.create(
    "ProviderAuthProviderNotFound",
    z.object({ providerID: z.string() }),
  )
  export const MethodNotFound = NamedError.create(
    "ProviderAuthMethodNotFound",
    z.object({ providerID: z.string(), method: z.number() }),
  )
  export const AuthExecuteFailed = NamedError.create("ProviderAuthExecuteFailed", z.object({}))

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
