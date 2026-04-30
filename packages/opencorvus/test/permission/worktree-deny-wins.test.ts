import { test, expect } from "bun:test"
import { PermissionNext } from "../../src/permission/next"

/**
 * Regression for the debug permission policy requested on 2026-04-30. The
 * composition in agent/agent.ts layers as:
 *
 *   defaults (external_directory defaults to allow)
 *   → agent overrides
 *   → user (cfg.permission)
 *
 * `findLast`-wins evaluator means user explicit `deny` or `ask` rules still
 * override the debug default. With no user override, worktree and sibling
 * paths both resolve to allow so unattended benchmark runs do not hang.
 */

const WORKTREE = "C:/Users/test/worktree-A"

function buildBuildLikeRuleset(userOverrides: Record<string, unknown> = {}) {
  // Mirror the build-agent composition at agent/agent.ts:155-175. Only the
  // external_directory rule shape matters for this test; other rules are
  // omitted to keep the ruleset focused.
  const defaults = PermissionNext.fromConfig({
    "*": "allow",
    external_directory: "allow",
  })
  const agentOverrides = PermissionNext.fromConfig({
    question: "allow",
    webfetch: "allow",
  })
  const user = PermissionNext.fromConfig(userOverrides)
  return PermissionNext.merge(defaults, agentOverrides, user)
}

test("worktree-internal path with no user override resolves to allow", () => {
  const ruleset = buildBuildLikeRuleset()
  const rule = PermissionNext.evaluate("external_directory", `${WORKTREE}/src/main.ts`, ruleset)
  expect(rule.action).toBe("allow")
})

test("path outside worktree defaults to allow for unattended debugging", () => {
  const ruleset = buildBuildLikeRuleset()
  const rule = PermissionNext.evaluate("external_directory", "C:/Users/test/sibling-worktree-B/src/main.ts", ruleset)
  expect(rule.action).toBe("allow")
})

test("user explicit deny within worktree wins over worktree allow (deny-wins ordering)", () => {
  const ruleset = buildBuildLikeRuleset({
    external_directory: {
      [`${WORKTREE}/secret/**`]: "deny",
    },
  })
  // Path matches BOTH the defaults' worktree-allow AND user's secret-deny;
  // user's deny is the LAST matching rule in the merged array → deny wins.
  const rule = PermissionNext.evaluate("external_directory", `${WORKTREE}/secret/api-key.env`, ruleset)
  expect(rule.action).toBe("deny")
})

test("user override outside the worktree-deny pattern still resolves to allow", () => {
  // User's deny is narrower than the worktree allow — paths NOT inside the
  // deny pattern keep the allow.
  const ruleset = buildBuildLikeRuleset({
    external_directory: {
      [`${WORKTREE}/secret/**`]: "deny",
    },
  })
  const rule = PermissionNext.evaluate("external_directory", `${WORKTREE}/src/main.ts`, ruleset)
  expect(rule.action).toBe("allow")
})

test("user general external_directory ask overrides debug allow default", () => {
  // If a user explicitly says "ask for all external_directory", that
  // intentionally suppresses the debug auto-allow.
  const ruleset = buildBuildLikeRuleset({
    external_directory: "ask",
  })
  const rule = PermissionNext.evaluate("external_directory", `${WORKTREE}/src/main.ts`, ruleset)
  expect(rule.action).toBe("ask")
})
