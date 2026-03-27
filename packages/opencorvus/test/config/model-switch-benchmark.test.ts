/**
 * Benchmark: LLM Model Switch — Config Write → Read → Provider Resolution
 *
 * 模拟 overlay 面板的 LLM 切换流程，验证：
 * 1. config.model 写入 JSON 文件
 * 2. Config.get() 读取到新值（state.reset 生效）
 * 3. Provider.defaultModel() 返回新模型
 * 4. Provider.reset() 后 getModel() 能获取新模型信息
 * 5. 连续快速切换不丢失最终值
 *
 * 输入: 模型字符串 "providerID/modelID"
 * 输出: Config.get().model === 输入值 && Provider.defaultModel() 解析正确
 * 验收标准: 全部 assertion 通过，无 fallback
 */
import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Config } from "../../src/config/config"
import { Provider } from "../../src/provider/provider"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

// ── Helpers ──

/** Simulate what the overlay's updateConfig() does:
 *  GET current config → mutate → write back (like PATCH /config)
 */
async function simulateOverlayModelSwitch(
  providerID: string,
  modelID: string,
  apiKey?: string,
) {
  const current = await Config.get()
  const patch: Record<string, any> = {
    model: `${providerID}/${modelID}`,
  }
  if (apiKey) {
    patch.provider = {
      [providerID]: {
        options: { apiKey },
      },
    }
  }
  // This is what the PATCH /config handler does:
  await Config.update({ ...current, ...patch })
  Provider.reset()
}

/** Read the raw JSON file from disk to verify persistence */
async function readRawConfig(dir: string): Promise<Record<string, any>> {
  const jsonc = path.join(dir, ".opencorvus", "opencorvus.jsonc")
  const json = path.join(dir, "opencorvus.json")
  for (const filepath of [jsonc, json]) {
    try {
      const text = await Filesystem.readText(filepath)
      // Strip JSONC comments for parsing
      const { parse } = await import("jsonc-parser")
      return parse(text) ?? {}
    } catch {}
  }
  return {}
}

// ── Test Suite ──
// IMPORTANT: Use git:true so findUp is bounded to the temp dir (worktree).
// Without it, findUp walks to C:\Users\...\Temp\ and finds stale .opencorvus/ configs.

describe("model-switch-benchmark", () => {
  // Test 1: Config write roundtrip — model string persisted to JSON
  test("config write: model string persisted to JSON file", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        model: "alibaba-cn/qwen3.5-plus",
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Before switch
        const before = await Config.get()
        expect(before.model).toBe("alibaba-cn/qwen3.5-plus")

        // Simulate overlay switch to github-copilot/gemini-3-flash-preview
        await simulateOverlayModelSwitch("github-copilot", "gemini-3-flash-preview")

        // Verify JSON file on disk
        const raw = await readRawConfig(tmp.path)
        expect(raw.model).toBe("github-copilot/gemini-3-flash-preview")
      },
    })
  })

  // Test 2: Config.get() returns new model after state reset
  test("config read: Config.get() returns new model after switch", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        model: "alibaba-cn/qwen3.5-plus",
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await simulateOverlayModelSwitch("github-copilot", "gemini-3-flash-preview")

        const after = await Config.get()
        expect(after.model).toBe("github-copilot/gemini-3-flash-preview")
      },
    })
  })

  // Test 3: Provider.defaultModel() resolves from fresh config
  test("provider resolution: defaultModel() returns switched model", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        model: "alibaba-cn/qwen3.5-plus",
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Before switch
        const modelBefore = await Provider.defaultModel()
        expect(modelBefore.providerID).toBe("alibaba-cn")
        expect(modelBefore.modelID).toBe("qwen3.5-plus")

        // Switch
        await simulateOverlayModelSwitch("github-copilot", "gemini-3-flash-preview")

        // After switch — Provider.defaultModel() must reflect new model
        const modelAfter = await Provider.defaultModel()
        expect(modelAfter.providerID).toBe("github-copilot")
        expect(modelAfter.modelID).toBe("gemini-3-flash-preview")
      },
    })
  })

  // Test 4: Provider.getModel() returns full model info for switched model
  // Requires provider API key to be registered — use env var via Instance.provide init
  test("provider model info: getModel() returns capabilities for switched model", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        model: "alibaba-cn/qwen3.5-plus",
      },
    })
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        // Provider discovery requires an API key (even a fake one)
        process.env["ANTHROPIC_API_KEY"] = "sk-test-dummy"
      },
      fn: async () => {
        await simulateOverlayModelSwitch("anthropic", "claude-sonnet-4-20250514")

        // getModel() must find the model in the provider catalog
        const model = await Provider.getModel("anthropic", "claude-sonnet-4-20250514")
        expect(model).toBeDefined()
        expect(model.id).toBe("claude-sonnet-4-20250514")
        expect(model.providerID).toBe("anthropic")
        // claude-sonnet-4-20250514 supports tool calls
        expect(model.capabilities.toolcall).toBe(true)
      },
    })
  })

  // Test 5: Rapid consecutive switches — last write wins
  test("rapid switch: 5 consecutive switches, last model wins", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        model: "alibaba-cn/qwen3.5-plus",
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const models = [
          ["anthropic", "claude-sonnet-4-20250514"],
          ["openai", "gpt-4.1"],
          ["google", "gemini-2.5-flash"],
          ["github-copilot", "gemini-3-flash-preview"],
          ["alibaba-cn", "qwen3.5-plus"],
        ] as const

        for (const [pid, mid] of models) {
          await simulateOverlayModelSwitch(pid, mid)
        }

        // Config must reflect the LAST switch
        const config = await Config.get()
        expect(config.model).toBe("alibaba-cn/qwen3.5-plus")

        const model = await Provider.defaultModel()
        expect(model.providerID).toBe("alibaba-cn")
        expect(model.modelID).toBe("qwen3.5-plus")

        // JSON file must also reflect last switch
        const raw = await readRawConfig(tmp.path)
        expect(raw.model).toBe("alibaba-cn/qwen3.5-plus")
      },
    })
  })

  // Test 6: Switch with API key — key persisted to provider config
  test("config write: API key persisted in provider section", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        model: "alibaba-cn/qwen3.5-plus",
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await simulateOverlayModelSwitch(
          "anthropic",
          "claude-sonnet-4-20250514",
          "sk-test-key-12345",
        )

        const config = await Config.get()
        expect(config.model).toBe("anthropic/claude-sonnet-4-20250514")

        const raw = await readRawConfig(tmp.path)
        expect(raw.model).toBe("anthropic/claude-sonnet-4-20250514")
        expect(raw.provider?.anthropic?.options?.apiKey).toBe("sk-test-key-12345")
      },
    })
  })

  // Test 7: JSONC format preserved after switch
  test("config write: JSONC format preserved (not corrupted)", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const configDir = path.join(dir, ".opencorvus")
        await fs.mkdir(configDir, { recursive: true })
        await Filesystem.write(
          path.join(configDir, "opencorvus.jsonc"),
          `{
  // This is a comment that must survive
  "$schema": "https://opencorvus.ai/config.json",
  "model": "alibaba-cn/qwen3.5-plus",
  "username": "testuser"
}`,
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await simulateOverlayModelSwitch("github-copilot", "gemini-3-flash-preview")

        // Read raw text — comment should survive JSONC patching
        const filepath = path.join(tmp.path, ".opencorvus", "opencorvus.jsonc")
        const text = await Filesystem.readText(filepath)
        expect(text).toContain("This is a comment that must survive")
        expect(text).toContain("github-copilot/gemini-3-flash-preview")
      },
    })
  })

  // Test 8: Switch back to original — no stale cache
  test("round-trip: switch away and back, no stale cache", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        model: "alibaba-cn/qwen3.5-plus",
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Switch away
        await simulateOverlayModelSwitch("github-copilot", "gemini-3-flash-preview")
        let model = await Provider.defaultModel()
        expect(model.providerID).toBe("github-copilot")
        expect(model.modelID).toBe("gemini-3-flash-preview")

        // Switch back
        await simulateOverlayModelSwitch("alibaba-cn", "qwen3.5-plus")
        model = await Provider.defaultModel()
        expect(model.providerID).toBe("alibaba-cn")
        expect(model.modelID).toBe("qwen3.5-plus")

        // Verify disk
        const raw = await readRawConfig(tmp.path)
        expect(raw.model).toBe("alibaba-cn/qwen3.5-plus")
      },
    })
  })

  // Test 9: resolveModel logic (mirrors control/message.ts:211-218)
  test("resolveModel: agent without model falls through to config model", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        model: "github-copilot/gemini-3-flash-preview",
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { Agent } = await import("../../src/agent/agent")

        // Default agent should have no model field
        const agentName = await Agent.defaultAgent()
        const agent = await Agent.get(agentName)
        expect(agent?.model).toBeUndefined()

        // So resolveModel should fall through to Provider.defaultModel()
        const model = agent?.model ?? (await Provider.defaultModel())
        expect(model.providerID).toBe("github-copilot")
        expect(model.modelID).toBe("gemini-3-flash-preview")
      },
    })
  })

  // Test 10: parseModel correctness for various model string formats
  test("parseModel: handles various provider/model string formats", () => {
    // Standard format
    expect(Provider.parseModel("github-copilot/gemini-3-flash-preview")).toEqual({
      providerID: "github-copilot",
      modelID: "gemini-3-flash-preview",
    })

    // Nested model ID with slashes
    expect(Provider.parseModel("openrouter/google/gemini-2.5-flash")).toEqual({
      providerID: "openrouter",
      modelID: "google/gemini-2.5-flash",
    })

    // Simple provider/model
    expect(Provider.parseModel("openai/gpt-4.1")).toEqual({
      providerID: "openai",
      modelID: "gpt-4.1",
    })
  })
})
