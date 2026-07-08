import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import fs from "node:fs/promises"
import http from "node:http"
import type { AddressInfo } from "node:net"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { authenticatedProxyUrl, proxiedFetchInit, resolveNetworkProxy } from "../../src/util/network-proxy"

test("authenticatedProxyUrl injects separate credentials at the transport boundary", () => {
  expect(authenticatedProxyUrl("http://10.217.133.185:30100", "hexin", "hx300033")).toBe(
    "http://hexin:hx300033@10.217.133.185:30100/",
  )
})

test("proxiedFetchInit attaches Bun proxy transport in the Bun runtime", () => {
  const init = proxiedFetchInit({ method: "GET" }, "http://hexin:hx300033@10.217.133.185:30100/")

  expect(init.method).toBe("GET")
  expect(init.proxy).toBe("http://hexin:hx300033@10.217.133.185:30100/")
  expect(init.dispatcher).toBeUndefined()
})

test("Bun fetch honors proxiedFetchInit proxy URL and credentials", async () => {
  const events: Array<{ method: string; url: string | undefined; proxyAuthorization: string | undefined }> = []
  const server = http.createServer((req, res) => {
    events.push({
      method: req.method ?? "",
      url: req.url,
      proxyAuthorization: req.headers["proxy-authorization"],
    })
    res.writeHead(209, { "content-type": "text/plain" })
    res.end("proxy reached")
  })

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const { port } = server.address() as AddressInfo
    const proxyUrl = authenticatedProxyUrl(`http://127.0.0.1:${port}`, "hexin", "hx300033")
    const response = await fetch(
      "http://example.com/proxy-runtime-check",
      proxiedFetchInit({ signal: AbortSignal.timeout(5_000) }, proxyUrl),
    )

    expect(response.status).toBe(209)
    expect(await response.text()).toBe("proxy reached")
    expect(events).toEqual([
      {
        method: "GET",
        url: "http://example.com/proxy-runtime-check",
        proxyAuthorization: "Basic aGV4aW46aHgzMDAwMzM=",
      },
    ])
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})

test("proxiedFetchInit attaches an Undici dispatcher in the Node runtime", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "oc-network-proxy-node-"))
  try {
    const outfile = path.join(dir, "network-proxy.mjs")
    const source = path.resolve(import.meta.dir, "../../src/util/network-proxy.ts")
    const build = await Bun.build({
      entrypoints: [source],
      target: "node",
      format: "esm",
      outdir: dir,
      naming: "network-proxy.mjs",
      write: true,
    })
    expect(build.success).toBe(true)

    const probe = `
      import { proxiedFetchInit } from ${JSON.stringify(pathToFileURL(outfile).href)};
      const init = proxiedFetchInit({ method: "GET" }, "http://hexin:hx300033@10.217.133.185:30100/");
      console.log(JSON.stringify({
        method: init.method,
        proxy: init.proxy,
        dispatcher: typeof init.dispatcher?.dispatch,
      }));
    `
    const result = spawnSync("node", ["--input-type=module", "-e", probe], { encoding: "utf8" })
    expect(result.stderr).toBe("")
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      method: "GET",
      proxy: "http://hexin:hx300033@10.217.133.185:30100/",
      dispatcher: "function",
    })
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test("proxiedFetchInit keeps direct transport fields absent when no proxy is resolved", () => {
  const init = proxiedFetchInit({ method: "GET" }, undefined)

  expect(init.method).toBe("GET")
  expect("proxy" in init).toBe(false)
  expect("dispatcher" in init).toBe(false)
})

test("resolveNetworkProxy only enables the requested proxy scope", () => {
  const config = {
    network: {
      proxy: {
        llmProvider: false,
        webResearch: true,
        url: "http://10.217.133.185:30100",
        username: "hexin",
        password: "hx300033",
      },
    },
  }

  expect(resolveNetworkProxy(config, "llmProvider")).toBeUndefined()
  expect(resolveNetworkProxy(config, "webResearch")).toBe("http://hexin:hx300033@10.217.133.185:30100/")
})
