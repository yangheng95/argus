import { afterEach, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Session } from "../../src/session"
import { SessionStatus } from "../../src/session/status"
import { Bus } from "../../src/bus"

afterEach(async () => {
  await Instance.disposeAll()
})

test("SessionStatus.set: terminal is single-source — second terminal is dropped", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ kind: "assistant", title: "status idempotency" })
      const sessionID = session.id
      const events: SessionStatus.Info[] = []
      const sub = Bus.subscribe(SessionStatus.Event.Status, (msg) => {
        if (msg.properties.sessionID === sessionID) events.push(msg.properties.status)
      })
      try {
        SessionStatus.set(sessionID, { type: "streaming" })
        // Reproduces G4: aborted from cancel(), then a stale completed from
        // the actor's natural serve() exit 6ms later.
        SessionStatus.set(sessionID, { type: "terminal", reason: "aborted" })
        SessionStatus.set(sessionID, { type: "terminal", reason: "completed" })

        const terminals = events.filter((e) => e.type === "terminal")
        expect(terminals.length).toBe(1)
        expect(terminals[0]).toEqual({ type: "terminal", reason: "aborted" })
        expect(SessionStatus.get(sessionID)).toEqual({ type: "terminal", reason: "aborted" })
      } finally {
        sub()
      }
    },
  })
})

test("SessionStatus.set: status changes after terminal are dropped (no streaming-after-terminal)", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ kind: "assistant", title: "status seal" })
      const sessionID = session.id
      const events: SessionStatus.Info[] = []
      const sub = Bus.subscribe(SessionStatus.Event.Status, (msg) => {
        if (msg.properties.sessionID === sessionID) events.push(msg.properties.status)
      })
      try {
        SessionStatus.set(sessionID, { type: "terminal", reason: "completed" })
        SessionStatus.set(sessionID, { type: "streaming" })
        SessionStatus.set(sessionID, { type: "idle" })

        // Only the first terminal escapes; everything after is dropped.
        expect(events.length).toBe(1)
        expect(events[0]).toEqual({ type: "terminal", reason: "completed" })
      } finally {
        sub()
      }
    },
  })
})

test("SessionStatus.set: terminal summary is published and stored with the terminal lifecycle", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ kind: "assistant", title: "status summary" })
      const sessionID = session.id
      const events: SessionStatus.Info[] = []
      const sub = Bus.subscribe(SessionStatus.Event.Status, (msg) => {
        if (msg.properties.sessionID === sessionID) events.push(msg.properties.status)
      })
      try {
        SessionStatus.set(sessionID, {
          type: "terminal",
          reason: "completed",
          summary: "I registered the requirements and reported two acceptance checks.",
        })

        expect(events).toEqual([
          {
            type: "terminal",
            reason: "completed",
            summary: "I registered the requirements and reported two acceptance checks.",
          },
        ])
        expect(SessionStatus.get(sessionID)).toEqual(events[0])
      } finally {
        sub()
      }
    },
  })
})

test("SessionStatus.set: pre-terminal flow (streaming/retry/idle) still works as before", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ kind: "assistant", title: "status flow" })
      const sessionID = session.id
      const events: SessionStatus.Info[] = []
      const idleEvents: string[] = []
      const sub1 = Bus.subscribe(SessionStatus.Event.Status, (msg) => {
        if (msg.properties.sessionID === sessionID) events.push(msg.properties.status)
      })
      const sub2 = Bus.subscribe(SessionStatus.Event.Idle, (msg) => {
        if (msg.properties.sessionID === sessionID) idleEvents.push("idle")
      })
      try {
        SessionStatus.set(sessionID, { type: "streaming" })
        SessionStatus.set(sessionID, {
          type: "retry",
          attempt: 1,
          message: "Provider rate limit",
          next: Date.now() + 1000,
        })
        SessionStatus.set(sessionID, { type: "streaming" })
        SessionStatus.set(sessionID, { type: "idle" })

        expect(events.map((e) => e.type)).toEqual(["streaming", "retry", "streaming", "idle"])
        expect(idleEvents).toEqual(["idle"])
        // After idle, state is deleted — fresh terminal is allowed.
        SessionStatus.set(sessionID, { type: "terminal", reason: "completed" })
        expect(events.map((e) => e.type)).toEqual(["streaming", "retry", "streaming", "idle", "terminal"])
      } finally {
        sub1()
        sub2()
      }
    },
  })
})
