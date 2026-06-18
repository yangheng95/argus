import { BrowserRuntime } from "@/browser/runtime"
import { Config } from "@/config/config"
import { resolveNetworkProxy } from "@/util/network-proxy"

export async function resolveFrontendDesignBrowserProxy(): Promise<BrowserRuntime.BrowserProxyConfig | undefined> {
  const proxyUrl = resolveNetworkProxy(await Config.get(), "webResearch")
  return BrowserRuntime.resolveBrowserProxyConfig({ proxyServer: proxyUrl })
}
