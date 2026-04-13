import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { ensureGatewaySession } from "../../src/gateway/session"
import { readCwd, writeCwd } from "../../src/gateway/cwd-state"
import { channelKey } from "../../src/session/channel-key"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

// Phase 2 invariants (gateway/session + cwd-state):
//  - ensureGatewaySession is a true singleton: two calls with the same
//    channelKey return the same row, no race-induced duplicate.
//  - First call seeds metadata.gateway.cwd to the supplied defaultCwd.
//  - cwd-state read/write round-trips through session metadata.
describe("Gateway session + cwd state (Phase 2)", () => {
  test("ensureGatewaySession returns same row on repeat calls", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const ck = channelKey({ platform: "slack", channel: "C-once", userID: "U1" })
        const a = await ensureGatewaySession({ channelKey: ck, defaultCwd: projectRoot })
        const b = await ensureGatewaySession({ channelKey: ck, defaultCwd: projectRoot })
        expect(a.id).toBe(b.id)
        expect(a.kind).toBe("gateway")
        expect(a.channelKey).toBe(ck)
        await Session.remove(a.id)
      },
    })
  })

  test("ensureGatewaySession seeds metadata.gateway.cwd at first creation", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const ck = channelKey({ platform: "slack", channel: "C-cwd", userID: "U2" })
        const s = await ensureGatewaySession({ channelKey: ck, defaultCwd: projectRoot })
        expect(readCwd(s)).toBe(projectRoot)
        await Session.remove(s.id)
      },
    })
  })

  test("writeCwd persists and is observed on the next read", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const ck = channelKey({ local: true, userID: "U3" })
        const s = await ensureGatewaySession({ channelKey: ck, defaultCwd: projectRoot })
        await writeCwd({ sessionID: s.id, cwd: "/tmp/some-other-project" })
        const reread = await Session.get(s.id)
        expect(readCwd(reread)).toBe("/tmp/some-other-project")
        await Session.remove(s.id)
      },
    })
  })

  test("Concurrent ensureGatewaySession calls collapse into one row", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const ck = channelKey({ platform: "discord", channel: "C-race", userID: "U4" })
        const [a, b] = await Promise.all([
          ensureGatewaySession({ channelKey: ck, defaultCwd: projectRoot }),
          ensureGatewaySession({ channelKey: ck, defaultCwd: projectRoot }),
        ])
        expect(a.id).toBe(b.id)
        await Session.remove(a.id)
      },
    })
  })
})
