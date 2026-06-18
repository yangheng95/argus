import { afterEach, expect, test } from "bun:test"
import { NETWORK_PROXY_TEST_URL, testNetworkProxy } from "../../src/util/network-proxy-test"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test("testNetworkProxy sends the probe through the authenticated Bun proxy transport", async () => {
  const seen: { input?: string; proxy?: string; method?: string; dispatcher?: unknown } = {}
  globalThis.fetch = (async (input, init) => {
    seen.input = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    seen.proxy = (init as RequestInit & { proxy?: string })?.proxy
    seen.dispatcher = (init as RequestInit & { dispatcher?: unknown })?.dispatcher
    seen.method = init?.method
    return new Response(null, { status: 204, statusText: "No Content" })
  }) as typeof fetch

  const result = await testNetworkProxy({
    url: "http://10.217.133.185:30100",
    username: "hexin",
    password: "hx300033",
  })

  expect(seen.input).toBe(NETWORK_PROXY_TEST_URL)
  expect(seen.proxy).toBe("http://hexin:hx300033@10.217.133.185:30100/")
  expect(seen.dispatcher).toBeUndefined()
  expect(seen.method).toBe("GET")
  expect(result.ok).toBe(true)
  expect(result.status).toBe("connected")
  expect(result.statusCode).toBe(204)
  expect(result.message).toBe("Proxy is reachable.")
})

test("testNetworkProxy returns the HTTP status code when the proxy target rejects the request", async () => {
  globalThis.fetch = (async () => {
    return new Response("proxy auth required", {
      status: 407,
      statusText: "Proxy Authentication Required",
    })
  }) as typeof fetch

  const result = await testNetworkProxy({
    url: "http://127.0.0.1:7890",
  })

  expect(result.ok).toBe(false)
  expect(result.status).toBe("error")
  expect(result.statusCode).toBe(407)
  expect(result.message).toBe("Proxy Authentication Required")
})

test("testNetworkProxy does not issue a direct request when the proxy URL is missing", async () => {
  let fetchCalls = 0
  globalThis.fetch = (async () => {
    fetchCalls++
    throw new Error("missing proxy URL must not touch the network")
  }) as typeof fetch

  const result = await testNetworkProxy({})

  expect(fetchCalls).toBe(0)
  expect(result.ok).toBe(false)
  expect(result.message).toContain("network.proxy.url is required")
})
