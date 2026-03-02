import { describe, test, expect, afterEach, beforeEach } from "bun:test"

// Flag module must be imported after env vars are set in preload.ts.
// Dynamic getters re-evaluate process.env at access time, so we can
// test them by manipulating process.env before reading the property.
const { Flag } = await import("../../src/flag/flag")

// Keys that tests manipulate — clean up after each test
const TEMP_KEYS = [
  "OPENCORVUS_TUI_CONFIG",
  "OPENCORVUS_CONFIG_DIR",
  "OPENCORVUS_CLIENT",
  "OPENCORVUS_DISABLE_CLAUDE_CODE",
  "OPENCORVUS_DISABLE_CLAUDE_CODE_PROMPT",
  "OPENCORVUS_DISABLE_CLAUDE_CODE_SKILLS",
  "OPENCORVUS_DISABLE_EXTERNAL_SKILLS",
  "OPENCORVUS_EXPERIMENTAL",
  "OPENCORVUS_EXPERIMENTAL_ICON_DISCOVERY",
  "OPENCORVUS_ENABLE_EXA",
  "OPENCORVUS_EXPERIMENTAL_EXA",
  "OPENCORVUS_EXPERIMENTAL_OXFMT",
  "OPENCORVUS_EXPERIMENTAL_LSP_TOOL",
  "OPENCORVUS_EXPERIMENTAL_PLAN_MODE",
  "OPENCORVUS_DISABLE_PROJECT_CONFIG",
  "OPENCORVUS_EXPERIMENTAL_EXA",
]

beforeEach(() => {
  for (const key of TEMP_KEYS) delete process.env[key]
})

afterEach(() => {
  for (const key of TEMP_KEYS) delete process.env[key]
})

describe("Flag — dynamic getter: OPENCORVUS_TUI_CONFIG", () => {
  test("returns undefined when env var is not set", () => {
    expect(Flag.OPENCORVUS_TUI_CONFIG).toBeUndefined()
  })

  test("returns value when env var is set", () => {
    process.env["OPENCORVUS_TUI_CONFIG"] = "/some/path/config.json"
    expect(Flag.OPENCORVUS_TUI_CONFIG).toBe("/some/path/config.json")
  })
})

describe("Flag — dynamic getter: OPENCORVUS_CONFIG_DIR", () => {
  test("returns undefined when not set", () => {
    expect(Flag.OPENCORVUS_CONFIG_DIR).toBeUndefined()
  })

  test("returns value when set", () => {
    process.env["OPENCORVUS_CONFIG_DIR"] = "/custom/config"
    expect(Flag.OPENCORVUS_CONFIG_DIR).toBe("/custom/config")
  })
})

describe("Flag — dynamic getter: OPENCORVUS_CLIENT", () => {
  test("defaults to 'cli' when not set", () => {
    expect(Flag.OPENCORVUS_CLIENT).toBe("cli")
  })

  test("returns set value when overridden", () => {
    process.env["OPENCORVUS_CLIENT"] = "tui"
    expect(Flag.OPENCORVUS_CLIENT).toBe("tui")
  })
})

describe("Flag — dynamic getter: OPENCORVUS_DISABLE_PROJECT_CONFIG", () => {
  test("returns false when not set", () => {
    expect(Flag.OPENCORVUS_DISABLE_PROJECT_CONFIG).toBe(false)
  })

  test("returns true when set to '1'", () => {
    process.env["OPENCORVUS_DISABLE_PROJECT_CONFIG"] = "1"
    expect(Flag.OPENCORVUS_DISABLE_PROJECT_CONFIG).toBe(true)
  })

  test("returns true when set to 'true'", () => {
    process.env["OPENCORVUS_DISABLE_PROJECT_CONFIG"] = "true"
    expect(Flag.OPENCORVUS_DISABLE_PROJECT_CONFIG).toBe(true)
  })

  test("returns false when set to 'false'", () => {
    process.env["OPENCORVUS_DISABLE_PROJECT_CONFIG"] = "false"
    expect(Flag.OPENCORVUS_DISABLE_PROJECT_CONFIG).toBe(false)
  })
})

describe("Flag — dependency chain: OPENCORVUS_DISABLE_CLAUDE_CODE", () => {
  test("OPENCORVUS_DISABLE_CLAUDE_CODE is false by default", () => {
    expect(Flag.OPENCORVUS_DISABLE_CLAUDE_CODE).toBe(false)
  })

  test("enabling OPENCORVUS_DISABLE_CLAUDE_CODE also enables OPENCORVUS_DISABLE_CLAUDE_CODE_PROMPT", () => {
    process.env["OPENCORVUS_DISABLE_CLAUDE_CODE"] = "1"
    expect(Flag.OPENCORVUS_DISABLE_CLAUDE_CODE).toBe(true)
    expect(Flag.OPENCORVUS_DISABLE_CLAUDE_CODE_PROMPT).toBe(true)
  })

  test("enabling OPENCORVUS_DISABLE_CLAUDE_CODE also enables OPENCORVUS_DISABLE_CLAUDE_CODE_SKILLS", () => {
    process.env["OPENCORVUS_DISABLE_CLAUDE_CODE"] = "1"
    expect(Flag.OPENCORVUS_DISABLE_CLAUDE_CODE_SKILLS).toBe(true)
  })

  test("OPENCORVUS_DISABLE_CLAUDE_CODE_SKILLS cascades to OPENCORVUS_DISABLE_EXTERNAL_SKILLS", () => {
    process.env["OPENCORVUS_DISABLE_CLAUDE_CODE"] = "1"
    expect(Flag.OPENCORVUS_DISABLE_EXTERNAL_SKILLS).toBe(true)
  })

  test("can disable OPENCORVUS_DISABLE_CLAUDE_CODE_PROMPT independently", () => {
    process.env["OPENCORVUS_DISABLE_CLAUDE_CODE_PROMPT"] = "1"
    expect(Flag.OPENCORVUS_DISABLE_CLAUDE_CODE_PROMPT).toBe(true)
    expect(Flag.OPENCORVUS_DISABLE_CLAUDE_CODE).toBe(false) // parent not affected
  })
})

describe("Flag — dependency chain: OPENCORVUS_EXPERIMENTAL", () => {
  // NOTE: Flag.OPENCORVUS_EXPERIMENTAL is a static property evaluated at module load
  // time, so tests cannot change it after import. The dynamic getters for
  // dependent flags also check the individual env vars, which CAN be set at
  // runtime.

  test("OPENCORVUS_EXPERIMENTAL_ICON_DISCOVERY is true when its own env var is set", () => {
    process.env["OPENCORVUS_EXPERIMENTAL_ICON_DISCOVERY"] = "1"
    expect(Flag.OPENCORVUS_EXPERIMENTAL_ICON_DISCOVERY).toBe(true)
  })

  test("OPENCORVUS_ENABLE_EXA is true when OPENCORVUS_ENABLE_EXA env var is set", () => {
    process.env["OPENCORVUS_ENABLE_EXA"] = "1"
    expect(Flag.OPENCORVUS_ENABLE_EXA).toBe(true)
  })

  test("OPENCORVUS_ENABLE_EXA is true when OPENCORVUS_EXPERIMENTAL_EXA env var is set", () => {
    process.env["OPENCORVUS_EXPERIMENTAL_EXA"] = "1"
    expect(Flag.OPENCORVUS_ENABLE_EXA).toBe(true)
  })

  test("OPENCORVUS_EXPERIMENTAL_OXFMT is true when its own env var is set", () => {
    process.env["OPENCORVUS_EXPERIMENTAL_OXFMT"] = "1"
    expect(Flag.OPENCORVUS_EXPERIMENTAL_OXFMT).toBe(true)
  })

  test("OPENCORVUS_EXPERIMENTAL_LSP_TOOL is true when its own env var is set", () => {
    process.env["OPENCORVUS_EXPERIMENTAL_LSP_TOOL"] = "1"
    expect(Flag.OPENCORVUS_EXPERIMENTAL_LSP_TOOL).toBe(true)
  })

  test("experimental flags default to false", () => {
    expect(Flag.OPENCORVUS_EXPERIMENTAL_ICON_DISCOVERY).toBe(false)
    expect(Flag.OPENCORVUS_ENABLE_EXA).toBe(false)
    expect(Flag.OPENCORVUS_EXPERIMENTAL_OXFMT).toBe(false)
    expect(Flag.OPENCORVUS_EXPERIMENTAL_LSP_TOOL).toBe(false)
  })
})
