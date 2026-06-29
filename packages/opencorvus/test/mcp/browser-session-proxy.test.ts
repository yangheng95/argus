import { afterEach, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

import { Config } from "../../src/config/config"
import { BrowserMCPNodeLauncher } from "../../src/mcp/browser/node-launcher"
import { browserMcpBridgeEnvironment } from "../../src/mcp/browser/proxy-env"
import {
  BROWSER_MCP_WEB_RESEARCH_PROXY_ENV,
  encodeBrowserMcpEnvironmentProxy,
  resolveBrowserMcpSessionProxy,
} from "../../src/mcp/browser/session-proxy"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  Config.global.reset()
  await Instance.disposeAll()
})

test(
  "browser MCP local transport passes network.proxy.webResearch through an internal Node-bundle environment value",
  async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Filesystem.write(
          path.join(dir, "opencorvus.json"),
          JSON.stringify({
            $schema: "https://opencorvus.ai/config.json",
            network: {
              proxy: {
                url: "http://10.217.133.185:30100",
                username: "proxy-user",
                password: "proxy-secret",
                webResearch: true,
              },
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const env = await browserMcpBridgeEnvironment({
          [BROWSER_MCP_WEB_RESEARCH_PROXY_ENV]: "stale",
        })
        expect(JSON.parse(env[BROWSER_MCP_WEB_RESEARCH_PROXY_ENV] ?? "{}")).toMatchObject({
          server: "http://10.217.133.185:30100",
          username: "proxy-user",
          password: "proxy-secret",
        })
      },
    })
  },
  10_000,
)

test("browser MCP node launcher only forwards the precomputed internal proxy environment", async () => {
  const proxy = encodeBrowserMcpEnvironmentProxy({
    server: "http://10.217.133.185:30100",
    username: "proxy-user",
    password: "proxy-secret",
  })
  const env = await BrowserMCPNodeLauncher.childEnvironment({
    packaged: true,
    env: {
      [BROWSER_MCP_WEB_RESEARCH_PROXY_ENV]: proxy,
    },
  })
  expect(env[BROWSER_MCP_WEB_RESEARCH_PROXY_ENV]).toBe(proxy)
})

test("browser MCP node launcher does not rebuild project config context", () => {
  const source = readFileSync(path.resolve(import.meta.dir, "../../src/mcp/browser/node-launcher.ts"), "utf8")
  expect(source).not.toContain("Instance")
  expect(source).not.toContain("Config")
  expect(source).not.toContain("resolveWebResearchBrowserProxy")
})

test("browser MCP session proxy reads the internal webResearch value when the tool omits proxy", async () => {
  await expect(
    resolveBrowserMcpSessionProxy(undefined, {
      [BROWSER_MCP_WEB_RESEARCH_PROXY_ENV]: encodeBrowserMcpEnvironmentProxy({
        server: "http://10.217.133.185:30100",
        username: "proxy-user",
        password: "proxy-secret",
      }),
    }),
  ).resolves.toEqual({
    server: "http://10.217.133.185:30100",
    username: "proxy-user",
    password: "proxy-secret",
  })
})

test("browser MCP session proxy keeps explicit session proxy as the single request override", async () => {
  await expect(
    resolveBrowserMcpSessionProxy(
      { server: "http://explicit-session-proxy.example:9090" },
      {
        [BROWSER_MCP_WEB_RESEARCH_PROXY_ENV]: encodeBrowserMcpEnvironmentProxy({
          server: "http://10.217.133.185:30100",
          username: "proxy-user",
          password: "proxy-secret",
        }),
      },
    ),
  ).resolves.toEqual({
    server: "http://explicit-session-proxy.example:9090",
  })
})
