import { test, expect } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Auth } from "../../src/auth"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"

async function withProject(fn: () => Promise<void>) {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencorvus.json"),
        JSON.stringify({
          $schema: "https://opencorvus.ai/config.json",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await fn()
    },
  })
}

test("openai-codex provider is available with oauth auth and keeps codex models", async () => {
  await Auth.set("openai-codex", {
    type: "oauth",
    access: "access-token",
    refresh: "refresh-token",
    expires: Date.now() + 60_000,
  })

  try {
    await withProject(async () => {
      const providers = await Provider.list()
      expect(providers["openai-codex"]).toBeDefined()
      expect(providers["openai-codex"].models["gpt-5.4"]).toBeDefined()
      expect(providers["openai-codex"].models["gpt-5.2-codex"]).toBeDefined()
      expect(providers["openai-codex"].models["gpt-5.2"]).toBeDefined()
      expect(providers["openai-codex"].models["gpt-4.1"]).toBeUndefined()
    })
  } finally {
    await Auth.remove("openai-codex")
  }
}, 15_000)

test("legacy openai oauth auth migrates to openai-codex", async () => {
  await Auth.set("openai", {
    type: "oauth",
    access: "legacy-access",
    refresh: "legacy-refresh",
    expires: Date.now() + 60_000,
  })

  try {
    await withProject(async () => {
      expect((await Auth.get("openai"))).toBeUndefined()
      expect(await Auth.get("openai-codex")).toMatchObject({
        type: "oauth",
        access: "legacy-access",
        refresh: "legacy-refresh",
      })
      const providers = await Provider.list()
      expect(providers["openai-codex"]).toBeDefined()
      expect(providers["openai"]).toBeUndefined()
    })
  } finally {
    await Auth.remove("openai-codex")
    await Auth.remove("openai")
  }
}, 15_000)
