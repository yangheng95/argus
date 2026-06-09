import { describe, expect, test } from "bun:test"
import { resolveRuntimeConfig } from "../src/runtime-config"

describe("runtime config", () => {
  test("merges channel profile permission into existing config permission", () => {
    const input = JSON.stringify({
      model: "alibaba-cn/qwen3.5-plus",
      permission: {
        bash: "ask",
      },
    })
    const result = resolveRuntimeConfig(input, "standard")
    const permission = result.config.permission as Record<string, string>
    expect(result.profileState.profile).toBe("standard")
    expect(permission.bash).toBe("allow")
    expect(permission["*"]).toBe("deny")
  })

  test("falls back to empty config for invalid JSON", () => {
    const result = resolveRuntimeConfig("{bad", "unknown_profile")
    expect(result.profileState.profile).toBe("standard")
    expect(result.profileState.invalid).toBe(true)
    expect(result.config.permission).toBeDefined()
  })
})
