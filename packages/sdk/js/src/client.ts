export * from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { OpencodeClient } from "./gen/sdk.gen.js"
export { OpencodeClient as OpenCorvusClient }
export { OpencodeClient }

export type OpenCorvusClientConfig = Config & {
  directory?: string
  username?: string
  password?: string
}
export type OpencodeClientConfig = OpenCorvusClientConfig

function basicAuthorization(username: string, password: string) {
  const bytes = new TextEncoder().encode(`${username}:${password}`)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `Basic ${btoa(binary)}`
}

function headerBag(headers: Config["headers"]) {
  return new Headers(headers as HeadersInit | undefined)
}

export function createOpenCorvusClient(input?: OpenCorvusClientConfig) {
  const { directory, username, password, ...rest } = input ?? {}
  let config: Config = rest

  if (!config.fetch) {
    const customFetch: any = (req: any) => {
      // @ts-ignore
      req.timeout = false
      return fetch(req)
    }
    config = {
      ...config,
      fetch: customFetch,
    }
  }

  if (directory) {
    let dir = directory
    // Normalize MINGW/MSYS-style paths (/c/foo/bar → C:\foo\bar) on Windows.
    // These paths cause path.resolve to produce incorrect results (e.g. C:\c\foo\bar).
    if (typeof process !== "undefined" && process.platform === "win32") {
      const m = dir.match(/^\/([a-zA-Z])(\/.*)?$/)
      if (m?.[1]) dir = `${m[1].toUpperCase()}:${(m[2] || "\\").replace(/\//g, "\\")}`
    }
    const isNonASCII = /[^\x00-\x7F]/.test(dir)
    const encodedDirectory = isNonASCII ? encodeURIComponent(dir) : dir
    const headers = headerBag(config.headers)
    headers.set("x-opencorvus-directory", encodedDirectory)
    config = {
      ...config,
      headers,
    }
  }

  if (password) {
    const headers = headerBag(config.headers)
    if (!headers.has("authorization")) {
      headers.set("Authorization", basicAuthorization(username ?? "opencorvus", password))
    }
    config = {
      ...config,
      headers,
    }
  }

  const client = createClient(config)
  return new OpencodeClient({ client })
}

export const createOpencodeClient = createOpenCorvusClient
