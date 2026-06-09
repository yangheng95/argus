import { expect, test } from "bun:test"
import { overlayMeta } from "../../src/orchestrator/protocol/message-bridge"
import { Session } from "../../src/session"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

// overlayMeta routing contract — pure function over (sessionID, rootSessionID, role).
// Source of truth for "what is this session" is the persisted `session.kind`
// column written by Session.createNext({kind}). No registry, no agent-string
// inference, no fallback.

test("root user message → channel=main (only path that leaves a card)", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const root = await Session.create({ kind: "root", title: "task root" })
      const meta = overlayMeta(root.id, root.id, { role: "user" })
      expect(meta.resolvedRole).toBe("user")
      expect(meta.channel).toBe("main")
    },
  })
})

test("user message in a sub-agent session routes to that sub-agent's card as orchestrator auth", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const root = await Session.create({ kind: "root", title: "task root" })
      const exec = await Session.create({
        kind: "executor",
        goalID: "gol_test_00000000000000000000000001",
        parentID: root.id,
        title: "executor",
      })
      const meta = overlayMeta(exec.id, root.id, { role: "user" })
      expect(meta.resolvedRole).toBe("orchestrator")
      expect(meta.channel).toBe("executor")
    },
  })
})

test("overlay direct reply in a sub-agent session routes as human input inside that agent card", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const root = await Session.create({ kind: "root", title: "task root" })
      const requirements = await Session.create({
        kind: "requirements",
        parentID: root.id,
        title: "requirements",
      })
      const meta = overlayMeta(requirements.id, root.id, {
        role: "user",
        extra: { overlay_direct_reply: true },
      })
      expect(meta.resolvedRole).toBe("user")
      expect(meta.channel).toBe("requirements")
    },
  })
})

test("session row missing from DB throws (let-it-crash, no fallback)", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const root = await Session.create({ kind: "root", title: "task root" })
      // Use a sessionID that was never persisted via Session.createNext.
      const ghostID = "ses_ghost_neverpersisted"
      expect(() => overlayMeta(ghostID, root.id, { role: "user" })).toThrow(/has no kind in the DB/)
    },
  })
})

test("assistant message on root throws — root only holds user content", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const root = await Session.create({ kind: "root", title: "task root" })
      expect(() => overlayMeta(root.id, root.id, { role: "assistant" })).toThrow(
        /Root sessions only hold user-authored content/,
      )
    },
  })
})

test("assistant on a sub-agent session → channel/resolvedRole = its kind", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const root = await Session.create({ kind: "root", title: "task root" })
      const agent = await Session.create({ kind: "assistant", parentID: root.id, title: "agent" })
      const exec = await Session.create({
        kind: "executor",
        goalID: "gol_test_00000000000000000000000001",
        parentID: root.id,
        title: "executor",
      })

      const am = overlayMeta(agent.id, root.id, { role: "assistant" })
      expect(am.resolvedRole).toBe("assistant")
      expect(am.channel).toBe("assistant")

      const em = overlayMeta(exec.id, root.id, { role: "assistant" })
      expect(em.resolvedRole).toBe("executor")
      expect(em.channel).toBe("executor")
    },
  })
})

test("engine self-stamped info.agent has zero effect — kind is the truth source", async () => {
  // OpenCorvus stamps info.agent="build" on executor-session messages, codex
  // stamps "general", etc. The previous bridge had a registry-override + a
  // resolveRole() string-mapper that translated those names. Now overlayMeta
  // doesn't even look at info.agent — it reads session.kind directly. This
  // test pins that contract: no matter what the inner engine writes, the
  // overlay routes by kind.
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const root = await Session.create({ kind: "root", title: "task root" })
      const exec = await Session.create({
        kind: "executor",
        goalID: "gol_test_00000000000000000000000001",
        parentID: root.id,
        title: "executor",
      })
      // overlayMeta only takes role; agent is ignored entirely.
      const meta = overlayMeta(exec.id, root.id, { role: "assistant" })
      expect(meta.resolvedRole).toBe("executor")
      expect(meta.channel).toBe("executor")
    },
  })
})
