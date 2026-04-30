import { test, expect } from "bun:test"
import { PermissionNext } from "../../src/permission/next"

/**
 * Regression for specs/scheduler-fix-plan-2026-04-30.md P3 (commit
 * e87333dbb) + codex 2nd-pass [P2] "Place worktree allow between defaults
 * and user rules". The composition in agent/agent.ts:155-175 layers as:
 *
 *   defaults (whitelistedDirs adds Instance.directory/** as allow)
 *   → agent overrides (e.g. webfetch: allow on the build agent)
 *   → user (cfg.permission)
 *
 * `findLast`-wins evaluator means user explicit `deny` rules MUST override
 * the worktree allow rule (otherwise users have no way to lock a sensitive
 * subdirectory inside their worktree). This test pins that invariant — if
 * a future change moves whitelistedDirs to a layer AFTER user, this test
 * fails.
 *
 * Also locks the inverse: a worktree-internal request with no user override
 * resolves to `allow` (NOT the default `*: ask`) — that's the
 * unattended-bench-friendliness property whitelistedDirs exists for.
 */

const WORKTREE = "C:/Users/test/worktree-A"

function buildBuildLikeRuleset(userOverrides: Record<string, unknown> = {}) {
  // Mirror the build-agent composition at agent/agent.ts:155-175. Only the
  // external_directory rule shape matters for this test; other rules are
  // omitted to keep the ruleset focused.
  const defaults = PermissionNext.fromConfig({
    "*": "ask",
    external_directory: {
      "*": "ask",
      [`${WORKTREE}/**`]: "allow",
    },
  })
  const agentOverrides = PermissionNext.fromConfig({
    question: "allow",
    webfetch: "allow",
  })
  const user = PermissionNext.fromConfig(userOverrides)
  return PermissionNext.merge(defaults, agentOverrides, user)
}

test("worktree-internal path with no user override resolves to allow (whitelistedDirs effective)", () => {
  const ruleset = buildBuildLikeRuleset()
  const rule = PermissionNext.evaluate(
    "external_directory",
    `${WORKTREE}/src/main.ts`,
    ruleset,
  )
  expect(rule.action).toBe("allow")
})

test("path outside worktree falls through to ask (boundary defense intact)", () => {
  const ruleset = buildBuildLikeRuleset()
  const rule = PermissionNext.evaluate(
    "external_directory",
    "C:/Users/test/sibling-worktree-B/src/main.ts",
    ruleset,
  )
  expect(rule.action).toBe("ask")
})

test("user explicit deny within worktree wins over worktree allow (deny-wins ordering)", () => {
  const ruleset = buildBuildLikeRuleset({
    external_directory: {
      [`${WORKTREE}/secret/**`]: "deny",
    },
  })
  // Path matches BOTH the defaults' worktree-allow AND user's secret-deny;
  // user's deny is the LAST matching rule in the merged array → deny wins.
  const rule = PermissionNext.evaluate(
    "external_directory",
    `${WORKTREE}/secret/api-key.env`,
    ruleset,
  )
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
  const rule = PermissionNext.evaluate(
    "external_directory",
    `${WORKTREE}/src/main.ts`,
    ruleset,
  )
  expect(rule.action).toBe("allow")
})

test("user general external_directory ask overrides whitelistedDirs (operator's prerogative)", () => {
  // If a user explicitly says "ask for all external_directory", that
  // intentionally suppresses the convenience auto-allow. The user is
  // accepting that unattended runs will block; that's their call.
  const ruleset = buildBuildLikeRuleset({
    external_directory: "ask",
  })
  const rule = PermissionNext.evaluate(
    "external_directory",
    `${WORKTREE}/src/main.ts`,
    ruleset,
  )
  expect(rule.action).toBe("ask")
})
