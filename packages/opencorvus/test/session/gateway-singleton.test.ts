import { describe, expect, test } from "bun:test"
import path from "path"
import { Session } from "../../src/session"
import { channelKey } from "../../src/session/channel-key"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

// Phase 1 schema invariants:
//  - session.kind defaults to "task" for legacy code paths
//  - the partial unique index session_gateway_singleton_idx prevents creating
//    two gateway sessions for the same channel_key
//  - kind="task" sessions are unaffected by the index (any number allowed)
describe("Gateway session singleton (Phase 1 schema)", () => {
  test("Session.createNext defaults to kind='task' and channel_key=null", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const s = await Session.createNext({ directory: projectRoot })
        expect(s.kind).toBe("task")
        expect(s.channelKey).toBeUndefined()
        await Session.remove(s.id)
      },
    })
  })

  test("Gateway session round-trips kind + channelKey through fromRow/toRow", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const ck = channelKey({ platform: "slack", channel: "C123", userID: "U1" })
        const s = await Session.createNext({
          directory: projectRoot,
          kind: "gateway",
          channelKey: ck,
        })
        expect(s.kind).toBe("gateway")
        expect(s.channelKey).toBe(ck)
        const reread = await Session.get(s.id)
        expect(reread.kind).toBe("gateway")
        expect(reread.channelKey).toBe(ck)
        await Session.remove(s.id)
      },
    })
  })

  test("Two gateway sessions for the same channel_key are rejected by the unique index", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const ck = channelKey({ platform: "slack", channel: "C-dup", userID: "U-dup" })
        const first = await Session.createNext({
          directory: projectRoot,
          kind: "gateway",
          channelKey: ck,
        })
        let threw = false
        try {
          await Session.createNext({
            directory: projectRoot,
            kind: "gateway",
            channelKey: ck,
          })
        } catch (err) {
          threw = true
        }
        expect(threw).toBe(true)
        await Session.remove(first.id)
      },
    })
  })

  test("kind='task' sessions can share a directory without uniqueness conflict", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const a = await Session.createNext({ directory: projectRoot })
        const b = await Session.createNext({ directory: projectRoot })
        expect(a.id).not.toBe(b.id)
        await Session.remove(a.id)
        await Session.remove(b.id)
      },
    })
  })
})
