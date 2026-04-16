import { expect, test, beforeEach } from "bun:test"
import { overlayMeta, resolveRole } from "../../src/server/routes/task-message-protocol-bridge"
import {
  registerGoalRunSession,
  unregisterGoalRunSession,
} from "../../src/server/routes/task-event"

test("coding executor ids resolve to executor overlay role", () => {
  expect(resolveRole("opencode")).toBe("executor")
  expect(resolveRole("codex")).toBe("executor")
  expect(resolveRole("claude-code")).toBe("executor")
})

// ── overlayMeta routing contract ──
// Pure routing function: given (sessionID, rootSessionID, rawInfo) decides
// (resolvedRole, channel). DB-free — caller supplies rootSessionID so tests
// don't need a persisted task row.

const TASK_ID = "tsk_test_overlaymeta"
const ROOT_SID = "ses_root_test"
const EXECUTOR_SID = "ses_exec_test"

beforeEach(() => {
  unregisterGoalRunSession(ROOT_SID)
  unregisterGoalRunSession(EXECUTOR_SID)
  registerGoalRunSession(ROOT_SID, TASK_ID, "assistant")
})

test("root user message → channel=main (only path that leaves an agent card)", () => {
  const meta = overlayMeta(ROOT_SID, ROOT_SID, { role: "user" })
  expect(meta.resolvedRole).toBe("user")
  expect(meta.channel).toBe("main")
})

test("child user message (orchestrator prompt) routes to the sub-agent's card", () => {
  registerGoalRunSession(EXECUTOR_SID, TASK_ID, "executor", "goal_x")
  const meta = overlayMeta(EXECUTOR_SID, ROOT_SID, { role: "user" })
  expect(meta.resolvedRole).toBe("user")
  expect(meta.channel).toBe("executor")
})

test("child user message WITHOUT registered parent throws (let-it-crash, no fallback)", () => {
  // Fix A's invariant: registerGoalRunSession must run before the session
  // emits any message. Child user messages on an unregistered session are a
  // bridge timing bug, never a legitimate state.
  expect(() => overlayMeta(EXECUTOR_SID, ROOT_SID, { role: "user" })).toThrow(
    /has no registered role/,
  )
})

test("assistant from root task-agent → channel=assistant (own card at root)", () => {
  // The old bridge specialed isRoot to channel=main, hiding task-agent output.
  // Current contract: root assistant gets its own top-level agent card.
  const meta = overlayMeta(ROOT_SID, ROOT_SID, { role: "assistant", agent: "orchestrator" })
  expect(meta.resolvedRole).toBe("assistant")
  expect(meta.channel).toBe("assistant")
})

test("Fix B: registered role overrides engine-stamped agent on assistant path", () => {
  // opencode internally stamps info.agent="build" on executor-session
  // messages. overlayMeta itself honours whatever agent is on info — the
  // registry override is applied upstream in enrichProperties BEFORE calling
  // overlayMeta. These two assertions verify both halves of the contract:
  //
  //   1. Raw agent="build" → channel=build (no override performed).
  //   2. Enrichment replaces agent with the registered role → channel=executor.
  registerGoalRunSession(EXECUTOR_SID, TASK_ID, "executor", "goal_x")

  const rawMeta = overlayMeta(EXECUTOR_SID, ROOT_SID, { role: "assistant", agent: "build" })
  expect(rawMeta.resolvedRole).toBe("build")
  expect(rawMeta.channel).toBe("build")

  const enrichedMeta = overlayMeta(EXECUTOR_SID, ROOT_SID, { role: "assistant", agent: "executor" })
  expect(enrichedMeta.resolvedRole).toBe("executor")
  expect(enrichedMeta.channel).toBe("executor")
})

test("assistant with empty agent falls through to 'assistant'", () => {
  const meta = overlayMeta(ROOT_SID, ROOT_SID, { role: "assistant", agent: "" })
  expect(meta.resolvedRole).toBe("assistant")
  expect(meta.channel).toBe("assistant")
})
