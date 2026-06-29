import { afterEach, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Session } from "../../src/session"
import { SessionStatus } from "../../src/session/status"
import { Bus } from "../../src/bus"

/**
 * Regression for specs/scheduler-collab-audit-2026-04-30.md §11.3 + bench
 * lines 19182-19183 (`session.terminal session=ses_221e2a0d... reason=aborted`
 * followed by `reason=completed` for the SAME session). Codex 3rd-pass
 * narrowed the cause: build sessions run their actor in the worktree
 * Instance (close() emits `terminal aborted`) while runAgentSession returns
 * in the caller / orchestrator Instance (emits `terminal completed`). With a
 * lazyInstanceState map, each Instance's local latch passed independently
 * and the bus carried both terminals.
 *
 * This test reproduces the cross-Instance shape and asserts only one
 * terminal escapes (the first one wins, regardless of which Instance
 * issued it).
 *
 * Also covers the re-entrancy race (audit §11.3 H1): a Bus subscriber
 * synchronously re-entering SessionStatus.set during the publish must see
 * the latch already sealed. The fix moved the state write BEFORE the
 * publish; this test enforces that ordering invariant from the public API.
 */

afterEach(async () => {
  await Instance.disposeAll()
})

test("SessionStatus.set: cross-Instance terminal race — only the first terminal escapes", async () => {
  await using tmpA = await tmpdir({ git: true })
  await using tmpB = await tmpdir({ git: true })
  let sessionID = ""

  // The bus is process-global (not lazyInstanceState), so a subscriber
  // installed under Instance A sees publishes that originated from Instance B
  // too. We track terminals across both.
  const terminals: SessionStatus.Info[] = []
  let sub: (() => void) | null = null

  await Instance.provide({
    directory: tmpA.path,
    fn: async () => {
      const session = await Session.create({ kind: "assistant", title: "cross instance status" })
      sessionID = session.id
      sub = Bus.subscribe(SessionStatus.Event.Status, (msg) => {
        if (msg.properties.sessionID === sessionID && msg.properties.status.type === "terminal") {
          terminals.push(msg.properties.status)
        }
      })
      // Instance A: simulates the actor closing with reason=aborted
      // (worktree Instance for build sessions).
      SessionStatus.set(sessionID, { type: "terminal", reason: "aborted" })
    },
  })

  await Instance.provide({
    directory: tmpB.path,
    fn: async () => {
      // Instance B: simulates runAgentSession's natural-finish completed
      // emit from the orchestrator Instance. Pre-fix this passed the local
      // latch (lazyInstanceState map for B was untouched by A's terminal).
      SessionStatus.set(sessionID, { type: "terminal", reason: "completed" })
    },
  })

  try {
    expect(terminals.length).toBe(1)
    expect(terminals[0]).toEqual({ type: "terminal", reason: "aborted" })
  } finally {
    sub?.()
  }
})

test("SessionStatus.set: re-entrant subscriber sees sealed state during publish (H1 race)", async () => {
  await using tmp = await tmpdir({ git: true })
  const terminals: SessionStatus.Info[] = []

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ kind: "assistant", title: "reentrant status" })
      const sessionID = session.id
      // Subscriber re-enters set() synchronously when it sees the first
      // terminal. Pre-fix, the state write happened AFTER publish, so
      // the re-entrant call's check at line 97 saw state still un-sealed
      // and the second terminal would publish too.
      const sub = Bus.subscribe(SessionStatus.Event.Status, (msg) => {
        if (msg.properties.sessionID === sessionID && msg.properties.status.type === "terminal") {
          terminals.push(msg.properties.status)
          // Synchronous re-entry. Must be sealed by now.
          SessionStatus.set(sessionID, { type: "terminal", reason: "completed" })
        }
      })
      try {
        SessionStatus.set(sessionID, { type: "terminal", reason: "aborted" })
        // Only the original aborted terminal must have escaped. The
        // re-entrant completed must have hit the sealed latch.
        expect(terminals.length).toBe(1)
        expect(terminals[0]).toEqual({ type: "terminal", reason: "aborted" })
        expect(SessionStatus.get(sessionID)).toEqual({ type: "terminal", reason: "aborted" })
      } finally {
        sub()
      }
    },
  })
})
