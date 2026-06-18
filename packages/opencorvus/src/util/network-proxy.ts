import type { Config } from "../config/config"
import { ProxyAgent, type Dispatcher } from "undici"

export type NetworkProxyScope = "llmProvider" | "webResearch"

export type ProxyFetchInit = RequestInit & {
  proxy?: string | { url: string; headers?: Bun.HeadersInit }
  dispatcher?: Dispatcher
}

function isBunRuntime(): boolean {
  return typeof Bun !== "undefined" && typeof Bun.version === "string"
}

export function resolveNetworkProxy(config: Config.Info, scope: NetworkProxyScope): string | undefined {
  const proxy = config.network?.proxy
  if (!proxy || proxy[scope] !== true) return undefined

  const url = proxy.url?.trim()
  if (!url) {
    throw new Error(`network.proxy.url is required when network.proxy.${scope} is true.`)
  }

  return authenticatedProxyUrl(url, proxy.username, proxy.password)
}

export function proxiedFetchInit<T extends ProxyFetchInit>(
  init: T,
  proxyUrl?: string,
): T & { proxy?: ProxyFetchInit["proxy"]; dispatcher?: Dispatcher } {
  if (!proxyUrl) return init

  if (isBunRuntime()) {
    return {
      ...init,
      proxy: proxyUrl,
    }
  }

  return {
    ...init,
    proxy: proxyUrl,
    dispatcher: new ProxyAgent(proxyUrl),
  }
}

export function authenticatedProxyUrl(rawUrl: string, username?: string, password?: string): string {
  const parsed = new URL(rawUrl)
  const user = username?.trim()
  const pass = password?.trim()

  if (user) parsed.username = user
  if (pass) parsed.password = pass

  return parsed.toString()
}
