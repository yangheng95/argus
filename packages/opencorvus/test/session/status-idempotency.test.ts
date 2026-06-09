import { afterEach, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
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
      const events: SessionStatus.Info[] = []
      const sub = Bus.subscribe(SessionStatus.Event.Status, (msg) => {
        if (msg.properties.sessionID === "ses_test_idem") events.push(msg.properties.status)
      })
      try {
        SessionStatus.set("ses_test_idem", { type: "streaming" })
        // Reproduces G4: aborted from cancel(), then a stale completed from
        // the actor's natural serve() exit 6ms later.
        SessionStatus.set("ses_test_idem", { type: "terminal", reason: "aborted" })
        SessionStatus.set("ses_test_idem", { type: "terminal", reason: "completed" })

        const terminals = events.filter((e) => e.type === "terminal")
        expect(terminals.length).toBe(1)
        expect(terminals[0]).toEqual({ type: "terminal", reason: "aborted" })
        expect(SessionStatus.get("ses_test_idem")).toEqual({ type: "terminal", reason: "aborted" })
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
      const events: SessionStatus.Info[] = []
      const sub = Bus.subscribe(SessionStatus.Event.Status, (msg) => {
        if (msg.properties.sessionID === "ses_test_seal") events.push(msg.properties.status)
      })
      try {
        SessionStatus.set("ses_test_seal", { type: "terminal", reason: "completed" })
        SessionStatus.set("ses_test_seal", { type: "streaming" })
        SessionStatus.set("ses_test_seal", { type: "idle" })

        // Only the first terminal escapes; everything after is dropped.
        expect(events.length).toBe(1)
        expect(events[0]).toEqual({ type: "terminal", reason: "completed" })
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
      const events: SessionStatus.Info[] = []
      const idleEvents: string[] = []
      const sub1 = Bus.subscribe(SessionStatus.Event.Status, (msg) => {
        if (msg.properties.sessionID === "ses_test_flow") events.push(msg.properties.status)
      })
      const sub2 = Bus.subscribe(SessionStatus.Event.Idle, (msg) => {
        if (msg.properties.sessionID === "ses_test_flow") idleEvents.push("idle")
      })
      try {
        SessionStatus.set("ses_test_flow", { type: "streaming" })
        SessionStatus.set("ses_test_flow", {
          type: "retry",
          attempt: 1,
          message: "Provider rate limit",
          next: Date.now() + 1000,
        })
        SessionStatus.set("ses_test_flow", { type: "streaming" })
        SessionStatus.set("ses_test_flow", { type: "idle" })

        expect(events.map((e) => e.type)).toEqual(["streaming", "retry", "streaming", "idle"])
        expect(idleEvents).toEqual(["idle"])
        // After idle, state is deleted — fresh terminal is allowed.
        SessionStatus.set("ses_test_flow", { type: "terminal", reason: "completed" })
        expect(events.map((e) => e.type)).toEqual(["streaming", "retry", "streaming", "idle", "terminal"])
      } finally {
        sub1()
        sub2()
      }
    },
  })
})
