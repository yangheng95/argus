import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { Agent } from "../../src/agent/agent"
import { PermissionNext } from "../../src/permission/next"
import { tmpdir } from "../fixture/fixture"

/**
 * 2026-04-30 — overlay-web-benchmark goal_run hung 5 minutes on every
 * `external_directory:*` ask the build agent fired against its parent
 * project root. The build agent runs inside `.opencorvus/worktrees/<branch>/`
 * — that worktree IS a checkout of the same project, so reading sibling /
 * parent files is the same VCS data at a different commit, not genuinely
 * "external". Without an Instance.directory entry in the agent's
 * `whitelistedDirs`, the `*=ask` rule caught every probe and unattended
 * runs hit the 5-min permission timeout.
 *
 * Fix adds `Instance.directory + "/**"` to `whitelistedDirs` so agents
 * walking their own project tree get auto-allowed; system paths
 * (`~/.ssh`, `/etc/...`, `~/Documents/...`) still fall through to `*=ask`
 * and remain gated.
 *
 * This regression pins the contract: for any agent that inherits the
 * shared default permission set, the project root MUST be allowlisted.
 */

describe("agent permission — Instance.directory allowlisted for external_directory", () => {
  test("build agent allows external_directory under Instance.directory", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const info = await Agent.get("build")
        const ruleset = info.permission
        // Permission API exposes findLast-style evaluation, not the raw
        // ruleset, so we verify the contract at the application layer:
        // a path INSIDE Instance.directory must NOT trigger an `ask`
        // outcome, while a path OUTSIDE (system-style) still does.
        const insidePath = path.join(tmp.path, "subdir", "file.txt")
        const outsidePath = path.join(
          process.platform === "win32" ? "C:\\Windows\\System32" : "/etc",
          "config",
        )
        const inside = PermissionNext.evaluate("external_directory", insidePath, ruleset)
        const outside = PermissionNext.evaluate("external_directory", outsidePath, ruleset)
        expect(inside.action).toBe("allow")
        expect(outside.action).toBe("ask")
      },
    })
  })
})
