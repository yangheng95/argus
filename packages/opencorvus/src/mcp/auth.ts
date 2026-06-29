import path from "path"
import z from "zod"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"

export namespace McpAuth {
  export const Tokens = z.object({
    accessToken: z.string(),
    refreshToken: z.string().optional(),
    expiresAt: z.number().optional(),
    scope: z.string().optional(),
  })
  export type Tokens = z.infer<typeof Tokens>

  export const ClientInfo = z.object({
    clientId: z.string(),
    clientSecret: z.string().optional(),
    clientIdIssuedAt: z.number().optional(),
    clientSecretExpiresAt: z.number().optional(),
  })
  export type ClientInfo = z.infer<typeof ClientInfo>

  export const Entry = z.object({
    tokens: Tokens.optional(),
    clientInfo: ClientInfo.optional(),
    codeVerifier: z.string().optional(),
    oauthState: z.string().optional(),
    serverUrl: z.string().optional(), // Track the URL these credentials are for
  })
  export type Entry = z.infer<typeof Entry>

  const filepath = path.join(Global.Path.data, "mcp-auth.json")
  const Store = z.record(z.string(), Entry)

  export function scopedKey(input: { projectID: string; mcpName: string }): string {
    const projectID = input.projectID.trim()
    const mcpName = input.mcpName.trim()
    if (!projectID) throw new Error("MCP auth scoped key requires a projectID")
    if (!mcpName) throw new Error("MCP auth scoped key requires an mcpName")
    return `${projectID}:${mcpName}`
  }

  function isMissingAuthFileError(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      ((error as { code?: unknown }).code === "ENOENT" || (error as { code?: unknown }).code === "ENOTDIR")
    )
  }

  export async function get(authKey: string): Promise<Entry | undefined> {
    const data = await all()
    return data[authKey]
  }

  /**
   * Get auth entry and validate it's for the correct URL.
   * Returns undefined if URL has changed (credentials are invalid).
   */
  export async function getForUrl(authKey: string, serverUrl: string): Promise<Entry | undefined> {
    const entry = await get(authKey)
    if (!entry) return undefined

    // If no serverUrl is stored, this is from an old version - consider it invalid
    if (!entry.serverUrl) return undefined

    // If URL has changed, credentials are invalid
    if (entry.serverUrl !== serverUrl) return undefined

    return entry
  }

  export async function all(): Promise<Record<string, Entry>> {
    try {
      return Store.parse(await Filesystem.readJson<unknown>(filepath))
    } catch (error) {
      if (isMissingAuthFileError(error)) return {}
      throw error
    }
  }

  export async function set(authKey: string, entry: Entry, serverUrl?: string): Promise<void> {
    const data = await all()
    // Always update serverUrl if provided
    if (serverUrl) {
      entry.serverUrl = serverUrl
    }
    await Filesystem.writeJson(filepath, { ...data, [authKey]: entry }, 0o600)
  }

  export async function remove(authKey: string): Promise<void> {
    const data = await all()
    delete data[authKey]
    await Filesystem.writeJson(filepath, data, 0o600)
  }

  export async function updateTokens(authKey: string, tokens: Tokens, serverUrl?: string): Promise<void> {
    const entry = (await get(authKey)) ?? {}
    entry.tokens = tokens
    await set(authKey, entry, serverUrl)
  }

  export async function updateClientInfo(authKey: string, clientInfo: ClientInfo, serverUrl?: string): Promise<void> {
    const entry = (await get(authKey)) ?? {}
    entry.clientInfo = clientInfo
    await set(authKey, entry, serverUrl)
  }

  export async function updateCodeVerifier(authKey: string, codeVerifier: string): Promise<void> {
    const entry = (await get(authKey)) ?? {}
    entry.codeVerifier = codeVerifier
    await set(authKey, entry)
  }

  export async function clearCodeVerifier(authKey: string): Promise<void> {
    const entry = await get(authKey)
    if (entry) {
      delete entry.codeVerifier
      await set(authKey, entry)
    }
  }

  export async function updateOAuthState(authKey: string, oauthState: string): Promise<void> {
    const entry = (await get(authKey)) ?? {}
    entry.oauthState = oauthState
    await set(authKey, entry)
  }

  export async function getOAuthState(authKey: string): Promise<string | undefined> {
    const entry = await get(authKey)
    return entry?.oauthState
  }

  export async function clearOAuthState(authKey: string): Promise<void> {
    const entry = await get(authKey)
    if (entry) {
      delete entry.oauthState
      await set(authKey, entry)
    }
  }

  /**
   * Check if stored tokens are expired.
   * Returns null if no tokens exist, false if no expiry or not expired, true if expired.
   */
  export async function isTokenExpired(authKey: string): Promise<boolean | null> {
    const entry = await get(authKey)
    if (!entry?.tokens) return null
    if (!entry.tokens.expiresAt) return false
    return entry.tokens.expiresAt < Date.now() / 1000
  }
}
