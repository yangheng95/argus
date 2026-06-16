import { Database, NotFoundError, and, desc, eq, isNull, like, or, sql } from "../storage/db"
import fs from "node:fs/promises"
import { Instance } from "@/project/instance"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { Session } from "@/session"
import { SessionTable } from "@/session/session.sql"
import { MissionID } from "./schema"

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

function missionIDFromInfo(session: Session.Info): string | undefined {
  const missionID = (session.metadata as { mission?: { id?: unknown } } | undefined)?.mission?.id
  const parsed = MissionID.safeParse(missionID)
  return parsed.success ? parsed.data : undefined
}

async function ensureMissionRuntimeDirectory(input: { directory: string; missionID: string }) {
  await fs.mkdir(ProjectRuntimePaths.missionRoot(input.directory, input.missionID), { recursive: true })
}

function findMissionSessionID(missionID: string) {
  return Database.use(
    (db) =>
      db
        .select({ id: SessionTable.id })
        .from(SessionTable)
        .where(
          and(
            eq(SessionTable.project_id, Instance.project.id),
            eq(SessionTable.kind, "mission"),
            sql`json_extract(${SessionTable.metadata}, '$.mission.id') = ${missionID}`,
          ),
        )
        .get()?.id,
  )
}

function findMissionSessionIDByDirectory(input: { missionID: string; directory: string }) {
  return Database.use(
    (db) =>
      db
        .select({ id: SessionTable.id })
        .from(SessionTable)
        .where(
          and(
            eq(SessionTable.directory, input.directory),
            eq(SessionTable.kind, "mission"),
            sql`json_extract(${SessionTable.metadata}, '$.mission.id') = ${input.missionID}`,
          ),
        )
        .get()?.id,
  )
}

function missionSessionConditions(
  input?: {
    directory?: string
    search?: string
    cursorUpdated?: number
    cursorSessionID?: string
    archived?: boolean
  },
  projectID?: string,
) {
  const conditions = [
    eq(SessionTable.kind, "mission"),
    sql`json_extract(${SessionTable.metadata}, '$.mission.id') IS NOT NULL`,
  ]

  if (projectID) {
    conditions.push(eq(SessionTable.project_id, projectID))
  }
  if (input?.directory) {
    conditions.push(eq(SessionTable.directory, input.directory))
  }
  if (input?.search) {
    const term = `%${input.search}%`
    conditions.push(
      or(
        like(SessionTable.title, term),
        sql`json_extract(${SessionTable.metadata}, '$.mission.id') LIKE ${term}`,
        like(SessionTable.directory, term),
      )!,
    )
  }
  if (input?.cursorUpdated !== undefined && input.cursorSessionID) {
    conditions.push(sql`(
      ${SessionTable.time_updated} < ${input.cursorUpdated}
      OR (${SessionTable.time_updated} = ${input.cursorUpdated} AND ${SessionTable.id} < ${input.cursorSessionID})
    )`)
  }
  if (!input?.archived) {
    conditions.push(isNull(SessionTable.time_archived))
  }
  return conditions
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

export async function getMissionSession(missionID: string): Promise<MissionSession> {
  const sessionID = findMissionSessionID(missionID)
  if (!sessionID) throw new NotFoundError({ message: `Mission not found: ${missionID}` })
  const session = await Session.get(sessionID)
  const parsedMissionID = missionIDFromInfo(session)
  if (parsedMissionID !== missionID) throw new NotFoundError({ message: `Mission not found: ${missionID}` })
  return withMissionID(session, parsedMissionID)
}

export async function getMissionSessionByDirectory(input: {
  missionID: string
  directory: string
}): Promise<MissionSession> {
  const sessionID = findMissionSessionIDByDirectory(input)
  if (!sessionID) throw new NotFoundError({ message: `Mission not found: ${input.missionID}` })
  const session = await Session.get(sessionID)
  const parsedMissionID = missionIDFromInfo(session)
  if (parsedMissionID !== input.missionID || session.directory !== input.directory) {
    throw new NotFoundError({ message: `Mission not found: ${input.missionID}` })
  }
  return withMissionID(session, parsedMissionID)
}

export async function* listMissionSessions(input?: {
  directory?: string
  search?: string
  limit?: number
  cursorUpdated?: number
  cursorSessionID?: string
  archived?: boolean
}) {
  const conditions = missionSessionConditions(input, Instance.project.id)
  const limit = input?.limit ?? 100
  const rows = Database.use((db) =>
    db
      .select({ id: SessionTable.id })
      .from(SessionTable)
      .where(and(...conditions))
      .orderBy(desc(SessionTable.time_updated), desc(SessionTable.id))
      .limit(limit)
      .all(),
  )

  for (const row of rows) {
    const session = await Session.get(row.id)
    const missionID = missionIDFromInfo(session)
    if (!missionID) continue
    yield withMissionID(session, missionID)
  }
}

export async function* listGlobalMissionSessions(input?: {
  directory?: string
  search?: string
  limit?: number
  cursorUpdated?: number
  cursorSessionID?: string
  archived?: boolean
}) {
  const conditions = missionSessionConditions(input)
  const limit = input?.limit ?? 100
  const rows = Database.use((db) =>
    db
      .select({ id: SessionTable.id })
      .from(SessionTable)
      .where(and(...conditions))
      .orderBy(desc(SessionTable.time_updated), desc(SessionTable.id))
      .limit(limit)
      .all(),
  )

  for (const row of rows) {
    const session = await Session.get(row.id)
    const missionID = missionIDFromInfo(session)
    if (!missionID) continue
    yield withMissionID(session, missionID)
  }
}

async function ensureMissionSessionInner(input: { missionID: string; defaultCwd: string }) {
  const missionID = MissionID.parse(input.missionID)
  const existingID = findMissionSessionID(missionID)
  if (existingID) {
    const existing = await Session.get(existingID)
    await ensureMissionRuntimeDirectory({ directory: existing.directory, missionID })
    return withMissionID(existing, missionID)
  }

  const created = await Session.createNext({
    kind: "mission",
    title: "Mission Control",
    directory: input.defaultCwd,
  })
  const updated = await Session.mergeMetadata({
    sessionID: created.id,
    patch: {
      mission: {
        id: missionID,
        channelKey: channelKeyForMission(missionID),
        cwd: input.defaultCwd,
      },
    },
  })
  await ensureMissionRuntimeDirectory({ directory: updated.directory, missionID })
  return withMissionID(updated, missionID)
}

export async function ensureMissionSession(input: { missionID: string; defaultCwd: string }) {
  const lockKey = `${Instance.project.id}:${input.missionID}`
  const existing = locks.get(lockKey)
  if (existing) return existing

  const promise = ensureMissionSessionInner(input).finally(() => locks.delete(lockKey))
  locks.set(lockKey, promise)
  return promise
}
