import { sql } from "drizzle-orm"
import { Database, and, eq } from "@/storage/db"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionTable } from "@/session/session.sql"

export type MissionSession = Session.Info & { missionID: string }

const locks = new Map<string, Promise<MissionSession>>()

// The channelKey pins exactly one mission session per (project, missionID).
// It is derived from the missionID — single source, no separate input.
function channelKeyForMission(missionID: string): string {
  return `mission:${missionID}`
}

function withMissionID(session: Session.Info, missionID: string): MissionSession {
  return { ...session, missionID }
}

function findMissionSessionID(missionID: string) {
  return Database.use((db) =>
    db
      .select({ id: SessionTable.id })
      .from(SessionTable)
      .where(and(
        eq(SessionTable.project_id, Instance.project.id),
        eq(SessionTable.kind, "mission"),
        sql`json_extract(${SessionTable.metadata}, '$.mission.id') = ${missionID}`,
      ))
      .get()
      ?.id,
  )
}

/**
 * Look up an existing mission session by missionID without creating one.
 *
 * The POST /mission/wake route uses this to distinguish "started a new
 * mission" from "resumed an existing mission" in its response. The actual
 * session acquisition still goes through `ensureMissionSession` — this
 * lookup intentionally has no create semantics.
 */
export function findExistingMissionSession(missionID: string): string | undefined {
  return findMissionSessionID(missionID)
}

async function ensureMissionSessionInner(input: { missionID: string; defaultCwd: string }) {
  const existingID = findMissionSessionID(input.missionID)
  if (existingID) return withMissionID(await Session.get(existingID), input.missionID)

  const created = await Session.createNext({
    kind: "mission",
    title: "Mission Control",
    directory: input.defaultCwd,
  })
  const updated = await Session.mergeMetadata({
    sessionID: created.id,
    patch: {
      mission: {
        id: input.missionID,
        channelKey: channelKeyForMission(input.missionID),
        cwd: input.defaultCwd,
      },
    },
  })
  return withMissionID(updated, input.missionID)
}

export async function ensureMissionSession(input: { missionID: string; defaultCwd: string }) {
  const lockKey = `${Instance.project.id}:${input.missionID}`
  const existing = locks.get(lockKey)
  if (existing) return existing

  const promise = ensureMissionSessionInner(input).finally(() => locks.delete(lockKey))
  locks.set(lockKey, promise)
  return promise
}
