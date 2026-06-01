import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { ensureMissionSession, findExistingMissionSession, listMissionSessions } from "../../src/mission/session"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

// Invariants for mission/session (the Mission agent wake path uses these):
//   - ensureMissionSession is a true singleton per (project, missionID):
//     two calls with the same missionID return the same row, no
//     race-induced duplicate.
//   - First call creates a kind="mission" session titled "Mission Control"
//     and seeds metadata.mission.{id, channelKey, cwd}. channelKey is
//     derived as `mission:<missionID>` (single source — not a separate input).
//   - findExistingMissionSession is read-only and returns the row id when
//     present, undefined when absent.
describe("Mission session helpers", () => {
  test("ensureMissionSession returns same row on repeat calls", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const a = await ensureMissionSession({ missionID: "m-once", defaultCwd: projectRoot })
        const b = await ensureMissionSession({ missionID: "m-once", defaultCwd: projectRoot })
        expect(a.id).toBe(b.id)
        expect(a.kind).toBe("mission")
        expect(a.title).toBe("Mission Control")
        expect(a.missionID).toBe("m-once")
        await Session.remove(a.id)
      },
    })
  })

  test("ensureMissionSession seeds metadata.mission.{id,channelKey,cwd} at first creation", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const s = await ensureMissionSession({ missionID: "m-cwd", defaultCwd: projectRoot })
        const mission = (s.metadata as { mission?: { id?: string; channelKey?: string; cwd?: string } } | undefined)?.mission
        expect(mission?.id).toBe("m-cwd")
        expect(mission?.channelKey).toBe("mission:m-cwd")
        expect(mission?.cwd).toBe(projectRoot)
        await Session.remove(s.id)
      },
    })
  })

  test("Concurrent ensureMissionSession calls collapse into one row", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const [a, b] = await Promise.all([
          ensureMissionSession({ missionID: "m-race", defaultCwd: projectRoot }),
          ensureMissionSession({ missionID: "m-race", defaultCwd: projectRoot }),
        ])
        expect(a.id).toBe(b.id)
        await Session.remove(a.id)
      },
    })
  })

  test("findExistingMissionSession returns undefined before, id after ensure", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        expect(findExistingMissionSession("m-find")).toBeUndefined()
        const s = await ensureMissionSession({ missionID: "m-find", defaultCwd: projectRoot })
        expect(findExistingMissionSession("m-find")).toBe(s.id)
        await Session.remove(s.id)
      },
    })
  })

  test("distinct missionIDs key distinct sessions", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const a = await ensureMissionSession({ missionID: "m-iso-a", defaultCwd: projectRoot })
        const b = await ensureMissionSession({ missionID: "m-iso-b", defaultCwd: projectRoot })
        expect(a.id).not.toBe(b.id)
        await Session.remove(a.id)
        await Session.remove(b.id)
      },
    })
  })

  test("listMissionSessions returns Mission metadata rows only", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const mission = await ensureMissionSession({ missionID: "m-list", defaultCwd: projectRoot })
        const assistant = await Session.createNext({ kind: "assistant", title: "Assistant", directory: projectRoot })
        const rows = []
        for await (const row of listMissionSessions({ search: "m-list" })) rows.push(row)

        expect(rows.map((row) => row.id)).toEqual([mission.id])
        expect(rows[0]?.missionID).toBe("m-list")

        await Session.remove(mission.id)
        await Session.remove(assistant.id)
      },
    })
  })
})
