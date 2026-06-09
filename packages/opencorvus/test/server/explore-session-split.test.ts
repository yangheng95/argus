/**
 * Regression: the orchestrator `explore` tool, reintroduced in commit
 * 60b3ce2e15 ("retire deliver, promote integrity"), created its sub-agent
 * session with `kind: "assistant"`. Because the overlay splits sessions per
 * agent purely off `session.kind` (overlayMeta → info.channel →
 * stageFromChannel → projectConversationView), every explore dispatch
 * collapsed into the single generic "assistant" lane instead of rendering as
 * its own agent card. Fix: dedicated `"explore"` SessionKind, stamped at the
 * dispatch site. These tests pin both the projection and the dispatch site.
 *
 * Run: bun test test/server/explore-session-split.test.ts
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { projectConversationView } from "../../src/conversation/view"

describe("explore subagent session split", () => {
  test("explore-channel sessions get their own 'explore' stage, not collapsed into assistant", () => {
    const transcript = [
      {
        info: { id: "msg_user", sessionID: "ses_root", channel: "main", time: { created: 10 } },
      },
      // Two separate explore dispatches + an unrelated assistant session.
      {
        info: {
          id: "msg_explore_a",
          sessionID: "ses_explore_a",
          channel: "explore",
          parentSessionID: "ses_orch",
          time: { created: 20 },
        },
      },
      {
        info: {
          id: "msg_explore_b",
          sessionID: "ses_explore_b",
          channel: "explore",
          parentSessionID: "ses_orch",
          time: { created: 30 },
        },
      },
      {
        info: {
          id: "msg_assistant",
          sessionID: "ses_assistant",
          channel: "assistant",
          parentSessionID: "ses_orch",
          time: { created: 40 },
        },
      },
    ]

    const view = projectConversationView({}, transcript)

    const exploreA = view.sessions.find((s) => s.sessionID === "ses_explore_a")
    const exploreB = view.sessions.find((s) => s.sessionID === "ses_explore_b")
    const assistant = view.sessions.find((s) => s.sessionID === "ses_assistant")

    // Each explore dispatch is its own session with stage "explore" — NOT
    // merged with the others and NOT relabelled as "assistant".
    expect(exploreA?.stage).toBe("explore")
    expect(exploreB?.stage).toBe("explore")
    expect(assistant?.stage).toBe("assistant")
    expect(exploreA?.messageIDs).toEqual(["msg_explore_a"])
    expect(exploreB?.messageIDs).toEqual(["msg_explore_b"])
    // No explore message bled into the generic assistant lane.
    expect(assistant?.messageIDs).toEqual(["msg_assistant"])
  })

  test("orchestrator explore tool stamps kind:'explore' (not the generic assistant bucket)", () => {
    const toolsSource = readFileSync(join(__dirname, "..", "..", "src", "orchestrator", "tools.ts"), "utf8")
    // The explore dispatch site must create an explore-kinded session.
    const exploreCreate = /const exploreSession = await Session\.createNext\(\{\s*kind:\s*"([^"]+)"/m.exec(toolsSource)
    expect(exploreCreate).not.toBeNull()
    expect(exploreCreate![1]).toBe("explore")
  })

  test("SESSION_KINDS single-source tuple declares the dedicated 'explore' member", () => {
    const sqlSource = readFileSync(join(__dirname, "..", "..", "src", "session", "session.sql.ts"), "utf8")
    // Single source: SessionKind derives from SESSION_KINDS, and the Info.kind
    // z.enum derives from the same tuple — no re-listed duplicate (rule 8).
    expect(sqlSource).toMatch(/export const SESSION_KINDS = \[[\s\S]*"explore"[\s\S]*\] as const/)
    expect(sqlSource).toMatch(/export type SessionKind = \(typeof SESSION_KINDS\)\[number\]/)
  })
})
