export * from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { OpencodeClient } from "./gen/sdk.gen.js"
export { type Config as OpenCorvusClientConfig, OpencodeClient as OpenCorvusClient }
export { type Config as OpencodeClientConfig, OpencodeClient }

export function createOpenCorvusClient(config?: Config & { directory?: string }) {
  if (!config?.fetch) {
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

  if (config?.directory) {
    let dir = config.directory
    // Normalize MINGW/MSYS-style paths (/c/foo/bar → C:\foo\bar) on Windows.
    // These paths cause path.resolve to produce incorrect results (e.g. C:\c\foo\bar).
    if (typeof process !== "undefined" && process.platform === "win32") {
      const m = dir.match(/^\/([a-zA-Z])(\/.*)?$/)
      if (m?.[1]) dir = `${m[1].toUpperCase()}:${(m[2] || "\\").replace(/\//g, "\\")}`
    }
    const isNonASCII = /[^\x00-\x7F]/.test(dir)
    const encodedDirectory = isNonASCII ? encodeURIComponent(dir) : dir
    config = {
      ...config,
      headers: {
        ...(config.headers ?? {}),
        "x-opencorvus-directory": encodedDirectory,
      },
    }
  }

  const client = createClient(config)
  return new OpencodeClient({ client })
}

export const createOpencodeClient = createOpenCorvusClient
