import type { Hooks, PluginInput } from "@opencorvus-ai/plugin"
import { Log } from "../util/log"
import { Installation } from "../installation"
import { Auth, OAUTH_DUMMY_KEY } from "../auth"
import os from "os"

const log = Log.create({ service: "plugin.codex" })

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const ISSUER = "https://auth.openai.com"
const CODEX_API_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses"
const OPENAI_CODEX_PROVIDER = "openai-codex"
const OAUTH_PORT = 1455
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3000
const TLS_CERT_ERROR_CODES = new Set([
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "ERR_TLS_CERT_ALTNAME_INVALID",
])
const TLS_CERT_ERROR_PATTERNS = [
  /unable to get local issuer certificate/i,
  /unable to verify the first certificate/i,
  /self[- ]signed certificate/i,
  /certificate has expired/i,
]
const OPENAI_AUTH_PROBE_URL =
  `${ISSUER}/oauth/authorize?response_type=code&client_id=opencorvus-preflight&redirect_uri=` +
  encodeURIComponent(`http://localhost:${OAUTH_PORT}/auth/callback`) +
  "&scope=openid+profile+email"

interface PkceCodes {
  verifier: string
  challenge: string
}

export type OpenAIOAuthTlsPreflightResult =
  | { ok: true }
  | {
      ok: false
      kind: "tls-cert" | "network"
      code?: string
      message: string
    }

async function generatePKCE(): Promise<PkceCodes> {
  const verifier = generateRandomString(43)
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const hash = await crypto.subtle.digest("SHA-256", data)
  const challenge = base64UrlEncode(hash)
  return { verifier, challenge }
}

function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join("")
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const binary = String.fromCharCode(...bytes)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function generateState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
}

function oauthCallbackUrl() {
  return `http://localhost:${OAUTH_PORT}/auth/callback`
}

function oauthErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function oauthFailure(error: unknown) {
  const root = error && typeof error === "object" ? (error as Record<string, unknown>) : {}
  const cause =
    root.cause && typeof root.cause === "object"
      ? (root.cause as Record<string, unknown>)
      : undefined
  const code = typeof cause?.code === "string" ? cause.code : undefined
  const message =
    typeof cause?.message === "string"
      ? cause.message
      : typeof root.message === "string"
        ? root.message
        : oauthErrorMessage(error)
  const kind =
    (code ? TLS_CERT_ERROR_CODES.has(code) : false) ||
      TLS_CERT_ERROR_PATTERNS.some((pattern) => pattern.test(message))
      ? "tls-cert"
      : "network"
  return {
    code,
    message,
    kind,
  } as const
}

export async function runOpenAIOAuthTlsPreflight(options: {
  timeoutMs?: number
  fetchImpl?: typeof fetch
} = {}): Promise<OpenAIOAuthTlsPreflightResult> {
  const timeoutMs = options.timeoutMs ?? 5000
  const fetchImpl = options.fetchImpl ?? fetch
  try {
    await fetchImpl(OPENAI_AUTH_PROBE_URL, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    })
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      ...oauthFailure(error),
    }
  }
}

export function formatOpenAIOAuthTlsPreflightFix(
  result: Exclude<OpenAIOAuthTlsPreflightResult, { ok: true }>,
) {
  if (result.kind !== "tls-cert") {
    return [
      "OpenAI OAuth prerequisites check failed before the browser flow.",
      `Cause: ${result.message}`,
      "Verify DNS, firewall, proxy, or TLS interception settings for auth.openai.com and try again.",
    ].join("\n")
  }
  return [
    "OpenAI OAuth prerequisites check failed: Bun/Node cannot validate TLS certificates for auth.openai.com.",
    `Cause: ${result.code ? `${result.code} (${result.message})` : result.message}`,
    "Fix your local certificate chain or corporate MITM root store, then retry OAuth.",
  ].join("\n")
}

export interface IdTokenClaims {
  chatgpt_account_id?: string
  organizations?: Array<{ id: string }>
  email?: string
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string
  }
}

export function parseJwtClaims(token: string): IdTokenClaims | undefined {
  const parts = token.split(".")
  if (parts.length !== 3) return undefined
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString())
  } catch {
    return undefined
  }
}

export function extractAccountIdFromClaims(claims: IdTokenClaims): string | undefined {
  return (
    claims.chatgpt_account_id ||
    claims["https://api.openai.com/auth"]?.chatgpt_account_id ||
    claims.organizations?.[0]?.id
  )
}

export function extractAccountId(tokens: TokenResponse): string | undefined {
  if (tokens.id_token) {
    const claims = parseJwtClaims(tokens.id_token)
    const accountId = claims && extractAccountIdFromClaims(claims)
    if (accountId) return accountId
  }
  if (tokens.access_token) {
    const claims = parseJwtClaims(tokens.access_token)
    return claims ? extractAccountIdFromClaims(claims) : undefined
  }
  return undefined
}

function extractInstructions(items: unknown[] | undefined) {
  if (!Array.isArray(items)) return
  const system = items.filter((item) => {
    if (!item || typeof item !== "object") return false
    const role = (item as Record<string, unknown>).role
    return role === "system" || role === "developer"
  })
  if (system.length === 0) return

  const instructions = system
    .map((item) => {
      const content = (item as Record<string, unknown>).content
      return typeof content === "string" ? content.trim() : ""
    })
    .filter(Boolean)
    .join("\n\n")

  if (!instructions) return
  return {
    instructions,
    items: items.filter((item) => {
      if (!item || typeof item !== "object") return true
      const role = (item as Record<string, unknown>).role
      return role !== "system" && role !== "developer"
    }),
  }
}

function followUpItems(items: unknown[] | undefined, calls?: Map<string, Record<string, unknown>>) {
  if (!Array.isArray(items)) return items
  const tail: unknown[] = []
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (!item || typeof item !== "object") break
    const row = item as Record<string, unknown>
    const role = row.role
    if (role === "user") {
      tail.unshift(item)
      continue
    }
    const type = row.type
    if (typeof type === "string" && type.endsWith("_output")) {
      tail.unshift(item)
      continue
    }
    break
  }
  if (tail.length === 0) return items

  const callIds = tail.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const callID = (item as Record<string, unknown>).call_id
    return typeof callID === "string" && callID ? [callID] : []
  })
  if (callIds.length === 0) return tail

  const cached = callIds.flatMap((callID) => {
    const item = calls?.get(callID)
    return item ? [item] : []
  })
  if (cached.length > 0) return [...cached, ...tail]

  const callSet = new Set(callIds)
  const matched = items.filter((item) => {
    if (!item || typeof item !== "object") return false
    const row = item as Record<string, unknown>
    const type = row.type
    const callID = row.call_id
    return typeof type === "string" && type.endsWith("_call") && typeof callID === "string" && callSet.has(callID)
  })

  return [...matched, ...tail]
}

function responseCalls(data: Record<string, unknown>) {
  const output = Array.isArray(data.output) ? data.output : []
  const entries = output.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const row = item as Record<string, unknown>
    const type = row.type
    const callID = row.call_id
    if (typeof type !== "string" || !type.endsWith("_call")) return []
    if (typeof callID !== "string" || !callID) return []
    return [[callID, row] as const]
  })
  return entries.length > 0 ? new Map(entries) : undefined
}

export function prepareCodexBody(body: unknown, previousResponseId?: string, calls?: Map<string, Record<string, unknown>>) {
  if (!body || typeof body !== "object") return body
  const row = body as Record<string, unknown>
  const { max_output_tokens: _, ...trimmed } = row
  const existing = trimmed.instructions
  const base = {
    ...trimmed,
    ...(previousResponseId && Array.isArray(trimmed.input) ? { input: followUpItems(trimmed.input, calls) } : {}),
    ...(previousResponseId && Array.isArray(trimmed.messages) ? { messages: followUpItems(trimmed.messages, calls) } : {}),
    store: false,
    stream: true,
  }
  if (typeof existing === "string" && existing.trim()) return base

  const fromInput = extractInstructions(Array.isArray(trimmed.input) ? trimmed.input : undefined)
  if (fromInput) {
    return {
      ...base,
      instructions: fromInput.instructions,
      input: previousResponseId ? followUpItems(fromInput.items, calls) : fromInput.items,
    }
  }

  const fromMessages = extractInstructions(Array.isArray(trimmed.messages) ? trimmed.messages : undefined)
  if (!fromMessages) return base
  return {
    ...base,
    instructions: fromMessages.instructions,
    messages: previousResponseId ? followUpItems(fromMessages.items, calls) : fromMessages.items,
  }
}

export function parseCodexSSE(text: string) {
  const events = text
    .split(/\r?\n\r?\n/)
    .flatMap((chunk) => {
      const data = chunk
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter(Boolean)
        .join("\n")
      if (!data || data === "[DONE]") return []
      try {
        return [JSON.parse(data) as Record<string, unknown>]
      } catch {
        return []
      }
    })

  const done = events.findLast((event) => event.type === "response.completed")
  if (done?.response && typeof done.response === "object") return done.response
  const created = events.findLast((event) => event.type === "response.created")
  if (created?.response && typeof created.response === "object") return created.response
  return
}

async function codexResponse(response: Response, wantsStream: boolean) {
  if (wantsStream) return response
  const text = await response.text()
  if (!text.trimStart().startsWith("event:")) {
    return new Response(text, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }

  const parsed = parseCodexSSE(text)
  if (!parsed) {
    return new Response(text, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }

  const headers = new Headers(response.headers)
  headers.set("content-type", "application/json")
  headers.delete("content-length")
  return new Response(JSON.stringify(parsed), {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

async function responseState(response: Response) {
  try {
    const data = await response.clone().json() as Record<string, unknown>
    return {
      id: typeof data.id === "string" && data.id ? data.id : undefined,
      calls: responseCalls(data),
    }
  } catch {
    return
  }
}

function buildAuthorizeUrl(redirectUri: string, pkce: PkceCodes, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access",
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    originator: "opencorvus",
  })
  return `${ISSUER}/oauth/authorize?${params.toString()}`
}

interface TokenResponse {
  id_token: string
  access_token: string
  refresh_token: string
  expires_in?: number
}

async function exchangeCodeForTokens(code: string, redirectUri: string, pkce: PkceCodes): Promise<TokenResponse> {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: pkce.verifier,
    }).toString(),
  })
  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`)
  }
  return response.json()
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }).toString(),
  })
  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`)
  }
  return response.json()
}

const HTML_SUCCESS = `<!doctype html>
<html>
  <head>
    <title>OpenCorvus - Codex Authorization Successful</title>
    <style>
      body {
        font-family:
          system-ui,
          -apple-system,
          sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
        background: #131010;
        color: #f1ecec;
      }
      .container {
        text-align: center;
        padding: 2rem;
      }
      h1 {
        color: #f1ecec;
        margin-bottom: 1rem;
      }
      p {
        color: #b7b1b1;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Authorization Successful</h1>
      <p>You can close this window and return to OpenCorvus.</p>
    </div>
    <script>
      setTimeout(() => window.close(), 2000)
    </script>
  </body>
</html>`

const HTML_ERROR = (error: string) => `<!doctype html>
<html>
  <head>
    <title>OpenCorvus - Codex Authorization Failed</title>
    <style>
      body {
        font-family:
          system-ui,
          -apple-system,
          sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
        background: #131010;
        color: #f1ecec;
      }
      .container {
        text-align: center;
        padding: 2rem;
      }
      h1 {
        color: #fc533a;
        margin-bottom: 1rem;
      }
      p {
        color: #b7b1b1;
      }
      .error {
        color: #ff917b;
        font-family: monospace;
        margin-top: 1rem;
        padding: 1rem;
        background: #3c140d;
        border-radius: 0.5rem;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Authorization Failed</h1>
      <p>An error occurred during authorization.</p>
      <div class="error">${error}</div>
    </div>
  </body>
</html>`

interface PendingOAuth {
  pkce: PkceCodes
  state: string
  resolve: (tokens: TokenResponse) => void
  reject: (error: Error) => void
}

let oauthServer: ReturnType<typeof Bun.serve> | undefined
let pendingOAuth: PendingOAuth | undefined

function finishPendingOAuth(error?: Error) {
  const current = pendingOAuth
  pendingOAuth = undefined
  if (!current || !error) return current
  current.reject(error)
  return current
}

function callbackParams(value: string) {
  const text = value.trim()
  if (!text) return new URLSearchParams()
  if (text.includes("://")) return new URL(text).searchParams
  if (text.startsWith("/")) return new URL(text, oauthCallbackUrl()).searchParams
  if (text.startsWith("?")) return new URLSearchParams(text.slice(1))
  if (text.includes("=")) return new URLSearchParams(text.replace(/^[?#]/, ""))
  return new URLSearchParams({ code: text })
}

export function parseOAuthCallbackInput(input: string, expectedState?: string) {
  const params = callbackParams(input)
  const error = params.get("error")
  const errorDescription = params.get("error_description")
  if (error) throw new Error(errorDescription || error)

  const code = params.get("code")
  if (!code) throw new Error("Missing authorization code")

  const state = params.get("state")
  if (expectedState && state && state !== expectedState) {
    throw new Error("Invalid state - potential CSRF attack")
  }

  return code
}

async function startOAuthServer(): Promise<{ port: number; redirectUri: string; listening: boolean }> {
  const redirectUri = oauthCallbackUrl()
  if (oauthServer) {
    return { port: OAUTH_PORT, redirectUri, listening: true }
  }

  try {
    oauthServer = Bun.serve({
      port: OAUTH_PORT,
      fetch(req) {
        const url = new URL(req.url)

        if (url.pathname === "/auth/callback") {
          const code = url.searchParams.get("code")
          const state = url.searchParams.get("state")
          const error = url.searchParams.get("error")
          const errorDescription = url.searchParams.get("error_description")

          if (error) {
            const errorMsg = errorDescription || error
            finishPendingOAuth(new Error(errorMsg))
            return new Response(HTML_ERROR(errorMsg), {
              headers: { "Content-Type": "text/html" },
            })
          }

          if (!code) {
            const errorMsg = "Missing authorization code"
            finishPendingOAuth(new Error(errorMsg))
            return new Response(HTML_ERROR(errorMsg), {
              status: 400,
              headers: { "Content-Type": "text/html" },
            })
          }

          if (!pendingOAuth || state !== pendingOAuth.state) {
            const errorMsg = "Invalid state - potential CSRF attack"
            finishPendingOAuth(new Error(errorMsg))
            return new Response(HTML_ERROR(errorMsg), {
              status: 400,
              headers: { "Content-Type": "text/html" },
            })
          }

          const current = finishPendingOAuth()
          if (!current) {
            return new Response(HTML_ERROR("Missing pending OAuth flow"), {
              status: 400,
              headers: { "Content-Type": "text/html" },
            })
          }

          exchangeCodeForTokens(code, redirectUri, current.pkce)
            .then((tokens) => current.resolve(tokens))
            .catch((err) => current.reject(err))

          return new Response(HTML_SUCCESS, {
            headers: { "Content-Type": "text/html" },
          })
        }

        if (url.pathname === "/cancel") {
          finishPendingOAuth(new Error("Login cancelled"))
          return new Response("Login cancelled", { status: 200 })
        }

        return new Response("Not found", { status: 404 })
      },
    })

    log.info("codex oauth server started", { port: OAUTH_PORT })
    return { port: OAUTH_PORT, redirectUri, listening: true }
  } catch (error) {
    log.warn("codex oauth server unavailable, falling back to manual redirect capture", {
      error: oauthErrorMessage(error),
    })
    return { port: OAUTH_PORT, redirectUri, listening: false }
  }
}

function stopOAuthServer() {
  if (oauthServer) {
    oauthServer.stop()
    oauthServer = undefined
    log.info("codex oauth server stopped")
  }
}

function waitForOAuthCallback(pkce: PkceCodes, state: string): Promise<TokenResponse> {
  return new Promise((resolve, reject) => {
    finishPendingOAuth(new Error("OAuth flow restarted"))
    const timeout = setTimeout(
      () => {
        if (pendingOAuth) {
          pendingOAuth = undefined
          reject(new Error("OAuth callback timeout - authorization took too long"))
        }
      },
      5 * 60 * 1000,
    ) // 5 minute timeout

    pendingOAuth = {
      pkce,
      state,
      resolve: (tokens) => {
        clearTimeout(timeout)
        resolve(tokens)
      },
      reject: (error) => {
        clearTimeout(timeout)
        reject(error)
      },
    }
  })
}

export async function CodexAuthPlugin(input: PluginInput): Promise<Hooks> {
  const previousResponseIds = new Map<string, string>()
  const previousCalls = new Map<string, Map<string, Record<string, unknown>>>()
  return {
    auth: {
      provider: OPENAI_CODEX_PROVIDER,
      async loader(getAuth, provider) {
        const auth = await getAuth()
        if (auth.type !== "oauth") return {}

        // Zero out costs for Codex (included with ChatGPT subscription)
        for (const model of Object.values(provider.models)) {
          model.cost = {
            input: 0,
            output: 0,
            cache: { read: 0, write: 0 },
            ...(model.cost.experimentalOver200K
              ? {
                  experimentalOver200K: {
                    input: 0,
                    output: 0,
                    cache: { read: 0, write: 0 },
                  },
                }
              : {}),
          }
        }

        return {
          apiKey: OAUTH_DUMMY_KEY,
          async fetch(requestInput: RequestInfo | URL, init?: RequestInit) {
            // Remove dummy API key authorization header
            if (init?.headers) {
              if (init.headers instanceof Headers) {
                init.headers.delete("authorization")
                init.headers.delete("Authorization")
              } else if (Array.isArray(init.headers)) {
                init.headers = init.headers.filter(([key]) => key.toLowerCase() !== "authorization")
              } else {
                delete init.headers["authorization"]
                delete init.headers["Authorization"]
              }
            }

            const currentAuth =
              await getAuth().catch(() => undefined) ?? await Auth.get(OPENAI_CODEX_PROVIDER).catch(() => undefined)
            if (!currentAuth || currentAuth.type !== "oauth") {
              throw new Error("OpenAI Codex OAuth credentials not available for request")
            }

            // Cast to include accountId field
            const authWithAccount = currentAuth as typeof currentAuth & { accountId?: string }

            // Check if token needs refresh
            if (!currentAuth.access || currentAuth.expires < Date.now()) {
              log.info("refreshing codex access token")
              const tokens = await refreshAccessToken(currentAuth.refresh)
              const newAccountId = extractAccountId(tokens) || authWithAccount.accountId
              await input.client.auth.set({
                providerID: OPENAI_CODEX_PROVIDER,
                auth: {
                  type: "oauth",
                  refresh: tokens.refresh_token,
                  access: tokens.access_token,
                  expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                  ...(newAccountId && { accountId: newAccountId }),
                },
              })
              currentAuth.access = tokens.access_token
              authWithAccount.accountId = newAccountId
            }

            // Build headers
            const headers = new Headers()
            if (init?.headers) {
              if (init.headers instanceof Headers) {
                init.headers.forEach((value, key) => headers.set(key, value))
              } else if (Array.isArray(init.headers)) {
                for (const [key, value] of init.headers) {
                  if (value !== undefined) headers.set(key, String(value))
                }
              } else {
                for (const [key, value] of Object.entries(init.headers)) {
                  if (value !== undefined) headers.set(key, String(value))
                }
              }
            }

            // Set authorization header with access token
            headers.set("authorization", `Bearer ${currentAuth.access}`)

            // Set ChatGPT-Account-Id header for organization subscriptions
            if (authWithAccount.accountId) {
              headers.set("ChatGPT-Account-Id", authWithAccount.accountId)
            }

            // Rewrite URL to Codex endpoint
            const parsed =
              requestInput instanceof URL
                ? requestInput
                : new URL(typeof requestInput === "string" ? requestInput : requestInput.url)
            const url =
              parsed.pathname.endsWith("/responses") || parsed.pathname.endsWith("/chat/completions")
                ? new URL(CODEX_API_ENDPOINT)
                : parsed

            let body = init?.body
            let wantsStream = false
            const sessionID = headers.get("session_id") ?? "global"
            if (url.toString() === CODEX_API_ENDPOINT && typeof body === "string") {
              try {
                const parsedBody = JSON.parse(body) as Record<string, unknown>
                const previous = previousResponseIds.get(sessionID)
                wantsStream = parsedBody.stream === true
                const adaptedBody = prepareCodexBody(parsedBody, previous, previousCalls.get(sessionID))
                if (process.env.OPENCORVUS_DEBUG_CODEX === "1" && previous) {
                  const items = Array.isArray((adaptedBody as Record<string, unknown>).input)
                    ? (adaptedBody as Record<string, unknown>).input
                    : []
                  console.log("[codex] follow-up", JSON.stringify(items, null, 2))
                }
                body = JSON.stringify(adaptedBody)
              } catch {
                body = init?.body
              }
            }

            const response = await fetch(url, {
              ...init,
              body,
              headers,
            })
            const adapted = await codexResponse(response, wantsStream)
            const state = await responseState(adapted)
            if (state?.id) previousResponseIds.set(sessionID, state.id)
            if (state?.calls) previousCalls.set(sessionID, state.calls)
            return adapted
          },
        }
      },
      methods: [
        {
          label: "ChatGPT Pro/Plus (browser)",
          type: "oauth",
          authorize: async () => {
            const preflight = await runOpenAIOAuthTlsPreflight()
            if (!preflight.ok && preflight.kind === "tls-cert") {
              throw new Error(formatOpenAIOAuthTlsPreflightFix(preflight))
            }

            const { redirectUri, listening } = await startOAuthServer()
            const pkce = await generatePKCE()
            const state = generateState()
            const authUrl = buildAuthorizeUrl(redirectUri, pkce, state)
            const callbackPromise = listening ? waitForOAuthCallback(pkce, state) : undefined

            return {
              url: authUrl,
              instructions: [
                "Complete OpenAI authorization in your local browser.",
                listening
                  ? "If localhost callback does not finish automatically, paste the full redirect URL or authorization code back here. If it does finish automatically, you can leave the field blank and submit."
                  : "After sign-in, paste the full redirect URL or authorization code back here.",
                `OpenAI OAuth uses ${redirectUri} for the callback.`,
              ].join("\n"),
              method: "code" as const,
              callback: async (code) => {
                const text = code.trim()
                try {
                  const tokens = text
                    ? await exchangeCodeForTokens(parseOAuthCallbackInput(text, state), redirectUri, pkce)
                    : await callbackPromise
                  if (!tokens) {
                    throw new Error("Paste the full redirect URL or authorization code to finish OpenAI OAuth")
                  }
                  const accountId = extractAccountId(tokens)
                  return {
                    type: "success" as const,
                    refresh: tokens.refresh_token,
                    access: tokens.access_token,
                    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                    accountId,
                  }
                } finally {
                  finishPendingOAuth()
                  stopOAuthServer()
                }
              },
            }
          },
        },
        {
          label: "ChatGPT Pro/Plus (headless)",
          type: "oauth",
          authorize: async () => {
            const deviceResponse = await fetch(`${ISSUER}/api/accounts/deviceauth/usercode`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "User-Agent": `opencorvus/${Installation.VERSION}`,
              },
              body: JSON.stringify({ client_id: CLIENT_ID }),
            })

            if (!deviceResponse.ok) throw new Error("Failed to initiate device authorization")

            const deviceData = (await deviceResponse.json()) as {
              device_auth_id: string
              user_code: string
              interval: string
            }
            const interval = Math.max(parseInt(deviceData.interval, 10) || 5, 1) * 1000

            return {
              url: `${ISSUER}/codex/device`,
              instructions: `Enter code: ${deviceData.user_code}`,
              method: "auto" as const,
              async callback() {
                while (true) {
                  const response = await fetch(`${ISSUER}/api/accounts/deviceauth/token`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "User-Agent": `opencorvus/${Installation.VERSION}`,
                    },
                    body: JSON.stringify({
                      device_auth_id: deviceData.device_auth_id,
                      user_code: deviceData.user_code,
                    }),
                  })

                  if (response.ok) {
                    const data = (await response.json()) as {
                      authorization_code: string
                      code_verifier: string
                    }

                    const tokenResponse = await fetch(`${ISSUER}/oauth/token`, {
                      method: "POST",
                      headers: { "Content-Type": "application/x-www-form-urlencoded" },
                      body: new URLSearchParams({
                        grant_type: "authorization_code",
                        code: data.authorization_code,
                        redirect_uri: `${ISSUER}/deviceauth/callback`,
                        client_id: CLIENT_ID,
                        code_verifier: data.code_verifier,
                      }).toString(),
                    })

                    if (!tokenResponse.ok) {
                      throw new Error(`Token exchange failed: ${tokenResponse.status}`)
                    }

                    const tokens: TokenResponse = await tokenResponse.json()

                    return {
                      type: "success" as const,
                      refresh: tokens.refresh_token,
                      access: tokens.access_token,
                      expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                      accountId: extractAccountId(tokens),
                    }
                  }

                  if (response.status !== 403 && response.status !== 404) {
                    return { type: "failed" as const }
                  }

                  await Bun.sleep(interval + OAUTH_POLLING_SAFETY_MARGIN_MS)
                }
              },
            }
          },
        },
        {
          label: "Manually enter API Key",
          type: "api",
        },
      ],
    },
    "chat.headers": async (input, output) => {
      if (input.model.providerID !== OPENAI_CODEX_PROVIDER) return
      output.headers.originator = "opencorvus"
      output.headers["User-Agent"] =
        `opencorvus/${Installation.VERSION} (${os.platform()} ${os.release()}; ${os.arch()})`
      output.headers.session_id = input.sessionID
    },
  }
}
