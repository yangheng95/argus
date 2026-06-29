import { test, expect, describe, mock, afterEach } from "bun:test"
import { Config } from "../../src/config/config"
import { AgentRoleContract } from "../../src/agent/role-contract"
import { Instance } from "../../src/project/instance"
import { Auth } from "../../src/auth"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import fs from "fs/promises"
import { existsSync } from "fs"
import { pathToFileURL } from "url"
import { Filesystem } from "../../src/util/filesystem"
import { BrowserMCPBuiltin } from "../../src/mcp/browser/builtin"
import { MCP } from "../../src/mcp"

// Get managed config directory from environment (set in preload.ts)
const managedConfigDir = process.env.OPENCORVUS_TEST_MANAGED_CONFIG_DIR!

afterEach(async () => {
  await fs.rm(managedConfigDir, { force: true, recursive: true }).catch(() => {})
})

async function writeManagedSettings(settings: object, filename = "opencorvus.json") {
  await fs.mkdir(managedConfigDir, { recursive: true })
  await Filesystem.write(path.join(managedConfigDir, filename), JSON.stringify(settings))
}

async function writeConfig(dir: string, config: object, name = "opencorvus.json") {
  await Filesystem.write(path.join(dir, name), JSON.stringify(config))
}

async function withGlobalConfigDir<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.OPENCORVUS_GLOBAL_CONFIG_DIR
  process.env.OPENCORVUS_GLOBAL_CONFIG_DIR = dir
  try {
    return await fn()
  } finally {
    if (previous === undefined) delete process.env.OPENCORVUS_GLOBAL_CONFIG_DIR
    else process.env.OPENCORVUS_GLOBAL_CONFIG_DIR = previous
  }
}

const NATIVE_AGENT_IDS = Object.keys(AgentRoleContract.all)

test("documented default model declaration is gpt-5.5", () => {
  expect(Config.DEFAULT_MODEL).toBe("openai/gpt-5.5")
})

test("no project config files: does NOT auto-write a project config and does NOT default model (spec §6-2, rule 7/8)", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()

      // Removed auto-behavior MUST NOT happen: no project config file is
      // materialized on first load (it used to freeze a copy of the
      // global-merged config + DEFAULT_MODEL into the project dir, which
      // permanently shadowed global — root cause of "model 反复覆盖").
      for (const name of ["opencorvus.jsonc", "opencorvus.json"]) {
        expect(existsSync(path.join(tmp.path, ".opencorvus", name))).toBe(false)
      }

      // No DEFAULT_MODEL fallback: model is simply unset when nothing
      // configured anywhere (resolveAgentModel throws MissingModelConfigError
      // downstream — strict & explicit, rule 7).
      expect(config.model).toBeUndefined()

      // In-memory computed defaults (NOT model, NOT a file write) still hold.
      expect(config.username).toBeDefined()
      expect(config.experimental?.auto_question).toBe(true)
      expect(config.experimental?.auto_confirm_proposed_tasks).toBe(true)
      expect(config.mcp?.browser).toEqual(BrowserMCPBuiltin.localConfig())
      expect(config.network?.proxy).toBeUndefined()
    },
  })
})

test("does not materialize a default network proxy", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()

      expect(config.network?.proxy).toBeUndefined()
      expect(existsSync(path.join(tmp.path, ".opencorvus", "opencorvus.json"))).toBe(false)
      expect(existsSync(path.join(tmp.path, ".opencorvus", "opencorvus.jsonc"))).toBe(false)
    },
  })
})

test("loads JSON config file", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://opencorvus.ai/config.json",
        model: "test/model",
        username: "testuser",
      })
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.model).toBe("test/model")
      expect(config.username).toBe("testuser")
    },
  })
})

test("loads network proxy config", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://opencorvus.ai/config.json",
        network: {
          proxy: {
            url: "http://127.0.0.1:7890",
            username: "hexin",
            password: "hx300033",
            llmProvider: true,
            webResearch: true,
          },
        },
      })
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.network?.proxy?.url).toBe("http://127.0.0.1:7890")
      expect(config.network?.proxy?.username).toBe("hexin")
      expect(config.network?.proxy?.password).toBe("hx300033")
      expect(config.network?.proxy?.llmProvider).toBe(true)
      expect(config.network?.proxy?.webResearch).toBe(true)
    },
  })
})

test("rejects unsupported network proxy URL scheme", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://opencorvus.ai/config.json",
        network: {
          proxy: {
            url: "socks5://127.0.0.1:1080",
            llmProvider: true,
          },
        },
      })
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Config.get()).rejects.toThrow("network.proxy.url must use http:// or https://")
    },
  })
})

test("rejects network proxy password without username", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://opencorvus.ai/config.json",
        network: {
          proxy: {
            url: "http://127.0.0.1:7890",
            password: "secret",
            llmProvider: true,
          },
        },
      })
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Config.get()).rejects.toThrow(
        "network.proxy.username is required when network.proxy.password is set",
      )
    },
  })
})

test("rejects network proxy credentials embedded in URL", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://opencorvus.ai/config.json",
        network: {
          proxy: {
            url: "http://user:pass@127.0.0.1:7890",
            llmProvider: true,
          },
        },
      })
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Config.get()).rejects.toThrow(
        "network.proxy.url must not include credentials; use network.proxy.username and network.proxy.password",
      )
    },
  })
})

test("rejects bare model IDs at config load time", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://opencorvus.ai/config.json",
        model: "bare-model",
      })
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Config.get()).rejects.toThrow("provider/model")
    },
  })
})

test("materializes top-level model onto every native agent at load time", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://opencorvus.ai/config.json",
        model: "top/model",
        agent: {
          build: { model: "custom/build", prompt_append: "keep build prompt append" },
          coding: { temperature: 0.2 },
        },
      })
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.model).toBe("top/model")
      for (const agentID of NATIVE_AGENT_IDS) {
        const expected = agentID === "build" ? "custom/build" : "top/model"
        expect(config.agent?.[agentID]?.model).toBe(expected)
      }
      expect(config.agent?.coding?.temperature).toBe(0.2)
      expect(config.agent?.build?.prompt_append).toBe("keep build prompt append")
    },
  })
})

test("loads JSONC config file", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Filesystem.write(
        path.join(dir, "opencorvus.jsonc"),
        `{
        // This is a comment
        "$schema": "https://opencorvus.ai/config.json",
        "model": "test/model",
        "username": "testuser"
      }`,
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.model).toBe("test/model")
      expect(config.username).toBe("testuser")
    },
  })
})

test("merges multiple config files with correct precedence", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(
        dir,
        {
          $schema: "https://opencorvus.ai/config.json",
          model: "base/model",
          username: "base",
        },
        "opencorvus.jsonc",
      )
      await writeConfig(dir, {
        $schema: "https://opencorvus.ai/config.json",
        model: "override/model",
      })
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.model).toBe("override/model")
      expect(config.username).toBe("base")
    },
  })
})

test("handles environment variable substitution", async () => {
  const originalEnv = process.env["TEST_VAR"]
  process.env["TEST_VAR"] = "test-user"

  try {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeConfig(dir, {
          $schema: "https://opencorvus.ai/config.json",
          username: "{env:TEST_VAR}",
        })
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        expect(config.username).toBe("test-user")
      },
    })
  } finally {
    if (originalEnv !== undefined) {
      process.env["TEST_VAR"] = originalEnv
    } else {
      delete process.env["TEST_VAR"]
    }
  }
})

test("preserves env variables when adding $schema to config", async () => {
  const originalEnv = process.env["PRESERVE_VAR"]
  process.env["PRESERVE_VAR"] = "secret_value"

  try {
    await using tmp = await tmpdir({
      init: async (dir) => {
        // Config without $schema - should trigger auto-add
        await Filesystem.write(
          path.join(dir, "opencorvus.json"),
          JSON.stringify({
            username: "{env:PRESERVE_VAR}",
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        expect(config.username).toBe("secret_value")

        // Read the file to verify the env variable was preserved
        const content = await Filesystem.readText(path.join(tmp.path, "opencorvus.json"))
        expect(content).toContain("{env:PRESERVE_VAR}")
        expect(content).not.toContain("secret_value")
        expect(content).toContain("$schema")
      },
    })
  } finally {
    if (originalEnv !== undefined) {
      process.env["PRESERVE_VAR"] = originalEnv
    } else {
      delete process.env["PRESERVE_VAR"]
    }
  }
})

test("handles file inclusion substitution", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Filesystem.write(path.join(dir, "included.txt"), "test-user")
      await writeConfig(dir, {
        $schema: "https://opencorvus.ai/config.json",
        username: "{file:included.txt}",
      })
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.username).toBe("test-user")
    },
  })
})

test("handles file inclusion with replacement tokens", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Filesystem.write(path.join(dir, "included.md"), "const out = await Bun.$`echo hi`")
      await writeConfig(dir, {
        $schema: "https://opencorvus.ai/config.json",
        username: "{file:included.md}",
      })
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.username).toBe("const out = await Bun.$`echo hi`")
    },
  })
})

test("validates config schema and throws on invalid fields", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://opencorvus.ai/config.json",
        invalid_field: "should cause error",
      })
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Strict schema should throw an error for invalid fields
      await expect(Config.get()).rejects.toThrow()
    },
  })
})

test("throws error for invalid JSON", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Filesystem.write(path.join(dir, "opencorvus.json"), "{ invalid json }")
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Config.get()).rejects.toThrow()
    },
  })
})

test("handles agent configuration", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://opencorvus.ai/config.json",
        agent: {
          test_agent: {
            model: "test/model",
            temperature: 0.7,
            description: "test agent",
            skill_mountable: true,
          },
        },
      })
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.agent?.["test_agent"]).toEqual(
        expect.objectContaining({
          model: "test/model",
          temperature: 0.7,
          description: "test agent",
          skill_mountable: true,
        }),
      )
      expect(config.agent?.["test_agent"]?.options).not.toHaveProperty("skill_mountable")
    },
  })
})

test("rejects legacy include/exclude tool fields for custom agents", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://opencorvus.ai/config.json",
        agent: {
          test_agent: {
            description: "test agent",
            tools: { include: ["read"] },
          },
        },
      })
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Config.get()).rejects.toThrow()
    },
  })
})

test("rejects agent-private tool fields for custom agents", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://opencorvus.ai/config.json",
        agent: {
          test_agent: {
            description: "test agent",
            tools: { private: ["browser_preview_compare_scroll_slices"] },
          },
        },
      })
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Config.get()).rejects.toThrow(/private/)
    },
  })
})

test("treats agent variant as model-scoped setting (not provider option)", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://opencorvus.ai/config.json",
        agent: {
          test_agent: {
            model: "openai/gpt-5.2",
            variant: "xhigh",
            max_tokens: 123,
          },
        },
      })
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      const agent = config.agent?.["test_agent"]

      expect(agent?.variant).toBe("xhigh")
      expect(agent?.options).toMatchObject({
        max_tokens: 123,
      })
      expect(agent?.options).not.toHaveProperty("variant")
    },
  })
})

test("handles command configuration", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://opencorvus.ai/config.json",
        command: {
          test_command: {
            template: "test template",
            description: "test command",
            agent: "test_agent",
          },
        },
      })
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.command?.["test_command"]).toEqual({
        template: "test template",
        description: "test command",
        agent: "test_agent",
      })
    },
  })
})

test("loads config from .opencorvus directory", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const opencorvusDir = path.join(dir, ".opencorvus")
      await fs.mkdir(opencorvusDir, { recursive: true })
      const agentDir = path.join(opencorvusDir, "agent")
      await fs.mkdir(agentDir, { recursive: true })

      await Filesystem.write(
        path.join(agentDir, "test.md"),
        `---
model: test/model
---
Test agent prompt`,
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.agent?.["test"]).toEqual(
        expect.objectContaining({
          name: "test",
          model: "test/model",
          prompt: "Test agent prompt",
        }),
      )
    },
  })
})

test("loads agents from .opencorvus/agents (plural)", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const opencorvusDir = path.join(dir, ".opencorvus")
      await fs.mkdir(opencorvusDir, { recursive: true })

      const agentsDir = path.join(opencorvusDir, "agents")
      await fs.mkdir(path.join(agentsDir, "nested"), { recursive: true })

      await Filesystem.write(
        path.join(agentsDir, "helper.md"),
        `---
model: test/model
mode: subagent
skill_mountable: true
---
Helper agent prompt`,
      )

      await Filesystem.write(
        path.join(agentsDir, "nested", "child.md"),
        `---
model: test/model
mode: subagent
---
Nested agent prompt`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()

      expect(config.agent?.["helper"]).toMatchObject({
        name: "helper",
        model: "test/model",
        mode: "subagent",
        skill_mountable: true,
        prompt: "Helper agent prompt",
      })
      expect(config.agent?.["helper"]?.options).not.toHaveProperty("skill_mountable")

      expect(config.agent?.["nested/child"]).toMatchObject({
        name: "nested/child",
        model: "test/model",
        mode: "subagent",
        prompt: "Nested agent prompt",
      })
    },
  })
})

test("loads commands from .opencorvus/command (singular)", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const opencorvusDir = path.join(dir, ".opencorvus")
      await fs.mkdir(opencorvusDir, { recursive: true })

      const commandDir = path.join(opencorvusDir, "command")
      await fs.mkdir(path.join(commandDir, "nested"), { recursive: true })

      await Filesystem.write(
        path.join(commandDir, "hello.md"),
        `---
description: Test command
---
Hello from singular command`,
      )

      await Filesystem.write(
        path.join(commandDir, "nested", "child.md"),
        `---
description: Nested command
---
Nested command template`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()

      expect(config.command?.["hello"]).toEqual({
        description: "Test command",
        template: "Hello from singular command",
      })

      expect(config.command?.["nested/child"]).toEqual({
        description: "Nested command",
        template: "Nested command template",
      })
    },
  })
})

test("loads commands from .opencorvus/commands (plural)", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const opencorvusDir = path.join(dir, ".opencorvus")
      await fs.mkdir(opencorvusDir, { recursive: true })

      const commandsDir = path.join(opencorvusDir, "commands")
      await fs.mkdir(path.join(commandsDir, "nested"), { recursive: true })

      await Filesystem.write(
        path.join(commandsDir, "hello.md"),
        `---
description: Test command
---
Hello from plural commands`,
      )

      await Filesystem.write(
        path.join(commandsDir, "nested", "child.md"),
        `---
description: Nested command
---
Nested command template`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()

      expect(config.command?.["hello"]).toEqual({
        description: "Test command",
        template: "Hello from plural commands",
      })

      expect(config.command?.["nested/child"]).toEqual({
        description: "Nested command",
        template: "Nested command template",
      })
    },
  })
})

test("updates config and writes to file", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const newConfig = { model: "updated/model" }
      await Config.update(newConfig as any)

      const writtenConfig = await Filesystem.readJson(path.join(tmp.path, ".opencorvus", "opencorvus.jsonc"))
      expect(writtenConfig.model).toBe("updated/model")
      for (const agentID of NATIVE_AGENT_IDS) {
        expect(writtenConfig.agent?.[agentID]?.model).toBe("updated/model")
      }
    },
  })
})

test("top-level model update materializes native agent models while same-patch agent model stays explicit", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Config.update({
        model: "updated/model",
        agent: {
          integrity: { model: "review/model" },
          build: { prompt_append: "keep build append" },
        },
      } as any)

      const writtenConfig = await Filesystem.readJson(path.join(tmp.path, ".opencorvus", "opencorvus.jsonc"))
      for (const agentID of NATIVE_AGENT_IDS) {
        const expected = agentID === "integrity" ? "review/model" : "updated/model"
        expect(writtenConfig.agent?.[agentID]?.model).toBe(expected)
      }
      expect(writtenConfig.agent?.build?.prompt_append).toBe("keep build append")
    },
  })
})

// Regression: AgentModelsPanel sends one PATCH per row; if the user changes
// two rows in fast succession the requests run in parallel and writeConfigFile's
// read-modify-write would race without a per-file lock. Both overrides must
// survive regardless of dispatch order.
test("concurrent Config.update calls preserve all overrides", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Config.update({ model: "openai/gpt-4o-mini" } as any)

      await Promise.all([
        Config.update({ agent: { build: { model: "anthropic/claude-sonnet-4-6" } } } as any),
        Config.update({ agent: { acceptance: { model: "openai/gpt-4.1" } } } as any),
        Config.update({ agent: { general: { model: "anthropic/claude-haiku-4-5" } } } as any),
      ])

      const written = await Filesystem.readJson(path.join(tmp.path, ".opencorvus", "opencorvus.jsonc"))
      expect(written.model).toBe("openai/gpt-4o-mini")
      expect(written.agent?.build?.model).toBe("anthropic/claude-sonnet-4-6")
      expect(written.agent?.acceptance?.model).toBe("openai/gpt-4.1")
      expect(written.agent?.general?.model).toBe("anthropic/claude-haiku-4-5")
    },
  })
})

test("gets config directories", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const dirs = await Config.directories()
      expect(dirs.length).toBeGreaterThanOrEqual(1)
    },
  })
})

test("does not try to install dependencies in read-only OPENCORVUS_CONFIG_DIR", async () => {
  if (process.platform === "win32") return

  await using tmp = await tmpdir<string>({
    init: async (dir) => {
      const ro = path.join(dir, "readonly")
      await fs.mkdir(ro, { recursive: true })
      await fs.chmod(ro, 0o555)
      return ro
    },
    dispose: async (dir) => {
      const ro = path.join(dir, "readonly")
      await fs.chmod(ro, 0o755).catch(() => {})
      return ro
    },
  })

  const prev = process.env.OPENCORVUS_CONFIG_DIR
  process.env.OPENCORVUS_CONFIG_DIR = tmp.extra

  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.get()
      },
    })
  } finally {
    if (prev === undefined) delete process.env.OPENCORVUS_CONFIG_DIR
    else process.env.OPENCORVUS_CONFIG_DIR = prev
  }
})

test("installs dependencies in writable OPENCORVUS_CONFIG_DIR when local plugins exist", async () => {
  await using tmp = await tmpdir<string>({
    init: async (dir) => {
      const cfg = path.join(dir, "configdir")
      await fs.mkdir(cfg, { recursive: true })
      await fs.mkdir(path.join(cfg, "plugin"), { recursive: true })
      await Filesystem.write(path.join(cfg, "plugin", "local.ts"), "export const Plugin = async () => ({})\n")
      return cfg
    },
  })

  const prev = process.env.OPENCORVUS_CONFIG_DIR
  process.env.OPENCORVUS_CONFIG_DIR = tmp.extra

  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.get()
        await Config.waitForDependencies()
      },
    })

    expect(await Filesystem.exists(path.join(tmp.extra, "package.json"))).toBe(true)
    expect(await Filesystem.exists(path.join(tmp.extra, ".gitignore"))).toBe(true)
  } finally {
    if (prev === undefined) delete process.env.OPENCORVUS_CONFIG_DIR
    else process.env.OPENCORVUS_CONFIG_DIR = prev
  }
})

test("does not install config dependencies when no local plugin files exist", async () => {
  await using tmp = await tmpdir<string>({
    init: async (dir) => {
      const home = path.join(dir, "home")
      await fs.mkdir(home, { recursive: true })
      return home
    },
  })

  const prevHome = process.env.OPENCORVUS_HOME
  process.env.OPENCORVUS_HOME = tmp.extra
  ;(Config.global as any).reset()

  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.get()
        await Config.waitForDependencies()
      },
    })

    expect(existsSync(path.join(tmp.extra, "config", "package.json"))).toBe(false)
    expect(existsSync(path.join(tmp.extra, "config", "node_modules"))).toBe(false)
    expect(existsSync(path.join(tmp.path, ".opencorvus", "package.json"))).toBe(false)
  } finally {
    if (prevHome === undefined) delete process.env.OPENCORVUS_HOME
    else process.env.OPENCORVUS_HOME = prevHome
    ;(Config.global as any).reset()
  }
})

test("loads packaged plugin manifests from generic packaged plugin directory", async () => {
  await using tmp = await tmpdir<string>({
    init: async (dir) => {
      const packaged = path.join(dir, "packaged")
      const manifest = path.join(packaged, "plugins", "fixture-plugin", "plugin.json")
      await fs.mkdir(path.dirname(manifest), { recursive: true })
      await Filesystem.write(
        manifest,
        JSON.stringify(
          {
            packageSpecifier: "@opencorvus-ai/fixture-plugin",
            serviceID: "fixture-plugin",
            backendExport: "./backend",
            overlayExport: "./overlay",
            resources: [],
          },
          null,
          2,
        ),
      )
      return packaged
    },
  })

  const prev = process.env.OPENCORVUS_PACKAGED_PLUGIN_DIR
  process.env.OPENCORVUS_PACKAGED_PLUGIN_DIR = tmp.extra

  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        expect(config.plugin ?? []).toContain(
          pathToFileURL(path.join(tmp.extra, "plugins", "fixture-plugin", "plugin.json")).href,
        )
      },
    })
  } finally {
    if (prev === undefined) delete process.env.OPENCORVUS_PACKAGED_PLUGIN_DIR
    else process.env.OPENCORVUS_PACKAGED_PLUGIN_DIR = prev
  }
})

test("resolves scoped npm plugins in config", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const pluginDir = path.join(dir, "node_modules", "@scope", "plugin")
      await fs.mkdir(pluginDir, { recursive: true })

      await Filesystem.write(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "config-fixture", version: "1.0.0", type: "module" }, null, 2),
      )

      await Filesystem.write(
        path.join(pluginDir, "package.json"),
        JSON.stringify(
          {
            name: "@scope/plugin",
            version: "1.0.0",
            type: "module",
            main: "./index.js",
          },
          null,
          2,
        ),
      )

      await Filesystem.write(path.join(pluginDir, "index.js"), "export default {}\n")

      await Filesystem.write(
        path.join(dir, "opencorvus.json"),
        JSON.stringify({ $schema: "https://opencorvus.ai/config.json", plugin: ["@scope/plugin"] }, null, 2),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      const pluginEntries = config.plugin ?? []

      const expected = pathToFileURL(path.join(tmp.path, "node_modules", "@scope", "plugin", "index.js")).href

      expect(pluginEntries.includes(expected)).toBe(true)

      const scopedEntry = pluginEntries.find((entry) => entry === expected)
      expect(scopedEntry).toBeDefined()
      expect(scopedEntry?.includes("/node_modules/@scope/plugin/")).toBe(true)
    },
  })
})

test("merges plugin arrays from global and local configs", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // Create a nested project structure with local .opencorvus config
      const projectDir = path.join(dir, "project")
      const opencorvusDir = path.join(projectDir, ".opencorvus")
      await fs.mkdir(opencorvusDir, { recursive: true })

      // Local .opencorvus config with different plugins
      await Filesystem.write(
        path.join(opencorvusDir, "opencorvus.json"),
        JSON.stringify({
          $schema: "https://opencorvus.ai/config.json",
          plugin: ["local-plugin-1"],
        }),
      )
    },
  })
  await using globalTmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://opencorvus.ai/config.json",
        plugin: ["global-plugin-1", "global-plugin-2"],
      })
    },
  })

  await withGlobalConfigDir(globalTmp.path, async () => {
    await Instance.provide({
      directory: path.join(tmp.path, "project"),
      fn: async () => {
        const config = await Config.get()
        const plugins = config.plugin ?? []

        // Should contain both global and local plugins
        expect(plugins.some((p) => p.includes("global-plugin-1"))).toBe(true)
        expect(plugins.some((p) => p.includes("global-plugin-2"))).toBe(true)
        expect(plugins.some((p) => p.includes("local-plugin-1"))).toBe(true)

        // Should have all 3 plugins (not replaced, but merged)
        const pluginNames = plugins.filter((p) => p.includes("global-plugin") || p.includes("local-plugin"))
        expect(pluginNames.length).toBeGreaterThanOrEqual(3)
      },
    })
  })
})

test("does not error when only custom agent is a subagent", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const opencorvusDir = path.join(dir, ".opencorvus")
      await fs.mkdir(opencorvusDir, { recursive: true })
      const agentDir = path.join(opencorvusDir, "agent")
      await fs.mkdir(agentDir, { recursive: true })

      await Filesystem.write(
        path.join(agentDir, "helper.md"),
        `---
model: test/model
mode: subagent
---
Helper subagent prompt`,
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.agent?.["helper"]).toMatchObject({
        name: "helper",
        model: "test/model",
        mode: "subagent",
        prompt: "Helper subagent prompt",
      })
    },
  })
})

test("merges instructions arrays from global and local configs", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const projectDir = path.join(dir, "project")
      const opencorvusDir = path.join(projectDir, ".opencorvus")
      await fs.mkdir(opencorvusDir, { recursive: true })

      await Filesystem.write(
        path.join(opencorvusDir, "opencorvus.json"),
        JSON.stringify({
          $schema: "https://opencorvus.ai/config.json",
          instructions: ["local-instructions.md"],
        }),
      )
    },
  })
  await using globalTmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://opencorvus.ai/config.json",
        instructions: ["global-instructions.md", "shared-rules.md"],
      })
    },
  })

  await withGlobalConfigDir(globalTmp.path, async () => {
    await Instance.provide({
      directory: path.join(tmp.path, "project"),
      fn: async () => {
        const config = await Config.get()
        const instructions = config.instructions ?? []

        expect(instructions).toContain("global-instructions.md")
        expect(instructions).toContain("shared-rules.md")
        expect(instructions).toContain("local-instructions.md")
        expect(instructions.length).toBe(3)
      },
    })
  })
})

test("deduplicates duplicate instructions from global and local configs", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const projectDir = path.join(dir, "project")
      const opencorvusDir = path.join(projectDir, ".opencorvus")
      await fs.mkdir(opencorvusDir, { recursive: true })

      await Filesystem.write(
        path.join(opencorvusDir, "opencorvus.json"),
        JSON.stringify({
          $schema: "https://opencorvus.ai/config.json",
          instructions: ["duplicate.md", "local-only.md"],
        }),
      )
    },
  })
  await using globalTmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://opencorvus.ai/config.json",
        instructions: ["duplicate.md", "global-only.md"],
      })
    },
  })

  await withGlobalConfigDir(globalTmp.path, async () => {
    await Instance.provide({
      directory: path.join(tmp.path, "project"),
      fn: async () => {
        const config = await Config.get()
        const instructions = config.instructions ?? []

        expect(instructions).toContain("global-only.md")
        expect(instructions).toContain("local-only.md")
        expect(instructions).toContain("duplicate.md")

        const duplicates = instructions.filter((i) => i === "duplicate.md")
        expect(duplicates.length).toBe(1)
        expect(instructions.length).toBe(3)
      },
    })
  })
})

test("deduplicates duplicate plugins from global and local configs", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // Create a nested project structure with local .opencorvus config
      const projectDir = path.join(dir, "project")
      const opencorvusDir = path.join(projectDir, ".opencorvus")
      await fs.mkdir(opencorvusDir, { recursive: true })

      // Local .opencorvus config with some overlapping plugins
      await Filesystem.write(
        path.join(opencorvusDir, "opencorvus.json"),
        JSON.stringify({
          $schema: "https://opencorvus.ai/config.json",
          plugin: ["duplicate-plugin", "local-plugin-1"],
        }),
      )
    },
  })
  await using globalTmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://opencorvus.ai/config.json",
        plugin: ["duplicate-plugin", "global-plugin-1"],
      })
    },
  })

  await withGlobalConfigDir(globalTmp.path, async () => {
    await Instance.provide({
      directory: path.join(tmp.path, "project"),
      fn: async () => {
        const config = await Config.get()
        const plugins = config.plugin ?? []

        // Should contain all unique plugins
        expect(plugins.some((p) => p.includes("global-plugin-1"))).toBe(true)
        expect(plugins.some((p) => p.includes("local-plugin-1"))).toBe(true)
        expect(plugins.some((p) => p.includes("duplicate-plugin"))).toBe(true)

        // Should deduplicate the duplicate plugin
        const duplicatePlugins = plugins.filter((p) => p.includes("duplicate-plugin"))
        expect(duplicatePlugins.length).toBe(1)

        // Should have exactly 3 unique plugins
        const pluginNames = plugins.filter(
          (p) => p.includes("global-plugin") || p.includes("local-plugin") || p.includes("duplicate-plugin"),
        )
        expect(pluginNames.length).toBe(3)
      },
    })
  })
})

// Managed settings tests
// Note: preload.ts sets OPENCORVUS_TEST_MANAGED_CONFIG which Global.Path.managedConfig uses

test("managed settings override user settings", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://opencorvus.ai/config.json",
        model: "user/model",
        share: "auto",
        username: "testuser",
      })
    },
  })

  await writeManagedSettings({
    $schema: "https://opencorvus.ai/config.json",
    model: "managed/model",
    share: "disabled",
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.model).toBe("managed/model")
      expect(config.share).toBe("disabled")
      expect(config.username).toBe("testuser")
    },
  })
})

test("managed settings override project settings", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://opencorvus.ai/config.json",
        autoupdate: true,
        disabled_providers: [],
      })
    },
  })

  await writeManagedSettings({
    $schema: "https://opencorvus.ai/config.json",
    autoupdate: false,
    disabled_providers: ["openai"],
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.autoupdate).toBe(false)
      expect(config.disabled_providers).toEqual(["openai"])
    },
  })
})

test("missing managed settings file is not an error", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://opencorvus.ai/config.json",
        model: "user/model",
      })
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.model).toBe("user/model")
    },
  })
})

test("permission config preserves key order", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Filesystem.write(
        path.join(dir, "opencorvus.json"),
        JSON.stringify({
          $schema: "https://opencorvus.ai/config.json",
          permission: {
            "*": "deny",
            edit: "ask",
            write: "ask",
            external_directory: "ask",
            read: "allow",
            todowrite: "allow",
            todoread: "allow",
            plan_enter: "allow",
            plan_exit: "allow",
            "thoughts_*": "allow",
            "reasoning_model_*": "allow",
            "tools_*": "allow",
            "pr_comments_*": "allow",
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      // audit-2026-04-29 W2-V25 — `plan_enter`/`plan_exit` were
      // removed from the Permission schema (see config.ts:625-647);
      // they now fall through to `.catchall()` in input order with
      // the other custom rules. The test expectation hadn't been
      // updated and silently failed across the suite.
      //
      // Zod z.object().catchall() outputs known schema keys first
      // (in definition order), then catchall keys in input order.
      // Schema-known here: "read", "edit", "external_directory",
      // "todowrite", "todoread". Catchall in input order: "*",
      // "write", "plan_enter", "plan_exit", and the wildcard
      // entries.
      expect(Object.keys(config.permission!)).toEqual([
        "read",
        "edit",
        "external_directory",
        "todowrite",
        "todoread",
        "*",
        "write",
        "plan_enter",
        "plan_exit",
        "thoughts_*",
        "reasoning_model_*",
        "tools_*",
        "pr_comments_*",
      ])
    },
  })
})

// MCP config merging tests

test("project config can override MCP server enabled status", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // Simulates a base config (like from remote .well-known) with disabled MCP
      await Filesystem.write(
        path.join(dir, "opencorvus.jsonc"),
        JSON.stringify({
          $schema: "https://opencorvus.ai/config.json",
          mcp: {
            jira: {
              type: "remote",
              url: "https://jira.example.com/mcp",
              transport: "streamable-http",
              enabled: false,
            },
            wiki: {
              type: "remote",
              url: "https://wiki.example.com/mcp",
              transport: "streamable-http",
              enabled: false,
            },
          },
        }),
      )
      // Project config enables just jira
      await Filesystem.write(
        path.join(dir, "opencorvus.json"),
        JSON.stringify({
          $schema: "https://opencorvus.ai/config.json",
          mcp: {
            jira: {
              type: "remote",
              url: "https://jira.example.com/mcp",
              transport: "streamable-http",
              enabled: true,
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      // jira should be enabled (overridden by project config)
      expect(config.mcp?.jira).toEqual({
        type: "remote",
        url: "https://jira.example.com/mcp",
        transport: "streamable-http",
        enabled: true,
      })
      // wiki should still be disabled (not overridden)
      expect(config.mcp?.wiki).toEqual({
        type: "remote",
        url: "https://wiki.example.com/mcp",
        transport: "streamable-http",
        enabled: false,
      })
    },
  })
})

test("MCP config deep merges preserving base config properties", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // Base config with full MCP definition
      await Filesystem.write(
        path.join(dir, "opencorvus.jsonc"),
        JSON.stringify({
          $schema: "https://opencorvus.ai/config.json",
          mcp: {
            myserver: {
              type: "remote",
              url: "https://myserver.example.com/mcp",
              transport: "streamable-http",
              enabled: false,
              headers: {
                "X-Custom-Header": "value",
              },
            },
          },
        }),
      )
      // Override just enables it, should preserve other properties
      await Filesystem.write(
        path.join(dir, "opencorvus.json"),
        JSON.stringify({
          $schema: "https://opencorvus.ai/config.json",
          mcp: {
            myserver: {
              type: "remote",
              url: "https://myserver.example.com/mcp",
              transport: "streamable-http",
              enabled: true,
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.mcp?.myserver).toEqual({
        type: "remote",
        url: "https://myserver.example.com/mcp",
        transport: "streamable-http",
        enabled: true,
        headers: {
          "X-Custom-Header": "value",
        },
      })
    },
  })
})

test("local .opencorvus config can override MCP from project config", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // Project config with disabled MCP
      await Filesystem.write(
        path.join(dir, "opencorvus.json"),
        JSON.stringify({
          $schema: "https://opencorvus.ai/config.json",
          mcp: {
            docs: {
              type: "remote",
              url: "https://docs.example.com/mcp",
              transport: "streamable-http",
              enabled: false,
            },
          },
        }),
      )
      // Local .opencorvus directory config enables it
      const opencorvusDir = path.join(dir, ".opencorvus")
      await fs.mkdir(opencorvusDir, { recursive: true })
      await Filesystem.write(
        path.join(opencorvusDir, "opencorvus.json"),
        JSON.stringify({
          $schema: "https://opencorvus.ai/config.json",
          mcp: {
            docs: {
              type: "remote",
              url: "https://docs.example.com/mcp",
              transport: "streamable-http",
              enabled: true,
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.mcp?.docs?.enabled).toBe(true)
    },
  })
})

test("can disable the built-in browser MCP with a config override", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://opencorvus.ai/config.json",
        mcp: {
          browser: {
            enabled: false,
          },
        },
      })
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.mcp?.browser).toEqual({ enabled: false })
      const status = await MCP.status()
      expect(status.browser).toEqual({ status: "disabled" })
    },
  })
})

test("rejects enabled-only MCP entries that are not explicit disables", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://opencorvus.ai/config.json",
        mcp: {
          browser: {
            enabled: true,
          },
        },
      })
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Config.get()).rejects.toThrow()
    },
  })
})

test("project config overrides remote well-known config", async () => {
  const originalFetch = globalThis.fetch
  let fetchedUrl: string | undefined
  const mockFetch = mock((url: string | URL | Request) => {
    const urlStr = url.toString()
    if (urlStr.includes(".well-known/opencorvus")) {
      fetchedUrl = urlStr
      return Promise.resolve(
        new Response(
          JSON.stringify({
            config: {
              mcp: {
                jira: {
                  type: "remote",
                  url: "https://jira.example.com/mcp",
                  transport: "streamable-http",
                  enabled: false,
                },
              },
            },
          }),
          { status: 200 },
        ),
      )
    }
    return originalFetch(url)
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const originalAuthAll = Auth.all
  Auth.all = mock(() =>
    Promise.resolve({
      "https://example.com": {
        type: "wellknown" as const,
        key: "TEST_TOKEN",
        token: "test-token",
      },
    }),
  )

  try {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        // Project config enables jira (overriding remote default)
        await Filesystem.write(
          path.join(dir, "opencorvus.json"),
          JSON.stringify({
            $schema: "https://opencorvus.ai/config.json",
            mcp: {
              jira: {
                type: "remote",
                url: "https://jira.example.com/mcp",
                transport: "streamable-http",
                enabled: true,
              },
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        // Verify fetch was called for wellknown config
        expect(fetchedUrl).toBe("https://example.com/.well-known/opencorvus")
        // Project config (enabled: true) should override remote (enabled: false)
        expect(config.mcp?.jira?.enabled).toBe(true)
      },
    })
  } finally {
    globalThis.fetch = originalFetch
    Auth.all = originalAuthAll
  }
})

describe("getPluginName", () => {
  test("extracts name from file:// URL", () => {
    expect(Config.getPluginName("file:///path/to/plugin/foo.js")).toBe("foo")
    expect(Config.getPluginName("file:///path/to/plugin/bar.ts")).toBe("bar")
    expect(Config.getPluginName("file:///some/path/my-plugin.js")).toBe("my-plugin")
  })

  test("extracts name from npm package with version", () => {
    expect(Config.getPluginName("oh-my-opencorvus@2.4.3")).toBe("oh-my-opencorvus")
    expect(Config.getPluginName("some-plugin@1.0.0")).toBe("some-plugin")
    expect(Config.getPluginName("plugin@latest")).toBe("plugin")
  })

  test("extracts name from scoped npm package", () => {
    expect(Config.getPluginName("@scope/pkg@1.0.0")).toBe("@scope/pkg")
    expect(Config.getPluginName("@opencorvus/plugin@2.0.0")).toBe("@opencorvus/plugin")
  })

  test("returns full string for package without version", () => {
    expect(Config.getPluginName("some-plugin")).toBe("some-plugin")
    expect(Config.getPluginName("@scope/pkg")).toBe("@scope/pkg")
  })
})

describe("deduplicatePlugins", () => {
  test("removes duplicates keeping higher priority (later entries)", () => {
    const plugins = ["global-plugin@1.0.0", "shared-plugin@1.0.0", "local-plugin@2.0.0", "shared-plugin@2.0.0"]

    const result = Config.deduplicatePlugins(plugins)

    expect(result).toContain("global-plugin@1.0.0")
    expect(result).toContain("local-plugin@2.0.0")
    expect(result).toContain("shared-plugin@2.0.0")
    expect(result).not.toContain("shared-plugin@1.0.0")
    expect(result.length).toBe(3)
  })

  test("prefers local file over npm package with same name", () => {
    const plugins = ["oh-my-opencorvus@2.4.3", "file:///project/.opencorvus/plugin/oh-my-opencorvus.js"]

    const result = Config.deduplicatePlugins(plugins)

    expect(result.length).toBe(1)
    expect(result[0]).toBe("file:///project/.opencorvus/plugin/oh-my-opencorvus.js")
  })

  test("preserves order of remaining plugins", () => {
    const plugins = ["a-plugin@1.0.0", "b-plugin@1.0.0", "c-plugin@1.0.0"]

    const result = Config.deduplicatePlugins(plugins)

    expect(result).toEqual(["a-plugin@1.0.0", "b-plugin@1.0.0", "c-plugin@1.0.0"])
  })

  test("local plugin directory overrides global opencorvus.json plugin", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const projectDir = path.join(dir, "project")
        const opencorvusDir = path.join(projectDir, ".opencorvus")
        const pluginDir = path.join(opencorvusDir, "plugin")
        await fs.mkdir(pluginDir, { recursive: true })

        await Filesystem.write(
          path.join(dir, "opencorvus.json"),
          JSON.stringify({
            $schema: "https://opencorvus.ai/config.json",
            plugin: ["my-plugin@1.0.0"],
          }),
        )

        await Filesystem.write(path.join(pluginDir, "my-plugin.js"), "export default {}")
      },
    })

    await Instance.provide({
      directory: path.join(tmp.path, "project"),
      fn: async () => {
        const config = await Config.get()
        const plugins = config.plugin ?? []

        const myPlugins = plugins.filter((p) => Config.getPluginName(p) === "my-plugin")
        expect(myPlugins.length).toBe(1)
        expect(myPlugins[0].startsWith("file://")).toBe(true)
      },
    })
  })
})

describe("OPENCORVUS_DISABLE_PROJECT_CONFIG", () => {
  test("skips project config files when flag is set", async () => {
    const originalEnv = process.env["OPENCORVUS_DISABLE_PROJECT_CONFIG"]
    process.env["OPENCORVUS_DISABLE_PROJECT_CONFIG"] = "true"

    try {
      await using tmp = await tmpdir({
        init: async (dir) => {
          // Create a project config that would normally be loaded
          await Filesystem.write(
            path.join(dir, "opencorvus.json"),
            JSON.stringify({
              $schema: "https://opencorvus.ai/config.json",
              model: "project/model",
              username: "project-user",
            }),
          )
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const config = await Config.get()
          // Project config should NOT be loaded - model should be default, not "project/model"
          expect(config.model).not.toBe("project/model")
          expect(config.username).not.toBe("project-user")
        },
      })
    } finally {
      if (originalEnv === undefined) {
        delete process.env["OPENCORVUS_DISABLE_PROJECT_CONFIG"]
      } else {
        process.env["OPENCORVUS_DISABLE_PROJECT_CONFIG"] = originalEnv
      }
    }
  })

  test("skips project .opencorvus/ directories when flag is set", async () => {
    const originalEnv = process.env["OPENCORVUS_DISABLE_PROJECT_CONFIG"]
    process.env["OPENCORVUS_DISABLE_PROJECT_CONFIG"] = "true"

    try {
      await using tmp = await tmpdir({
        init: async (dir) => {
          // Create a .opencorvus directory with a command
          const opencorvusDir = path.join(dir, ".opencorvus", "command")
          await fs.mkdir(opencorvusDir, { recursive: true })
          await Filesystem.write(path.join(opencorvusDir, "test-cmd.md"), "# Test Command\nThis is a test command.")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const directories = await Config.directories()
          // Project .opencorvus should NOT be in directories list
          const hasProjectOpenCorvus = directories.some((d) => d.startsWith(tmp.path))
          expect(hasProjectOpenCorvus).toBe(false)
        },
      })
    } finally {
      if (originalEnv === undefined) {
        delete process.env["OPENCORVUS_DISABLE_PROJECT_CONFIG"]
      } else {
        process.env["OPENCORVUS_DISABLE_PROJECT_CONFIG"] = originalEnv
      }
    }
  })

  test("still loads global config when flag is set", async () => {
    const originalEnv = process.env["OPENCORVUS_DISABLE_PROJECT_CONFIG"]
    process.env["OPENCORVUS_DISABLE_PROJECT_CONFIG"] = "true"

    try {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Should still get default config (from global or defaults)
          const config = await Config.get()
          expect(config).toBeDefined()
          expect(config.username).toBeDefined()
        },
      })
    } finally {
      if (originalEnv === undefined) {
        delete process.env["OPENCORVUS_DISABLE_PROJECT_CONFIG"]
      } else {
        process.env["OPENCORVUS_DISABLE_PROJECT_CONFIG"] = originalEnv
      }
    }
  })

  test("skips relative instructions with warning when flag is set but no config dir", async () => {
    const originalDisable = process.env["OPENCORVUS_DISABLE_PROJECT_CONFIG"]
    const originalConfigDir = process.env["OPENCORVUS_CONFIG_DIR"]

    try {
      // Ensure no config dir is set
      delete process.env["OPENCORVUS_CONFIG_DIR"]
      process.env["OPENCORVUS_DISABLE_PROJECT_CONFIG"] = "true"

      await using tmp = await tmpdir({
        init: async (dir) => {
          // Create a config with relative instruction path
          await Filesystem.write(
            path.join(dir, "opencorvus.json"),
            JSON.stringify({
              $schema: "https://opencorvus.ai/config.json",
              instructions: ["./CUSTOM.md"],
            }),
          )
          // Create the instruction file (should be skipped)
          await Filesystem.write(path.join(dir, "CUSTOM.md"), "# Custom Instructions")
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // The relative instruction should be skipped without error
          // We're mainly verifying this doesn't throw and the config loads
          const config = await Config.get()
          expect(config).toBeDefined()
          // The instruction should have been skipped (warning logged)
          // We can't easily test the warning was logged, but we verify
          // the relative path didn't cause an error
        },
      })
    } finally {
      if (originalDisable === undefined) {
        delete process.env["OPENCORVUS_DISABLE_PROJECT_CONFIG"]
      } else {
        process.env["OPENCORVUS_DISABLE_PROJECT_CONFIG"] = originalDisable
      }
      if (originalConfigDir === undefined) {
        delete process.env["OPENCORVUS_CONFIG_DIR"]
      } else {
        process.env["OPENCORVUS_CONFIG_DIR"] = originalConfigDir
      }
    }
  })

  test("OPENCORVUS_CONFIG_DIR still works when flag is set", async () => {
    const originalDisable = process.env["OPENCORVUS_DISABLE_PROJECT_CONFIG"]
    const originalConfigDir = process.env["OPENCORVUS_CONFIG_DIR"]

    try {
      await using configDirTmp = await tmpdir({
        init: async (dir) => {
          // Create config in the custom config dir
          await Filesystem.write(
            path.join(dir, "opencorvus.json"),
            JSON.stringify({
              $schema: "https://opencorvus.ai/config.json",
              model: "configdir/model",
            }),
          )
        },
      })

      await using projectTmp = await tmpdir({
        init: async (dir) => {
          // Create config in project (should be ignored)
          await Filesystem.write(
            path.join(dir, "opencorvus.json"),
            JSON.stringify({
              $schema: "https://opencorvus.ai/config.json",
              model: "project/model",
            }),
          )
        },
      })

      process.env["OPENCORVUS_DISABLE_PROJECT_CONFIG"] = "true"
      process.env["OPENCORVUS_CONFIG_DIR"] = configDirTmp.path

      await Instance.provide({
        directory: projectTmp.path,
        fn: async () => {
          const config = await Config.get()
          // Should load from OPENCORVUS_CONFIG_DIR, not project
          expect(config.model).toBe("configdir/model")
        },
      })
    } finally {
      if (originalDisable === undefined) {
        delete process.env["OPENCORVUS_DISABLE_PROJECT_CONFIG"]
      } else {
        process.env["OPENCORVUS_DISABLE_PROJECT_CONFIG"] = originalDisable
      }
      if (originalConfigDir === undefined) {
        delete process.env["OPENCORVUS_CONFIG_DIR"]
      } else {
        process.env["OPENCORVUS_CONFIG_DIR"] = originalConfigDir
      }
    }
  })
})

describe("OPENCORVUS_CONFIG_CONTENT token substitution", () => {
  test("substitutes {env:} tokens in OPENCORVUS_CONFIG_CONTENT", async () => {
    const originalEnv = process.env["OPENCORVUS_CONFIG_CONTENT"]
    const originalTestVar = process.env["TEST_CONFIG_VAR"]
    process.env["TEST_CONFIG_VAR"] = "test_api_key_12345"
    process.env["OPENCORVUS_CONFIG_CONTENT"] = JSON.stringify({
      $schema: "https://opencorvus.ai/config.json",
      username: "{env:TEST_CONFIG_VAR}",
    })

    try {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const config = await Config.get()
          expect(config.username).toBe("test_api_key_12345")
        },
      })
    } finally {
      if (originalEnv !== undefined) {
        process.env["OPENCORVUS_CONFIG_CONTENT"] = originalEnv
      } else {
        delete process.env["OPENCORVUS_CONFIG_CONTENT"]
      }
      if (originalTestVar !== undefined) {
        process.env["TEST_CONFIG_VAR"] = originalTestVar
      } else {
        delete process.env["TEST_CONFIG_VAR"]
      }
    }
  })

  test("substitutes {file:} tokens in OPENCORVUS_CONFIG_CONTENT", async () => {
    const originalEnv = process.env["OPENCORVUS_CONFIG_CONTENT"]

    try {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Filesystem.write(path.join(dir, "api_key.txt"), "secret_key_from_file")
          process.env["OPENCORVUS_CONFIG_CONTENT"] = JSON.stringify({
            $schema: "https://opencorvus.ai/config.json",
            username: "{file:./api_key.txt}",
          })
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const config = await Config.get()
          expect(config.username).toBe("secret_key_from_file")
        },
      })
    } finally {
      if (originalEnv !== undefined) {
        process.env["OPENCORVUS_CONFIG_CONTENT"] = originalEnv
      } else {
        delete process.env["OPENCORVUS_CONFIG_CONTENT"]
      }
    }
  })
})
