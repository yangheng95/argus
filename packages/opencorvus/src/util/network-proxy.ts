import type { Config } from "../config/config"

export type NetworkProxyScope = "llmProvider" | "webResearch"

export type ProxyFetchInit = RequestInit & {
  proxy?: string | { url: string; headers?: Bun.HeadersInit }
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

export function proxiedFetchInit<T extends ProxyFetchInit>(init: T, proxyUrl?: string): T & { proxy?: string } {
  return {
    ...init,
    ...(proxyUrl ? { proxy: proxyUrl } : {}),
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
