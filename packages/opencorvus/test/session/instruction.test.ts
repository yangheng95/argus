import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import path from "path"
import { InstructionPrompt } from "../../src/session/instruction"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("InstructionPrompt.resolve", () => {
  test("loads project AGENTS.md and CLAUDE.md as authoritative system paths", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "AGENTS.md"), "# Agent Instructions")
        await Bun.write(path.join(dir, "CLAUDE.md"), "# Claude Instructions")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const paths = Array.from(await InstructionPrompt.systemPaths())
        expect(paths).toContain(path.join(tmp.path, "AGENTS.md"))
        expect(paths).toContain(path.join(tmp.path, "CLAUDE.md"))
        expect(paths.indexOf(path.join(tmp.path, "AGENTS.md"))).toBeLessThan(
          paths.indexOf(path.join(tmp.path, "CLAUDE.md")),
        )
      },
    })
  })

  test("loads lowercase agent.md and claude.md as authoritative system paths", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "agent.md"), "# Lower Agent Instructions")
        await Bun.write(path.join(dir, "claude.md"), "# Lower Claude Instructions")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const paths = Array.from(await InstructionPrompt.systemPaths())
        expect(paths).toContain(path.join(tmp.path, "agent.md"))
        expect(paths).toContain(path.join(tmp.path, "claude.md"))
      },
    })
  })

  test("expands @ file references inside instruction files", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "AGENTS.md"), "# Root Instructions\n@rules.MD")
        await Bun.write(path.join(dir, "rUlEs.md"), "# Included Rules\nFollow the included rule.")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const system = await InstructionPrompt.system()
        expect(system.join("\n\n")).toContain("Instructions from: " + path.join(tmp.path, "rUlEs.md"))
        expect(system.join("\n\n")).toContain("Follow the included rule.")
      },
    })
  })

  test("ignores npm scoped imports and missing optional include parents in instruction references", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "AGENTS.md"),
          [
            "# Root Instructions",
            "@rules.md",
            "@missing-parent/rules.md",
            "",
            "```ts",
            "import { createBridge } from '@ainvest/vibe-bridge';",
            "```",
            "",
            "Inline code like `/** @internal */` is not a file include.",
          ].join("\n"),
        )
        await Bun.write(path.join(dir, "rules.md"), "# Included Rules\nFollow the included rule.")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const system = await InstructionPrompt.system()
        const text = system.join("\n\n")
        expect(text).toContain("Instructions from: " + path.join(tmp.path, "rules.md"))
        expect(text).toContain("Follow the included rule.")
      },
    })
  })

  test("returns empty when AGENTS.md is at project root (already in systemPaths)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "AGENTS.md"), "# Root Instructions")
        await Bun.write(path.join(dir, "src", "file.ts"), "const x = 1")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const system = await InstructionPrompt.systemPaths()
        expect(system.has(path.join(tmp.path, "AGENTS.md"))).toBe(true)

        const results = await InstructionPrompt.resolve([], path.join(tmp.path, "src", "file.ts"), "test-message-1")
        expect(results).toEqual([])
      },
    })
  })

  test("returns AGENTS.md from subdirectory (not in systemPaths)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "subdir", "AGENTS.md"), "# Subdir Instructions")
        await Bun.write(path.join(dir, "subdir", "nested", "file.ts"), "const x = 1")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const system = await InstructionPrompt.systemPaths()
        expect(system.has(path.join(tmp.path, "subdir", "AGENTS.md"))).toBe(false)

        const results = await InstructionPrompt.resolve(
          [],
          path.join(tmp.path, "subdir", "nested", "file.ts"),
          "test-message-2",
        )
        expect(results.length).toBe(1)
        expect(results[0].filepath).toBe(path.join(tmp.path, "subdir", "AGENTS.md"))
      },
    })
  })

  test("expands @ file references from subdirectory instructions loaded by read", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "subdir", "agent.md"), "# Subdir Instructions\n@extra-rules.md")
        await Bun.write(path.join(dir, "subdir", "extra-rules.md"), "# Extra Rules\nUse the extra rule.")
        await Bun.write(path.join(dir, "subdir", "nested", "file.ts"), "const x = 1")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const results = await InstructionPrompt.resolve(
          [],
          path.join(tmp.path, "subdir", "nested", "file.ts"),
          "test-message-subdir-at",
        )
        expect(results.length).toBe(1)
        expect(results[0].content).toContain("Instructions from: " + path.join(tmp.path, "subdir", "extra-rules.md"))
        expect(results[0].content).toContain("Use the extra rule.")
      },
    })
  })

  test("doesn't reload AGENTS.md when reading it directly", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "subdir", "AGENTS.md"), "# Subdir Instructions")
        await Bun.write(path.join(dir, "subdir", "nested", "file.ts"), "const x = 1")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filepath = path.join(tmp.path, "subdir", "AGENTS.md")
        const system = await InstructionPrompt.systemPaths()
        expect(system.has(filepath)).toBe(false)

        const results = await InstructionPrompt.resolve([], filepath, "test-message-2")
        expect(results).toEqual([])
      },
    })
  })
})

describe("InstructionPrompt.systemPaths OPENCORVUS_CONFIG_DIR", () => {
  let originalConfigDir: string | undefined

  beforeEach(() => {
    originalConfigDir = process.env["OPENCORVUS_CONFIG_DIR"]
  })

  afterEach(() => {
    if (originalConfigDir === undefined) {
      delete process.env["OPENCORVUS_CONFIG_DIR"]
    } else {
      process.env["OPENCORVUS_CONFIG_DIR"] = originalConfigDir
    }
  })

  test("prefers OPENCORVUS_CONFIG_DIR AGENTS.md over global when both exist", async () => {
    await using profileTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "AGENTS.md"), "# Profile Instructions")
      },
    })
    await using globalTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "AGENTS.md"), "# Global Instructions")
      },
    })
    await using projectTmp = await tmpdir()

    process.env["OPENCORVUS_CONFIG_DIR"] = profileTmp.path
    const originalGlobalConfigDir = process.env["OPENCORVUS_GLOBAL_CONFIG_DIR"]
    process.env["OPENCORVUS_GLOBAL_CONFIG_DIR"] = globalTmp.path

    try {
      await Instance.provide({
        directory: projectTmp.path,
        fn: async () => {
          const paths = await InstructionPrompt.systemPaths()
          expect(paths.has(path.join(profileTmp.path, "AGENTS.md"))).toBe(true)
          expect(paths.has(path.join(globalTmp.path, "AGENTS.md"))).toBe(false)
        },
      })
    } finally {
      if (originalGlobalConfigDir === undefined) delete process.env["OPENCORVUS_GLOBAL_CONFIG_DIR"]
      else process.env["OPENCORVUS_GLOBAL_CONFIG_DIR"] = originalGlobalConfigDir
    }
  })

  test("falls back to global AGENTS.md when OPENCORVUS_CONFIG_DIR has no AGENTS.md", async () => {
    await using profileTmp = await tmpdir()
    await using globalTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "AGENTS.md"), "# Global Instructions")
      },
    })
    await using projectTmp = await tmpdir()

    process.env["OPENCORVUS_CONFIG_DIR"] = profileTmp.path
    const originalGlobalConfigDir = process.env["OPENCORVUS_GLOBAL_CONFIG_DIR"]
    process.env["OPENCORVUS_GLOBAL_CONFIG_DIR"] = globalTmp.path

    try {
      await Instance.provide({
        directory: projectTmp.path,
        fn: async () => {
          const paths = await InstructionPrompt.systemPaths()
          expect(paths.has(path.join(profileTmp.path, "AGENTS.md"))).toBe(false)
          expect(paths.has(path.join(globalTmp.path, "AGENTS.md"))).toBe(true)
        },
      })
    } finally {
      if (originalGlobalConfigDir === undefined) delete process.env["OPENCORVUS_GLOBAL_CONFIG_DIR"]
      else process.env["OPENCORVUS_GLOBAL_CONFIG_DIR"] = originalGlobalConfigDir
    }
  })

  test("uses global AGENTS.md when OPENCORVUS_CONFIG_DIR is not set", async () => {
    await using globalTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "AGENTS.md"), "# Global Instructions")
      },
    })
    await using projectTmp = await tmpdir()

    delete process.env["OPENCORVUS_CONFIG_DIR"]
    const originalGlobalConfigDir = process.env["OPENCORVUS_GLOBAL_CONFIG_DIR"]
    process.env["OPENCORVUS_GLOBAL_CONFIG_DIR"] = globalTmp.path

    try {
      await Instance.provide({
        directory: projectTmp.path,
        fn: async () => {
          const paths = await InstructionPrompt.systemPaths()
          expect(paths.has(path.join(globalTmp.path, "AGENTS.md"))).toBe(true)
        },
      })
    } finally {
      if (originalGlobalConfigDir === undefined) delete process.env["OPENCORVUS_GLOBAL_CONFIG_DIR"]
      else process.env["OPENCORVUS_GLOBAL_CONFIG_DIR"] = originalGlobalConfigDir
    }
  })
})
