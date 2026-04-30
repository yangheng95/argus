import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { Agent } from "../../src/agent/agent"
import { PermissionNext } from "../../src/permission/next"
import { tmpdir } from "../fixture/fixture"

/**
 * 2026-04-30 debug policy: build sessions must not stall on unattended
 * PermissionNext prompts. The shared agent defaults accept external_directory
 * requests unless the operator adds an explicit deny/ask rule in config.
 */

describe("agent permission — external_directory defaults to allow", () => {
  test("build agent allows project and system external_directory paths", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const info = await Agent.get("build")
        const ruleset = info.permission
        const insidePath = path.join(tmp.path, "subdir", "file.txt")
        const outsidePath = path.join(process.platform === "win32" ? "C:\\Windows\\System32" : "/etc", "config")
        const inside = PermissionNext.evaluate("external_directory", insidePath, ruleset)
        const outside = PermissionNext.evaluate("external_directory", outsidePath, ruleset)
        expect(inside.action).toBe("allow")
        expect(outside.action).toBe("allow")
      },
    })
  })
})
