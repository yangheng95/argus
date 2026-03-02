import { describe, test, expect, afterEach, beforeEach } from "bun:test"

// Flag module must be imported after env vars are set in preload.ts.
// Dynamic getters re-evaluate process.env at access time, so we can
// test them by manipulating process.env before reading the property.
const { Flag } = await import("../../src/flag/flag")

// Keys that tests manipulate — clean up after each test
const TEMP_KEYS = [
  "ARGUS_TUI_CONFIG",
  "ARGUS_CONFIG_DIR",
  "ARGUS_CLIENT",
  "ARGUS_DISABLE_CLAUDE_CODE",
  "ARGUS_DISABLE_CLAUDE_CODE_PROMPT",
  "ARGUS_DISABLE_CLAUDE_CODE_SKILLS",
  "ARGUS_DISABLE_EXTERNAL_SKILLS",
  "ARGUS_EXPERIMENTAL",
  "ARGUS_EXPERIMENTAL_ICON_DISCOVERY",
  "ARGUS_ENABLE_EXA",
  "ARGUS_EXPERIMENTAL_EXA",
  "ARGUS_EXPERIMENTAL_OXFMT",
  "ARGUS_EXPERIMENTAL_LSP_TOOL",
  "ARGUS_EXPERIMENTAL_PLAN_MODE",
  "ARGUS_DISABLE_PROJECT_CONFIG",
  "ARGUS_EXPERIMENTAL_EXA",
]

beforeEach(() => {
  for (const key of TEMP_KEYS) delete process.env[key]
})

afterEach(() => {
  for (const key of TEMP_KEYS) delete process.env[key]
})

describe("Flag — dynamic getter: ARGUS_TUI_CONFIG", () => {
  test("returns undefined when env var is not set", () => {
    expect(Flag.ARGUS_TUI_CONFIG).toBeUndefined()
  })

  test("returns value when env var is set", () => {
    process.env["ARGUS_TUI_CONFIG"] = "/some/path/config.json"
    expect(Flag.ARGUS_TUI_CONFIG).toBe("/some/path/config.json")
  })
})

describe("Flag — dynamic getter: ARGUS_CONFIG_DIR", () => {
  test("returns undefined when not set", () => {
    expect(Flag.ARGUS_CONFIG_DIR).toBeUndefined()
  })

  test("returns value when set", () => {
    process.env["ARGUS_CONFIG_DIR"] = "/custom/config"
    expect(Flag.ARGUS_CONFIG_DIR).toBe("/custom/config")
  })
})

describe("Flag — dynamic getter: ARGUS_CLIENT", () => {
  test("defaults to 'cli' when not set", () => {
    expect(Flag.ARGUS_CLIENT).toBe("cli")
  })

  test("returns set value when overridden", () => {
    process.env["ARGUS_CLIENT"] = "tui"
    expect(Flag.ARGUS_CLIENT).toBe("tui")
  })
})

describe("Flag — dynamic getter: ARGUS_DISABLE_PROJECT_CONFIG", () => {
  test("returns false when not set", () => {
    expect(Flag.ARGUS_DISABLE_PROJECT_CONFIG).toBe(false)
  })

  test("returns true when set to '1'", () => {
    process.env["ARGUS_DISABLE_PROJECT_CONFIG"] = "1"
    expect(Flag.ARGUS_DISABLE_PROJECT_CONFIG).toBe(true)
  })

  test("returns true when set to 'true'", () => {
    process.env["ARGUS_DISABLE_PROJECT_CONFIG"] = "true"
    expect(Flag.ARGUS_DISABLE_PROJECT_CONFIG).toBe(true)
  })

  test("returns false when set to 'false'", () => {
    process.env["ARGUS_DISABLE_PROJECT_CONFIG"] = "false"
    expect(Flag.ARGUS_DISABLE_PROJECT_CONFIG).toBe(false)
  })
})

describe("Flag — dependency chain: ARGUS_DISABLE_CLAUDE_CODE", () => {
  test("ARGUS_DISABLE_CLAUDE_CODE is false by default", () => {
    expect(Flag.ARGUS_DISABLE_CLAUDE_CODE).toBe(false)
  })

  test("enabling ARGUS_DISABLE_CLAUDE_CODE also enables ARGUS_DISABLE_CLAUDE_CODE_PROMPT", () => {
    process.env["ARGUS_DISABLE_CLAUDE_CODE"] = "1"
    expect(Flag.ARGUS_DISABLE_CLAUDE_CODE).toBe(true)
    expect(Flag.ARGUS_DISABLE_CLAUDE_CODE_PROMPT).toBe(true)
  })

  test("enabling ARGUS_DISABLE_CLAUDE_CODE also enables ARGUS_DISABLE_CLAUDE_CODE_SKILLS", () => {
    process.env["ARGUS_DISABLE_CLAUDE_CODE"] = "1"
    expect(Flag.ARGUS_DISABLE_CLAUDE_CODE_SKILLS).toBe(true)
  })

  test("ARGUS_DISABLE_CLAUDE_CODE_SKILLS cascades to ARGUS_DISABLE_EXTERNAL_SKILLS", () => {
    process.env["ARGUS_DISABLE_CLAUDE_CODE"] = "1"
    expect(Flag.ARGUS_DISABLE_EXTERNAL_SKILLS).toBe(true)
  })

  test("can disable ARGUS_DISABLE_CLAUDE_CODE_PROMPT independently", () => {
    process.env["ARGUS_DISABLE_CLAUDE_CODE_PROMPT"] = "1"
    expect(Flag.ARGUS_DISABLE_CLAUDE_CODE_PROMPT).toBe(true)
    expect(Flag.ARGUS_DISABLE_CLAUDE_CODE).toBe(false) // parent not affected
  })
})

describe("Flag — dependency chain: ARGUS_EXPERIMENTAL", () => {
  // NOTE: Flag.ARGUS_EXPERIMENTAL is a static property evaluated at module load
  // time, so tests cannot change it after import. The dynamic getters for
  // dependent flags also check the individual env vars, which CAN be set at
  // runtime.

  test("ARGUS_EXPERIMENTAL_ICON_DISCOVERY is true when its own env var is set", () => {
    process.env["ARGUS_EXPERIMENTAL_ICON_DISCOVERY"] = "1"
    expect(Flag.ARGUS_EXPERIMENTAL_ICON_DISCOVERY).toBe(true)
  })

  test("ARGUS_ENABLE_EXA is true when ARGUS_ENABLE_EXA env var is set", () => {
    process.env["ARGUS_ENABLE_EXA"] = "1"
    expect(Flag.ARGUS_ENABLE_EXA).toBe(true)
  })

  test("ARGUS_ENABLE_EXA is true when ARGUS_EXPERIMENTAL_EXA env var is set", () => {
    process.env["ARGUS_EXPERIMENTAL_EXA"] = "1"
    expect(Flag.ARGUS_ENABLE_EXA).toBe(true)
  })

  test("ARGUS_EXPERIMENTAL_OXFMT is true when its own env var is set", () => {
    process.env["ARGUS_EXPERIMENTAL_OXFMT"] = "1"
    expect(Flag.ARGUS_EXPERIMENTAL_OXFMT).toBe(true)
  })

  test("ARGUS_EXPERIMENTAL_LSP_TOOL is true when its own env var is set", () => {
    process.env["ARGUS_EXPERIMENTAL_LSP_TOOL"] = "1"
    expect(Flag.ARGUS_EXPERIMENTAL_LSP_TOOL).toBe(true)
  })

  test("experimental flags default to false", () => {
    expect(Flag.ARGUS_EXPERIMENTAL_ICON_DISCOVERY).toBe(false)
    expect(Flag.ARGUS_ENABLE_EXA).toBe(false)
    expect(Flag.ARGUS_EXPERIMENTAL_OXFMT).toBe(false)
    expect(Flag.ARGUS_EXPERIMENTAL_LSP_TOOL).toBe(false)
  })
})
