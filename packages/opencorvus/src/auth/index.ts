import path from "path"
import os from "os"
import { Global } from "../global"
import z from "zod"
import { Filesystem } from "../util/filesystem"

export const OAUTH_DUMMY_KEY = "opencorvus-oauth-dummy-key"

export namespace Auth {
  export const Oauth = z
    .object({
      type: z.literal("oauth"),
      refresh: z.string(),
      access: z.string(),
      expires: z.number(),
      accountId: z.string().optional(),
      enterpriseUrl: z.string().optional(),
    })
    .meta({ ref: "OAuth" })

  export const Api = z
    .object({
      type: z.literal("api"),
      key: z.string(),
    })
    .meta({ ref: "ApiAuth" })

  export const WellKnown = z
    .object({
      type: z.literal("wellknown"),
      key: z.string(),
      token: z.string(),
    })
    .meta({ ref: "WellKnownAuth" })

  export const Info = z.discriminatedUnion("type", [Oauth, Api, WellKnown]).meta({ ref: "Auth" })
  export type Info = z.infer<typeof Info>

  const filepath = path.join(Global.Path.data, "auth.json")
  const codexFilepath = path.join(realHome(), ".codex", "auth.json")

  function realHome() {
    try {
      const home = os.homedir()
      if (home) return home
    } catch {
      // fall through to environment-derived paths
    }
    return process.env.HOME || process.env.USERPROFILE || Global.Path.home
  }

  function parseClaims(token: string) {
    const parts = token.split(".")
    if (parts.length !== 3) return
    try {
      const json = Buffer.from(parts[1], "base64url").toString()
      return JSON.parse(json) as Record<string, unknown>
    } catch {
      return
    }
  }

  function parseExpiry(token?: string) {
    if (!token) return
    const exp = parseClaims(token)?.exp
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : undefined
  }

  function parseAccountId(tokens: Record<string, unknown>) {
    const direct = tokens.account_id
    if (typeof direct === "string" && direct) return direct

    const fromClaims = [tokens.id_token, tokens.access_token]
      .filter((token): token is string => typeof token === "string" && !!token)
      .map(parseClaims)
      .find(Boolean)

    if (!fromClaims) return
    const root = fromClaims.chatgpt_account_id
    if (typeof root === "string" && root) return root
    const nested = fromClaims["https://api.openai.com/auth"]
    if (nested && typeof nested === "object") {
      const nestedId = (nested as Record<string, unknown>).chatgpt_account_id
      if (typeof nestedId === "string" && nestedId) return nestedId
    }
    const org = Array.isArray(fromClaims.organizations) ? fromClaims.organizations[0] : undefined
    if (!org || typeof org !== "object") return
    const orgId = (org as Record<string, unknown>).id
    return typeof orgId === "string" && orgId ? orgId : undefined
  }

  function fallbackEnabled() {
    if (process.env.OPENCORVUS_ENABLE_CODEX_AUTH_FALLBACK === "1") return true
    return !process.env.OPENCORVUS_TEST_HOME
  }

  async function stored(): Promise<Record<string, Info>> {
    const data = await Filesystem.readJson<Record<string, unknown>>(filepath).catch(() => ({}))
    return Object.entries(data).reduce(
      (acc, [key, value]) => {
        const parsed = Info.safeParse(value)
        if (!parsed.success) return acc
        acc[key] = parsed.data
        return acc
      },
      {} as Record<string, Info>,
    )
  }

  export async function get(providerID: string) {
    const auth = await all()
    return auth[providerID]
  }

  export async function codexFallback(): Promise<Record<string, Info>> {
    const data = await Filesystem.readJson<Record<string, unknown>>(codexFilepath).catch(() => undefined)
    if (!data || typeof data !== "object") return {}
    const tokens = data.tokens
    if (!tokens || typeof tokens !== "object") return {}
    const access = typeof tokens.access_token === "string" && tokens.access_token ? tokens.access_token : undefined
    const refresh = typeof tokens.refresh_token === "string" && tokens.refresh_token ? tokens.refresh_token : undefined
    if (!access || !refresh) return {}

    const accountId = parseAccountId(tokens)
    const expires = parseExpiry(access) ?? parseExpiry(typeof tokens.id_token === "string" ? tokens.id_token : undefined)

    return {
      openai: {
        type: "oauth",
        access,
        refresh,
        expires: expires ?? Date.now() + 55 * 60 * 1000,
        ...(accountId ? { accountId } : {}),
      },
    }
  }

  export async function all(): Promise<Record<string, Info>> {
    const data = await stored()
    if (!fallbackEnabled()) return data
    return { ...(await codexFallback()), ...data }
  }

  export async function set(key: string, info: Info) {
    const data = await stored()
    await Filesystem.writeJson(filepath, { ...data, [key]: info }, 0o600)
  }

  export async function remove(key: string) {
    const data = await stored()
    delete data[key]
    await Filesystem.writeJson(filepath, data, 0o600)
  }
}
