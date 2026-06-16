import { and, Database, eq, sql } from "@/storage/db"
import { EngineArtifactTable, EngineGoalTable, EngineTaskTable } from "@/engine/engine.sql"
import { Identifier } from "@/id/id"
import { SessionTable } from "@/session/session.sql"

export type RuntimePathIDKind = "task" | "goal" | "run" | "session"

function isFullIDSegment(segment: string): boolean {
  const separator = segment.lastIndexOf("_")
  return separator > 0 && separator < segment.length - 1
}

function assertOne(kind: RuntimePathIDKind, segment: string, rows: Array<{ id: string }>): string {
  if (rows.length !== 1) {
    throw new Error(`Runtime ${kind} path segment ${segment} matched ${rows.length} database rows`)
  }
  return rows[0]!.id
}

function uniqueRows(rows: Array<{ id: string | null }>): Array<{ id: string }> {
  return [...new Set(rows.map((row) => row.id).filter((id): id is string => Boolean(id)))].map((id) => ({ id }))
}

function resolveRows(kind: RuntimePathIDKind, segment: string, rows: Array<{ id: string }>): string {
  if (isFullIDSegment(segment)) return assertOne(kind, segment, rows.filter((row) => row.id === segment))
  if (segment.length !== Identifier.DIRECTORY_KEY_LENGTH) {
    throw new Error(`Invalid runtime ${kind} path segment: ${segment}`)
  }
  return assertOne(
    kind,
    segment,
    rows.filter((row) => Identifier.directoryKey(row.id) === segment),
  )
}

export namespace RuntimePathIDLookup {
  export function directoryKeyFromFanout(first: string, second: string): string {
    const key = `${first}${second}`
    if (!/^[0-9A-Za-z]{8}$/.test(key)) throw new Error(`Invalid runtime fanout path: ${first}/${second}`)
    return key
  }

  export function resolveFanout(kind: RuntimePathIDKind, projectID: string, first: string, second: string): string {
    return resolve(kind, projectID, directoryKeyFromFanout(first, second))
  }

  export function resolve(kind: RuntimePathIDKind, projectID: string, segment: string): string {
    switch (kind) {
      case "task":
        return task(projectID, segment)
      case "goal":
        return goal(projectID, segment)
      case "run":
        return run(projectID, segment)
      case "session":
        return session(projectID, segment)
    }
  }

  export function task(projectID: string, segment: string): string {
    const rows = Database.use((db) =>
      db
        .select({ id: EngineTaskTable.id })
        .from(EngineTaskTable)
        .where(eq(EngineTaskTable.project_id, projectID))
        .all(),
    )
    return resolveRows("task", segment, rows)
  }

  export function goal(projectID: string, segment: string): string {
    const rows = Database.use((db) =>
      db
        .select({ id: EngineGoalTable.id })
        .from(EngineGoalTable)
        .innerJoin(EngineTaskTable, eq(EngineTaskTable.id, EngineGoalTable.task_id))
        .where(eq(EngineTaskTable.project_id, projectID))
        .all(),
    )
    return resolveRows("goal", segment, rows)
  }

  export function run(projectID: string, segment: string): string {
    const rows = Database.use((db) =>
      db
        .select({ id: EngineArtifactTable.run_id })
        .from(EngineArtifactTable)
        .innerJoin(EngineTaskTable, eq(EngineTaskTable.id, EngineArtifactTable.task_id))
        .where(and(eq(EngineArtifactTable.kind, "run"), eq(EngineTaskTable.project_id, projectID)))
        .all(),
    )
    return resolveRows("run", segment, uniqueRows(rows))
  }

  export function session(projectID: string, segment: string): string {
    const rows = Database.use((db) =>
      db.select({ id: SessionTable.id }).from(SessionTable).where(eq(SessionTable.project_id, projectID)).all(),
    )
    return resolveRows("session", segment, rows)
  }

  export function taskSession(projectID: string, segment: string): { taskID: string; sessionID: string } {
    if (isFullIDSegment(segment)) {
      throw new Error(`Invalid runtime task-session path segment: ${segment}`)
    }
    if (segment.length !== Identifier.DIRECTORY_KEY_LENGTH) {
      throw new Error(`Invalid runtime task-session path segment: ${segment}`)
    }
    const rows = Database.use((db) =>
      db
        .select({
          taskID: EngineTaskTable.id,
          sessionID: SessionTable.id,
        })
        .from(EngineTaskTable)
        .innerJoin(SessionTable, eq(SessionTable.id, EngineTaskTable.session_id))
        .where(eq(EngineTaskTable.project_id, projectID))
        .all(),
    )
    const matches = rows.filter(
      (row) => Identifier.scopedDirectoryKey("task-session", `${row.taskID}:${row.sessionID}`) === segment,
    )
    if (matches.length !== 1) {
      throw new Error(`Runtime task-session path segment ${segment} matched ${matches.length} database rows`)
    }
    return matches[0]!
  }

  export function goalRun(projectID: string, segment: string): { taskID: string; goalID: string; runID: string } {
    if (isFullIDSegment(segment)) {
      throw new Error(`Invalid runtime goal-run path segment: ${segment}`)
    }
    if (segment.length !== Identifier.DIRECTORY_KEY_LENGTH) {
      throw new Error(`Invalid runtime goal-run path segment: ${segment}`)
    }
    const rows = Database.use((db) =>
      db
        .select({
          taskID: EngineTaskTable.id,
          goalID: EngineGoalTable.id,
          runID: EngineArtifactTable.run_id,
        })
        .from(EngineArtifactTable)
        .innerJoin(
          EngineGoalTable,
          and(
            eq(EngineGoalTable.task_id, EngineArtifactTable.task_id),
            sql`json_extract(${EngineArtifactTable.payload}, '$.goal_id') = ${EngineGoalTable.id}`,
          ),
        )
        .innerJoin(EngineTaskTable, eq(EngineTaskTable.id, EngineArtifactTable.task_id))
        .where(and(eq(EngineArtifactTable.kind, "goal_run_attempt"), eq(EngineTaskTable.project_id, projectID)))
        .all(),
    )
    const candidates = rows.filter((row): row is { taskID: string; goalID: string; runID: string } =>
      Boolean(row.runID),
    )
    const unique = [
      ...new Map(candidates.map((row) => [`${row.taskID}:${row.goalID}:${row.runID}`, row] as const)).values(),
    ]
    const matches = unique.filter(
      (row) => Identifier.scopedDirectoryKey("goal-run", `${row.taskID}:${row.goalID}:${row.runID}`) === segment,
    )
    if (matches.length !== 1) {
      throw new Error(`Runtime goal-run path segment ${segment} matched ${matches.length} database rows`)
    }
    return matches[0]!
  }
}
