import { afterEach, expect, test } from "bun:test"
import path from "node:path"

import { Config } from "../../src/config/config"
import { resolveFrontendDesignBrowserProxy } from "../../src/frontend-design/browser-proxy"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  Config.global.reset()
  await Instance.disposeAll()
})

test("frontend-design browser proxy uses network.proxy.webResearch credentials", async () => {
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
      await expect(resolveFrontendDesignBrowserProxy()).resolves.toMatchObject({
        server: "http://10.217.133.185:30100",
        username: "proxy-user",
        password: "proxy-secret",
      })
    },
  })
})

test("frontend-design browser proxy is absent when webResearch is disabled", async () => {
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
              llmProvider: true,
              webResearch: false,
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(resolveFrontendDesignBrowserProxy()).resolves.toBeUndefined()
    },
  })
})
