import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { ensureGatewaySession, findExistingGatewaySession } from "../../src/gateway/session"
import { channelKey } from "../../src/session/channel-key"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

// Invariants for gateway/session (the mission supervisor wake path
// reuses these helpers via channelKey="master:<missionID>"):
//   - ensureGatewaySession is a true singleton: two calls with the same
//     channelKey return the same row, no race-induced duplicate.
//   - First call seeds metadata.gateway.cwd to the supplied defaultCwd.
//   - findExistingGatewaySession is read-only and returns the row id
//     when present, undefined when absent.
//
// (The legacy switch_cwd / writeCwd / readCwd helpers were dropped
// with the decompose chain — there is no per-session mutable cwd
// surface anymore. The mission supervisor's cwd is the project
// directory at wake time; cross-worktree work is dispatched, not
// captured in a session metadata field.)
describe("Gateway session helpers", () => {
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
        const cwd = (s.metadata as { gateway?: { cwd?: string } } | undefined)?.gateway?.cwd
        expect(cwd).toBe(projectRoot)
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

  test("findExistingGatewaySession returns undefined before, id after ensure", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const ck = channelKey({ platform: "slack", channel: "C-find", userID: "U-find" })
        expect(findExistingGatewaySession(ck)).toBeUndefined()
        const s = await ensureGatewaySession({ channelKey: ck, defaultCwd: projectRoot })
        expect(findExistingGatewaySession(ck)).toBe(s.id)
        await Session.remove(s.id)
      },
    })
  })

  test("master:<missionID> channelKey is namespace-isolated from panel channelKeys", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const ckPanel = channelKey({ platform: "slack", channel: "C-iso", userID: "U-iso" })
        const ckMaster = `master:tv-replay-iso`
        const panel = await ensureGatewaySession({ channelKey: ckPanel, defaultCwd: projectRoot })
        const master = await ensureGatewaySession({ channelKey: ckMaster, defaultCwd: projectRoot })
        expect(panel.id).not.toBe(master.id)
        await Session.remove(panel.id)
        await Session.remove(master.id)
      },
    })
  })
})
